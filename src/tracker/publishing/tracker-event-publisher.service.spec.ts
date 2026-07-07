import { ConfigService } from '@nestjs/config';
import { TrackerEventPublisherService } from './tracker-event-publisher.service';
import { TRACKER_EVENTS } from '../events/tracker-events.constants';
import {
  TrackerDeviceConnectedEvent,
  TrackerDeviceDisconnectedEvent,
} from '../events/tracker-device-connection.event';
import { TrackerReportReceivedEvent } from '../events/tracker-report-received.event';
import { ParsedTrackerFrame } from '../parser/tracker-parser.types';
import { TrackerReport } from '../entities/tracker-report.entity';
import { TrackerEventOutboxService } from '../events/tracker-event-outbox.service';

interface PublishCommandLike {
  input: {
    Message: string;
    MessageAttributes: { eventType: { StringValue: string } };
  };
}

const sendMock = jest.fn<Promise<unknown>, [PublishCommandLike]>();

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: sendMock,
    destroy: jest.fn(),
  })),
  PublishCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

const TEST_IMEI = '356938035643809';

function buildConfigService(snsTopicArn: string | undefined): ConfigService {
  return {
    get: jest.fn().mockReturnValue({ awsRegion: 'us-east-2', snsTopicArn }),
  } as unknown as ConfigService;
}

function buildOutbox(): {
  service: TrackerEventOutboxService;
  record: jest.Mock;
} {
  const record = jest.fn().mockResolvedValue(undefined);
  return {
    service: { record } as unknown as TrackerEventOutboxService,
    record,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('TrackerEventPublisherService', () => {
  beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({});
  });

  it('does nothing when SNS_TOPIC_ARN is not configured', async () => {
    const outbox = buildOutbox();
    const service = new TrackerEventPublisherService(
      buildConfigService(undefined),
      outbox.service,
    );

    service.handleDeviceConnected(
      new TrackerDeviceConnectedEvent(TEST_IMEI, '1.2.3.4', 12345),
    );
    await flushMicrotasks();

    expect(sendMock).not.toHaveBeenCalled();
    expect(outbox.record).toHaveBeenCalledTimes(1);
  });

  it('publishes a report-received event with a versioned envelope', async () => {
    const outbox = buildOutbox();
    const service = new TrackerEventPublisherService(
      buildConfigService('arn:aws:sns:us-east-2:123456789012:tracker-events'),
      outbox.service,
    );

    const savedReport = {
      id: 'abc-123',
      imei: TEST_IMEI,
    } as unknown as TrackerReport;
    const event = new TrackerReportReceivedEvent(
      TEST_IMEI,
      {} as unknown as ParsedTrackerFrame,
      savedReport,
    );

    service.handleReportReceived(event);
    await flushMicrotasks();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [command] = sendMock.mock.calls[0];
    const envelope: unknown = JSON.parse(command.input.Message);
    expect(envelope).toMatchObject({
      eventType: TRACKER_EVENTS.REPORT_RECEIVED,
      version: 1,
      imei: TEST_IMEI,
      data: { report: savedReport },
    });
    expect(command.input.MessageAttributes.eventType.StringValue).toBe(
      TRACKER_EVENTS.REPORT_RECEIVED,
    );

    expect(outbox.record).toHaveBeenCalledTimes(1);
    expect(outbox.record).toHaveBeenCalledWith(
      TRACKER_EVENTS.REPORT_RECEIVED,
      TEST_IMEI,
      { report: savedReport },
      expect.any(Date),
    );
  });

  it('logs and swallows errors instead of throwing when publish fails', async () => {
    sendMock.mockRejectedValue(new Error('boom'));
    const service = new TrackerEventPublisherService(
      buildConfigService('arn:aws:sns:us-east-2:123456789012:tracker-events'),
      buildOutbox().service,
    );

    expect(() =>
      service.handleDeviceDisconnected(
        new TrackerDeviceDisconnectedEvent(TEST_IMEI, '1.2.3.4', 999),
      ),
    ).not.toThrow();
    await flushMicrotasks();

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('still publishes to SNS even if recording to the outbox fails', async () => {
    const outbox = buildOutbox();
    outbox.record.mockRejectedValue(new Error('db down'));
    const service = new TrackerEventPublisherService(
      buildConfigService('arn:aws:sns:us-east-2:123456789012:tracker-events'),
      outbox.service,
    );

    service.handleDeviceConnected(
      new TrackerDeviceConnectedEvent(TEST_IMEI, '1.2.3.4', 12345),
    );
    await flushMicrotasks();

    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
