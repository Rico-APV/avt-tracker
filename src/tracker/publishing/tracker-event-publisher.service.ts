import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { AppConfig } from '../../config/configuration';
import { TRACKER_EVENTS } from '../events/tracker-events.constants';
import {
  TrackerDeviceConnectedEvent,
  TrackerDeviceDisconnectedEvent,
} from '../events/tracker-device-connection.event';
import { TrackerReportReceivedEvent } from '../events/tracker-report-received.event';
import { TrackerEventOutboxService } from '../events/tracker-event-outbox.service';
import { STARLINK_EVENTS } from '../../starlink/events/starlink-events.constants';
import {
  StarlinkDeviceConnectedEvent,
  StarlinkDeviceDisconnectedEvent,
} from '../../starlink/events/starlink-device-connection.event';
import { StarlinkReportReceivedEvent } from '../../starlink/events/starlink-report-received.event';

/**
 * Stable, versioned envelope published to SNS for every tracker domain
 * event. `version` lets consumers detect a breaking payload change without
 * having to guess from field presence.
 */
interface TrackerEventEnvelope {
  eventType: string;
  version: 1;
  occurredAt: string;
  imei: string;
  data: Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fans the in-process tracker domain events (`@nestjs/event-emitter`) out
 * to two independent destinations, so other services (in other VPCs/
 * accounts) can react to device activity without coupling to this
 * service's TCP/DB internals:
 *
 * - SNS, for low-latency push (near real time, best-effort).
 * - `TrackerEventOutboxService` (Postgres), a durable log a consumer can
 *   poll via `GET /tracker/events/unread` to catch up on anything it
 *   missed - e.g. it was down when the SNS message went out.
 *
 * Both are fire-and-forget from the event emitter's point of view: a
 * failure in either is logged but never thrown, so neither can affect TCP
 * ack latency or crash the connection that triggered the event.
 */
@Injectable()
export class TrackerEventPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(TrackerEventPublisherService.name);
  private readonly client?: SNSClient;
  private readonly topicArn?: string;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly outbox: TrackerEventOutboxService,
  ) {
    const notifications = this.configService.get('notifications', {
      infer: true,
    });
    this.topicArn = notifications.snsTopicArn;
    if (this.topicArn) {
      this.client = new SNSClient({ region: notifications.awsRegion });
    } else {
      this.logger.warn(
        'SNS_TOPIC_ARN is not set; tracker events will not be published externally.',
      );
    }
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  @OnEvent(TRACKER_EVENTS.REPORT_RECEIVED)
  handleReportReceived(event: TrackerReportReceivedEvent): void {
    this.dispatch(TRACKER_EVENTS.REPORT_RECEIVED, event.imei, {
      report: event.saved,
    });
  }

  @OnEvent(TRACKER_EVENTS.DEVICE_CONNECTED)
  handleDeviceConnected(event: TrackerDeviceConnectedEvent): void {
    this.dispatch(TRACKER_EVENTS.DEVICE_CONNECTED, event.imei, {
      remoteAddress: event.remoteAddress,
      remotePort: event.remotePort,
      connectedAt: event.connectedAt.toISOString(),
    });
  }

  @OnEvent(TRACKER_EVENTS.DEVICE_DISCONNECTED)
  handleDeviceDisconnected(event: TrackerDeviceDisconnectedEvent): void {
    this.dispatch(TRACKER_EVENTS.DEVICE_DISCONNECTED, event.imei, {
      remoteAddress: event.remoteAddress,
      remotePort: event.remotePort,
      disconnectedAt: event.disconnectedAt.toISOString(),
    });
  }

  // StarLink events reuse the same outbox table + SNS topic as the AVT110
  // tracker events above - one cross-service event stream regardless of
  // which vendor's device produced it. `imei` in the shared envelope/table
  // holds the StarLink deviceId here (just a device identifier column,
  // named for its AVT110 origin).
  @OnEvent(STARLINK_EVENTS.REPORT_RECEIVED)
  handleStarlinkReportReceived(event: StarlinkReportReceivedEvent): void {
    this.dispatch(STARLINK_EVENTS.REPORT_RECEIVED, event.deviceId, {
      report: event.saved,
    });
  }

  @OnEvent(STARLINK_EVENTS.DEVICE_CONNECTED)
  handleStarlinkDeviceConnected(event: StarlinkDeviceConnectedEvent): void {
    this.dispatch(STARLINK_EVENTS.DEVICE_CONNECTED, event.deviceId, {
      remoteAddress: event.remoteAddress,
      remotePort: event.remotePort,
      connectedAt: event.connectedAt.toISOString(),
    });
  }

  @OnEvent(STARLINK_EVENTS.DEVICE_DISCONNECTED)
  handleStarlinkDeviceDisconnected(
    event: StarlinkDeviceDisconnectedEvent,
  ): void {
    this.dispatch(STARLINK_EVENTS.DEVICE_DISCONNECTED, event.deviceId, {
      remoteAddress: event.remoteAddress,
      remotePort: event.remotePort,
      disconnectedAt: event.disconnectedAt.toISOString(),
    });
  }

  private dispatch(
    eventType: string,
    imei: string,
    data: Record<string, unknown>,
  ): void {
    const occurredAt = new Date();

    void this.outbox
      .record(eventType, imei, data, occurredAt)
      .then((saved) =>
        this.logger.log(
          `Recorded ${eventType} in outbox for IMEI ${imei} (outbox id=${saved.id})`,
        ),
      )
      .catch((error: unknown) =>
        this.logger.error(
          `Failed to record ${eventType} in outbox for IMEI ${imei}: ${errorMessage(error)}`,
        ),
      );

    void this.publish(eventType, imei, data, occurredAt);
  }

  private async publish(
    eventType: string,
    imei: string,
    data: Record<string, unknown>,
    occurredAt: Date,
  ): Promise<void> {
    if (!this.client || !this.topicArn) {
      this.logger.debug(
        `Skipped SNS publish of ${eventType} for IMEI ${imei}: SNS_TOPIC_ARN not configured.`,
      );
      return;
    }

    const envelope: TrackerEventEnvelope = {
      eventType,
      version: 1,
      occurredAt: occurredAt.toISOString(),
      imei,
      data,
    };

    try {
      const result = await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(envelope),
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: eventType },
            imei: { DataType: 'String', StringValue: imei },
          },
        }),
      );
      this.logger.log(
        `Published ${eventType} for IMEI ${imei} to SNS ${this.topicArn} (MessageId=${result.MessageId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish ${eventType} for IMEI ${imei} to SNS ${this.topicArn}: ${errorMessage(error)}`,
      );
    }
  }
}
