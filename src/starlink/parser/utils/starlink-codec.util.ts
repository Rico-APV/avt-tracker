/**
 * `#EDT#`/`#PDT#` timestamps are `yyMMddHHmmss` (12 digits), UTC - matches
 * Traccar's default `PROTOCOL_DATE_FORMAT` for this protocol.
 */
export function parseStarlinkDateTime(value: string): Date | null {
  if (!/^\d{12}$/.test(value)) {
    return null;
  }
  const year = 2000 + parseInt(value.slice(0, 2), 10);
  const month = parseInt(value.slice(2, 4), 10);
  const day = parseInt(value.slice(4, 6), 10);
  const hour = parseInt(value.slice(6, 8), 10);
  const minute = parseInt(value.slice(8, 10), 10);
  const second = parseInt(value.slice(10, 12), 10);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/**
 * `#LAT#`/`#LONG#` are signed degrees+minutes, e.g. "+3934.567890" ->
 * 39 degrees + 34.567890/60 minutes. Direct port of the parsing in
 * Traccar's `StarLinkProtocolDecoder.parseCoordinate`.
 */
export function parseStarlinkCoordinate(value: string): number {
  const dotIndex = value.indexOf('.');
  if (dotIndex === -1) {
    throw new Error(`Coordinate has no decimal point: "${value}"`);
  }
  const minutesIndex = dotIndex - 2;
  if (minutesIndex < 1) {
    throw new Error(`Coordinate is too short to contain degrees: "${value}"`);
  }
  const degrees = parseFloat(value.substring(1, minutesIndex));
  const minutes = parseFloat(value.substring(minutesIndex));
  if (Number.isNaN(degrees) || Number.isNaN(minutes)) {
    throw new Error(`Coordinate is not numeric: "${value}"`);
  }
  const result = degrees + minutes / 60;
  return value.charAt(0) === '+' ? result : -result;
}
