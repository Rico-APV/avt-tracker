import { TrackerFrameSplitter } from './tracker-frame-splitter';

describe('TrackerFrameSplitter', () => {
  it('extracts a single frame delivered in one chunk', () => {
    const splitter = new TrackerFrameSplitter();
    const { frames, overflowed } = splitter.push(Buffer.from('+SHBD:04FF#'));

    expect(overflowed).toBe(false);
    expect(frames).toHaveLength(1);
    expect(frames[0].toString('ascii')).toBe('+SHBD:04FF#');
    expect(splitter.pendingByteCount).toBe(0);
  });

  it('extracts multiple frames concatenated in a single chunk', () => {
    const splitter = new TrackerFrameSplitter();
    const { frames } = splitter.push(
      Buffer.from('+SHBD:0001#+SHBD:0002#+SHBD:0003#'),
    );

    expect(frames.map((f) => f.toString('ascii'))).toEqual([
      '+SHBD:0001#',
      '+SHBD:0002#',
      '+SHBD:0003#',
    ]);
  });

  it('reassembles a frame split across multiple TCP chunks', () => {
    const splitter = new TrackerFrameSplitter();

    const first = splitter.push(Buffer.from('+SHBD:0'));
    expect(first.frames).toHaveLength(0);
    expect(splitter.pendingByteCount).toBe(7);

    const second = splitter.push(Buffer.from('4FF#'));
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0].toString('ascii')).toBe('+SHBD:04FF#');
    expect(splitter.pendingByteCount).toBe(0);
  });

  it('drops the buffer instead of growing unboundedly when no terminator ever arrives', () => {
    const splitter = new TrackerFrameSplitter(16);

    const { frames, overflowed } = splitter.push(Buffer.alloc(32, 0x41));

    expect(frames).toHaveLength(0);
    expect(overflowed).toBe(true);
    expect(splitter.pendingByteCount).toBe(0);
  });
});
