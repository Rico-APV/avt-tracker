const FRAME_TERMINATOR = 0x23; // '#'

/**
 * Accumulates raw bytes coming off a single TCP socket and extracts
 * complete frames, each terminated by the protocol's '#' (0x23) character.
 *
 * A single `write()` from the device can contain zero, one, or several
 * frames concatenated together, and a frame can also be split across
 * multiple TCP packets - this class buffers across calls to `push()` to
 * handle both cases.
 *
 * Safety: if `maxBufferBytes` is exceeded without ever finding a '#', the
 * buffer is assumed to be garbage/desynced data and is dropped so a
 * misbehaving connection can't grow memory unbounded.
 *
 * KNOWN LIMITATION: this scans raw bytes for 0x23 as specified by the
 * protocol doc, but +RPT/-RPT/+HBD frames are otherwise binary - a data
 * byte (part of the IMEI, a coordinate, a cell ID, ...) can coincidentally
 * equal 0x23 and cause a frame to be split in the wrong place. When that
 * happens, `TrackerParserService.parseFrame` will fail on the resulting
 * fragment (usually because the header no longer lines up), which
 * `TrackerTcpServer` already catches, logs, and discards - so this can
 * cause an occasional dropped message but never a crash. This was
 * confirmed against IMEI "356938035643809" (byte pair "35" = 0x23) during
 * manual testing; the more robust fix is a length-prefixed reader driven
 * by the frame's own `Length` field, which is a good next step if dropped
 * frames are ever observed in practice.
 */
export class TrackerFrameSplitter {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxBufferBytes: number = 64 * 1024) {}

  /**
   * Feed newly received bytes in and pull out every complete frame that is
   * now available (each frame still includes its trailing '#').
   */
  push(chunk: Buffer): { frames: Buffer[]; overflowed: boolean } {
    this.buffer =
      this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const frames: Buffer[] = [];
    let terminatorIndex: number;
    while ((terminatorIndex = this.buffer.indexOf(FRAME_TERMINATOR)) !== -1) {
      const frame = this.buffer.subarray(0, terminatorIndex + 1);
      frames.push(Buffer.from(frame));
      this.buffer = this.buffer.subarray(terminatorIndex + 1);
    }

    let overflowed = false;
    if (this.buffer.length > this.maxBufferBytes) {
      overflowed = true;
      this.buffer = Buffer.alloc(0);
    }

    return { frames, overflowed };
  }

  /** Bytes currently held that don't yet form a complete frame. */
  get pendingByteCount(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
