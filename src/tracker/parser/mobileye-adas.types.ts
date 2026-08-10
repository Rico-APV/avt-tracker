/**
 * Mobileye ADAS domain types for AVT110 trackers wired to a Mobileye unit
 * via the vehicle's CAN bus (through the tracker's CAN-Logistic module,
 * configured with AT@CAN/AT@CMS - see "CAN-Logistic Supported parameters",
 * AdvCAN PID 1-8: Headway valid, Headway measurement, Peds FCW, Peds in DZ,
 * LDW off, FCW on, Left LDW on, Right LDW on).
 *
 * STATUS: data model only, not wired up to any parser yet. The AVT110
 * Tracker Protocol R6.01 document does not mention Mobileye/ADAS anywhere -
 * no CAN Info Mask bit and no Special Car Model ID is documented for it (the
 * only Special Car Model IDs in that revision are 158/160/161, for the
 * e-GENSET and Multilift Ultima equipment). There is currently no confirmed
 * mapping from these AdvCAN PIDs onto a specific +RPT Data Mask / CAN Info
 * Mask field.
 *
 * TODO: wire `MobileyeAdasReading` into `TrackerParserService` (see the
 * `TrackerReportPayload.mobileyeAdas` field and the Data Mask bit 9-31
 * default case in `parseReportDataZone`) once either:
 *   - the CAN-Logistic configuration file referenced by the "Supported
 *     parameters" doc (which maps AdvCAN PIDs to specific CAN Info Mask
 *     fields for this device) becomes available, or
 *   - a real +RPT/-ALL frame captured from a vehicle with Mobileye
 *     connected is available to reverse-engineer the mapping against
 *     (the same way the PEO fence field order was confirmed above).
 *
 * Naming is aligned with `TYPES_EVENTS_MOBILEYE` in scope-backend
 * (LWDL/LWDR/FCW/HCW) for cross-system consistency.
 */

/** Raw AdvCAN PID 1-8 readings, per the CAN-Logistic "Supported parameters" table. */
export interface MobileyeAdasReading {
  /** AdvCAN PID 1. */
  headwayValid: boolean;
  /** AdvCAN PID 2; raw byte range 0-127, unit 0.1s/bit. */
  headwayMeasurementSeconds: number;
  /** AdvCAN PID 3. */
  pedestrianForwardCollisionWarning: boolean;
  /** AdvCAN PID 4. */
  pedestrianInDangerZone: boolean;
  /** AdvCAN PID 5. */
  laneDepartureWarningOff: boolean;
  /** AdvCAN PID 6. */
  forwardCollisionWarningOn: boolean;
  /** AdvCAN PID 7. */
  leftLaneDepartureWarningOn: boolean;
  /** AdvCAN PID 8. */
  rightLaneDepartureWarningOn: boolean;
}

/** Discrete ADAS event types, named to match scope-backend's TYPES_EVENTS_MOBILEYE. */
export enum MobileyeAdasEventType {
  LWDL = 'LWDL',
  LWDR = 'LWDR',
  FCW = 'FCW',
  PCW = 'PCW',
  PEDESTRIAN_IN_DANGER_ZONE = 'PEDESTRIAN_IN_DANGER_ZONE',
}

/**
 * Derives discrete ADAS events from a raw reading. Pure/stateless so it can
 * be exercised independently of however `MobileyeAdasReading` ends up being
 * parsed off the wire.
 */
export function deriveMobileyeAdasEvents(
  reading: MobileyeAdasReading,
): MobileyeAdasEventType[] {
  const events: MobileyeAdasEventType[] = [];
  if (reading.leftLaneDepartureWarningOn) {
    events.push(MobileyeAdasEventType.LWDL);
  }
  if (reading.rightLaneDepartureWarningOn) {
    events.push(MobileyeAdasEventType.LWDR);
  }
  if (reading.forwardCollisionWarningOn) {
    events.push(MobileyeAdasEventType.FCW);
  }
  if (reading.pedestrianForwardCollisionWarning) {
    events.push(MobileyeAdasEventType.PCW);
  }
  if (reading.pedestrianInDangerZone) {
    events.push(MobileyeAdasEventType.PEDESTRIAN_IN_DANGER_ZONE);
  }
  return events;
}
