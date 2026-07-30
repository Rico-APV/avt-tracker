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

  it('parses a frame with no head byte at all (some real units omit it)', () => {
    // Regression test: a real device sent lines starting directly with "SLU"
    // (no arbitrary byte before it), which the frame regex used to require
    // and reject as unparseable.
    const line =
      `SLU${TEST_DEVICE_ID},6,7043,` +
      `${buildEventReportData({ eid: '6' })}*4B`;

    const parsed = parser.parseFrame(line);

    expect(parsed.header.head).toBe('');
    expect(parsed.header.deviceId).toBe(TEST_DEVICE_ID);
    expect(parsed.report?.eventId).toBe(6);
  });

  it('accepts a custom format tag list, for fleets that omit tags (e.g. no digital I/O)', () => {
    // Regression test with a real production line: this fleet's units are
    // configured with only 14 fields (no #IN1#-#OUT4# block), so with the
    // default 23-tag format LAC/CID/voltages were being mislabeled as
    // digital I/O. Confirmed against real values: LAC=562 and CID=45128966
    // are far too large to be digital I/O, but fit LAC/CID perfectly; the
    // trailing 12.169/04.020 match a 12V vehicle supply + a ~4V backup
    // battery far better than boolean-ish inputs.
    const noDigitalIoFormat = [
      '#EDT#',
      '#EID#',
      '#PDT#',
      '#LAT#',
      '#LONG#',
      '#SPD#',
      '#HEAD#',
      '#ODO#',
      '#LAC#',
      '#CID#',
      '#VIN#',
      '#VBAT#',
      '#IGN#',
      '#ENG#',
    ];
    const line =
      'SLU022C2F,06,7043,260726184420,01,260726184416,+1852.9260,' +
      '-09909.2547,000.0,165,000000,562,45128966,12.169,04.020,1,2*4B';

    const parsed = parser.parseFrame(line, noDigitalIoFormat);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.header.deviceId).toBe('022C2F');
    expect(parsed.report?.lac).toBe(562);
    expect(parsed.report?.cid).toBe(45128966);
    expect(parsed.report?.mainPowerVoltage).toBe(12.169);
    expect(parsed.report?.batteryVoltage).toBe(4.02);
    expect(parsed.report?.ignition).toBe(true);
    expect(parsed.report?.digitalInputs).toEqual({});
    expect(parsed.report?.digitalOutputs).toEqual({});
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

  it('never lets a garbage numeric field silently become null - it warns instead', () => {
    // Regression test: parseInt/parseFloat return NaN (not an exception) on
    // garbage input, and NaN serializes to `null` in JSON - so without an
    // explicit NaN check, a corrupt field would be indistinguishable from
    // one the device simply didn't send.
    const data = buildEventReportData({ eid: '6', vbat: 'ACME' });
    const parsed = parser.parseFrame(
      buildStarlinkLine({
        deviceId: TEST_DEVICE_ID,
        messageType: 6,
        messageIndex: 1,
        data,
      }),
    );

    expect(parsed.report?.batteryVoltage).toBeUndefined();
    expect(parsed.report?.eventId).toBe(6);
    expect(
      parsed.warnings.some((w) => w.includes('Failed to decode tag #VBAT#')),
    ).toBe(true);
  });

  it('throws for a line that does not match the frame format at all', () => {
    expect(() => parser.parseFrame('not a starlink frame')).toThrow();
  });

  it('throws for an empty line', () => {
    expect(() => parser.parseFrame('')).toThrow();
  });
});
