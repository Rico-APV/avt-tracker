import { TrackerParserService } from './tracker-parser.service';
import { TrackerFrameKind } from './tracker-parser.types';
import { MobileyeAdasEventType } from './mobileye-adas.types';
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

  it('flags Data Mask bits it does not decode (e.g. Tachograph, bit 12) without crashing', () => {
    const tail = Buffer.concat([
      u16(4000), // battery voltage
      u8(80), // battery level
    ]);

    const dataZone = buildReportDataZone({
      eventType: 24, // CANBUS Info Event
      eventState: 0,
      dataMask: (1 << 2) | (1 << 12), // battery + Tachograph (unsupported)
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
    expect(parsed.report?.unsupportedDataMaskBits).toEqual([12]);
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

  it('parses a real CANBUS Info Event frame with an unconnected Mobileye unit (CAN Info Mask 2 + Electric Info Mask 1 + CAN Info Mask 3 + CAN Advanced Info Mask 1)', () => {
    // Captured device frame; Data Mask 0x01800C01 sets bits 0 (frame),
    // 10 (CAN Info Mask 2), 11 (Electric Info Mask 1), 23 (CAN Info Mask 3)
    // and 24 (CAN Advanced Info Mask 1 - AdvCAN PID 1-8/Mobileye). Every
    // AdvCAN PID reads back as the 0xFF "not available" sentinel, since no
    // Mobileye unit was actually connected when this frame was captured.
    const rawHex = [
      '2B5250543A', // "+RPT:"
      '009C', // declared length (mismatches actual frame size - see below)
      '5620260 71D025807'.replace(' ', ''), // IMEI 863238072902887
      '20', // device ID
      '0602', // protocol version
      '18', // event type 24 (CANBUS Info Event)
      '13', // event state
      '01800C01', // Data Mask: bits 0, 10, 11, 23, 24
      '0202', // bit 0: frame count=2, id=2
      '7FFCF000', // bit 10: CAN Info Mask 2
      '00'.repeat(38),
      'FFFF', // ...timeToServiceDays raw sentinel
      '00001FFF', // bit 11: Electric Info Mask 1
      '00'.repeat(31),
      '0000011D', // bit 23: CAN Info Mask 3
      '00000000',
      '00000000',
      '00000000',
      '00000000',
      '1F', // ...current gear number
      '000000FF', // bit 24: CAN Advanced Info Mask 1 (AdvCAN PID 1-8)
      '01FF'.repeat(8), // 8x (length=1, data=0xFF "not available")
      '07EA080B141825', // generated time 2026-08-11T20:24:37Z
      '40F6', // serial number
      '23', // tail '#'
    ].join('');
    const frame = Buffer.from(rawHex, 'hex');

    const parsed = parser.parseFrame(frame);

    expect(parsed.header.imei).toBe('863238072902887');
    expect(parsed.header.deviceId).toBe(0x20);
    expect(parsed.header.serialNumberHex).toBe('40F6');
    expect(parsed.header.generatedAt?.toISOString()).toBe(
      new Date(Date.UTC(2026, 7, 11, 20, 24, 37)).toISOString(),
    );

    expect(parsed.report?.eventType).toBe(24);
    expect(parsed.report?.dataMask).toBe(0x01800c01);
    expect(parsed.report?.frame).toEqual({ count: 2, id: 2 });

    expect(parsed.report?.canInfo2?.mask).toBe(0x7ffcf000);
    expect(parsed.report?.canInfo2?.unsupportedBits).toEqual([]);

    expect(parsed.report?.electricInfo1?.mask).toBe(0x00001fff);
    expect(parsed.report?.electricInfo1?.unsupportedBits).toEqual([]);

    expect(parsed.report?.canInfo3?.mask).toBe(0x0000011d);
    expect(parsed.report?.canInfo3).toMatchObject({
      totalRetarderUsageTimeSeconds: 0,
      totalCo2EmissionKg: 0,
      totalPtoUsageTimeSeconds: 0,
      totalFuelUsedWithPtoEngagedMl: 0,
      currentGearNumber: 0x1f,
      unsupportedBits: [],
    });

    expect(parsed.report?.canAdvancedInfo1?.mask).toBe(0x000000ff);
    expect(parsed.report?.canAdvancedInfo1?.pids).toHaveLength(8);
    expect(
      parsed.report?.canAdvancedInfo1?.pids.map((p) => ({
        pid: p.pid,
        data: p.data.toString('hex'),
      })),
    ).toEqual(
      Array.from({ length: 8 }, (_, i) => ({ pid: i + 1, data: 'ff' })),
    );

    // AdvCAN PID 1 (Headway valid) reads back 0xFF, i.e. not the boolean
    // value 1, so every derived flag is false rather than a false positive.
    expect(parsed.report?.mobileyeAdas).toEqual({
      headwayValid: false,
      headwayMeasurementSeconds: 25.5,
      pedestrianForwardCollisionWarning: false,
      pedestrianInDangerZone: false,
      laneDepartureWarningOff: false,
      forwardCollisionWarningOn: false,
      leftLaneDepartureWarningOn: false,
      rightLaneDepartureWarningOn: false,
    });
    expect(parsed.report?.mobileyeAdasEvents).toEqual([]);

    // Every Data Mask bit in this frame is now decoded; nothing left over.
    expect(parsed.report?.unsupportedDataMaskBits).toEqual([]);
    // The device's declared Length field (0x009C=156) doesn't match the
    // actual frame size on this capture; parsing still succeeds by trusting
    // actual bytes (see `parseHeader`), but the mismatch is surfaced.
    expect(parsed.warnings.some((w) => w.includes('Declared Length'))).toBe(
      true,
    );
  });

  it('derives Mobileye ADAS events from CAN Advanced Info Mask 1 (AdvCAN PID 1-8) when a unit is actually connected', () => {
    const pidMask = 0x000000ff; // PID 1-8 all present
    const tail = Buffer.concat([
      u32(pidMask),
      u8(1),
      u8(1), // PID 1: Headway valid = true
      u8(1),
      u8(25), // PID 2: Headway measurement = 25 * 0.1s = 2.5s
      u8(1),
      u8(0), // PID 3: Peds FCW = false
      u8(1),
      u8(1), // PID 4: Peds in DZ = true
      u8(1),
      u8(0), // PID 5: LDW off = false
      u8(1),
      u8(1), // PID 6: FCW on = true
      u8(1),
      u8(1), // PID 7: Left LDW on = true
      u8(1),
      u8(0), // PID 8: Right LDW on = false
    ]);

    const dataZone = buildReportDataZone({
      eventType: 24,
      eventState: 0,
      dataMask: 1 << 24, // CAN Advanced Info Mask 1 only
      tail,
    });

    const frame = buildFrame({
      head: '+RPT:',
      imei: TEST_IMEI,
      dataZone,
      generatedAt: TEST_GENERATED_AT,
      serialNumber: 0x0013,
    });

    const parsed = parser.parseFrame(frame);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.report?.mobileyeAdas).toEqual({
      headwayValid: true,
      headwayMeasurementSeconds: 2.5,
      pedestrianForwardCollisionWarning: false,
      pedestrianInDangerZone: true,
      laneDepartureWarningOff: false,
      forwardCollisionWarningOn: true,
      leftLaneDepartureWarningOn: true,
      rightLaneDepartureWarningOn: false,
    });
    expect(parsed.report?.mobileyeAdasEvents).toEqual([
      MobileyeAdasEventType.LWDL,
      MobileyeAdasEventType.FCW,
      MobileyeAdasEventType.PEDESTRIAN_IN_DANGER_ZONE,
    ]);
  });
});
