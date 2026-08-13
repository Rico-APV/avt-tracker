import { Injectable, Logger } from '@nestjs/common';
import {
  decodeDtcCode,
  decodeExtendedHms,
  decodeGTime,
  decodeImei,
  decodeShortHms,
  formatProtocolVersion,
  toHex,
} from './utils/binary-codec.util';
import { BufferCursor } from './utils/buffer-cursor';
import { getEventTypeName } from './tracker-parser.constants';
import {
  deriveMobileyeAdasEvents,
  MobileyeAdasReading,
} from './mobileye-adas.types';
import {
  AsciiFrameData,
  CanAdvancedInfoMask1Block,
  CanInfoMask1Block,
  CanInfoMask2Block,
  CanInfoMask3Block,
  DtcCode,
  ElectricInfoMask1Block,
  EventDataBlock,
  GnssBlock,
  GnssFix,
  HEX_ENCODED_FRAME_KINDS,
  HeartbeatPayload,
  OneWireSensorReading,
  ParsedTrackerFrame,
  PeoFencePoint,
  PeoFenceStatus,
  TrackerFrameHeader,
  TrackerFrameKind,
  TrackerReportPayload,
  TyreReading,
} from './tracker-parser.types';

/** Size (bytes) of the fixed header fields that precede the data zone. */
const HEADER_FIXED_BYTES = {
  length: 2,
  imei: 8,
  deviceId: 1,
} as const;

/** Bytes consumed, within the binary section, before the data zone starts. */
const HEADER_PREFIX_BYTES =
  HEADER_FIXED_BYTES.length +
  HEADER_FIXED_BYTES.imei +
  HEADER_FIXED_BYTES.deviceId;

/** Size (bytes) of the fixed trailer fields that follow the data zone. */
const TRAILER_FIXED_BYTES = {
  generatedTime: 7,
  serialNumber: 2,
} as const;

const ALL_FRAME_KIND_TOKENS = Object.values(TrackerFrameKind).filter(
  (value) => value !== TrackerFrameKind.UNKNOWN,
) as string[];

/**
 * Stateless decoder for AVT110 Tracker Protocol (R6.01) frames.
 *
 * Framing (accumulating a socket's byte stream and splitting on the 0x23
 * '#' terminator) is deliberately NOT this class's job - see
 * `TrackerFrameSplitter` / `TrackerTcpServer`. This service only ever
 * receives one already-delimited frame (including its trailing '#') and
 * turns it into a typed object.
 *
 * Design goal: never throw out of `parseFrame`. Any field we don't
 * understand, or any truncated/corrupt payload, degrades to a `warnings`
 * entry on the returned object instead of an exception, so a single bad
 * frame can never take down the TCP connection or the process.
 */
@Injectable()
export class TrackerParserService {
  private readonly logger = new Logger(TrackerParserService.name);

  parseFrame(frame: Buffer): ParsedTrackerFrame {
    this.logger.debug(`Parsing frame: ${toHex(frame)}`);

    if (frame.length === 0) {
      throw new Error('Cannot parse an empty frame');
    }

    const headToken = this.readHeadToken(frame);
    const kind = this.resolveKind(headToken);
    const hasTrailingHash = frame[frame.length - 1] === 0x23;
    const warnings: string[] = [];
    if (!hasTrailingHash) {
      warnings.push(
        "Frame did not end with the expected '#' (0x23) terminator; " +
          'attempting to parse it anyway.',
      );
    }

    const bodyEnd = hasTrailingHash ? frame.length - 1 : frame.length;
    const binarySection = frame.subarray(headToken.length, bodyEnd);

    const header = this.parseHeader(headToken, kind, binarySection, warnings);
    const dataZoneStart = headToken.length + HEADER_PREFIX_BYTES;
    const dataZone = frame.subarray(
      dataZoneStart,
      dataZoneStart + header.computedDataZoneLength,
    );

    const parsed: ParsedTrackerFrame = {
      header,
      warnings,
      rawHex: toHex(frame),
      dataZoneHex: toHex(dataZone),
    };

    try {
      if (
        kind === TrackerFrameKind.RPT ||
        kind === TrackerFrameKind.RPT_HISTORICAL
      ) {
        parsed.report = this.parseReportDataZone(dataZone, warnings);
      } else if (kind === TrackerFrameKind.HBD) {
        parsed.heartbeat = this.parseHeartbeatDataZone(dataZone);
      } else if (HEX_ENCODED_FRAME_KINDS.has(kind)) {
        warnings.push(
          `Structured decoding for ${kind} frames is not implemented yet ` +
            '(TODO); rawHex/dataZoneHex are still available for reprocessing.',
        );
      } else {
        parsed.ascii = this.parseAsciiDataZone(dataZone, warnings);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to decode data zone: ${message}`);
      this.logger.warn(
        `Frame ${kind} from IMEI ${header.imei} partially decoded: ${message}`,
      );
    }

    return parsed;
  }

  // ---------------------------------------------------------------------
  // Header / framing
  // ---------------------------------------------------------------------

  private readHeadToken(frame: Buffer): string {
    const colonIndex = frame.indexOf(0x3a); // ':'
    if (colonIndex === -1 || colonIndex > 7) {
      throw new Error(
        `Could not locate a frame head token (expected e.g. "+RPT:" near the start): ${toHex(
          frame.subarray(0, Math.min(frame.length, 8)),
        )}`,
      );
    }
    return frame.toString('ascii', 0, colonIndex + 1);
  }

  private resolveKind(headToken: string): TrackerFrameKind {
    const withoutColon = headToken.replace(/:$/, '');
    return ALL_FRAME_KIND_TOKENS.includes(withoutColon)
      ? (withoutColon as TrackerFrameKind)
      : TrackerFrameKind.UNKNOWN;
  }

  private parseHeader(
    headToken: string,
    kind: TrackerFrameKind,
    binarySection: Buffer,
    warnings: string[],
  ): TrackerFrameHeader {
    const cursor = new BufferCursor(binarySection);
    const declaredLength = cursor.readUInt16BE();
    const imei = decodeImei(cursor.readBytes(HEADER_FIXED_BYTES.imei));
    const deviceId = cursor.readUInt8();

    const fixedTailBytes =
      TRAILER_FIXED_BYTES.generatedTime + TRAILER_FIXED_BYTES.serialNumber;
    const computedDataZoneLength =
      binarySection.length - cursor.offset - fixedTailBytes;

    if (computedDataZoneLength < 0) {
      throw new Error(
        `${kind} frame is too short to contain its header and trailer ` +
          `(binary section is ${binarySection.length} bytes)`,
      );
    }

    // We trust the actual byte layout (computed from the frame we were
    // handed) over the device-declared Length field, but surface a
    // mismatch since it can indicate stream desync.
    const expectedDeclaredLength =
      binarySection.length - HEADER_FIXED_BYTES.length;
    if (declaredLength !== expectedDeclaredLength) {
      warnings.push(
        `Declared Length (${declaredLength}) does not match the actual frame ` +
          `size (${expectedDeclaredLength}); trusting actual bytes.`,
      );
    }

    cursor.skip(computedDataZoneLength);
    const generatedAt = decodeGTime(
      cursor.readBytes(TRAILER_FIXED_BYTES.generatedTime),
    );
    const serialNumberBytes = cursor.readBytes(
      TRAILER_FIXED_BYTES.serialNumber,
    );
    const serialNumber = serialNumberBytes.readUInt16BE(0);
    const serialNumberHex = toHex(serialNumberBytes);

    return {
      kind,
      headToken,
      declaredLength,
      computedDataZoneLength,
      imei,
      deviceId,
      generatedAt,
      serialNumberHex,
      serialNumber,
    };
  }

  // ---------------------------------------------------------------------
  // +HBD
  // ---------------------------------------------------------------------

  private parseHeartbeatDataZone(dataZone: Buffer): HeartbeatPayload {
    if (dataZone.length < 2) {
      throw new Error(
        `+HBD data zone too short for protocol version (${dataZone.length} bytes)`,
      );
    }
    return { protocolVersion: formatProtocolVersion(dataZone.subarray(0, 2)) };
  }

  // ---------------------------------------------------------------------
  // ASCII (+ACK / +QRY / +ALL / +VER / ...)
  // ---------------------------------------------------------------------

  private parseAsciiDataZone(
    dataZone: Buffer,
    warnings: string[],
  ): AsciiFrameData {
    const raw = dataZone.toString('ascii');
    const fields = raw.length > 0 ? raw.split(',') : [];
    const ascii: AsciiFrameData = {
      raw,
      fields,
      commandKey: fields[0] || undefined,
    };

    const peoFences = this.parsePeoFenceList(fields, warnings);
    if (peoFences.length > 0) {
      ascii.peoFences = peoFences;
    }

    return ascii;
  }

  /**
   * Scans an ASCII field list for repeated `PEO,<id>,<mode>,<start>,<end>,
   * <lon,lat>*N,<checkInterval>,<overSpeedAlarmMode>,<overSpeedThreshold>,
   * <overSpeedDuration>` records and decodes them. See the field-order note
   * on `PeoFenceStatus`.
   */
  private parsePeoFenceList(
    fields: string[],
    warnings: string[],
  ): PeoFenceStatus[] {
    const fences: PeoFenceStatus[] = [];

    for (let i = 0; i < fields.length; i++) {
      if (fields[i] !== 'PEO') {
        continue;
      }

      const peoId = Number(fields[i + 1]);
      const mode = Number(fields[i + 2]);
      const startPoint = Number(fields[i + 3]);
      const endPoint = Number(fields[i + 4]);
      const pointCount = endPoint - startPoint + 1;

      if (
        !Number.isFinite(peoId) ||
        !Number.isFinite(mode) ||
        !Number.isFinite(startPoint) ||
        !Number.isFinite(endPoint) ||
        pointCount < 0
      ) {
        warnings.push(
          `Could not parse PEO fence record at ASCII field ${i}: malformed id/mode/start/end.`,
        );
        break;
      }

      const points: PeoFencePoint[] = [];
      let cursor = i + 5;
      let truncated = false;
      for (let p = 0; p < pointCount; p++) {
        const longitude = Number(fields[cursor]);
        const latitude = Number(fields[cursor + 1]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          warnings.push(
            `PEO fence ${peoId} coordinates truncated at ASCII field ${cursor}; ` +
              'only the fully received points are included.',
          );
          truncated = true;
          break;
        }
        points.push({ longitude, latitude });
        cursor += 2;
      }
      if (truncated) {
        break;
      }

      const checkIntervalSeconds = Number(fields[cursor]);
      const overSpeedAlarmMode = Number(fields[cursor + 1]);
      const overSpeedThresholdKmh = Number(fields[cursor + 2]);
      const overSpeedDurationSeconds = Number(fields[cursor + 3]);

      if (
        !Number.isFinite(checkIntervalSeconds) ||
        !Number.isFinite(overSpeedAlarmMode) ||
        !Number.isFinite(overSpeedThresholdKmh) ||
        !Number.isFinite(overSpeedDurationSeconds)
      ) {
        warnings.push(
          `PEO fence ${peoId} check-interval/over-speed fields truncated at ` +
            `ASCII field ${cursor}.`,
        );
        break;
      }

      fences.push({
        peoId,
        mode,
        startPoint,
        endPoint,
        points,
        checkIntervalSeconds,
        overSpeedAlarmMode,
        overSpeedThresholdKmh,
        overSpeedDurationSeconds,
      });

      i = cursor + 3;
    }

    return fences;
  }

  // ---------------------------------------------------------------------
  // +RPT / -RPT
  // ---------------------------------------------------------------------

  private parseReportDataZone(
    dataZone: Buffer,
    warnings: string[],
  ): TrackerReportPayload {
    const cursor = new BufferCursor(dataZone);
    const protocolVersion = formatProtocolVersion(cursor.readBytes(2));
    const eventType = cursor.readUInt8();
    const eventState = cursor.readUInt8();
    const dataMask = cursor.readUInt32BE();

    const payload: TrackerReportPayload = {
      protocolVersion,
      eventType,
      eventName: getEventTypeName(eventType),
      eventState,
      dataMask,
      unsupportedDataMaskBits: [],
    };

    for (let bit = 0; bit <= 31; bit++) {
      if (!(dataMask & (1 << bit))) {
        continue;
      }
      try {
        switch (bit) {
          case 0: {
            const count = cursor.readUInt8();
            const id = cursor.readUInt8();
            payload.frame = { count, id };
            break;
          }
          case 1: {
            payload.networkType = cursor.readUInt8();
            break;
          }
          case 2: {
            const voltageMv = cursor.readUInt16BE();
            const levelPercent = cursor.readUInt8();
            payload.battery = { voltageMv, levelPercent };
            break;
          }
          case 3: {
            payload.gnss = this.parseGnssBlock(cursor);
            break;
          }
          case 4: {
            const mcc = cursor.readUInt16BE();
            const mnc = cursor.readUInt16BE();
            const lac = cursor.readUInt16BE();
            const cellId = cursor.readUInt32BE();
            const csq = cursor.readUInt8();
            payload.cell = { mcc, mnc, lac, cellId, csq };
            break;
          }
          case 5:
          case 6:
            // Reserved, no payload bytes.
            break;
          case 7: {
            const code = cursor.readUInt8();
            cursor.skip(2); // reserved
            payload.upgrade = { code };
            break;
          }
          case 8: {
            payload.eventData = this.parseEventDataBlock(cursor, warnings);
            break;
          }
          case 9: {
            payload.canInfo1 = this.parseCanInfoMask1Block(cursor, warnings);
            break;
          }
          case 10: {
            payload.canInfo2 = this.parseCanInfoMask2Block(cursor, warnings);
            break;
          }
          case 11: {
            payload.electricInfo1 = this.parseElectricInfoMask1Block(
              cursor,
              warnings,
            );
            break;
          }
          case 23: {
            payload.canInfo3 = this.parseCanInfoMask3Block(cursor, warnings);
            break;
          }
          case 24: {
            const canAdvancedInfo1 = this.parseCanAdvancedInfoMask1Block(
              cursor,
              warnings,
            );
            payload.canAdvancedInfo1 = canAdvancedInfo1;
            const mobileyeAdas =
              this.deriveMobileyeAdasReading(canAdvancedInfo1);
            if (mobileyeAdas) {
              payload.mobileyeAdas = mobileyeAdas;
              payload.mobileyeAdasEvents =
                deriveMobileyeAdasEvents(mobileyeAdas);
            }
            break;
          }
          default: {
            // Bits 12-22, 25-31 (UART1, Tachograph*, Special Car, NMEA2000,
            // BLE, Upgrade Config, ...) carry large nested structures that
            // are not decoded yet.
            // TODO: implement per docs/AVT110_Tracker_Protocol_6_01.pdf.
            payload.unsupportedDataMaskBits.push(bit);
            break;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Stopped decoding Data Mask at bit ${bit}: ${message}. Remaining ` +
            'fields (if any) are only available via dataZoneHex.',
        );
        // Once a read fails we can no longer trust field boundaries for
        // subsequent bits, so stop rather than guess.
        break;
      }
    }

    if (payload.unsupportedDataMaskBits.length > 0) {
      warnings.push(
        `Data Mask bits not decoded: [${payload.unsupportedDataMaskBits.join(', ')}]. ` +
          'TODO: CAN bus / tachograph / BLE / NMEA2000 blocks - see protocol PDF.',
      );
    }

    return payload;
  }

  private parseGnssBlock(cursor: BufferCursor): GnssBlock {
    const infoMask = cursor.readUInt16BE();
    const count = cursor.readUInt8();
    const fixes: GnssFix[] = [];
    for (let i = 0; i < count; i++) {
      fixes.push(this.parseGnssFix(cursor, infoMask));
    }
    return { infoMask, count, fixes, primary: fixes[0] };
  }

  private parseGnssFix(cursor: BufferCursor, infoMask: number): GnssFix {
    const fix: GnssFix = {};

    if (infoMask & 0x0001) {
      const raw = cursor.readUInt8();
      fix.fixTypeRaw = raw;
      fix.generatedType = (raw >> 4) & 0x0f;
      fix.fixResult = raw & 0x0f;
    }
    if (infoMask & 0x0002) {
      fix.hdop = cursor.readUInt8();
    }
    if (infoMask & 0x0004) {
      fix.speedKmh = cursor.readUInt16BE();
    }
    if (infoMask & 0x0008) {
      fix.azimuth = cursor.readUInt16BE();
    }
    if (infoMask & 0x0010) {
      fix.altitudeM = cursor.readInt16BE();
    }
    if (infoMask & 0x0020) {
      fix.latitude = cursor.readInt32BE() / 1e6;
    }
    if (infoMask & 0x0040) {
      fix.longitude = cursor.readInt32BE() / 1e6;
    }
    if (infoMask & 0x0080) {
      fix.utcTime = decodeGTime(cursor.readBytes(7)) ?? undefined;
    }
    if (infoMask & 0x0100) {
      const satMask = cursor.readUInt8();
      fix.satellites = { mask: satMask };
      if (satMask & 0x01) fix.satellites.gps = cursor.readUInt8();
      if (satMask & 0x02) fix.satellites.beidou = cursor.readUInt8();
      if (satMask & 0x04) fix.satellites.galileo = cursor.readUInt8();
      if (satMask & 0x08) fix.satellites.glonass = cursor.readUInt8();
    }

    return fix;
  }

  private parseEventDataBlock(
    cursor: BufferCursor,
    warnings: string[],
  ): EventDataBlock {
    const mask = cursor.readUInt32BE();
    const block: EventDataBlock = { mask, unsupportedBits: [] };

    for (let bit = 0; bit <= 31; bit++) {
      if (!(mask & (1 << bit))) {
        continue;
      }
      try {
        switch (bit) {
          case 0:
            block.mainPowerVoltageMv = cursor.readUInt16BE();
            break;
          case 1: {
            const index = cursor.readUInt8();
            const voltageMv = cursor.readUInt16BE();
            block.analogInput = { index, voltageMv };
            break;
          }
          case 2:
            block.ignitionMotionState = cursor.readUInt8();
            break;
          case 3:
            block.digitalInputState = cursor.readUInt8();
            break;
          case 4:
            block.digitalOutputState = cursor.readUInt8();
            break;
          case 5: {
            const currentHm = cursor.readUInt16BE();
            const totalHm = cursor.readUInt32BE();
            block.mileage = { currentHm, totalHm };
            break;
          }
          case 6:
            // Reserved
            break;
          case 7:
            block.geoStatusMask = cursor.readUInt32BE();
            break;
          case 8: {
            const length = cursor.readUInt8();
            block.idData = { length, hex: toHex(cursor.readBytes(length)) };
            break;
          }
          case 9: {
            const sensorCount = cursor.readUInt8();
            block.oneWire = [];
            for (let i = 0; i < sensorCount; i++) {
              const sensorIdHex = toHex(cursor.readBytes(8));
              const dataMaskByte = cursor.readUInt8();
              const reading: OneWireSensorReading = {
                sensorIdHex,
                dataMask: dataMaskByte,
              };
              if (dataMaskByte & 0x01) {
                reading.temperatureC = cursor.readInt16BE() / 10;
              }
              if (dataMaskByte & 0x02) {
                reading.humidityPercent = cursor.readUInt8();
              }
              block.oneWire.push(reading);
            }
            break;
          }
          case 10: {
            const currentSeconds = decodeShortHms(cursor.readBytes(3));
            const totalSeconds = decodeExtendedHms(cursor.readBytes(5));
            block.hourMeter = { currentSeconds, totalSeconds };
            break;
          }
          case 11:
            block.selfCalibration = {
              xForward: cursor.readInt8(),
              yForward: cursor.readInt8(),
              zForward: cursor.readInt8(),
              xHorizontal: cursor.readInt8(),
              yHorizontal: cursor.readInt8(),
              zHorizontal: cursor.readInt8(),
              xGravity: cursor.readInt8(),
              yGravity: cursor.readInt8(),
              zGravity: cursor.readInt8(),
            };
            break;
          case 12:
            block.crash = {
              counter: cursor.readUInt8(),
              ascStatus: cursor.readUInt8(),
              x: cursor.readInt16BE(),
              y: cursor.readInt16BE(),
              z: cursor.readInt16BE(),
            };
            break;
          case 13:
            // Reserved
            break;
          case 14:
            block.certificate = {
              serverProtocolType: cursor.readUInt8(),
              certificateFileType: cursor.readUInt8(),
              downloadCode: cursor.readUInt8(),
            };
            break;
          case 21:
            block.peoStatus1to32 = cursor.readUInt32BE();
            break;
          case 23:
            block.peoStatus33to50 = cursor.readUInt32BE();
            break;
          case 25:
            block.canBusSyncId = cursor.readUInt32BE();
            break;
          default:
            // Bits 15-20, 22, 24, 26-31: reserved or not modelled yet
            // (e.g. bit 16 CAN sync details beyond the sync ID itself).
            block.unsupportedBits.push(bit);
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Stopped decoding Event Data Mask at bit ${bit}: ${message}.`,
        );
        break;
      }
    }

    if (block.unsupportedBits.length > 0) {
      warnings.push(
        `Event Data Mask bits not decoded: [${block.unsupportedBits.join(', ')}]. TODO.`,
      );
    }

    return block;
  }

  // ---------------------------------------------------------------------
  // CAN Info Mask 1 / 2 (+RPT Data Mask bits 9 / 10)
  // ---------------------------------------------------------------------

  private parseCanInfoMask1Block(
    cursor: BufferCursor,
    warnings: string[],
  ): CanInfoMask1Block {
    const mask = cursor.readUInt32BE();
    const block: CanInfoMask1Block = { mask, unsupportedBits: [] };

    for (let bit = 0; bit <= 31; bit++) {
      if (!(mask & (1 << bit))) {
        continue;
      }
      try {
        switch (bit) {
          case 0:
            block.vin = cursor.readLengthPrefixedAscii();
            break;
          case 1:
            block.ignitionKey = cursor.readUInt8();
            break;
          case 2:
            block.totalDistanceHm = cursor.readUInt32BE();
            break;
          case 3:
            block.totalDistanceImpulses = cursor.readUInt32BE();
            break;
          case 4:
            block.totalFuelUsedMl = cursor.readUInt32BE();
            break;
          case 5:
            block.vehicleSpeedKmh = cursor.readUInt16BE();
            break;
          case 6:
            block.engineRpm = cursor.readUInt16BE();
            break;
          case 7:
            block.engineCoolantTemperatureC = cursor.readInt16BE();
            break;
          case 8:
            block.fuelConsumption = {
              litersPer100Km: cursor.readUInt16BE() * 0.1,
              litersPerHour: cursor.readUInt16BE() * 0.05,
            };
            break;
          case 9:
            block.fuelLevel = {
              liters: cursor.readUInt8(),
              percent: cursor.readUInt8() * 0.4,
            };
            break;
          case 10:
            block.rangeKm = cursor.readUIntBE(3);
            break;
          case 11:
            block.acceleratorPedalPressurePercent = cursor.readUInt8() * 0.4;
            break;
          case 12:
            block.totalEngineHoursSeconds = cursor.readUInt32BE();
            break;
          case 13:
            block.totalDrivingTimeSeconds = cursor.readUInt32BE();
            break;
          case 14:
            block.totalEngineIdleTimeSeconds = cursor.readUInt32BE();
            break;
          case 15:
            block.totalIdleFuelUsedMl = cursor.readUInt32BE();
            break;
          case 16:
            block.axleWeight1Kg = cursor.readUInt16BE() * 0.5;
            break;
          case 17:
            block.axleWeight2Kg = cursor.readUInt16BE() * 0.5;
            break;
          case 18:
            block.axleWeight3Kg = cursor.readUInt16BE() * 0.5;
            break;
          case 19:
            block.axleWeight4Kg = cursor.readUInt16BE() * 0.5;
            break;
          case 20:
            block.detailedIndicators1 = cursor.readUInt32BE();
            break;
          case 21:
            block.detailedIndicators2 = cursor.readUInt32BE();
            break;
          case 22:
            block.lights = cursor.readUInt8();
            break;
          case 23:
            block.doors = cursor.readUInt8();
            break;
          case 24:
            block.totalVehicleOverspeedTimeSeconds = cursor.readUInt32BE();
            break;
          case 25:
            block.totalVehicleEngineOverspeedTimeSeconds =
              cursor.readUInt32BE();
            break;
          case 26:
            block.engineColdStartsCount = cursor.readUIntBE(3);
            break;
          case 27:
            block.engineAllStartsCount = cursor.readUIntBE(3);
            break;
          case 28:
            block.engineStartsByIgnitionCount = cursor.readUIntBE(3);
            break;
          case 29:
            block.totalEngineColdRunningTimeSeconds = cursor.readUInt32BE();
            break;
          case 30:
            block.handbrakeAppliesDuringRideCount = cursor.readUInt16BE();
            break;
          default:
            // Bit 31: reserved.
            block.unsupportedBits.push(bit);
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Stopped decoding CAN Info Mask 1 at bit ${bit}: ${message}.`,
        );
        break;
      }
    }

    if (block.unsupportedBits.length > 0) {
      warnings.push(
        `CAN Info Mask 1 bits not decoded: [${block.unsupportedBits.join(', ')}].`,
      );
    }

    return block;
  }

  private parseCanInfoMask2Block(
    cursor: BufferCursor,
    warnings: string[],
  ): CanInfoMask2Block {
    const mask = cursor.readUInt32BE();
    const block: CanInfoMask2Block = { mask, unsupportedBits: [] };

    for (let bit = 0; bit <= 31; bit++) {
      if (!(mask & (1 << bit))) {
        continue;
      }
      try {
        switch (bit) {
          case 0:
            block.adBlueLevelPercent = cursor.readUInt8() * 0.4;
            break;
          case 1:
            block.retarderUsagePercent = cursor.readUInt8();
            break;
          case 2:
            block.powerMode = cursor.readUInt8();
            break;
          case 3:
            block.axleWeight5Kg = cursor.readUInt16BE() * 0.5;
            break;
          case 4:
            block.axleWeight6Kg = cursor.readUInt16BE() * 0.5;
            break;
          case 5:
            block.axleWeight7Kg = cursor.readUInt16BE() * 0.5;
            break;
          case 6:
            block.analogInputMv = cursor.readUInt16BE();
            break;
          case 7:
            block.engineBrakingFactor = cursor.readUInt32BE();
            break;
          case 8:
            block.pedalBrakingFactor = cursor.readUInt32BE();
            break;
          case 9:
            block.totalAcceleratorKickdowns = cursor.readUIntBE(3);
            break;
          case 10:
            block.totalEffectiveEngineSpeedTimeSeconds = cursor.readUInt32BE();
            break;
          case 11:
            block.totalCruiseControlTimeSeconds = cursor.readUInt32BE();
            break;
          case 12:
            block.totalAcceleratorKickdownTimeSeconds = cursor.readUInt32BE();
            break;
          case 13:
            block.totalBrakeApplications = cursor.readUIntBE(3);
            break;
          case 14:
            block.oilTemperatureC = cursor.readInt16BE();
            break;
          case 15:
            block.trailerVin = cursor.readLengthPrefixedAscii();
            break;
          case 16:
          case 17:
            // Reserved, no payload bytes.
            break;
          case 18:
            block.registrationNumber = cursor.readLengthPrefixedAscii();
            break;
          case 19:
            block.rapidBrakings = cursor.readUIntBE(3);
            break;
          case 20:
            block.rapidAccelerations = cursor.readUIntBE(3);
            break;
          case 21:
            block.engineTorquePercent = cursor.readUInt8() - 125;
            break;
          case 22:
            block.serviceDistanceKm = cursor.readInt32BE();
            break;
          case 23:
            block.ambientTemperatureC = cursor.readInt16BE();
            break;
          case 24: {
            const dtcCount = cursor.readUInt8();
            const dtcCodes: DtcCode[] = [];
            for (let i = 0; i < dtcCount; i++) {
              dtcCodes.push(decodeDtcCode(cursor.readBytes(3)));
            }
            block.dtcCodes = dtcCodes;
            break;
          }
          case 25:
            block.gaseousFuelLevel = {
              liters: cursor.readUInt8(),
              percent: cursor.readUInt8() * 0.4,
            };
            break;
          case 26:
            block.fuelLevelCombustion = {
              liters: cursor.readUInt8(),
              percent: cursor.readUInt8() * 0.4,
            };
            break;
          case 27:
            block.totalFuelFromVehicleMl = cursor.readUInt32BE();
            break;
          case 28:
            block.totalGaseousFuelUsageKg = cursor.readUInt32BE() * 0.5;
            break;
          case 29: {
            const tyreCount = cursor.readUInt8();
            const tyres: TyreReading[] = [];
            for (let i = 0; i < tyreCount; i++) {
              const location = cursor.readUInt8();
              tyres.push({
                axlePosition: (location >> 4) & 0xf,
                wheelPosition: location & 0xf,
                pressureKpa: cursor.readUInt16BE(),
                temperatureC: cursor.readUIntBE(3) * 0.01,
                state: cursor.readUInt8(),
              });
            }
            block.tyres = tyres;
            break;
          }
          case 30:
            block.timeToServiceDays = cursor.readUInt16BE() - 1000;
            break;
          default:
            // Bit 31: reserved.
            block.unsupportedBits.push(bit);
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Stopped decoding CAN Info Mask 2 at bit ${bit}: ${message}.`,
        );
        break;
      }
    }

    if (block.unsupportedBits.length > 0) {
      warnings.push(
        `CAN Info Mask 2 bits not decoded: [${block.unsupportedBits.join(', ')}].`,
      );
    }

    return block;
  }

  // ---------------------------------------------------------------------
  // Electric Info Mask 1 / CAN Info Mask 3 (+RPT Data Mask bits 11 / 23)
  // ---------------------------------------------------------------------

  private parseElectricInfoMask1Block(
    cursor: BufferCursor,
    warnings: string[],
  ): ElectricInfoMask1Block {
    const mask = cursor.readUInt32BE();
    const block: ElectricInfoMask1Block = { mask, unsupportedBits: [] };

    for (let bit = 0; bit <= 31; bit++) {
      if (!(mask & (1 << bit))) {
        continue;
      }
      try {
        switch (bit) {
          case 0:
            block.batteryInstantaneousVoltage = cursor.readUInt16BE();
            break;
          case 1:
            block.batteryChargingCyclesCount = cursor.readUInt16BE();
            break;
          case 2:
            block.totalEnergyRecuperated = cursor.readUInt32BE();
            break;
          case 3:
            block.batteryLevelPercent = cursor.readUInt8() * 0.4;
            break;
          case 4:
            block.chargingState = cursor.readUInt16BE();
            break;
          case 5:
            block.batteryTemperatureC = cursor.readInt16BE();
            break;
          case 6:
            block.batteryChargingCurrent = cursor.readUInt16BE() * 0.1;
            break;
          case 7:
            block.batteryInstantaneousPower = cursor.readInt16BE();
            break;
          case 8:
            block.batteryStateOfHealthPercent = cursor.readUInt8() * 0.4;
            break;
          case 9:
            block.totalEnergyUsed = cursor.readUInt32BE();
            break;
          case 10:
            block.totalEnergyUsedWhenIdling = cursor.readUInt32BE();
            break;
          case 11:
            block.totalEnergyCharged = cursor.readUInt32BE();
            break;
          case 12:
            block.onlyBatteryChargeLevelPercent = cursor.readUInt8() * 0.4;
            break;
          default:
            block.unsupportedBits.push(bit);
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Stopped decoding Electric Info Mask 1 at bit ${bit}: ${message}.`,
        );
        break;
      }
    }

    if (block.unsupportedBits.length > 0) {
      warnings.push(
        `Electric Info Mask 1 bits not decoded: [${block.unsupportedBits.join(', ')}]; ` +
          'any further Data Mask bits in this frame may be misaligned.',
      );
    }

    return block;
  }

  private parseCanInfoMask3Block(
    cursor: BufferCursor,
    warnings: string[],
  ): CanInfoMask3Block {
    const mask = cursor.readUInt32BE();
    const block: CanInfoMask3Block = { mask, unsupportedBits: [] };

    for (let bit = 0; bit <= 31; bit++) {
      if (!(mask & (1 << bit))) {
        continue;
      }
      try {
        switch (bit) {
          case 0:
            block.totalRetarderUsageTimeSeconds = cursor.readUInt32BE();
            break;
          case 2:
            block.totalCo2EmissionKg = cursor.readUInt32BE();
            break;
          case 3:
            block.totalPtoUsageTimeSeconds = cursor.readUInt32BE();
            break;
          case 4:
            block.totalFuelUsedWithPtoEngagedMl = cursor.readUInt32BE();
            break;
          case 8:
            block.currentGearNumber = cursor.readUInt8();
            break;
          default:
            block.unsupportedBits.push(bit);
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Stopped decoding CAN Info Mask 3 at bit ${bit}: ${message}.`,
        );
        break;
      }
    }

    if (block.unsupportedBits.length > 0) {
      warnings.push(
        `CAN Info Mask 3 bits not decoded: [${block.unsupportedBits.join(', ')}]; ` +
          'any further Data Mask bits in this frame may be misaligned.',
      );
    }

    return block;
  }

  // ---------------------------------------------------------------------
  // CAN Advanced Information Mask 1 / Mobileye ADAS (+RPT Data Mask bit 24)
  // ---------------------------------------------------------------------

  private parseCanAdvancedInfoMask1Block(
    cursor: BufferCursor,
    warnings: string[],
  ): CanAdvancedInfoMask1Block {
    const mask = cursor.readUInt32BE();
    const block: CanAdvancedInfoMask1Block = { mask, pids: [] };

    for (let bit = 0; bit <= 31; bit++) {
      if (!(mask & (1 << bit))) {
        continue;
      }
      try {
        const length = cursor.readUInt8();
        const data = Buffer.from(cursor.readBytes(length));
        block.pids.push({ pid: bit + 1, data });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Stopped decoding CAN Advanced Info Mask 1 at AdvCAN PID ${bit + 1}: ${message}.`,
        );
        break;
      }
    }

    return block;
  }

  /**
   * Interprets AdvCAN PID 1-8 (see `mobileye-adas.types.ts`) off a decoded
   * CAN Advanced Information Mask 1 block. Returns undefined when PID 1
   * (Headway valid) isn't present, since that's the cheapest signal that
   * this device's AdvCAN feed isn't configured for Mobileye at all.
   */
  private deriveMobileyeAdasReading(
    block: CanAdvancedInfoMask1Block,
  ): MobileyeAdasReading | undefined {
    const byPid = new Map(block.pids.map((entry) => [entry.pid, entry.data]));
    const pid1 = byPid.get(1);
    if (!pid1 || pid1.length === 0) {
      return undefined;
    }
    const byteOf = (pid: number): number => byPid.get(pid)?.[0] ?? 0;

    return {
      headwayValid: byteOf(1) === 1,
      headwayMeasurementSeconds: byteOf(2) * 0.1,
      pedestrianForwardCollisionWarning: byteOf(3) === 1,
      pedestrianInDangerZone: byteOf(4) === 1,
      laneDepartureWarningOff: byteOf(5) === 1,
      forwardCollisionWarningOn: byteOf(6) === 1,
      leftLaneDepartureWarningOn: byteOf(7) === 1,
      rightLaneDepartureWarningOn: byteOf(8) === 1,
    };
  }
}
