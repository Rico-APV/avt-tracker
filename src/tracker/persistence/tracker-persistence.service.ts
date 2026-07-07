import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryDeepPartialEntity, Repository } from 'typeorm';
import { TrackerDevice } from '../entities/tracker-device.entity';
import {
  TrackerFrameKindValue,
  TrackerReport,
} from '../entities/tracker-report.entity';
import { ParsedTrackerFrame } from '../parser/tracker-parser.types';

export interface FindReportsOptions {
  limit?: number;
  from?: Date;
  to?: Date;
}

function formatHexMask(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
}

@Injectable()
export class TrackerPersistenceService {
  private readonly logger = new Logger(TrackerPersistenceService.name);

  constructor(
    @InjectRepository(TrackerDevice)
    private readonly deviceRepository: Repository<TrackerDevice>,
    @InjectRepository(TrackerReport)
    private readonly reportRepository: Repository<TrackerReport>,
  ) {}

  /**
   * Creates-or-patches the device row in a single atomic statement
   * (`INSERT ... ON CONFLICT (imei) DO UPDATE`).
   *
   * This matters: a brand-new device's first frame triggers both
   * `markDeviceConnected` (from the TCP layer, fire-and-forget) and
   * `saveReport` (once the frame is decoded) for the *same* IMEI within
   * the same tick. A naive "find, then create-or-update, then save"
   * sequence lets both calls race past the `findOneBy` before either has
   * inserted anything, so both then try to INSERT the same primary key
   * and one fails with a unique-violation. `upsert()` pushes the
   * find-or-create down into a single Postgres statement, so concurrent
   * calls for the same IMEI just serialize at the row-lock level instead
   * of racing.
   */
  private async upsertDevice(
    patch: QueryDeepPartialEntity<TrackerDevice> & { imei: string },
  ): Promise<void> {
    await this.deviceRepository.upsert(patch, ['imei']);
  }

  async markDeviceConnected(imei: string): Promise<void> {
    await this.upsertDevice({
      imei,
      tcpConnected: true,
      lastSeenAt: new Date(),
    });
  }

  async markDeviceDisconnected(imei: string): Promise<void> {
    await this.upsertDevice({ imei, tcpConnected: false });
  }

  /**
   * Persists a decoded +RPT/-RPT frame and refreshes the owning device's
   * "last known state" snapshot. Returns `null` if the frame wasn't a
   * report (defensive - callers should already only invoke this for
   * report frames).
   */
  async saveReport(parsed: ParsedTrackerFrame): Promise<TrackerReport | null> {
    const { header, report } = parsed;
    if (!report) {
      return null;
    }

    const primaryFix = report.gnss?.primary;
    const satellites = primaryFix?.satellites;
    const satelliteCount = satellites
      ? (satellites.gps ?? 0) +
        (satellites.beidou ?? 0) +
        (satellites.galileo ?? 0) +
        (satellites.glonass ?? 0)
      : null;

    const now = new Date();
    const devicePatch: QueryDeepPartialEntity<TrackerDevice> & {
      imei: string;
    } = {
      imei: header.imei,
      tcpConnected: true,
      lastSeenAt: now,
      lastReportAt: header.generatedAt ?? now,
      lastFrameKind: header.kind,
      lastEventType: report.eventType,
      lastEventName: report.eventName,
    };
    // Only include fields the report actually carried, so an upsert for a
    // message without (say) a GNSS fix doesn't null out the last known
    // position - see `upsertDevice` for why this has to be a single
    // upsert rather than read-modify-write.
    if (primaryFix?.latitude !== undefined) {
      devicePatch.lastLatitude = primaryFix.latitude;
    }
    if (primaryFix?.longitude !== undefined) {
      devicePatch.lastLongitude = primaryFix.longitude;
    }
    if (primaryFix?.altitudeM !== undefined) {
      devicePatch.lastAltitudeM = primaryFix.altitudeM;
    }
    if (primaryFix?.speedKmh !== undefined) {
      devicePatch.lastSpeedKmh = primaryFix.speedKmh;
    }
    if (report.battery) {
      devicePatch.lastBatteryLevelPercent = report.battery.levelPercent;
      devicePatch.lastBatteryVoltageMv = report.battery.voltageMv;
    }
    if (report.networkType !== undefined) {
      devicePatch.lastNetworkType = report.networkType;
    }
    await this.upsertDevice(devicePatch);

    const entity = this.reportRepository.create({
      imei: header.imei,
      frameKind: header.kind as TrackerFrameKindValue,
      protocolVersion: report.protocolVersion,
      eventType: report.eventType,
      eventName: report.eventName,
      eventState: report.eventState,
      latitude: primaryFix?.latitude ?? null,
      longitude: primaryFix?.longitude ?? null,
      altitudeM: primaryFix?.altitudeM ?? null,
      speedKmh: primaryFix?.speedKmh ?? null,
      azimuth: primaryFix?.azimuth ?? null,
      satelliteCount,
      batteryVoltageMv: report.battery?.voltageMv ?? null,
      batteryLevelPercent: report.battery?.levelPercent ?? null,
      mainPowerVoltageMv: report.eventData?.mainPowerVoltageMv ?? null,
      networkType: report.networkType ?? null,
      mcc: report.cell?.mcc ?? null,
      mnc: report.cell?.mnc ?? null,
      lac: report.cell?.lac ?? null,
      cellId:
        report.cell?.cellId !== undefined ? String(report.cell.cellId) : null,
      csq: report.cell?.csq ?? null,
      dataMaskHex: formatHexMask(report.dataMask),
      eventDataMaskHex: report.eventData
        ? formatHexMask(report.eventData.mask)
        : null,
      unsupportedDataMaskBits: report.unsupportedDataMaskBits.length
        ? report.unsupportedDataMaskBits
        : null,
      parseWarnings: parsed.warnings.length ? parsed.warnings : null,
      payload: report as unknown as Record<string, unknown>,
      rawHex: parsed.rawHex,
      generatedAt: header.generatedAt,
    });

    const saved = await this.reportRepository.save(entity);
    this.logger.debug(
      `Saved ${header.kind} report ${saved.id} for IMEI ${header.imei} (event ${report.eventType} ${report.eventName})`,
    );
    return saved;
  }

  findAllDevices(): Promise<TrackerDevice[]> {
    return this.deviceRepository.find({
      order: { lastSeenAt: 'DESC' },
    });
  }

  findDevice(imei: string): Promise<TrackerDevice | null> {
    return this.deviceRepository.findOneBy({ imei });
  }

  async findReports(
    imei: string,
    options: FindReportsOptions = {},
  ): Promise<TrackerReport[]> {
    const qb = this.reportRepository
      .createQueryBuilder('report')
      .where('report.imei = :imei', { imei });

    if (options.from) {
      qb.andWhere('report.receivedAt >= :from', { from: options.from });
    }
    if (options.to) {
      qb.andWhere('report.receivedAt <= :to', { to: options.to });
    }

    qb.orderBy('report.receivedAt', 'DESC');
    qb.take(options.limit && options.limit > 0 ? options.limit : 50);

    return qb.getMany();
  }

  findRecentReports(limit: number): Promise<TrackerReport[]> {
    return this.reportRepository.find({
      order: { receivedAt: 'DESC' },
      take: limit,
    });
  }
}
