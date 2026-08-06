const FRAME_TERMINATOR = 0x23; // '#'
const COLON = 0x3a; // ':'
/** Head tokens are at most 5 ASCII chars (e.g. "+NACK"), so the colon that
 * ends one can never legitimately appear past this offset - matches the
 * bound `TrackerParserService.readHeadToken` enforces on a complete frame. */
const MAX_HEAD_TOKEN_SEARCH_BYTES = 8;
/** Width of the binary `<Length>` field that immediately follows the colon. */
const LENGTH_FIELD_BYTES = 2;
/**
 * Width, in bytes, of the fields that always sit between `<Length>` and the
 * data zone (IMEI + DeviceID) plus the fields that always sit between the
 * data zone and the terminator (GTime + SN). The data zone itself is
 * variable-length (possibly zero), so this is the minimum number of bytes
 * that must follow `<Length>` in any legitimate frame - used to bound how
 * far back the terminator fallback search is allowed to look.
 */
const MINIMUM_TRAILING_FIXED_BYTES =
  /* imei */ 8 + /* deviceId */ 1 + /* generatedTime */ 7 + /* serialNumber */ 2;

/**
 * Accumulates raw bytes coming off a single TCP socket and extracts
 * complete frames.
 *
 * Framing is anchored on the '#' (0x23) terminator, not on the protocol's
 * own `<Length>` field - devices have been observed in the wild sending a
 * `<Length>` that doesn't match the actual frame (e.g. declaring the
 * *total* frame size instead of the IMEI+DeviceID+DataZone+GTime+SN size
 * the spec calls for), which would otherwise desync every frame after it
 * once several frames are concatenated in one `write()`.
 *
 * The catch: a frame's binary section (IMEI / DeviceID / Data Zone / GTime
 * / SN) can itself contain the byte value 0x23 as ordinary data - e.g. IMEI
 * "356938035643809" encodes its first two digits ("35") as the raw byte
 * 0x23 - so naively scanning for the next '#' can cut a frame in half. To
 * stay safe we use a hybrid strategy in `resolveFrameLength`:
 *
 *   1. Fast path: once the declared `<Length>` gives us a candidate frame
 *      end, check whether that position actually holds a '#'. If it does,
 *      the field was trustworthy - use it directly, with zero risk from
 *      stray 0x23 bytes inside the data zone.
 *   2. Fallback: if the declared length doesn't land on a '#' (or lands
 *      short), scan for the real terminator instead - but only from the
 *      first byte position after the frame's fixed-size fields (Length +
 *      IMEI + DeviceID + GTime + SN). Every legitimate frame's terminator
 *      sits at or after that offset, so this skip guarantees we never
 *      mistake a 0x23 inside the IMEI for the terminator.
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
   * Determines the total byte length of the next frame from its head token,
   * preferring the declared Length field when it checks out and otherwise
   * falling back to a bounded search for the real terminator (see the class
   * doc comment for why this two-step approach is needed).
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
    const declaredFrameLength = lengthFieldEnd + declaredLength + 1;
    if (
      this.buffer.length >= declaredFrameLength &&
      this.buffer[declaredFrameLength - 1] === FRAME_TERMINATOR
    ) {
      return declaredFrameLength;
    }

    // Declared Length was missing enough bytes to land on a '#', or simply
    // lied about the frame size. Fall back to the real terminator, but
    // never search before the point every legitimate frame's fixed-size
    // fields guarantee it can't appear before - that's what keeps a 0x23
    // inside the IMEI from being mistaken for it.
    const minimumTerminatorIndex = lengthFieldEnd + MINIMUM_TRAILING_FIXED_BYTES;
    if (this.buffer.length <= minimumTerminatorIndex) {
      return undefined; // not even enough bytes for the smallest possible frame yet
    }

    const terminatorIndex = this.buffer.indexOf(
      FRAME_TERMINATOR,
      minimumTerminatorIndex,
    );
    if (terminatorIndex === -1) {
      return undefined; // terminator hasn't arrived yet
    }
    return terminatorIndex + 1; // +1 to include the terminator itself
  }
}
