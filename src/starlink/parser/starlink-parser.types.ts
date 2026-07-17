/**
 * "SLU" text protocol used by ERM/StarLink trackers (StarLink Tracker,
 * TrackerSF, ...). Reverse-derived from Traccar's open-source, in-
 * production `StarLinkProtocolDecoder`/`StarLinkProtocol` (Apache 2.0) -
 * ERM's own protocol pages (sweb.erm.co.il/protocol) are login-gated, so
 * no official spec PDF was available to work from directly.
 *
 * Wire format (one line per message, '\n'-terminated):
 *   <head><1 char>SLU<deviceId>,<type>,<index>,<data...>*<checksum 2 hex>
 * e.g. "!SLU123456,6,42,241205153000,6,,,,,,,,,,,,,,,,,,*A3"
 */
/** The only message type this parser currently decodes field-by-field. */
export const STARLINK_EVENT_REPORT_MESSAGE_TYPE = 6;

/**
 * Positional tags for the event-report data zone, matching the device's
 * default configured format (Traccar's `PROTOCOL_FORMAT` default). A real
 * unit's format is configurable out-of-band and could differ - fields
 * beyond what's decoded here are recorded in `unsupportedTags`, never
 * dropped silently.
 */
export const DEFAULT_STARLINK_FORMAT_TAGS = [
  '#EDT#',
  '#EID#',
  '#PDT#',
  '#LAT#',
  '#LONG#',
  '#SPD#',
  '#HEAD#',
  '#ODO#',
  '#IN1#',
  '#IN2#',
  '#IN3#',
  '#IN4#',
  '#OUT1#',
  '#OUT2#',
  '#OUT3#',
  '#OUT4#',
  '#LAC#',
  '#CID#',
  '#VIN#',
  '#VBAT#',
  '#DEST#',
  '#IGN#',
  '#ENG#',
] as const;

export interface StarlinkFrameHeader {
  /** The single arbitrary character preceding "SLU" (protocol head byte). */
  head: string;
  /** 6 hex chars or a 15-digit IMEI, per the device. */
  deviceId: string;
  messageType: number;
  messageIndex: number;
  /** 2 hex chars; not validated - see StarlinkParserService docs. */
  checksumHex: string;
}

export interface StarlinkReportPayload {
  eventId?: number;
  eventName?: string;
  alarm?: string;
  deviceTime?: Date | null;
  fixTime?: Date | null;
  latitude?: number;
  longitude?: number;
  altitudeM?: number;
  /** Populated from #SPD# (device-reported, unit per device config - see docs). */
  speedKnots?: number;
  /** Populated from #SPDK# (explicitly km/h on the wire). */
  speedKmh?: number;
  course?: number;
  odometerM?: number;
  digitalInputs: Record<string, number>;
  digitalOutputs: Record<string, number>;
  lac?: number;
  cid?: number;
  mainPowerVoltage?: number;
  batteryVoltage?: number;
  destination?: string;
  ignition?: boolean;
  satellites?: number;
  pdop?: number;
  /** Tags present in the data but not decoded into a typed field yet. */
  unsupportedTags: string[];
}

export interface ParsedStarlinkFrame {
  header: StarlinkFrameHeader;
  report?: StarlinkReportPayload;
  warnings: string[];
  rawLine: string;
  rawData: string;
}
