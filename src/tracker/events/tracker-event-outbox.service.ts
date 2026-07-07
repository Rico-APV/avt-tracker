import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TrackerEvent } from '../entities/tracker-event.entity';

@Injectable()
export class TrackerEventOutboxService {
  constructor(
    @InjectRepository(TrackerEvent)
    private readonly eventRepository: Repository<TrackerEvent>,
  ) {}

  record(
    eventType: string,
    imei: string,
    data: Record<string, unknown>,
    occurredAt: Date,
  ): Promise<TrackerEvent> {
    const entity = this.eventRepository.create({
      eventType,
      imei,
      data,
      occurredAt,
      delivered: false,
    });
    return this.eventRepository.save(entity);
  }

  findUnread(limit: number): Promise<TrackerEvent[]> {
    return this.eventRepository.find({
      where: { delivered: false },
      order: { occurredAt: 'ASC' },
      take: limit,
    });
  }

  async markDelivered(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.eventRepository.update(
      { id: In(ids) },
      { delivered: true, deliveredAt: new Date() },
    );
  }
}
