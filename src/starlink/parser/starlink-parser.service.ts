import { Injectable, Logger } from '@nestjs/common';
import {
  parseStarlinkCoordinate,
  parseStarlinkDateTime,
} from './utils/starlink-codec.util';
import {
  getStarlinkAlarm,
  getStarlinkEventName,
} from './starlink-parser.constants';
import {
  DEFAULT_STARLINK_FORMAT_TAGS,
  ParsedStarlinkFrame,
  StarlinkFrameHeader,
  STARLINK_EVENT_REPORT_MESSAGE_TYPE,
  StarlinkReportPayload,
} from './starlink-parser.types';

/**
 * `.SLU<deviceId>,<type>,<index>,<data...>*<XX>` - one arbitrary head byte,
 * literal "SLU", device id (6 hex chars or a 15-digit IMEI), then
 * comma-separated type/index/data, a literal '*', and a 2-hex-digit
 * checksum. Framing (splitting the TCP stream into lines) is deliberately
 * NOT this class's job - see `StarlinkLineSplitter`; this only ever parses
 * one already-delimited line.
 */
const FRAME_PATTERN =
  /^.SLU([0-9A-Fa-f]{6}|\d{15}),(\d+),(\d+),(.+)\*([0-9A-Fa-f]{2})$/;

/**
 * Stateless decoder for the "SLU" text protocol used by ERM/StarLink
 * trackers. See `starlink-parser.types.ts` for where this format comes
 * from - it wasn't possible to get ERM's own protocol PDF (their protocol
 * pages require a login), so this is derived from Traccar's open-source,
 * production `StarLinkProtocolDecoder`.
 *
 * Design goal, matching `TrackerParserService`: never throw out of
 * `parseFrame`. Any field we don't understand, or a truncated/corrupt
 * line, degrades to a `warnings` entry instead of an exception.
 *
 * Known gaps (left as TODOs rather than guessed at):
 * - The checksum is matched but not verified - no public source describes
 *   the algorithm, and Traccar's own decoder doesn't validate it either.
 * - Only message type 6 (event report) is decoded; other types (protocol
 *   version, programming ack, etc.) are recognised but not parsed.
 * - Per-device custom format strings aren't supported - only the default
 *   23-tag format is decoded; anything else shows up as `unsupportedTags`.
 * - A handful of tags Traccar supports (base64-encoded 1-wire sensor
 *   protobuf blobs, RFID reads, fuel sensors, ...) aren't implemented.
 */
@Injectable()
export class StarlinkParserService {
  private readonly logger = new Logger(StarlinkParserService.name);

  parseFrame(line: string): ParsedStarlinkFrame {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      throw new Error('Cannot parse an empty line');
    }

    const match = FRAME_PATTERN.exec(trimmed);
    if (!match) {
      throw new Error(
        `Line does not match the "SLU" frame format (expected ` +
          `".SLU<id>,<type>,<index>,<data>*<XX>"): ${trimmed.slice(0, 80)}`,
      );
    }

    const [, deviceId, messageTypeRaw, messageIndexRaw, data, checksumHex] =
      match;
    const header: StarlinkFrameHeader = {
      head: trimmed.charAt(0),
      deviceId,
      messageType: parseInt(messageTypeRaw, 10),
      messageIndex: parseInt(messageIndexRaw, 10),
      checksumHex,
    };

    const warnings: string[] = [];
    const parsed: ParsedStarlinkFrame = {
      header,
      warnings,
      rawLine: trimmed,
      rawData: data,
    };

    if (header.messageType === STARLINK_EVENT_REPORT_MESSAGE_TYPE) {
      try {
        parsed.report = this.parseEventReport(data, warnings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to decode event report data: ${message}`);
        this.logger.warn(
          `Frame from device ${deviceId} partially decoded: ${message}`,
        );
      }
    } else {
      warnings.push(
        `Message type ${header.messageType} is not decoded yet (only type ` +
          `${STARLINK_EVENT_REPORT_MESSAGE_TYPE}/event-report is implemented); ` +
          'rawData is still available for reprocessing.',
      );
    }

    return parsed;
  }

  private parseEventReport(
    data: string,
    warnings: string[],
  ): StarlinkReportPayload {
    const fields = data.split(',');
    const payload: StarlinkReportPayload = {
      digitalInputs: {},
      digitalOutputs: {},
      unsupportedTags: [],
    };

    const fieldCount = Math.min(
      fields.length,
      DEFAULT_STARLINK_FORMAT_TAGS.length,
    );
    for (let i = 0; i < fieldCount; i++) {
      const value = fields[i];
      if (value === '') {
        continue;
      }
      const tag = DEFAULT_STARLINK_FORMAT_TAGS[i];
      try {
        this.applyTag(tag, value, payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Failed to decode tag ${tag} (value "${value}"): ${message}`,
        );
      }
    }

    if (fields.length > DEFAULT_STARLINK_FORMAT_TAGS.length) {
      warnings.push(
        `Data has ${fields.length} fields but only the first ` +
          `${DEFAULT_STARLINK_FORMAT_TAGS.length} (default format) are decoded; ` +
          'extra fields ignored.',
      );
    }

    if (payload.unsupportedTags.length > 0) {
      warnings.push(
        `Unsupported tags left undecoded: [${payload.unsupportedTags.join(', ')}]. TODO.`,
      );
    }

    return payload;
  }

  private applyTag(
    tag: string,
    value: string,
    payload: StarlinkReportPayload,
  ): void {
    switch (tag) {
      case '#EDT#':
        payload.deviceTime = parseStarlinkDateTime(value);
        break;
      case '#EID#': {
        const eventId = parseInt(value, 10);
        payload.eventId = eventId;
        payload.eventName = getStarlinkEventName(eventId);
        payload.alarm = getStarlinkAlarm(eventId);
        if (eventId === 24) {
          payload.ignition = true;
        } else if (eventId === 25) {
          payload.ignition = false;
        }
        break;
      }
      case '#PDT#':
        payload.fixTime = parseStarlinkDateTime(value);
        break;
      case '#LAT#':
        payload.latitude = parseStarlinkCoordinate(value);
        break;
      case '#LONG#':
        payload.longitude = parseStarlinkCoordinate(value);
        break;
      case '#SPD#':
        payload.speedKnots = parseFloat(value);
        break;
      case '#HEAD#':
        payload.course = parseInt(value, 10);
        break;
      case '#ODO#':
        payload.odometerM = Math.round(parseFloat(value) * 1000);
        break;
      case '#IN1#':
      case '#IN2#':
      case '#IN3#':
      case '#IN4#':
        payload.digitalInputs[tag.slice(1, -1)] = parseInt(value, 10);
        break;
      case '#OUT1#':
      case '#OUT2#':
      case '#OUT3#':
      case '#OUT4#':
        payload.digitalOutputs[tag.slice(1, -1)] = parseInt(value, 10);
        break;
      case '#LAC#':
        payload.lac = parseInt(value, 10);
        break;
      case '#CID#':
        payload.cid = parseInt(value, 10);
        break;
      case '#VIN#':
        payload.mainPowerVoltage = parseFloat(value);
        break;
      case '#VBAT#':
        payload.batteryVoltage = parseFloat(value);
        break;
      case '#DEST#':
        payload.destination = value;
        break;
      case '#IGN#':
      case '#ENG#':
        payload.ignition = parseInt(value, 10) > 0;
        break;
      default:
        payload.unsupportedTags.push(tag);
        break;
    }
  }
}
