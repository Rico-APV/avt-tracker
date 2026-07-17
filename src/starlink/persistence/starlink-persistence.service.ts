import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryDeepPartialEntity, Repository } from 'typeorm';
import { StarlinkDevice } from '../entities/starlink-device.entity';
import { StarlinkReport } from '../entities/starlink-report.entity';
import { ParsedStarlinkFrame } from '../parser/starlink-parser.types';

export interface FindStarlinkReportsOptions {
  limit?: number;
  from?: Date;
  to?: Date;
}

@Injectable()
export class StarlinkPersistenceService {
  private readonly logger = new Logger(StarlinkPersistenceService.name);

  constructor(
    @InjectRepository(StarlinkDevice)
    private readonly deviceRepository: Repository<StarlinkDevice>,
    @InjectRepository(StarlinkReport)
    private readonly reportRepository: Repository<StarlinkReport>,
  ) {}

  /**
   * Atomic `INSERT ... ON CONFLICT (deviceId) DO UPDATE`, same reasoning as
   * `TrackerPersistenceService.upsertDevice`: a brand-new device's first
   * message can trigger `markDeviceConnected` and `saveReport` for the same
   * deviceId within the same tick, and a naive find-then-create would race.
   */
  private async upsertDevice(
    patch: QueryDeepPartialEntity<StarlinkDevice> & { deviceId: string },
  ): Promise<void> {
    await this.deviceRepository.upsert(patch, ['deviceId']);
  }

  async markDeviceConnected(deviceId: string): Promise<void> {
    await this.upsertDevice({
      deviceId,
      tcpConnected: true,
      lastSeenAt: new Date(),
    });
  }

  async markDeviceDisconnected(deviceId: string): Promise<void> {
    await this.upsertDevice({ deviceId, tcpConnected: false });
  }

  /**
   * Persists a decoded event-report message and refreshes the owning
   * device's "last known state" snapshot. Returns `null` if the frame
   * wasn't an event report (defensive - callers should already only
   * invoke this for report frames).
   */
  async saveReport(
    parsed: ParsedStarlinkFrame,
  ): Promise<StarlinkReport | null> {
    const { header, report } = parsed;
    if (!report) {
      return null;
    }

    const now = new Date();
    const devicePatch: QueryDeepPartialEntity<StarlinkDevice> & {
      deviceId: string;
    } = {
      deviceId: header.deviceId,
      tcpConnected: true,
      lastSeenAt: now,
      lastReportAt: report.deviceTime ?? now,
    };
    // Only include fields this report actually carried, so an upsert for a
    // message without (say) a GNSS fix doesn't null out the last known
    // position - see `upsertDevice` for why this has to be a single upsert.
    if (report.eventId !== undefined) {
      devicePatch.lastEventId = report.eventId;
      devicePatch.lastEventName = report.eventName ?? null;
    }
    if (report.latitude !== undefined) {
      devicePatch.lastLatitude = report.latitude;
    }
    if (report.longitude !== undefined) {
      devicePatch.lastLongitude = report.longitude;
    }
    if (report.speedKnots !== undefined) {
      devicePatch.lastSpeedKnots = report.speedKnots;
    }
    if (report.speedKmh !== undefined) {
      devicePatch.lastSpeedKmh = report.speedKmh;
    }
    if (report.ignition !== undefined) {
      devicePatch.lastIgnition = report.ignition;
    }
    if (report.batteryVoltage !== undefined) {
      devicePatch.lastBatteryVoltage = report.batteryVoltage;
    }
    if (report.mainPowerVoltage !== undefined) {
      devicePatch.lastMainPowerVoltage = report.mainPowerVoltage;
    }
    await this.upsertDevice(devicePatch);

    const entity = this.reportRepository.create({
      deviceId: header.deviceId,
      messageType: header.messageType,
      messageIndex: header.messageIndex,
      eventId: report.eventId ?? null,
      eventName: report.eventName ?? null,
      alarm: report.alarm ?? null,
      deviceTime: report.deviceTime ?? null,
      fixTime: report.fixTime ?? null,
      latitude: report.latitude ?? null,
      longitude: report.longitude ?? null,
      altitudeM: report.altitudeM ?? null,
      speedKnots: report.speedKnots ?? null,
      speedKmh: report.speedKmh ?? null,
      course: report.course ?? null,
      odometerM:
        report.odometerM !== undefined ? String(report.odometerM) : null,
      lac: report.lac ?? null,
      cid: report.cid ?? null,
      mainPowerVoltage: report.mainPowerVoltage ?? null,
      batteryVoltage: report.batteryVoltage ?? null,
      ignition: report.ignition ?? null,
      satellites: report.satellites ?? null,
      pdop: report.pdop ?? null,
      digitalInputs: Object.keys(report.digitalInputs).length
        ? report.digitalInputs
        : null,
      digitalOutputs: Object.keys(report.digitalOutputs).length
        ? report.digitalOutputs
        : null,
      destination: report.destination ?? null,
      unsupportedTags: report.unsupportedTags.length
        ? report.unsupportedTags
        : null,
      parseWarnings: parsed.warnings.length ? parsed.warnings : null,
      payload: report as unknown as Record<string, unknown>,
      rawLine: parsed.rawLine,
      checksumHex: header.checksumHex,
    });

    const saved = await this.reportRepository.save(entity);
    this.logger.debug(
      `Saved StarLink report ${saved.id} for device ${header.deviceId} ` +
        `(event ${report.eventId ?? 'n/a'} ${report.eventName ?? ''})`,
    );
    return saved;
  }

  findAllDevices(): Promise<StarlinkDevice[]> {
    return this.deviceRepository.find({ order: { lastSeenAt: 'DESC' } });
  }

  findDevice(deviceId: string): Promise<StarlinkDevice | null> {
    return this.deviceRepository.findOneBy({ deviceId });
  }

  async findReports(
    deviceId: string,
    options: FindStarlinkReportsOptions = {},
  ): Promise<StarlinkReport[]> {
    const qb = this.reportRepository
      .createQueryBuilder('report')
      .where('report.deviceId = :deviceId', { deviceId });

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

  findRecentReports(limit: number): Promise<StarlinkReport[]> {
    return this.reportRepository.find({
      order: { receivedAt: 'DESC' },
      take: limit,
    });
  }
}
