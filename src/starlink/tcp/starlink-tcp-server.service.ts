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
  StarlinkDeviceConnectedEvent,
  StarlinkDeviceDisconnectedEvent,
} from '../events/starlink-device-connection.event';
import { StarlinkReportReceivedEvent } from '../events/starlink-report-received.event';
import { STARLINK_EVENTS } from '../events/starlink-events.constants';
import { StarlinkParserService } from '../parser/starlink-parser.service';
import { ParsedStarlinkFrame } from '../parser/starlink-parser.types';
import { StarlinkPersistenceService } from '../persistence/starlink-persistence.service';
import { StarlinkConnectionRegistryService } from './starlink-connection-registry.service';
import { StarlinkLineSplitter } from './starlink-line-splitter';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Raw `net.createServer` TCP listener for ERM/StarLink trackers (Tracker,
 * TrackerSF, ...), on its own port, independent of the AVT110 listener
 * (`TrackerTcpServer`). Same rationale as that class for not using
 * `@nestjs/microservices`'s TCP transport: this needs to speak the
 * device's actual line-based text wire format, not Nest's own protocol.
 *
 * Unlike the AVT110 protocol, "SLU" messages get no acknowledgement reply
 * in Traccar's reference implementation, so none is sent here either -
 * flagged in `StarlinkParserService`'s docs as worth verifying against a
 * real unit if messages ever appear to be retransmitted.
 */
@Injectable()
export class StarlinkTcpServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StarlinkTcpServer.name);
  private server?: net.Server;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly parser: StarlinkParserService,
    private readonly persistence: StarlinkPersistenceService,
    private readonly registry: StarlinkConnectionRegistryService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    const starlink = this.configService.get('starlink', { infer: true });

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) =>
        this.handleConnection(socket),
      );

      const onListenError = (error: Error) => {
        this.logger.error(
          `Could not start StarLink TCP listener on ${starlink.tcpHost}:${starlink.tcpPort}: ${error.message}`,
        );
        reject(error);
      };
      server.once('error', onListenError);

      server.listen(starlink.tcpPort, starlink.tcpHost, () => {
        server.removeListener('error', onListenError);
        server.on('error', (error) => {
          this.logger.error(
            `StarLink TCP server error: ${errorMessage(error)}`,
          );
        });
        this.logger.log(
          `StarLink tracker TCP listener started on ${starlink.tcpHost}:${starlink.tcpPort}`,
        );
        resolve();
      });

      this.server = server;
    });
  }

  onModuleDestroy(): void {
    this.server?.close();
    this.logger.log('StarLink TCP listener stopped');
  }

  private handleConnection(socket: net.Socket): void {
    const starlink = this.configService.get('starlink', { infer: true });
    const remoteAddress = socket.remoteAddress;
    const remotePort = socket.remotePort;
    const peer = `${remoteAddress ?? 'unknown'}:${remotePort ?? '?'}`;
    const splitter = new StarlinkLineSplitter(starlink.maxBufferBytes);

    // Populated once we've decoded a line from this socket and learned
    // which device it is; a socket always belongs to exactly one device.
    let deviceId: string | undefined;

    this.logger.log(`New StarLink TCP connection from ${peer}`);

    if (starlink.socketTimeoutMs > 0) {
      socket.setTimeout(starlink.socketTimeoutMs);
    }

    const registerDevice = (resolvedDeviceId: string): void => {
      if (deviceId === resolvedDeviceId) {
        this.registry.touch(deviceId);
        return;
      }
      deviceId = resolvedDeviceId;
      this.registry.register(deviceId, socket, remoteAddress, remotePort);
      void this.persistence
        .markDeviceConnected(deviceId)
        .catch((error) =>
          this.logger.error(
            `Failed to mark device ${deviceId} as connected: ${errorMessage(error)}`,
          ),
        );
      this.eventEmitter.emit(
        STARLINK_EVENTS.DEVICE_CONNECTED,
        new StarlinkDeviceConnectedEvent(deviceId, remoteAddress, remotePort),
      );
      this.logger.log(`Identified connection ${peer} as device ${deviceId}`);
    };

    socket.on('data', (chunk: Buffer) => {
      let lines: string[];
      let overflowed: boolean;
      try {
        ({ lines, overflowed } = splitter.push(chunk));
      } catch (error) {
        this.logger.error(
          `Failed to buffer data from ${peer} (device=${deviceId ?? 'unknown'}): ${errorMessage(error)}`,
        );
        return;
      }

      if (overflowed) {
        this.logger.warn(
          `Receive buffer for ${peer} (device=${deviceId ?? 'unknown'}) exceeded ` +
            `${starlink.maxBufferBytes} bytes with no newline; dropping it.`,
        );
      }

      for (const line of lines) {
        this.handleLine(line, peer, registerDevice);
      }
    });

    socket.on('timeout', () => {
      this.logger.warn(
        `Socket timeout for ${peer} (device=${deviceId ?? 'unknown'}); closing connection.`,
      );
      socket.end();
    });

    socket.on('error', (error) => {
      this.logger.warn(
        `Socket error for ${peer} (device=${deviceId ?? 'unknown'}): ${error.message}`,
      );
    });

    socket.on('close', () => {
      this.logger.log(
        `Connection closed for ${peer} (device=${deviceId ?? 'unknown'})`,
      );
      if (!deviceId) {
        return;
      }
      this.registry.unregister(deviceId);
      void this.persistence
        .markDeviceDisconnected(deviceId)
        .catch((error) =>
          this.logger.error(
            `Failed to mark device ${deviceId} as disconnected: ${errorMessage(error)}`,
          ),
        );
      this.eventEmitter.emit(
        STARLINK_EVENTS.DEVICE_DISCONNECTED,
        new StarlinkDeviceDisconnectedEvent(
          deviceId,
          remoteAddress,
          remotePort,
        ),
      );
    });
  }

  /**
   * Parses one already-delimited line and reacts to it. Never throws:
   * anything unexpected is logged and the connection stays open so the
   * device can keep sending subsequent lines.
   */
  private handleLine(
    line: string,
    peer: string,
    registerDevice: (deviceId: string) => void,
  ): void {
    let parsed: ParsedStarlinkFrame;
    try {
      parsed = this.parser.parseFrame(line);
    } catch (error) {
      this.logger.warn(
        `Discarding unparseable line from ${peer}: ${errorMessage(error)}`,
      );
      return;
    }

    const { header } = parsed;
    registerDevice(header.deviceId);

    if (parsed.warnings.length > 0) {
      this.logger.warn(
        `Device ${header.deviceId}: message type ${header.messageType} decoded with warnings: ${parsed.warnings.join(' | ')}`,
      );
    }

    if (parsed.report) {
      this.handleReport(parsed, header.deviceId);
    }
  }

  private handleReport(parsed: ParsedStarlinkFrame, deviceId: string): void {
    void this.persistence
      .saveReport(parsed)
      .then((saved) => {
        if (saved) {
          this.eventEmitter.emit(
            STARLINK_EVENTS.REPORT_RECEIVED,
            new StarlinkReportReceivedEvent(deviceId, parsed, saved),
          );
        }
      })
      .catch((error) =>
        this.logger.error(
          `Failed to persist StarLink report from device ${deviceId}: ${errorMessage(error)}`,
        ),
      );
  }
}
