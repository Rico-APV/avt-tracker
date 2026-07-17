/**
 * Event names emitted through @nestjs/event-emitter so other modules (and
 * `TrackerEventPublisherService`, which fans these out to SNS/the outbox
 * table for cross-service consumption) can react to StarLink activity.
 * Mirrors `TRACKER_EVENTS`.
 */
export const STARLINK_EVENTS = {
  DEVICE_CONNECTED: 'starlink.device.connected',
  DEVICE_DISCONNECTED: 'starlink.device.disconnected',
  REPORT_RECEIVED: 'starlink.report.received',
} as const;
