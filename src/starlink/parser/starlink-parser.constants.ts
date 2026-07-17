/**
 * Human-readable names + alarm keys for `#EID#` (event id), reverse-derived
 * from Traccar's `StarLinkProtocolDecoder.decodeAlarm`.
 */
const EVENT_NAMES: Record<number, string> = {
  6: 'Overspeed Alarm',
  7: 'Geofence Enter',
  8: 'Geofence Exit',
  9: 'Power Cut',
  11: 'Low Battery',
  24: 'Ignition On',
  25: 'Ignition Off',
  26: 'Tow Alarm',
  36: 'SOS Alarm',
  42: 'Jamming Alarm',
};

const EVENT_ALARMS: Record<number, string> = {
  6: 'overspeed',
  7: 'geofenceEnter',
  8: 'geofenceExit',
  9: 'powerCut',
  11: 'lowBattery',
  26: 'tow',
  36: 'sos',
  42: 'jamming',
};

export function getStarlinkEventName(eventId: number): string {
  return EVENT_NAMES[eventId] ?? `Unknown Event (${eventId})`;
}

export function getStarlinkAlarm(eventId: number): string | undefined {
  return EVENT_ALARMS[eventId];
}
