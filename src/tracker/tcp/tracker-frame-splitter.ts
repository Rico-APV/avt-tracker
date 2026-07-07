const FRAME_TERMINATOR = 0x23; // '#'
const COLON = 0x3a; // ':'
/** Head tokens are at most 5 ASCII chars (e.g. "+NACK"), so the colon that
 * ends one can never legitimately appear past this offset - matches the
 * bound `TrackerParserService.readHeadToken` enforces on a complete frame. */
const MAX_HEAD_TOKEN_SEARCH_BYTES = 8;
/** Width of the binary `<Length>` field that immediately follows the colon. */
const LENGTH_FIELD_BYTES = 2;

/**
 * Accumulates raw bytes coming off a single TCP socket and extracts
 * complete frames.
 *
 * Framing is driven by the protocol's own `<Length>` field rather than by
 * scanning for the '#' (0x23) terminator: a frame's binary section (IMEI /
 * DeviceID / Data Zone / G-Time / SN) can itself contain the byte value
 * 0x23 as ordinary data - e.g. IMEI "356938035643809" encodes its first two
 * digits ("35") as the raw byte 0x23 - so scanning for the next '#' can cut
 * a frame in half. Instead, once the head token (e.g. "+RPT:") and the
 * 2-byte Length field right after it have arrived, we know exactly how many
 * more bytes make up this frame and can slice it precisely, regardless of
 * what those bytes contain.
 *
 * A single `write()` from the device can contain zero, one, or several
 * frames concatenated together, and a frame can also be split across
 * multiple TCP packets - this class buffers across calls to `push()` to
 * handle both cases.
 *
 * Safety: if the buffer ever can't be resolved into a head token (corrupt/
 * desynced stream), it resyncs by discarding up to the next '#' it can
 * find, and if no '#' ever turns up before `maxBufferBytes` is exceeded,
 * the whole buffer is dropped so a misbehaving connection can't grow
 * memory unbounded.
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
    for (;;) {
      const frameLength = this.resolveFrameLength();
      if (frameLength === undefined) {
        break; // not enough bytes yet to know where this frame ends
      }
      if (frameLength === null) {
        // Doesn't look like a valid head token - resync on the next '#'.
        const terminatorIndex = this.buffer.indexOf(FRAME_TERMINATOR);
        if (terminatorIndex === -1) {
          break; // wait for more data (or the overflow check below)
        }
        this.buffer = this.buffer.subarray(terminatorIndex + 1);
        continue;
      }
      if (this.buffer.length < frameLength) {
        break; // wait for the rest of this frame
      }
      frames.push(Buffer.from(this.buffer.subarray(0, frameLength)));
      this.buffer = this.buffer.subarray(frameLength);
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

  /**
   * Determines the total byte length of the next frame from its head token
   * and Length field.
   *
   * Returns the frame length once known; `undefined` if more bytes are
   * needed before that can be determined; `null` if what's buffered so far
   * doesn't look like a valid head token at all (stream desync).
   */
  private resolveFrameLength(): number | null | undefined {
    const searchWindow = this.buffer.subarray(
      0,
      Math.min(this.buffer.length, MAX_HEAD_TOKEN_SEARCH_BYTES),
    );
    const colonIndex = searchWindow.indexOf(COLON);
    if (colonIndex === -1) {
      return searchWindow.length < MAX_HEAD_TOKEN_SEARCH_BYTES
        ? undefined
        : null;
    }

    const headTokenLength = colonIndex + 1;
    const lengthFieldEnd = headTokenLength + LENGTH_FIELD_BYTES;
    if (this.buffer.length < lengthFieldEnd) {
      return undefined; // need more bytes to read the Length field
    }

    const declaredLength = this.buffer.readUInt16BE(headTokenLength);
    return lengthFieldEnd + declaredLength + 1; // +1 for the trailing '#'
  }
}
