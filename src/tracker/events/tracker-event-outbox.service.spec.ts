import { Repository } from 'typeorm';
import { TrackerEventOutboxService } from './tracker-event-outbox.service';
import { TrackerEvent } from '../entities/tracker-event.entity';

function buildRepository(): jest.Mocked<
  Pick<Repository<TrackerEvent>, 'create' | 'save' | 'find' | 'update'>
> {
  return {
    create: jest.fn((entity) => entity as TrackerEvent),
    save: jest.fn((entity) => Promise.resolve(entity as TrackerEvent)),
    find: jest.fn(),
    update: jest.fn(),
  };
}

describe('TrackerEventOutboxService', () => {
  it('records a new event as not yet delivered', async () => {
    const repository = buildRepository();
    const service = new TrackerEventOutboxService(
      repository as unknown as Repository<TrackerEvent>,
    );
    const occurredAt = new Date('2026-07-07T20:00:00Z');

    const saved = await service.record(
      'tracker.report.received',
      '356938035643809',
      { foo: 'bar' },
      occurredAt,
    );

    expect(repository.create).toHaveBeenCalledWith({
      eventType: 'tracker.report.received',
      imei: '356938035643809',
      data: { foo: 'bar' },
      occurredAt,
      delivered: false,
    });
    expect(saved.delivered).toBe(false);
  });

  it('finds unread events ordered oldest-first, capped at the given limit', async () => {
    const repository = buildRepository();
    const service = new TrackerEventOutboxService(
      repository as unknown as Repository<TrackerEvent>,
    );

    await service.findUnread(25);

    expect(repository.find).toHaveBeenCalledWith({
      where: { delivered: false },
      order: { occurredAt: 'ASC' },
      take: 25,
    });
  });

  it('marks the given ids as delivered', async () => {
    const repository = buildRepository();
    const service = new TrackerEventOutboxService(
      repository as unknown as Repository<TrackerEvent>,
    );

    await service.markDelivered(['id-1', 'id-2']);

    expect(repository.update).toHaveBeenCalledTimes(1);
    const [where, patch] = repository.update.mock.calls[0] as [
      unknown,
      unknown,
    ];
    expect(JSON.stringify(where)).toContain('id-1');
    expect(JSON.stringify(where)).toContain('id-2');
    expect(patch).toMatchObject({ delivered: true });
  });

  it('does not touch the repository when there is nothing to mark delivered', async () => {
    const repository = buildRepository();
    const service = new TrackerEventOutboxService(
      repository as unknown as Repository<TrackerEvent>,
    );

    await service.markDelivered([]);

    expect(repository.update).not.toHaveBeenCalled();
  });
});
