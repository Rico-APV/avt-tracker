const LINE_TERMINATOR = 0x0a; // '\n'
const CARRIAGE_RETURN = 0x0d; // '\r'

/**
 * Accumulates raw bytes coming off a single TCP socket and extracts
 * complete lines, mirroring Traccar's `LineBasedFrameDecoder` for this
 * protocol (see `StarlinkParserService` docs): the "SLU" protocol is plain
 * ASCII text, one message per line, so - unlike the AVT110 tracker's
 * binary framing - there's no risk of the delimiter byte appearing inside
 * a message's own data.
 *
 * A single `write()` from the device can contain zero, one, or several
 * lines, and a line can also be split across multiple TCP packets - this
 * class buffers across calls to `push()` to handle both cases. `\r\n` and
 * bare `\n` are both accepted; blank lines are dropped.
 *
 * Safety: if `maxBufferBytes` is exceeded without ever finding a '\n', the
 * buffer is assumed to be garbage/desynced data and is dropped so a
 * misbehaving connection can't grow memory unbounded.
 */
export class StarlinkLineSplitter {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxBufferBytes: number = 8 * 1024) {}

  push(chunk: Buffer): { lines: string[]; overflowed: boolean } {
    this.buffer =
      this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const lines: string[] = [];
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf(LINE_TERMINATOR)) !== -1) {
      let lineEnd = newlineIndex;
      if (lineEnd > 0 && this.buffer[lineEnd - 1] === CARRIAGE_RETURN) {
        lineEnd -= 1;
      }
      const line = this.buffer.toString('utf8', 0, lineEnd);
      this.buffer = this.buffer.subarray(newlineIndex + 1);
      if (line.length > 0) {
        lines.push(line);
      }
    }

    let overflowed = false;
    if (this.buffer.length > this.maxBufferBytes) {
      overflowed = true;
      this.buffer = Buffer.alloc(0);
    }

    return { lines, overflowed };
  }

  /** Bytes currently held that don't yet form a complete line. */
  get pendingByteCount(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
