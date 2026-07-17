# AVT110 Tracker Ingest

A NestJS service that:

- Listens on a **raw TCP socket** for AVT110 (EGPRS/LTE Cat-1) GNSS tracker
  connections and decodes the AVT110 Tracker Protocol (R6.01) frames they
  send (`+RPT`, `-RPT`, `+HBD`, ...), replying with `+SACK`/`+SHBD` as the
  protocol requires.
- Listens on a **second, independent raw TCP socket** for ERM/StarLink
  trackers (StarLink Tracker, TrackerSF, ...) and decodes their "SLU"
  text protocol.
- Persists what it decodes to PostgreSQL (device snapshot + full report
  history, including the raw payload for later reprocessing).
- Exposes a small read-only HTTP API to inspect what's been received.

This follows the vendor's "AVT110 Tracker Protocol R6.01" document - see
[`docs/README.md`](docs/README.md) for where to drop that PDF in this repo
and which sections map to which parts of the parser. The StarLink side has
no equivalent PDF (ERM's own protocol docs at sweb.erm.co.il/protocol are
login-gated) - see `src/starlink/parser/starlink-parser.service.ts` for
where that format was actually sourced from (Traccar's open-source
decoder) and its known gaps.

## Requirements

- Node.js 20+ (developed/tested on Node 24)
- pnpm
- Docker (for the local Postgres instance) - or any PostgreSQL 13+ instance

## Setup

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Start PostgreSQL**

   ```bash
   docker compose up -d
   ```

   This starts Postgres on `localhost:5433` (deliberately not the default
   5432 - see the note below) with the credentials from your `.env` file
   (`avt` / `avt` / database `avt_tracker` by default).

   > **Windows note:** if you already have a native PostgreSQL install
   > running as a Windows service, it likely occupies port 5432, and Docker
   > Desktop's port-forwarding for `localhost:5432` can get silently
   > shadowed by it - connections would then hit your native Postgres
   > instead of the container and fail with a password/auth error. Using
   > 5433 for this project's container sidesteps that entirely.

3. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Adjust as needed - see [Environment variables](#environment-variables)
   below. The defaults work out of the box with the bundled
   `docker-compose.yml`.

4. **Run database migrations**

   ```bash
   pnpm run migration:run
   ```

   `synchronize` is intentionally left `false` (see `DB_SYNCHRONIZE` below) -
   schema changes always go through a reviewed migration file, never
   auto-sync, even in development.

5. **Start the app**

   ```bash
   pnpm run start:dev
   ```

   On startup you'll see two listeners come up:

   ```
   AVT110 tracker TCP listener started on 0.0.0.0:6001 (configure the device with AT@SIS=at,0,1,<this-host>,6001,,,0,0001#)
   HTTP API listening on http://localhost:3000
   ```

## Pointing an AVT110 at this server

The device opens the TCP connection *outward* to you - there's nothing to
listen for on the device side. Configure it with the tracker protocol's
`AT@SIS` command (Main Server Information Settings), pointing at this
machine's IP and the `TRACKER_TCP_PORT` below, e.g.:

```
AT@SIS=at,0,1,203.0.113.10,6001,,,0,0001#
```

- `1` = TCP report mode
- `203.0.113.10` = this server's IP (reachable from the device/SIM's network)
- `6001` = must match `TRACKER_TCP_PORT`
- `0001` = command serial number (any 4-hex-digit value)

Once configured, the device will connect, start sending `+HBD` heartbeats
and `+RPT` reports, and this server will start showing it under
`GET /tracker/devices`.

## Environment variables

See [`.env.example`](.env.example) for the full list with defaults. Summary:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP API port (Nest) |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | Postgres connection |
| `DB_SYNCHRONIZE` | Never `true` outside of a throwaway sandbox - use migrations instead |
| `DB_LOGGING` | Log all SQL TypeORM executes |
| `TRACKER_TCP_HOST` / `TRACKER_TCP_PORT` | Where the raw TCP listener for devices binds. This is **separate** from `PORT` (the HTTP API) - devices never speak HTTP |
| `TRACKER_TCP_SOCKET_TIMEOUT_MS` | Idle socket timeout; devices that go silent longer than this get disconnected (0 disables it) |
| `TRACKER_TCP_MAX_BUFFER_BYTES` | Safety cap on the per-connection receive buffer before it's assumed desynced and dropped |
| `STARLINK_TCP_HOST` / `STARLINK_TCP_PORT` | Where the StarLink TCP listener binds - independent port from the AVT110 one, default `5136` (Traccar's documented default for this protocol) |
| `STARLINK_TCP_SOCKET_TIMEOUT_MS` / `STARLINK_TCP_MAX_BUFFER_BYTES` | Same idea as the AVT110 ones above, for the StarLink listener |

## HTTP API

All endpoints are read-only and unauthenticated for now - they exist to
verify the TCP ingest pipeline is working, not as a production API surface.

- `GET /tracker/devices` - every device seen so far, with its last known
  position/battery/event and whether it's currently connected over TCP.
- `GET /tracker/devices/:imei/reports?limit=&from=&to=` - report history
  for one device (`limit` default 50, max 1000; `from`/`to` filter on
  received time).
- `GET /tracker/monitor/overview` - how many devices are known vs.
  currently connected, plus per-device connection metadata (good for a
  dashboard).
- `GET /tracker/monitor/events?limit=` - the most recent reports across
  *all* devices, newest first (a live event feed).
- `GET /tracker/events/unread?limit=` - polling alternative to the SNS
  push (see below): returns domain events (`tracker.device.connected`/
  `disconnected`/`tracker.report.received`/`starlink.*`) not yet fetched
  by a consumer, oldest first (default 100, max 500), and **marks them
  delivered as a side effect of the call** - a repeat call only returns
  what's new since the last poll. Prefer the SNS/SQS path if you need
  at-least-once delivery without risking a dropped HTTP response losing
  events.

StarLink has the same shape of endpoints under `/starlink` instead of
`/tracker`: `GET /starlink/devices`,
`GET /starlink/devices/:deviceId/reports?limit=&from=&to=`,
`GET /starlink/monitor/overview`, `GET /starlink/monitor/events?limit=`.
`deviceId` is what the unit reports on the wire (6 hex chars or a 15-digit
IMEI) - there's no separate `/starlink/events/unread`, both protocols
share the one `/tracker/events/unread` outbox (see below).

## Cross-service events

Every `tracker.device.connected`/`disconnected`/`tracker.report.received`
and `starlink.device.connected`/`disconnected`/`starlink.report.received`
domain event is fanned out two ways (see `TrackerEventPublisherService`,
which handles both protocols' events): a best-effort push to an SNS topic
(`SNS_TOPIC_ARN`), and a durable row in Postgres backing the
`/tracker/events/unread` endpoint above. Both carry the same versioned
envelope: `{ eventType, version, occurredAt, imei, data }` (`imei` holds
the StarLink `deviceId` for StarLink events - it's really just a "device
identifier" column, named for where it originated).

## Architecture

```
src/
  config/            @nestjs/config setup + Joi validation schema
  database/           TypeORM (Postgres) module, CLI data-source, migrations
  tracker/             AVT110 protocol (binary, '#'-terminated)
    parser/           Pure, dependency-free frame decoder (TrackerParserService)
    tcp/               net.createServer listener + per-socket frame buffering
                        + in-memory "who's connected" registry
    persistence/       TypeORM repository access (devices + reports)
    events/            @nestjs/event-emitter event names/payloads
    publishing/        Fans tracker.*/starlink.* events out to SNS + outbox
    entities/          TrackerDevice / TrackerReport / TrackerEvent
    tracker.controller.ts
  starlink/            ERM/StarLink "SLU" protocol (text, newline-terminated)
    parser/           Pure, dependency-free frame decoder (StarlinkParserService)
    tcp/               Same shape as tracker/tcp, on its own port
    persistence/       TypeORM repository access (devices + reports)
    events/            @nestjs/event-emitter event names/payloads
    entities/          StarlinkDevice / StarlinkReport
    starlink.controller.ts
```

Key design choices:

- **The TCP listener is a plain `net.createServer`**, wired up as a regular
  Nest provider (`TrackerTcpServer`, started in `onModuleInit`). It
  deliberately does **not** use `@nestjs/microservices`'s TCP transport -
  that transport speaks Nest's own JSON-RPC-ish wire format, which has
  nothing to do with the AVT110's `#`-terminated ASCII/hex frames.
- **Framing**: each socket accumulates bytes in a `TrackerFrameSplitter`,
  which derives each frame's exact length from its head token + `Length`
  field rather than scanning for the `#` (0x23) terminator - that byte can
  legitimately appear inside a frame's binary section (e.g. as part of an
  IMEI or a coordinate), so a naive scan-for-`#` splitter can cut a frame
  in half. It only falls back to scanning for `#` to resync after a
  genuinely corrupt/desynced stream. StarLink's `StarlinkLineSplitter` is
  simpler (plain newline-delimited text, no such ambiguity).
- **Parsing** (`TrackerParserService`) is pure and synchronous - no network
  or DB access - so it's cheap to unit test (see
  `tracker-parser.service.spec.ts`). It's designed to never throw for
  anything it can partially recover from: unsupported `Data Mask` bits
  (e.g. CAN bus / tachograph / BLE blocks - not implemented yet) are
  recorded and skipped rather than failing the whole message, and a
  truncated/corrupt data zone stops decoding at the point it broke while
  keeping everything decoded up to that point. The full frame is always
  stored as hex (`rawHex`/`dataZoneHex`) so a message can be reprocessed
  later if parsing support improves.
- **Acknowledgements**: `+SACK` is sent for every `+RPT`/`-RPT` and `+SHBD`
  for every `+HBD`. The protocol only requires `+SACK` when the device's
  `SACK Enable` parameter is on (set via `AT@SIS`), which this server
  doesn't currently track per-device - acknowledging unconditionally is
  harmless (a device with it disabled just ignores the extra bytes).
- **Domain events** (`tracker.device.connected`, `tracker.device.disconnected`,
  `tracker.report.received`) are emitted via `@nestjs/event-emitter` so
  future modules (a websocket gateway, alerting, ...) can react without
  depending on the TCP/parsing internals.

## Known limitations / TODOs

- **Data Mask bits 9-31 are not decoded** (CAN Info Masks 1-3, Electric CAN,
  UART1, Tachograph blocks, Special Car info, NMEA2000, BLE, Upgrade
  Config). These carry large nested structures with variable-length
  strings (VIN, registration number, driver names, ...) per the protocol
  PDF. When present, the affected bits are listed in
  `report.unsupportedDataMaskBits` and a warning is logged/stored, but the
  rest of the message still decodes normally and the full frame is kept
  as `rawHex` for future reprocessing.
- **`+ACK`/`+QRY`/`+ALL`/`+VER`/etc. (ASCII command-response frames) are
  parsed generically** (comma-split) but not persisted or acted upon -
  there's no outbound command feature yet to correlate them with.
- **`+LDP`/`+BMR` (large data packets / device-manager reports)** are
  recognised by head token only; their data zones aren't decoded yet.
- **No per-device SACK-enabled tracking** - see "Acknowledgements" above.
- **No auth** on the HTTP API.

### StarLink-specific

No official protocol PDF was available (ERM's protocol pages require a
login) - `StarlinkParserService` is reverse-derived from Traccar's
open-source, production `StarLinkProtocolDecoder`. Known gaps:

- **Checksum is matched but not verified** - no public source describes
  the algorithm, and Traccar's own decoder doesn't validate it either.
- **Only message type 6 (event report) is decoded**; other types
  (protocol version, programming ack, ...) are recognised but not parsed.
- **Only the default 23-tag format is decoded** - per-device custom
  format strings (a real StarLink feature) aren't supported. Anything
  outside the default format shows up in `report.unsupportedTags`.
- **No acknowledgement is sent back** to the device, matching Traccar's
  observed behavior for this protocol - worth verifying against a real
  unit if messages ever appear to be retransmitted.
- A handful of tags Traccar supports aren't implemented here (base64
  1-wire sensor protobuf blobs, RFID reads, fuel sensors, ...).

## Testing

```bash
pnpm test          # unit tests (parsers, framers, persistence, publishing)
pnpm run test:cov   # with coverage
pnpm run test:e2e   # HTTP e2e scaffold
```

`TrackerParserService`'s tests hand-build real protocol frames (see
`tracker/parser/test-fixtures.ts`) covering: a `+RPT` with battery + GNSS
data, a `+HBD` heartbeat, a truncated/corrupt `+RPT` (asserts the parser
recovers gracefully instead of throwing), and a `+RPT` with an
intentionally-unsupported `Data Mask` bit set.

`StarlinkParserService`'s tests (see `starlink/parser/test-fixtures.ts`)
cover: an event-report frame with the full default tag format, the
ignition-on/off special-cased event ids, both device-id formats (6 hex /
15-digit IMEI), an unsupported message type, extra fields beyond the
default format, and a corrupt field value (asserts it degrades to a
warning instead of throwing).

## Useful commands

```bash
pnpm run migration:generate --name SomeChange   # after editing entities
pnpm run migration:run
pnpm run migration:revert
```

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for deploying this to AWS ECS
(Fargate) behind an ALB (HTTP API) + NLB (tracker TCP port) with GitHub
Actions - includes the `Dockerfile`, `.aws/task-definition.json`, and the
one-time AWS CLI setup for everything else (VPC, RDS, Secrets Manager,
IAM, both load balancers).
