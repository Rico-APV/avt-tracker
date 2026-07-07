/**
 * Human readable names for `<Event Type>` in the +RPT/-RPT frame.
 * Source: AVT110 Tracker Protocol R6.01, section 3.2.1.
 */
export const EVENT_TYPE_NAMES: Record<number, string> = {
  0: 'Terminal Power Event',
  1: 'Regular Report Event',
  2: 'Moving Event',
  3: 'Battery Alarm Event',
  7: 'Crash Alarm Event',
  11: 'Upgrade Firmware Event',
  12: 'External Temperature Alarm Event',
  13: 'Ignition Event',
  14: 'Main Power Alarm Event',
  15: 'TOW Alarm Event',
  16: 'Over Speed Alarm Event',
  17: 'Engine Idle Alarm Event',
  18: 'Start Stop Alarm Event',
  19: 'Harsh Behavior Alarm Event',
  20: 'G-Sensor Self-Calibration Event',
  21: 'Geo Fence Alarm Event',
  22: 'Digital Input 1 Event',
  23: 'ID Authorized Event',
  24: 'CANBUS Info Event',
  25: 'Tachograph Common Event',
  26: 'Tachograph DDD File Upload Event',
  27: 'Output Alarm Event',
  28: 'Delta AIS Alarm Event',
  29: 'PDP Alarm Event',
  30: 'BLE Common Info Event',
  31: 'External Humidity Alarm Event',
  32: 'Jamming Alarm Event',
  35: 'TLS Certificate File Download Event',
  38: 'Upgrade Configuration Event',
  39: 'GNSS Spoofing Alarm Event',
  40: 'PEO Fence Alarm Event',
  41: 'PEO Fence Over Speed Alarm Event',
  44: 'BLE Slave Connect Event',
  45: 'CANBUS Info Alarm Event',
};

export function getEventTypeName(eventType: number): string {
  return EVENT_TYPE_NAMES[eventType] ?? `Unknown Event Type (${eventType})`;
}
