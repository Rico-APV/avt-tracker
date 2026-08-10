/** Raised when a read would run past the end of the underlying buffer. */
export class TrackerFrameTruncatedError extends Error {
  constructor(requestedBytes: number, remainingBytes: number, offset: number) {
    super(
      `Truncated frame: needed ${requestedBytes} more byte(s) at offset ${offset}, ` +
        `only ${remainingBytes} available`,
    );
    this.name = 'TrackerFrameTruncatedError';
  }
}

/**
 * Sequential, forward-only reader over a Buffer. All multi-byte integers in
 * the AVT110 protocol are big-endian, per the "Data Stream Format" section
 * of the protocol document.
 */
export class BufferCursor {
  private _offset = 0;

  constructor(private readonly buf: Buffer) {}

  get offset(): number {
    return this._offset;
  }

  get remaining(): number {
    return this.buf.length - this._offset;
  }

  private ensure(count: number): void {
    if (this.remaining < count) {
      throw new TrackerFrameTruncatedError(count, this.remaining, this._offset);
    }
  }

  readBytes(count: number): Buffer {
    this.ensure(count);
    const slice = this.buf.subarray(this._offset, this._offset + count);
    this._offset += count;
    return slice;
  }

  skip(count: number): void {
    this.ensure(count);
    this._offset += count;
  }

  readUInt8(): number {
    this.ensure(1);
    const value = this.buf.readUInt8(this._offset);
    this._offset += 1;
    return value;
  }

  readInt8(): number {
    this.ensure(1);
    const value = this.buf.readInt8(this._offset);
    this._offset += 1;
    return value;
  }

  readUInt16BE(): number {
    this.ensure(2);
    const value = this.buf.readUInt16BE(this._offset);
    this._offset += 2;
    return value;
  }

  readInt16BE(): number {
    this.ensure(2);
    const value = this.buf.readInt16BE(this._offset);
    this._offset += 2;
    return value;
  }

  readUInt32BE(): number {
    this.ensure(4);
    const value = this.buf.readUInt32BE(this._offset);
    this._offset += 4;
    return value;
  }

  readInt32BE(): number {
    this.ensure(4);
    const value = this.buf.readInt32BE(this._offset);
    this._offset += 4;
    return value;
  }

  /** Big-endian unsigned integer of arbitrary width (1-6 bytes). */
  readUIntBE(byteLength: number): number {
    this.ensure(byteLength);
    const value = this.buf.readUIntBE(this._offset, byteLength);
    this._offset += byteLength;
    return value;
  }

  /** Big-endian signed integer of arbitrary width (1-6 bytes). */
  readIntBE(byteLength: number): number {
    this.ensure(byteLength);
    const value = this.buf.readIntBE(this._offset, byteLength);
    this._offset += byteLength;
    return value;
  }

  /** A 1-byte length prefix followed by that many ASCII bytes. */
  readLengthPrefixedAscii(): string {
    const length = this.readUInt8();
    return this.readBytes(length).toString('ascii');
  }
}
