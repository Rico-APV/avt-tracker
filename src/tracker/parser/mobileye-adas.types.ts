/**
 * Mobileye ADAS domain types for AVT110 trackers wired to a Mobileye unit
 * via the vehicle's CAN bus (through the tracker's CAN-Logistic module,
 * configured with AT@CAN/AT@CMS - see "CAN-Logistic Supported parameters",
 * AdvCAN PID 1-8: Headway valid, Headway measurement, Peds FCW, Peds in DZ,
 * LDW off, FCW on, Left LDW on, Right LDW on).
 *
 * Mapping confirmed 2026-08-13 by reverse-engineering a real +RPT frame
 * (the AVT110 Tracker Protocol R6.01 document itself never mentions
 * Mobileye/ADAS or an AdvCAN PID -> Data Mask bit mapping): AdvCAN PID N
 * lands as the (N-1)-th bit of the "CAN Advanced Information Mask 1" block,
 * which itself is +RPT Data Mask bit 24 - see
 * `TrackerParserService.parseCanAdvancedInfoMask1Block`/
 * `deriveMobileyeAdasReading` and `CanAdvancedInfoMask1Block` in
 * `tracker-parser.types.ts`. Each present PID is a 1-byte length followed
 * by that many bytes of data (1 byte for all of PID 1-8 today). An absent/
 * disconnected Mobileye unit reports each PID byte as the sentinel `0xFF`.
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
