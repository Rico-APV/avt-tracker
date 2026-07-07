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

  it('flags Data Mask bits it does not decode (e.g. CAN Info Mask 1, bit 9) without crashing', () => {
    const tail = Buffer.concat([
      u16(4000), // battery voltage
      u8(80), // battery level
    ]);

    const dataZone = buildReportDataZone({
      eventType: 24, // CANBUS Info Event
      eventState: 0,
      dataMask: (1 << 2) | (1 << 9), // battery + CAN Info Mask 1 (unsupported)
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
    expect(parsed.report?.unsupportedDataMaskBits).toEqual([9]);
    expect(
      parsed.warnings.some((w) => w.includes('Data Mask bits not decoded')),
    ).toBe(true);
    // The full data zone is still preserved for reprocessing later.
    expect(parsed.dataZoneHex.length).toBeGreaterThan(0);
  });
});
