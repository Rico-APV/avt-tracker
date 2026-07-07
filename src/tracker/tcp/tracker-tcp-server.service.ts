import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as net from 'net';
import { AppConfig } from '../../config/configuration';
import {
  TrackerDeviceConnectedEvent,
  TrackerDeviceDisconnectedEvent,
} from '../events/tracker-device-connection.event';
import { TrackerReportReceivedEvent } from '../events/tracker-report-received.event';
import { TRACKER_EVENTS } from '../events/tracker-events.constants';
import { TrackerParserService } from '../parser/tracker-parser.service';
import {
  ParsedTrackerFrame,
  TrackerFrameKind,
} from '../parser/tracker-parser.types';
import { TrackerPersistenceService } from '../persistence/tracker-persistence.service';
import { TrackerConnectionRegistryService } from './tracker-connection-registry.service';
import { TrackerFrameSplitter } from './tracker-frame-splitter';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Raw `net.createServer` TCP listener for AVT110 (and protocol-compatible
 * ATL/AVT/ABT) devices.
 *
 * This intentionally does NOT use `@nestjs/microservices`'s TCP transport:
 * that transport speaks Nest's own JSON-based wire protocol, which has
 * nothing to do with the '#'-terminated ASCII/hex frames these devices
 * send. Instead this is a plain Node `net.Server` wrapped as a regular
 * Nest provider (started in `onModuleInit`, stopped in `onModuleDestroy`)
 * so it participates in the app's lifecycle like anything else.
 */
@Injectable()
export class TrackerTcpServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackerTcpServer.name);
  private server?: net.Server;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly parser: TrackerParserService,
    private readonly persistence: TrackerPersistenceService,
    private readonly registry: TrackerConnectionRegistryService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    const tracker = this.configService.get('tracker', { infer: true });

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) =>
        this.handleConnection(socket),
      );

      const onListenError = (error: Error) => {
        this.logger.error(
          `Could not start tracker TCP listener on ${tracker.tcpHost}:${tracker.tcpPort}: ${error.message}`,
        );
        reject(error);
      };
      server.once('error', onListenError);

      server.listen(tracker.tcpPort, tracker.tcpHost, () => {
        server.removeListener('error', onListenError);
        // Once listening, socket-level errors must never crash the server.
        server.on('error', (error) => {
          this.logger.error(`Tracker TCP server error: ${errorMessage(error)}`);
        });
        this.logger.log(
          `AVT110 tracker TCP listener started on ${tracker.tcpHost}:${tracker.tcpPort} ` +
            `(configure the device with AT@SIS=at,0,1,<this-host>,${tracker.tcpPort},,,0,0001#)`,
        );
        resolve();
      });

      this.server = server;
    });
  }

  onModuleDestroy(): void {
    this.server?.close();
    this.logger.log('Tracker TCP listener stopped');
  }

  private handleConnection(socket: net.Socket): void {
    const tracker = this.configService.get('tracker', { infer: true });
    const remoteAddress = socket.remoteAddress;
    const remotePort = socket.remotePort;
    const peer = `${remoteAddress ?? 'unknown'}:${remotePort ?? '?'}`;
    const splitter = new TrackerFrameSplitter(tracker.maxBufferBytes);

    // Populated once we've decoded a frame from this socket and learned
    // which device it is; a socket always belongs to exactly one IMEI.
    let imei: string | undefined;

    this.logger.log(`New TCP connection from ${peer}`);

    if (tracker.socketTimeoutMs > 0) {
      socket.setTimeout(tracker.socketTimeoutMs);
    }

    const registerDevice = (resolvedImei: string): void => {
      if (imei === resolvedImei) {
        this.registry.touch(imei);
        return;
      }
      imei = resolvedImei;
      this.registry.register(imei, socket, remoteAddress, remotePort);
      void this.persistence
        .markDeviceConnected(imei)
        .catch((error) =>
          this.logger.error(
            `Failed to mark device ${imei} as connected: ${errorMessage(error)}`,
          ),
        );
      this.eventEmitter.emit(
        TRACKER_EVENTS.DEVICE_CONNECTED,
        new TrackerDeviceConnectedEvent(imei, remoteAddress, remotePort),
      );
      this.logger.log(`Identified connection ${peer} as IMEI ${imei}`);
    };

    socket.on('data', (chunk: Buffer) => {
      let frames: Buffer[];
      let overflowed: boolean;
      try {
        ({ frames, overflowed } = splitter.push(chunk));
      } catch (error) {
        this.logger.error(
          `Failed to buffer data from ${peer} (imei=${imei ?? 'unknown'}): ${errorMessage(error)}`,
        );
        return;
      }

      if (overflowed) {
        this.logger.warn(
          `Receive buffer for ${peer} (imei=${imei ?? 'unknown'}) exceeded ` +
            `${tracker.maxBufferBytes} bytes with no '#' terminator; dropping it.`,
        );
      }

      for (const frame of frames) {
        this.handleFrame(socket, frame, peer, registerDevice);
      }
    });

    socket.on('timeout', () => {
      this.logger.warn(
        `Socket timeout for ${peer} (imei=${imei ?? 'unknown'}); closing connection.`,
      );
      socket.end();
    });

    socket.on('error', (error) => {
      this.logger.warn(
        `Socket error for ${peer} (imei=${imei ?? 'unknown'}): ${error.message}`,
      );
    });

    socket.on('close', () => {
      this.logger.log(
        `Connection closed for ${peer} (imei=${imei ?? 'unknown'})`,
      );
      if (!imei) {
        return;
      }
      this.registry.unregister(imei);
      void this.persistence
        .markDeviceDisconnected(imei)
        .catch((error) =>
          this.logger.error(
            `Failed to mark device ${imei} as disconnected: ${errorMessage(error)}`,
          ),
        );
      this.eventEmitter.emit(
        TRACKER_EVENTS.DEVICE_DISCONNECTED,
        new TrackerDeviceDisconnectedEvent(imei, remoteAddress, remotePort),
      );
    });
  }

  /**
   * Parses one already-delimited frame and reacts to it. Never throws:
   * anything unexpected is logged and the connection stays open so the
   * device can keep sending subsequent frames.
   */
  private handleFrame(
    socket: net.Socket,
    frame: Buffer,
    peer: string,
    registerDevice: (imei: string) => void,
  ): void {
    let parsed: ParsedTrackerFrame;
    try {
      parsed = this.parser.parseFrame(frame);
    } catch (error) {
      this.logger.warn(
        `Discarding unparseable frame from ${peer} (${frame.length} bytes): ${errorMessage(error)}`,
      );
      return;
    }

    const { header } = parsed;
    registerDevice(header.imei);

    if (parsed.warnings.length > 0) {
      this.logger.warn(
        `IMEI ${header.imei}: ${header.kind} frame decoded with warnings: ${parsed.warnings.join(' | ')}`,
      );
    }

    switch (header.kind) {
      case TrackerFrameKind.RPT:
      case TrackerFrameKind.RPT_HISTORICAL:
        this.handleReportFrame(socket, parsed, header.imei, peer);
        break;
      case TrackerFrameKind.HBD:
        this.handleHeartbeatFrame(
          socket,
          header.serialNumberHex,
          header.imei,
          peer,
        );
        break;
      case TrackerFrameKind.UNKNOWN:
        this.logger.warn(
          `IMEI ${header.imei}: unrecognised frame head "${header.headToken}" from ${peer}; ignoring.`,
        );
        break;
      default:
        this.logger.debug(
          `IMEI ${header.imei}: received ${header.kind} frame from ${peer} (no action wired up for it yet).`,
        );
        break;
    }
  }

  private handleReportFrame(
    socket: net.Socket,
    parsed: ParsedTrackerFrame,
    imei: string,
    peer: string,
  ): void {
    void this.persistence
      .saveReport(parsed)
      .then((saved) => {
        if (saved) {
          this.eventEmitter.emit(
            TRACKER_EVENTS.REPORT_RECEIVED,
            new TrackerReportReceivedEvent(imei, parsed, saved),
          );
        }
      })
      .catch((error) =>
        this.logger.error(
          `Failed to persist ${parsed.header.kind} report from IMEI ${imei}: ${errorMessage(error)}`,
        ),
      )
      .finally(() => {
        // The device only expects +SACK when it has SACK Enable turned on
        // (configured out-of-band via AT@SIS), which this server doesn't
        // currently track per-device. Acknowledging unconditionally is
        // harmless: devices with SACK disabled simply ignore it, and
        // devices with it enabled get the acknowledgement they need to
        // stop retransmitting.
        this.writeFrame(
          socket,
          `+SACK:${parsed.header.serialNumberHex}#`,
          peer,
        );
      });
  }

  private handleHeartbeatFrame(
    socket: net.Socket,
    serialNumberHex: string,
    imei: string,
    peer: string,
  ): void {
    this.registry.touch(imei);
    this.writeFrame(socket, `+SHBD:${serialNumberHex}#`, peer);
  }

  private writeFrame(socket: net.Socket, text: string, peer: string): void {
    socket.write(Buffer.from(text, 'ascii'), (error) => {
      if (error) {
        this.logger.warn(
          `Failed to write "${text}" to ${peer}: ${error.message}`,
        );
      }
    });
  }
}
