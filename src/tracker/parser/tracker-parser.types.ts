import { MobileyeAdasReading } from './mobileye-adas.types';

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
  /**
   * Never populated yet - see `mobileye-adas.types.ts` for why (no confirmed
   * AdvCAN PID -> Data Mask bit mapping). Declared here so the field is
   * ready once `parseReportDataZone` can decode it.
   */
  mobileyeAdas?: MobileyeAdasReading;
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
