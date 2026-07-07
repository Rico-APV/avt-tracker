/**
 * Decodes the 8-byte IMEI encoding used throughout the AVT110 protocol.
 *
 * Each of the first 7 bytes holds two decimal digits as its raw numeric
 * value (e.g. 0x0D = 13 => digits "1","3"), and the 8th byte holds the
 * single trailing digit of the (odd-length, 15 digit) IMEI. Example from
 * the protocol doc:
 *   IMEI  13 57 90 24 68 11 22 5
 *   HEX   0D 39 5A 18 44 0B 16 05
 *   => "135790246811225"
 */
export function decodeImei(bytes: Buffer): string {
  if (bytes.length !== 8) {
    throw new Error(`IMEI field must be 8 bytes, got ${bytes.length}`);
  }
  let imei = '';
  for (let i = 0; i < 7; i++) {
    imei += bytes[i].toString(10).padStart(2, '0');
  }
  imei += (bytes[7] % 10).toString(10);
  return imei;
}

/**
 * Decodes the 7-byte "G-Time" (generated time) field: 2 bytes year, then
 * 1 byte each for month/day/hour/minute/second. Returned as a UTC Date.
 */
export function decodeGTime(bytes: Buffer): Date | null {
  if (bytes.length !== 7) {
    throw new Error(`G-Time field must be 7 bytes, got ${bytes.length}`);
  }
  const year = bytes.readUInt16BE(0);
  const month = bytes[2];
  const day = bytes[3];
  const hour = bytes[4];
  const minute = bytes[5];
  const second = bytes[6];

  if (year === 0 || month === 0 || day === 0) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/**
 * Formats a 2-byte protocol version field, e.g. bytes [0x0B, 0x01] => "11.01"
 * (major byte, then minor byte, per section 3.2.1).
 */
export function formatProtocolVersion(bytes: Buffer): string {
  if (bytes.length !== 2) {
    throw new Error(
      `Protocol version field must be 2 bytes, got ${bytes.length}`,
    );
  }
  return `${bytes[0]}.${bytes[1].toString().padStart(2, '0')}`;
}

/** "Current Hour Meter Count": 3 bytes, HH:MM:SS -> total seconds. */
export function decodeShortHms(bytes: Buffer): number {
  if (bytes.length !== 3) {
    throw new Error(`Short HMS field must be 3 bytes, got ${bytes.length}`);
  }
  const [hours, minutes, seconds] = bytes;
  return hours * 3600 + minutes * 60 + seconds;
}

/** "Total Hour Meter Count": 5 bytes, HHHHH:MM:SS -> total seconds. */
export function decodeExtendedHms(bytes: Buffer): number {
  if (bytes.length !== 5) {
    throw new Error(`Extended HMS field must be 5 bytes, got ${bytes.length}`);
  }
  const hours = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  const minutes = bytes[3];
  const seconds = bytes[4];
  return hours * 3600 + minutes * 60 + seconds;
}

export function toHex(bytes: Buffer): string {
  return bytes.toString('hex').toUpperCase();
}
