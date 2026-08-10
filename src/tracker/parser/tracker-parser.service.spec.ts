import { TrackerParserService } from './tracker-parser.service';
import { TrackerFrameKind } from './tracker-parser.types';
import { buildFrame, buildReportDataZone } from './test-fixtures';

function u8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}
function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value, 0);
  return b;
}
function i32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value, 0);
  return b;
}
function u32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value, 0);
  return b;
}

const TEST_IMEI = '356938035643809';
const TEST_GENERATED_AT = new Date(Date.UTC(2026, 6, 7, 12, 34, 56)); // 2026-07-07T12:34:56Z

describe('TrackerParserService', () => {
  let parser: TrackerParserService;

  beforeEach(() => {
    parser = new TrackerParserService();
  });

  it('parses a +RPT frame with battery + GNSS data (Data Mask bits 2 and 3)', () => {
    const gnssInfoMask =
      0x01 /* fix type */ |
      0x04 /* speed */ |
      0x20 /* latitude */ |
      0x40; /* longitude */

    const tail = Buffer.concat([
      // Bit 2: battery
      u16(4055), // voltageMv
      u8(88), // levelPercent
      // Bit 3: GNSS
      u16(gnssInfoMask),
      u8(1), // one fix in this message
      u8(0x03), // fixTypeRaw: generatedType=0 (periodic), fixResult=3 (3D fix)
      u16(72), // speedKmh
      i32(40712776), // latitude * 1e6
      i32(-74005974), // longitude * 1e6
    ]);

    const dataZone = buildReportDataZone({
      eventType: 1, // Regular Report Event
      eventState: 0,
      dataMask: (1 << 2) | (1 << 3),
      tail,
    });

    const frame = buildFrame({
      head: '+RPT:',
      imei: TEST_IMEI,
      dataZone,
      generatedAt: TEST_GENERATED_AT,
      serialNumber: 0x04ff,
    });

    const parsed = parser.parseFrame(frame);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.header.kind).toBe(TrackerFrameKind.RPT);
    expect(parsed.header.imei).toBe(TEST_IMEI);
    expect(parsed.header.deviceId).toBe(0x20);
    expect(parsed.header.serialNumberHex).toBe('04FF');
    expect(parsed.header.serialNumber).toBe(0x04ff);
    expect(parsed.header.generatedAt?.toISOString()).toBe(
      TEST_GENERATED_AT.toISOString(),
    );

    expect(parsed.report).toBeDefined();
    expect(parsed.report?.protocolVersion).toBe('11.01');
    expect(parsed.report?.eventType).toBe(1);
    expect(parsed.report?.eventName).toBe('Regular Report Event');
    expect(parsed.report?.unsupportedDataMaskBits).toEqual([]);

    expect(parsed.report?.battery).toEqual({
      voltageMv: 4055,
      levelPercent: 88,
    });

    const primary = parsed.report?.gnss?.primary;
    expect(primary).toBeDefined();
    expect(primary?.fixResult).toBe(3);
    expect(primary?.speedKmh).toBe(72);
    expect(primary?.latitude).toBeCloseTo(40.712776, 6);
    expect(primary?.longitude).toBeCloseTo(-74.005974, 6);
  });

  it('parses a +HBD heartbeat frame', () => {
    const dataZone = Buffer.from([0x0b, 0x01]); // protocol version 11.01

    const frame = buildFrame({
      head: '+HBD:',
      imei: TEST_IMEI,
      dataZone,
      generatedAt: TEST_GENERATED_AT,
      serialNumber: 0x0502,
    });

    const parsed = parser.parseFrame(frame);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.header.kind).toBe(TrackerFrameKind.HBD);
    expect(parsed.header.imei).toBe(TEST_IMEI);
    expect(parsed.header.serialNumberHex).toBe('0502');
    expect(parsed.heartbeat).toEqual({ protocolVersion: '11.01' });
    // The server would reply "+SHBD:0502#" to this - that's the TCP
    // server's job, not the parser's, so it isn't asserted here.
  });

  it('never throws on a truncated/corrupt data zone, and keeps whatever it could decode', () => {
    // Data Mask claims battery (bit2) AND GNSS (bit3), but the buffer is
    // cut short right after the GNSS Info Mask + count, before any of the
    // actual fix bytes - simulating a frame mangled in transit.
    const truncatedTail = Buffer.concat([
      u16(4055), // voltageMv
      u8(88), // levelPercent
      u16(0x01 | 0x20 | 0x40), // GNSS info mask promising fixType+lat+lon...
      u8(1), // ...for 1 fix...
      // ...but zero bytes actually follow for that fix.
    ]);

    const dataZone = buildReportDataZone({
      eventType: 1,
      eventState: 0,
      dataMask: (1 << 2) | (1 << 3),
      tail: truncatedTail,
    });

    const frame = buildFrame({
      head: '+RPT:',
      imei: TEST_IMEI,
      dataZone,
      generatedAt: TEST_GENERATED_AT,
      serialNumber: 0x0001,
    });

    let parsed: ReturnType<TrackerParserService['parseFrame']> | undefined;
    expect(() => {
      parsed = parser.parseFrame(frame);
    }).not.toThrow();

    expect(parsed).toBeDefined();
    // Fields parsed before the truncation are preserved...
    expect(parsed?.report?.protocolVersion).toBe('11.01');
    expect(parsed?.report?.eventType).toBe(1);
    expect(parsed?.report?.battery).toEqual({
      voltageMv: 4055,
      levelPercent: 88,
    });
    // ...the GNSS block itself never got far enough to produce anything
    // usable, so it's simply absent rather than a half-built object...
    expect(parsed?.report?.gnss).toBeUndefined();
    // ...and the truncation is surfaced as a warning rather than an
    // exception.
    expect(
      parsed?.warnings.some((w) => w.includes('Stopped decoding Data Mask')),
    ).toBe(true);
  });

  it('throws a plain, catchable Error (not a crash) when no frame head can be found at all', () => {
    // There is no way to recover any field from bytes that don't even
    // contain a recognisable "+XXX:" head, so parseFrame is allowed to
    // throw here - it's the TCP server's job (see TrackerTcpServer) to
    // catch this and just drop/log the frame instead of taking the
    // connection down.
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x23]);
    expect(() => parser.parseFrame(garbage)).toThrow();
  });

  it('flags Data Mask bits it does not decode (e.g. Electric CAN Info Mask, bit 11) without crashing', () => {
    const tail = Buffer.concat([
      u16(4000), // battery voltage
      u8(80), // battery level
    ]);

    const dataZone = buildReportDataZone({
      eventType: 24, // CANBUS Info Event
      eventState: 0,
      dataMask: (1 << 2) | (1 << 11), // battery + Electric CAN Info Mask (unsupported)
      tail,
    });

    const frame = buildFrame({
      head: '+RPT:',
      imei: TEST_IMEI,
      dataZone,
      generatedAt: TEST_GENERATED_AT,
      serialNumber: 0x0010,
    });

    const parsed = parser.parseFrame(frame);

    expect(parsed.report?.battery).toEqual({
      voltageMv: 4000,
      levelPercent: 80,
    });
    expect(parsed.report?.unsupportedDataMaskBits).toEqual([11]);
    expect(
      parsed.warnings.some((w) => w.includes('Data Mask bits not decoded')),
    ).toBe(true);
    // The full data zone is still preserved for reprocessing later.
    expect(parsed.dataZoneHex.length).toBeGreaterThan(0);
  });

  it('parses CAN Info Mask 1 (VIN, ignition, speed, RPM, fuel level)', () => {
    const canMask1 = (1 << 0) | (1 << 1) | (1 << 5) | (1 << 6) | (1 << 9);
    const vin = 'WVWZZZ1JZXW000001';
    const canTail = Buffer.concat([
      u32(canMask1),
      u8(vin.length),
      Buffer.from(vin, 'ascii'), // bit 0: VIN
      u8(2), // bit 1: ignition key (2 = engine on)
      u16(87), // bit 5: vehicle speed (km/h)
      u16(1850), // bit 6: engine RPM
      u8(45), // bit 9: fuel level liters
      u8(150), // bit 9: fuel level percent raw (*0.4 => 60%)
    ]);

    const dataZone = buildReportDataZone({
      eventType: 24,
      eventState: 0,
      dataMask: 1 << 9, // CAN Info Mask 1 only
      tail: canTail,
    });

    const frame = buildFrame({
      head: '+RPT:',
      imei: TEST_IMEI,
      dataZone,
      generatedAt: TEST_GENERATED_AT,
      serialNumber: 0x0011,
    });

    const parsed = parser.parseFrame(frame);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.report?.canInfo1).toEqual({
      mask: canMask1,
      vin,
      ignitionKey: 2,
      vehicleSpeedKmh: 87,
      engineRpm: 1850,
      fuelLevel: { liters: 45, percent: 60 },
      unsupportedBits: [],
    });
  });

  it('parses CAN Info Mask 2 (DTC codes and tyre readings)', () => {
    const canMask2 = (1 << 24) | (1 << 29);
    const canTail = Buffer.concat([
      u32(canMask2),
      // bit 24: 2 DTC codes - [0x02,0x2E,0x03] "P022E" pending+confirmed,
      // and [0x61,0x99,0x02] "C2199" pending.
      u8(2),
      Buffer.from([0x02, 0x2e, 0x03]),
      Buffer.from([0x61, 0x99, 0x02]),
      // bit 29: 1 tyre reading - axle 0, wheel 1, 800 kPa, 25.5C, state OK.
      u8(1),
      Buffer.from([0x01]), // location byte: axle=0 (high nibble), wheel=1 (low nibble)
      u16(800),
      Buffer.from([0x00, 0x09, 0xf6]), // 3-byte temperature *0.01C = 2550 -> 25.5
      u8(0),
    ]);

    const dataZone = buildReportDataZone({
      eventType: 24,
      eventState: 0,
      dataMask: 1 << 10, // CAN Info Mask 2 only
      tail: canTail,
    });

    const frame = buildFrame({
      head: '+RPT:',
      imei: TEST_IMEI,
      dataZone,
      generatedAt: TEST_GENERATED_AT,
      serialNumber: 0x0012,
    });

    const parsed = parser.parseFrame(frame);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.report?.canInfo2).toEqual({
      mask: canMask2,
      dtcCodes: [
        { code: 'P022E', permanent: false, pending: true, confirmed: true },
        { code: 'C2199', permanent: false, pending: true, confirmed: false },
      ],
      tyres: [
        {
          axlePosition: 0,
          wheelPosition: 1,
          pressureKpa: 800,
          temperatureC: 25.5,
          state: 0,
        },
      ],
      unsupportedBits: [],
    });
  });

  it('decodes repeated PEO fence records inside an ASCII "-ALL:" frame', () => {
    // Real frame captured from a device: a "-ALL:" head (UNKNOWN kind, since
    // only "+ALL" is a recognised token) whose ASCII data zone lists 3 PEO
    // fences (14, 15, 16); the last one is cut short by the frame's own
    // declared-length mismatch.
    const hex =
      '2D414C4C3A00F9562026074E50100124303130342C312C2C302C33302C302C' +
      '50454F2C31342C302C312C332C302E3030303030302C302E3030303030302C' +
      '302E3030303030302C302E3030303030302C302E3030303030302C302E3030' +
      '303030302C302C302C33302C302C50454F2C31352C302C312C332C302E3030' +
      '303030302C302E3030303030302C302E3030303030302C302E303030303030' +
      '2C302E3030303030302C302E3030303030302C302C302C33302C302C50454F' +
      '2C31362C302C312C332C302E3030303030302C302E3030303030302C302E30' +
      '30303030302C302E3030303030302C302E30303030300' +
      '7EA071F0C123A118A23';
    const frame = Buffer.from(hex, 'hex');

    const parsed = parser.parseFrame(frame);

    expect(parsed.header.kind).toBe('UNKNOWN');
    expect(parsed.header.headToken).toBe('-ALL:');
    expect(parsed.warnings.some((w) => w.includes('Declared Length'))).toBe(
      true,
    );
    expect(parsed.ascii?.commandKey).toBe('0104');

    expect(parsed.ascii?.peoFences).toEqual([
      expect.objectContaining({
        peoId: 14,
        mode: 0,
        startPoint: 1,
        endPoint: 3,
        points: [
          { longitude: 0, latitude: 0 },
          { longitude: 0, latitude: 0 },
          { longitude: 0, latitude: 0 },
        ],
        checkIntervalSeconds: 0,
        overSpeedAlarmMode: 0,
        overSpeedThresholdKmh: 30,
        overSpeedDurationSeconds: 0,
      }),
      expect.objectContaining({ peoId: 15 }),
    ]);
    // Fence 16 was cut short by the truncated frame, so it's dropped rather
    // than reported with fabricated/incomplete data.
    expect(parsed.ascii?.peoFences).toHaveLength(2);
    expect(parsed.warnings.some((w) => w.includes('PEO fence 16'))).toBe(true);
  });
});
