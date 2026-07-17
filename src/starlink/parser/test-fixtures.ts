export interface BuildStarlinkLineOptions {
  head?: string;
  deviceId: string;
  messageType: number;
  messageIndex: number;
  data: string;
  checksumHex?: string;
}

/** Assembles a raw "SLU" protocol line, mirroring what a real unit sends. */
export function buildStarlinkLine(options: BuildStarlinkLineOptions): string {
  const head = options.head ?? '!';
  const checksum = options.checksumHex ?? '00';
  return (
    `${head}SLU${options.deviceId},${options.messageType},` +
    `${options.messageIndex},${options.data}*${checksum}`
  );
}

/** Fields in DEFAULT_STARLINK_FORMAT_TAGS order, joined with ','. */
export function buildEventReportData(fields: {
  edt?: string;
  eid?: string;
  pdt?: string;
  lat?: string;
  long?: string;
  spd?: string;
  head?: string;
  odo?: string;
  in1?: string;
  in2?: string;
  in3?: string;
  in4?: string;
  out1?: string;
  out2?: string;
  out3?: string;
  out4?: string;
  lac?: string;
  cid?: string;
  vin?: string;
  vbat?: string;
  dest?: string;
  ign?: string;
  eng?: string;
}): string {
  return [
    fields.edt ?? '',
    fields.eid ?? '',
    fields.pdt ?? '',
    fields.lat ?? '',
    fields.long ?? '',
    fields.spd ?? '',
    fields.head ?? '',
    fields.odo ?? '',
    fields.in1 ?? '',
    fields.in2 ?? '',
    fields.in3 ?? '',
    fields.in4 ?? '',
    fields.out1 ?? '',
    fields.out2 ?? '',
    fields.out3 ?? '',
    fields.out4 ?? '',
    fields.lac ?? '',
    fields.cid ?? '',
    fields.vin ?? '',
    fields.vbat ?? '',
    fields.dest ?? '',
    fields.ign ?? '',
    fields.eng ?? '',
  ].join(',');
}
