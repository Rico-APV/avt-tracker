import { StarlinkParserService } from './starlink-parser.service';
import { buildEventReportData, buildStarlinkLine } from './test-fixtures';

const TEST_DEVICE_ID = '356938';

describe('StarlinkParserService', () => {
  let parser: StarlinkParserService;

  beforeEach(() => {
    parser = new StarlinkParserService();
  });

  it('parses an event-report frame with the default 23-tag format', () => {
    const data = buildEventReportData({
      edt: '260707123456',
      eid: '6',
      pdt: '260707123450',
      lat: '+3934.567890',
      long: '-07440.123456',
      spd: '42.5',
      head: '180',
      odo: '123.456',
      in1: '1',
      in2: '0',
      lac: '4321',
      cid: '987654',
      vin: '13.8',
      vbat: '4.1',
      dest: 'ACME-WHSE',
      ign: '1',
    });
    const line = buildStarlinkLine({
      deviceId: TEST_DEVICE_ID,
      messageType: 6,
      messageIndex: 42,
      data,
      checksumHex: 'A3',
    });

    const parsed = parser.parseFrame(line);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.header).toEqual({
      head: '!',
      deviceId: TEST_DEVICE_ID,
      messageType: 6,
      messageIndex: 42,
      checksumHex: 'A3',
    });

    const { report } = parsed;
    expect(report).toBeDefined();
    expect(report?.eventId).toBe(6);
    expect(report?.eventName).toBe('Overspeed Alarm');
    expect(report?.alarm).toBe('overspeed');
    expect(report?.deviceTime?.toISOString()).toBe('2026-07-07T12:34:56.000Z');
    expect(report?.fixTime?.toISOString()).toBe('2026-07-07T12:34:50.000Z');
    expect(report?.latitude).toBeCloseTo(39.576131, 5);
    expect(report?.longitude).toBeCloseTo(-74.668724, 5);
    expect(report?.speedKnots).toBe(42.5);
    expect(report?.course).toBe(180);
    expect(report?.odometerM).toBe(123456);
    expect(report?.digitalInputs).toEqual({ IN1: 1, IN2: 0 });
    expect(report?.lac).toBe(4321);
    expect(report?.cid).toBe(987654);
    expect(report?.mainPowerVoltage).toBe(13.8);
    expect(report?.batteryVoltage).toBe(4.1);
    expect(report?.destination).toBe('ACME-WHSE');
    expect(report?.ignition).toBe(true);
    expect(report?.unsupportedTags).toEqual([]);
  });

  it('sets ignition true/false from the dedicated event ids (24/25)', () => {
    const on = parser.parseFrame(
      buildStarlinkLine({
        deviceId: TEST_DEVICE_ID,
        messageType: 6,
        messageIndex: 1,
        data: buildEventReportData({ eid: '24' }),
      }),
    );
    expect(on.report?.ignition).toBe(true);

    const off = parser.parseFrame(
      buildStarlinkLine({
        deviceId: TEST_DEVICE_ID,
        messageType: 6,
        messageIndex: 2,
        data: buildEventReportData({ eid: '25' }),
      }),
    );
    expect(off.report?.ignition).toBe(false);
  });

  it('supports the 15-digit IMEI form of the device id', () => {
    const parsed = parser.parseFrame(
      buildStarlinkLine({
        deviceId: '356938035643809',
        messageType: 6,
        messageIndex: 1,
        data: buildEventReportData({ eid: '6' }),
      }),
    );

    expect(parsed.header.deviceId).toBe('356938035643809');
  });

  it('records a non-event-report message type as an unsupported warning, without a report', () => {
    const parsed = parser.parseFrame(
      buildStarlinkLine({
        deviceId: TEST_DEVICE_ID,
        messageType: 1,
        messageIndex: 1,
        data: '1.0',
      }),
    );

    expect(parsed.report).toBeUndefined();
    expect(parsed.header.messageType).toBe(1);
    expect(parsed.warnings.some((w) => w.includes('not decoded yet'))).toBe(
      true,
    );
  });

  it('records fields beyond the default format as unsupported without throwing', () => {
    const data = buildEventReportData({ eid: '6' }) + ',extra1,extra2';
    const parsed = parser.parseFrame(
      buildStarlinkLine({
        deviceId: TEST_DEVICE_ID,
        messageType: 6,
        messageIndex: 1,
        data,
      }),
    );

    expect(parsed.report?.eventId).toBe(6);
    expect(
      parsed.warnings.some((w) => w.includes('extra fields ignored')),
    ).toBe(true);
  });

  it('never throws on a corrupt field value - degrades to a warning instead', () => {
    const data = buildEventReportData({ lat: 'not-a-coordinate', eid: '6' });
    const parsed = parser.parseFrame(
      buildStarlinkLine({
        deviceId: TEST_DEVICE_ID,
        messageType: 6,
        messageIndex: 1,
        data,
      }),
    );

    expect(parsed.report?.latitude).toBeUndefined();
    expect(parsed.report?.eventId).toBe(6);
    expect(
      parsed.warnings.some((w) => w.includes('Failed to decode tag #LAT#')),
    ).toBe(true);
  });

  it('throws for a line that does not match the frame format at all', () => {
    expect(() => parser.parseFrame('not a starlink frame')).toThrow();
  });

  it('throws for an empty line', () => {
    expect(() => parser.parseFrame('')).toThrow();
  });
});
