import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StarlinkDevice } from './starlink-device.entity';

/**
 * One row per "SLU" event-report message (message type 6) received from a
 * StarLink unit. `payload` keeps the fully parsed object and `rawLine`
 * keeps the original text line, so a message can be reprocessed later if
 * the parser gains support for more tags.
 */
@Entity('starlink_report')
export class StarlinkReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  deviceId: string;

  @ManyToOne(() => StarlinkDevice, (device) => device.reports, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'deviceId', referencedColumnName: 'deviceId' })
  device: StarlinkDevice;

  @Column({ type: 'int' })
  messageType: number;

  @Column({ type: 'int' })
  messageIndex: number;

  @Column({ type: 'int', nullable: true })
  eventId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  eventName: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  alarm: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deviceTime: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  fixTime: Date | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  altitudeM: number | null;

  @Column({ type: 'double precision', nullable: true })
  speedKnots: number | null;

  @Column({ type: 'double precision', nullable: true })
  speedKmh: number | null;

  @Column({ type: 'int', nullable: true })
  course: number | null;

  @Column({ type: 'bigint', nullable: true })
  odometerM: string | null;

  @Column({ type: 'int', nullable: true })
  lac: number | null;

  @Column({ type: 'int', nullable: true })
  cid: number | null;

  @Column({ type: 'double precision', nullable: true })
  mainPowerVoltage: number | null;

  @Column({ type: 'double precision', nullable: true })
  batteryVoltage: number | null;

  @Column({ type: 'boolean', nullable: true })
  ignition: boolean | null;

  @Column({ type: 'int', nullable: true })
  satellites: number | null;

  @Column({ type: 'double precision', nullable: true })
  pdop: number | null;

  @Column({ type: 'jsonb', nullable: true })
  digitalInputs: Record<string, number> | null;

  @Column({ type: 'jsonb', nullable: true })
  digitalOutputs: Record<string, number> | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  destination: string | null;

  @Column({ type: 'jsonb', nullable: true })
  unsupportedTags: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  parseWarnings: string[] | null;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'text' })
  rawLine: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  checksumHex: string | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;
}
