import {
  MobileyeAdasEventType,
  MobileyeAdasReading,
} from './mobileye-adas.types';

/**
 * Frame "head" tokens as they appear literally on the wire, e.g. `+RPT:`.
 * See AVT110 Tracker Protocol R6.01, section 3.1 (Message Format).
 */
export enum TrackerFrameKind {
  RPT = '+RPT',
  RPT_HISTORICAL = '-RPT',
  HBD = '+HBD',
  ACK = '+ACK',
  NACK = '+NACK',
  QRY = '+QRY',
  ALL = '+ALL',
  VER = '+VER',
  QNI = '+QNI',
  GSV = '+GSV',
  LSV = '+LSV',
  BSV = '+BSV',
  GAV = '+GAV',
  CVS = '+CVS',
  CMI = '+CMI',
  DFI = '+DFI',
  LDP = '+LDP',
  LDP_HISTORICAL = '-LDP',
  BMR = '+BMR',
  BMR_HISTORICAL = '-BMR',
  SCF = '+SCF',
  TCF = '+TCF',
  BCD = '+BCD',
  UNKNOWN = 'UNKNOWN',
}

/** Which frame kinds carry a binary (hex) data zone vs an ASCII CSV one. */
export const HEX_ENCODED_FRAME_KINDS = new Set<TrackerFrameKind>([
  TrackerFrameKind.RPT,
  TrackerFrameKind.RPT_HISTORICAL,
  TrackerFrameKind.HBD,
  TrackerFrameKind.LDP,
  TrackerFrameKind.LDP_HISTORICAL,
  TrackerFrameKind.BMR,
  TrackerFrameKind.BMR_HISTORICAL,
]);

export interface GnssFix {
  /** Raw fix-type byte, high nibble = generated type, low nibble = fix result. */
  fixTypeRaw?: number;
  generatedType?: number;
  fixResult?: number;
  hdop?: number;
  speedKmh?: number;
  azimuth?: number;
  altitudeM?: number;
  /** Decimal degrees. */
  latitude?: number;
  /** Decimal degrees. */
  longitude?: number;
  utcTime?: Date;
  satellites?: {
    mask: number;
    gps?: number;
    beidou?: number;
    galileo?: number;
    glonass?: number;
  };
}

export interface GnssBlock {
  infoMask: number;
  count: number;
  fixes: GnssFix[];
  /** Convenience accessor for the first (primary) fix in the block. */
  primary?: GnssFix;
}

export interface BatteryBlock {
  voltageMv: number;
  levelPercent: number;
}

export interface CellBlock {
  mcc: number;
  mnc: number;
  lac: number;
  cellId: number;
  csq: number;
}

export interface UpgradeBlock {
  code: number;
}

export interface OneWireSensorReading {
  sensorIdHex: string;
  dataMask: number;
  temperatureC?: number;
  humidityPercent?: number;
}

export interface FuelConsumptionReading {
  litersPer100Km: number;
  litersPerHour: number;
}

export interface FuelLevelReading {
  liters: number;
  percent: number;
}

export interface DtcCode {
  /** e.g. "P022E". */
  code: string;
  permanent: boolean;
  pending: boolean;
  confirmed: boolean;
}

export interface TyreReading {
  /** 0-14; 15 (0xF) means "not available". */
  axlePosition: number;
  /** 0-14; 15 (0xF) means "not available". */
  wheelPosition: number;
  pressureKpa: number;
  temperatureC: number;
  /** 0: OK, 1: low pressure, 2: very low pressure, 0xFF: unavailable. */
  state: number;
}

/** +RPT Data Mask bit 9 (CAN Info Mask 1). See protocol section 3.2.1. */
export interface CanInfoMask1Block {
  mask: number;
  vin?: string;
  /** 0: off, 1: on, 2: engine on. */
  ignitionKey?: number;
  totalDistanceHm?: number;
  totalDistanceImpulses?: number;
  totalFuelUsedMl?: number;
  vehicleSpeedKmh?: number;
  engineRpm?: number;
  engineCoolantTemperatureC?: number;
  fuelConsumption?: FuelConsumptionReading;
  fuelLevel?: FuelLevelReading;
  rangeKm?: number;
  acceleratorPedalPressurePercent?: number;
  totalEngineHoursSeconds?: number;
  totalDrivingTimeSeconds?: number;
  totalEngineIdleTimeSeconds?: number;
  totalIdleFuelUsedMl?: number;
  axleWeight1Kg?: number;
  axleWeight2Kg?: number;
  axleWeight3Kg?: number;
  axleWeight4Kg?: number;
  /** Raw bitmask; see protocol doc for the per-bit indicator meanings. */
  detailedIndicators1?: number;
  /** Raw bitmask; see protocol doc for the per-bit indicator meanings. */
  detailedIndicators2?: number;
  /** Raw bitmask; see protocol doc for the per-bit light meanings. */
  lights?: number;
  /** Raw bitmask; see protocol doc for the per-bit door meanings. */
  doors?: number;
  totalVehicleOverspeedTimeSeconds?: number;
  totalVehicleEngineOverspeedTimeSeconds?: number;
  engineColdStartsCount?: number;
  engineAllStartsCount?: number;
  engineStartsByIgnitionCount?: number;
  totalEngineColdRunningTimeSeconds?: number;
  handbrakeAppliesDuringRideCount?: number;
  /** Bits (0-31) we recognised but stopped decoding at, or never modelled. */
  unsupportedBits: number[];
}

/** +RPT Data Mask bit 10 (CAN Info Mask 2). See protocol section 3.2.1. */
export interface CanInfoMask2Block {
  mask: number;
  adBlueLevelPercent?: number;
  retarderUsagePercent?: number;
  /** Raw byte; see protocol doc for the PTO sub-fields. */
  powerMode?: number;
  axleWeight5Kg?: number;
  axleWeight6Kg?: number;
  axleWeight7Kg?: number;
  analogInputMv?: number;
  engineBrakingFactor?: number;
  pedalBrakingFactor?: number;
  totalAcceleratorKickdowns?: number;
  totalEffectiveEngineSpeedTimeSeconds?: number;
  totalCruiseControlTimeSeconds?: number;
  totalAcceleratorKickdownTimeSeconds?: number;
  totalBrakeApplications?: number;
  oilTemperatureC?: number;
  trailerVin?: string;
  registrationNumber?: string;
  rapidBrakings?: number;
  rapidAccelerations?: number;
  engineTorquePercent?: number;
  serviceDistanceKm?: number;
  ambientTemperatureC?: number;
  dtcCodes?: DtcCode[];
  gaseousFuelLevel?: FuelLevelReading;
  fuelLevelCombustion?: FuelLevelReading;
  totalFuelFromVehicleMl?: number;
  totalGaseousFuelUsageKg?: number;
  tyres?: TyreReading[];
  /** Days from now (negative = overdue). Raw field has a -1000 day offset. */
  timeToServiceDays?: number;
  /** Bits (0-31) we recognised but stopped decoding at, or never modelled. */
  unsupportedBits: number[];
}

/** +RPT Data Mask bit 23 (CAN Info Mask 3). See protocol section 3.2.1. */
export interface CanInfoMask3Block {
  mask: number;
  totalRetarderUsageTimeSeconds?: number;
  totalCo2EmissionKg?: number;
  totalPtoUsageTimeSeconds?: number;
  totalFuelUsedWithPtoEngagedMl?: number;
  currentGearNumber?: number;
  /** Bits (0-31) we recognised but stopped decoding at, or never modelled. */
  unsupportedBits: number[];
}

/**
 * +RPT Data Mask bit 11 (Electric Info Mask 1). Field boundaries below are
 * inferred from this project's own naming conventions elsewhere in the
 * protocol ("Total X" fields ~= 4-byte counters, "X Percent" fields ~=
 * 1 byte * 0.4, temperatures ~= signed 2-byte) and cross-checked only
 * against the TOTAL byte length of a single real +RPT sample where every
 * field happened to read as zero. That confirms the overall 31-byte length
 * (and therefore that whatever Data Mask bits follow, e.g. bit 23/24,
 * realign correctly) but does NOT confirm individual field boundaries
 * against any non-zero sample or vendor doc - treat these values with
 * caution until validated against a frame with real battery data.
 */
export interface ElectricInfoMask1Block {
  mask: number;
  batteryInstantaneousVoltage?: number;
  batteryChargingCyclesCount?: number;
  totalEnergyRecuperated?: number;
  batteryLevelPercent?: number;
  chargingState?: number;
  batteryTemperatureC?: number;
  batteryChargingCurrent?: number;
  batteryInstantaneousPower?: number;
  batteryStateOfHealthPercent?: number;
  totalEnergyUsed?: number;
  totalEnergyUsedWhenIdling?: number;
  totalEnergyCharged?: number;
  onlyBatteryChargeLevelPercent?: number;
  /** Bits (0-31) we recognised but stopped decoding at, or never modelled. */
  unsupportedBits: number[];
}

/** A single length-prefixed AdvCAN PID reading inside a CAN Advanced Information Mask. */
export interface CanAdvancedInfoPid {
  /** 1-based AdvCAN PID number (mask bit index + 1). */
  pid: number;
  data: Buffer;
}

/**
 * +RPT Data Mask bit 24 (CAN Advanced Information Mask 1) - the
 * "AdvancedCAN"/AdvCAN PID feed described in "CAN-Logistic v3 Xon/Xoff
 * protocol" section 8.2 and the "Mobileye integration through Advanced CAN"
 * application note. Each set mask bit N carries one length-prefixed AdvCAN
 * PID (N+1): a 1-byte length followed by that many bytes of raw data. See
 * `mobileye-adas.types.ts` for how PIDs 1-8 (the currently documented
 * Mobileye parameters) are interpreted.
 */
export interface CanAdvancedInfoMask1Block {
  mask: number;
  pids: CanAdvancedInfoPid[];
}

export interface EventDataBlock {
  mask: number;
  mainPowerVoltageMv?: number;
  analogInput?: { index: number; voltageMv: number };
  ignitionMotionState?: number;
  digitalInputState?: number;
  digitalOutputState?: number;
  mileage?: { currentHm: number; totalHm: number };
  geoStatusMask?: number;
  idData?: { length: number; hex: string };
  oneWire?: OneWireSensorReading[];
  hourMeter?: { currentSeconds: number; totalSeconds: number };
  selfCalibration?: {
    xForward: number;
    yForward: number;
    zForward: number;
    xHorizontal: number;
    yHorizontal: number;
    zHorizontal: number;
    xGravity: number;
    yGravity: number;
    zGravity: number;
  };
  crash?: {
    counter: number;
    ascStatus: number;
    x: number;
    y: number;
    z: number;
  };
  certificate?: {
    serverProtocolType: number;
    certificateFileType: number;
    downloadCode: number;
  };
  peoStatus1to32?: number;
  peoStatus33to50?: number;
  canBusSyncId?: number;
  /** Bits inside the (nested) Event Data Mask we recognised but stopped at. */
  unsupportedBits: number[];
}

export interface TrackerReportPayload {
  protocolVersion: string;
  eventType: number;
  eventName: string;
  eventState: number;
  dataMask: number;
  frame?: { count: number; id: number };
  networkType?: number;
  battery?: BatteryBlock;
  gnss?: GnssBlock;
  cell?: CellBlock;
  upgrade?: UpgradeBlock;
  eventData?: EventDataBlock;
  canInfo1?: CanInfoMask1Block;
  canInfo2?: CanInfoMask2Block;
  canInfo3?: CanInfoMask3Block;
  electricInfo1?: ElectricInfoMask1Block;
  canAdvancedInfo1?: CanAdvancedInfoMask1Block;
  /**
   * Derived from `canAdvancedInfo1`'s AdvCAN PID 1-8 (see
   * `mobileye-adas.types.ts`), populated whenever Data Mask bit 24 is
   * present and carries PID 1 (Headway valid).
   */
  mobileyeAdas?: MobileyeAdasReading;
  /** Discrete ADAS events derived from `mobileyeAdas`; see `deriveMobileyeAdasEvents`. */
  mobileyeAdasEvents?: MobileyeAdasEventType[];
  /** Top-level Data Mask bits (>=9) that carry structures we don't decode yet (CAN bus, tachograph, BLE, ...). */
  unsupportedDataMaskBits: number[];
}

export interface PeoFencePoint {
  longitude: number;
  latitude: number;
}

/**
 * A single PEO (polygon fence) record as it appears in an ASCII list report
 * (e.g. inside a `-ALL:`/`0104` frame). Field order inferred from the
 * `AT@PEO` command layout (protocol section 2.1.3.5): it isn't itself
 * documented as a report message, but the trailing four values match
 * `AT@PEO`'s <Check Interval>/<Over Speed Alarm Mode>/<Over Speed
 * Threshold>/<Over Speed Duration> defaults (0, 0, 30, 0) exactly, in that
 * order, which is what this mapping is based on.
 */
export interface PeoFenceStatus {
  peoId: number;
  /** AT@PEO <Mode>: 0 disabled, 1 enter alarm, 2 exit alarm, 3 enter+exit alarm. */
  mode: number;
  startPoint: number;
  endPoint: number;
  points: PeoFencePoint[];
  checkIntervalSeconds: number;
  overSpeedAlarmMode: number;
  overSpeedThresholdKmh: number;
  overSpeedDurationSeconds: number;
}

export interface AsciiFrameData {
  raw: string;
  fields: string[];
  commandKey?: string;
  /** Populated when `fields` contains one or more `PEO` fence records. */
  peoFences?: PeoFenceStatus[];
}

export interface HeartbeatPayload {
  protocolVersion: string;
}

export interface TrackerFrameHeader {
  kind: TrackerFrameKind;
  headToken: string;
  declaredLength: number;
  computedDataZoneLength: number;
  imei: string;
  deviceId: number;
  generatedAt: Date | null;
  serialNumberHex: string;
  serialNumber: number;
}

export interface ParsedTrackerFrame {
  header: TrackerFrameHeader;
  report?: TrackerReportPayload;
  heartbeat?: HeartbeatPayload;
  ascii?: AsciiFrameData;
  warnings: string[];
  rawHex: string;
  dataZoneHex: string;
}
