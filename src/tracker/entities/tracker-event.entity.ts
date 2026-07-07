import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Durable record of every tracker domain event (device connected/
 * disconnected, report received), independent of the best-effort SNS
 * publish. This is what backs the `/tracker/events/unread` polling
 * endpoint: a consumer that can't (or doesn't want to) run an SQS listener
 * can instead pull from here and catch up on anything it missed, e.g.
 * after downtime.
 *
 * No FK to `tracker_device` on purpose - this is an independent delivery
 * log, not device state, so it shouldn't be affected by a device row being
 * deleted or not existing yet.
 */
@Entity('tracker_event')
export class TrackerEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  eventType: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  imei: string;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  /** Set once an external consumer has fetched this via the unread-events endpoint. */
  @Index()
  @Column({ type: 'boolean', default: false })
  delivered: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
