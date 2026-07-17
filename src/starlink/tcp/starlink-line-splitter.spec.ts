import { StarlinkLineSplitter } from './starlink-line-splitter';

describe('StarlinkLineSplitter', () => {
  it('extracts a single line delivered in one chunk', () => {
    const splitter = new StarlinkLineSplitter();
    const { lines, overflowed } = splitter.push(
      Buffer.from('!SLU356938,6,1,foo*00\n'),
    );

    expect(overflowed).toBe(false);
    expect(lines).toEqual(['!SLU356938,6,1,foo*00']);
    expect(splitter.pendingByteCount).toBe(0);
  });

  it('strips a trailing carriage return (\\r\\n line endings)', () => {
    const splitter = new StarlinkLineSplitter();
    const { lines } = splitter.push(Buffer.from('!SLU356938,6,1,foo*00\r\n'));

    expect(lines).toEqual(['!SLU356938,6,1,foo*00']);
  });

  it('extracts multiple lines concatenated in a single chunk', () => {
    const splitter = new StarlinkLineSplitter();
    const { lines } = splitter.push(Buffer.from('one\ntwo\nthree\n'));

    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('reassembles a line split across multiple TCP chunks', () => {
    const splitter = new StarlinkLineSplitter();

    const first = splitter.push(Buffer.from('!SLU3569'));
    expect(first.lines).toHaveLength(0);
    expect(splitter.pendingByteCount).toBe(8);

    const second = splitter.push(Buffer.from('38,6,1,foo*00\n'));
    expect(second.lines).toEqual(['!SLU356938,6,1,foo*00']);
    expect(splitter.pendingByteCount).toBe(0);
  });

  it('drops blank lines', () => {
    const splitter = new StarlinkLineSplitter();
    const { lines } = splitter.push(Buffer.from('one\n\n\ntwo\n'));

    expect(lines).toEqual(['one', 'two']);
  });

  it('drops the buffer instead of growing unboundedly when no newline ever arrives', () => {
    const splitter = new StarlinkLineSplitter(16);

    const { lines, overflowed } = splitter.push(Buffer.alloc(32, 0x41));

    expect(lines).toHaveLength(0);
    expect(overflowed).toBe(true);
    expect(splitter.pendingByteCount).toBe(0);
  });
});
