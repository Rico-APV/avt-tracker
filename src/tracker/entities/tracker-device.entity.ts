import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TrackerReport } from './tracker-report.entity';

/**
 * One row per physical device (keyed by IMEI). Holds a denormalized
 * "last known state" snapshot so the device list view doesn't need to
 * join/aggregate tracker_report on every request.
 */
@Entity('tracker_device')
export class TrackerDevice {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  imei: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  alias: string | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastReportAt: Date | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  lastFrameKind: string | null;

  @Column({ type: 'double precision', nullable: true })
  lastLatitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  lastLongitude: number | null;

  @Column({ type: 'int', nullable: true })
  lastAltitudeM: number | null;

  @Column({ type: 'int', nullable: true })
  lastSpeedKmh: number | null;

  @Column({ type: 'int', nullable: true })
  lastEventType: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastEventName: string | null;

  @Column({ type: 'int', nullable: true })
  lastBatteryLevelPercent: number | null;

  @Column({ type: 'int', nullable: true })
  lastBatteryVoltageMv: number | null;

  @Column({ type: 'int', nullable: true })
  lastNetworkType: number | null;

  @Column({ type: 'boolean', default: false })
  tcpConnected: boolean;

  @OneToMany(() => TrackerReport, (report) => report.device)
  reports: TrackerReport[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
