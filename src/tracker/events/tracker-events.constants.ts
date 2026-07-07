/**
 * Event names emitted through @nestjs/event-emitter so other modules
 * (websocket gateways, alerting, notifications, ...) can react to tracker
 * activity without coupling to the TCP/parsing internals.
 */
export const TRACKER_EVENTS = {
  DEVICE_CONNECTED: 'tracker.device.connected',
  DEVICE_DISCONNECTED: 'tracker.device.disconnected',
  REPORT_RECEIVED: 'tracker.report.received',
} as const;
