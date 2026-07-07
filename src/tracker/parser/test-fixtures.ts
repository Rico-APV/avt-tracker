/**
 * Helpers to hand-assemble raw AVT110 frames for tests, mirroring the
 * encodings documented in the protocol PDF (mirror image of
 * `binary-codec.util.ts`'s decoders).
 */

export function encodeImei(imei: string): Buffer {
  if (imei.length !== 15) {
    throw new Error('Test IMEI fixtures must be 15 digits');
  }
  const bytes = Buffer.alloc(8);
  for (let i = 0; i < 7; i++) {
    bytes[i] = parseInt(imei.substring(i * 2, i * 2 + 2), 10);
  }
  bytes[7] = parseInt(imei.substring(14, 15), 10);
  return bytes;
}

export function encodeGTime(date: Date): Buffer {
  const buf = Buffer.alloc(7);
  buf.writeUInt16BE(date.getUTCFullYear(), 0);
  buf[2] = date.getUTCMonth() + 1;
  buf[3] = date.getUTCDate();
  buf[4] = date.getUTCHours();
  buf[5] = date.getUTCMinutes();
  buf[6] = date.getUTCSeconds();
  return buf;
}

export interface BuildFrameOptions {
  head: string; // e.g. '+RPT:', '+HBD:'
  imei: string;
  deviceId?: number;
  dataZone: Buffer;
  generatedAt: Date;
  serialNumber: number;
  /** Deliberately write a wrong Length field, to test mismatch handling. */
  declaredLengthOverride?: number;
}

/** Assembles a full binary frame (header + data zone + trailer + '#'). */
export function buildFrame(options: BuildFrameOptions): Buffer {
  const headBuf = Buffer.from(options.head, 'ascii');
  const imeiBuf = encodeImei(options.imei);
  const deviceIdBuf = Buffer.from([options.deviceId ?? 0x20]);
  const gTimeBuf = encodeGTime(options.generatedAt);
  const snBuf = Buffer.alloc(2);
  snBuf.writeUInt16BE(options.serialNumber, 0);

  const actualLength =
    imeiBuf.length +
    deviceIdBuf.length +
    options.dataZone.length +
    gTimeBuf.length +
    snBuf.length;
  const lengthBuf = Buffer.alloc(2);
  lengthBuf.writeUInt16BE(options.declaredLengthOverride ?? actualLength, 0);

  return Buffer.concat([
    headBuf,
    lengthBuf,
    imeiBuf,
    deviceIdBuf,
    options.dataZone,
    gTimeBuf,
    snBuf,
    Buffer.from('#', 'ascii'),
  ]);
}

/** Builds a +RPT data zone: header fields + whatever bit-driven bytes you hand it. */
export function buildReportDataZone(options: {
  protocolVersion?: [number, number];
  eventType: number;
  eventState: number;
  dataMask: number;
  tail: Buffer;
}): Buffer {
  const [major, minor] = options.protocolVersion ?? [11, 1];
  const dataMaskBuf = Buffer.alloc(4);
  dataMaskBuf.writeUInt32BE(options.dataMask, 0);
  return Buffer.concat([
    Buffer.from([major, minor]),
    Buffer.from([options.eventType, options.eventState]),
    dataMaskBuf,
    options.tail,
  ]);
}
