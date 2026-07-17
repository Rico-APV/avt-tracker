import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StarlinkReport } from './starlink-report.entity';

/**
 * One row per physical StarLink unit, keyed by the device id the unit
 * itself reports (6 hex chars or a 15-digit IMEI, per the "SLU" protocol -
 * see StarlinkParserService). Holds a denormalized "last known state"
 * snapshot, same approach as `TrackerDevice`.
 */
@Entity('starlink_device')
export class StarlinkDevice {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  deviceId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  alias: string | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastReportAt: Date | null;

  @Column({ type: 'int', nullable: true })
  lastEventId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastEventName: string | null;

  @Column({ type: 'double precision', nullable: true })
  lastLatitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  lastLongitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  lastSpeedKnots: number | null;

  @Column({ type: 'double precision', nullable: true })
  lastSpeedKmh: number | null;

  @Column({ type: 'boolean', nullable: true })
  lastIgnition: boolean | null;

  @Column({ type: 'double precision', nullable: true })
  lastBatteryVoltage: number | null;

  @Column({ type: 'double precision', nullable: true })
  lastMainPowerVoltage: number | null;

  @Column({ type: 'boolean', default: false })
  tcpConnected: boolean;

  @OneToMany(() => StarlinkReport, (report) => report.device)
  reports: StarlinkReport[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
