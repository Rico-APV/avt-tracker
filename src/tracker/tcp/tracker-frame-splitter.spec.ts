import { TrackerFrameSplitter } from './tracker-frame-splitter';
import { buildFrame } from '../parser/test-fixtures';

// This IMEI is deliberately the one that exposed the original bug: its
// first two digits ("35") encode to the raw byte 0x23, the same byte as
// the '#' terminator, so it lands inside the frame's binary section.
const TEST_IMEI = '356938035643809';
const HBD_DATA_ZONE = Buffer.from([0x0b, 0x01]); // protocol version 11.01

function hbdFrame(serialNumber: number): Buffer {
  return buildFrame({
    head: '+HBD:',
    imei: TEST_IMEI,
    dataZone: HBD_DATA_ZONE,
    generatedAt: new Date(Date.UTC(2026, 6, 7, 12, 34, 56)),
    serialNumber,
  });
}

describe('TrackerFrameSplitter', () => {
  it('extracts a single frame delivered in one chunk', () => {
    const splitter = new TrackerFrameSplitter();
    const frame = hbdFrame(0x0001);

    const { frames, overflowed } = splitter.push(frame);

    expect(overflowed).toBe(false);
    expect(frames).toEqual([frame]);
    expect(splitter.pendingByteCount).toBe(0);
  });

  it('extracts multiple frames concatenated in a single chunk', () => {
    const splitter = new TrackerFrameSplitter();
    const f1 = hbdFrame(1);
    const f2 = hbdFrame(2);
    const f3 = hbdFrame(3);

    const { frames } = splitter.push(Buffer.concat([f1, f2, f3]));

    expect(frames).toEqual([f1, f2, f3]);
  });

  it('reassembles a frame split across multiple TCP chunks', () => {
    const splitter = new TrackerFrameSplitter();
    const frame = hbdFrame(0x04ff);
    const splitPoint = Math.floor(frame.length / 2);

    const first = splitter.push(frame.subarray(0, splitPoint));
    expect(first.frames).toHaveLength(0);
    expect(splitter.pendingByteCount).toBe(splitPoint);

    const second = splitter.push(frame.subarray(splitPoint));
    expect(second.frames).toEqual([frame]);
    expect(splitter.pendingByteCount).toBe(0);
  });

  it('does not split a frame early just because its binary section contains a 0x23 byte', () => {
    // Regression test for the original bug: this IMEI puts a 0x23 byte
    // right at the start of the binary section, well before the real '#'.
    const splitter = new TrackerFrameSplitter();
    const frame = hbdFrame(0x0502);
    expect(frame.indexOf(0x23)).toBeLessThan(frame.length - 1);

    const { frames } = splitter.push(frame);

    expect(frames).toEqual([frame]);
  });

  it('resyncs past a malformed head token by discarding up to the next terminator', () => {
    const splitter = new TrackerFrameSplitter();
    const garbage = Buffer.from('XXXXXXXXXX#', 'ascii');
    const goodFrame = hbdFrame(0x0007);

    const { frames } = splitter.push(Buffer.concat([garbage, goodFrame]));

    expect(frames).toEqual([goodFrame]);
  });

  it('drops the buffer instead of growing unboundedly when no valid frame ever resolves', () => {
    const splitter = new TrackerFrameSplitter(16);

    const { frames, overflowed } = splitter.push(Buffer.alloc(32, 0x41));

    expect(frames).toHaveLength(0);
    expect(overflowed).toBe(true);
    expect(splitter.pendingByteCount).toBe(0);
  });
});
