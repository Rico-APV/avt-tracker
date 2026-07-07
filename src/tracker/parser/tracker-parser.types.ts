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
  /** Top-level Data Mask bits (>=9) that carry structures we don't decode yet (CAN bus, tachograph, BLE, ...). */
  unsupportedDataMaskBits: number[];
}

export interface AsciiFrameData {
  raw: string;
  fields: string[];
  commandKey?: string;
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
