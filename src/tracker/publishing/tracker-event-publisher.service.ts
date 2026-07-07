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

/**
 * Mirrors the in-process tracker domain events (`@nestjs/event-emitter`)
 * out to an SNS topic, so other services (in other VPCs/accounts) can react
 * to device activity without coupling to this service's TCP/DB internals.
 *
 * Fire-and-forget by design: a publish failure is logged but never
 * propagated, so a flaky SNS call can't affect TCP ack latency or crash the
 * connection - this listener runs fully decoupled from the event emitter
 * that triggered it.
 */
@Injectable()
export class TrackerEventPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(TrackerEventPublisherService.name);
  private readonly client?: SNSClient;
  private readonly topicArn?: string;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
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
    void this.publish(TRACKER_EVENTS.REPORT_RECEIVED, event.imei, {
      report: event.saved,
    });
  }

  @OnEvent(TRACKER_EVENTS.DEVICE_CONNECTED)
  handleDeviceConnected(event: TrackerDeviceConnectedEvent): void {
    void this.publish(TRACKER_EVENTS.DEVICE_CONNECTED, event.imei, {
      remoteAddress: event.remoteAddress,
      remotePort: event.remotePort,
      connectedAt: event.connectedAt.toISOString(),
    });
  }

  @OnEvent(TRACKER_EVENTS.DEVICE_DISCONNECTED)
  handleDeviceDisconnected(event: TrackerDeviceDisconnectedEvent): void {
    void this.publish(TRACKER_EVENTS.DEVICE_DISCONNECTED, event.imei, {
      remoteAddress: event.remoteAddress,
      remotePort: event.remotePort,
      disconnectedAt: event.disconnectedAt.toISOString(),
    });
  }

  private async publish(
    eventType: string,
    imei: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.client || !this.topicArn) {
      return;
    }

    const envelope: TrackerEventEnvelope = {
      eventType,
      version: 1,
      occurredAt: new Date().toISOString(),
      imei,
      data,
    };

    try {
      await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(envelope),
          MessageAttributes: {
            eventType: { DataType: 'String', StringValue: eventType },
            imei: { DataType: 'String', StringValue: imei },
          },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to publish ${eventType} for IMEI ${imei}: ${message}`,
      );
    }
  }
}
