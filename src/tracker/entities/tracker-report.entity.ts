import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrackerDevice } from './tracker-device.entity';

export type TrackerFrameKindValue = '+RPT' | '-RPT';

/**
 * One row per +RPT/-RPT frame received from a device. `payload` keeps the
 * fully parsed object (including anything the flattened columns below don't
 * expose) and `rawHex` keeps the original bytes so the message can be
 * reprocessed later if the parser gains support for more fields.
 */
@Entity('tracker_report')
export class TrackerReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  imei: string;

  @ManyToOne(() => TrackerDevice, (device) => device.reports, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'imei', referencedColumnName: 'imei' })
  device: TrackerDevice;

  @Column({ type: 'varchar', length: 8 })
  frameKind: TrackerFrameKindValue;

  @Column({ type: 'varchar', length: 16, nullable: true })
  protocolVersion: string | null;

  @Column({ type: 'int', nullable: true })
  eventType: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  eventName: string | null;

  @Column({ type: 'int', nullable: true })
  eventState: number | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ type: 'int', nullable: true })
  altitudeM: number | null;

  @Column({ type: 'int', nullable: true })
  speedKmh: number | null;

  @Column({ type: 'int', nullable: true })
  azimuth: number | null;

  @Column({ type: 'int', nullable: true })
  satelliteCount: number | null;

  @Column({ type: 'int', nullable: true })
  batteryVoltageMv: number | null;

  @Column({ type: 'int', nullable: true })
  batteryLevelPercent: number | null;

  @Column({ type: 'int', nullable: true })
  mainPowerVoltageMv: number | null;

  @Column({ type: 'int', nullable: true })
  networkType: number | null;

  @Column({ type: 'int', nullable: true })
  mcc: number | null;

  @Column({ type: 'int', nullable: true })
  mnc: number | null;

  @Column({ type: 'int', nullable: true })
  lac: number | null;

  @Column({ type: 'bigint', nullable: true })
  cellId: string | null;

  @Column({ type: 'int', nullable: true })
  csq: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  dataMaskHex: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  eventDataMaskHex: string | null;

  @Column({ type: 'jsonb', nullable: true })
  unsupportedDataMaskBits: number[] | null;

  @Column({ type: 'jsonb', nullable: true })
  parseWarnings: string[] | null;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'text' })
  rawHex: string;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;
}
