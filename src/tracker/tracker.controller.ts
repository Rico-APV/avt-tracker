import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { TrackerConnectionRegistryService } from './tcp/tracker-connection-registry.service';
import { TrackerPersistenceService } from './persistence/tracker-persistence.service';

/**
 * Read-only HTTP surface for whatever the TCP listener has stored so far.
 * No auth yet - this is only meant for verifying/monitoring that data is
 * flowing in correctly.
 */
@Controller('tracker')
export class TrackerController {
  constructor(
    private readonly persistence: TrackerPersistenceService,
    private readonly registry: TrackerConnectionRegistryService,
  ) {}

  @Get('devices')
  async listDevices() {
    const devices = await this.persistence.findAllDevices();
    return devices.map((device) => ({
      imei: device.imei,
      alias: device.alias,
      online: this.registry.isConnected(device.imei),
      lastSeenAt: device.lastSeenAt,
      lastReportAt: device.lastReportAt,
      lastFrameKind: device.lastFrameKind,
      lastPosition:
        device.lastLatitude != null && device.lastLongitude != null
          ? {
              latitude: device.lastLatitude,
              longitude: device.lastLongitude,
              altitudeM: device.lastAltitudeM,
              speedKmh: device.lastSpeedKmh,
            }
          : null,
      lastEvent:
        device.lastEventType != null
          ? { type: device.lastEventType, name: device.lastEventName }
          : null,
      battery:
        device.lastBatteryLevelPercent != null
          ? {
              levelPercent: device.lastBatteryLevelPercent,
              voltageMv: device.lastBatteryVoltageMv,
            }
          : null,
      networkType: device.lastNetworkType,
    }));
  }

  @Get('devices/:imei/reports')
  async listReports(
    @Param('imei') imei: string,
    @Query() query: ListReportsQueryDto,
  ) {
    const device = await this.persistence.findDevice(imei);
    if (!device) {
      throw new NotFoundException(`No device known with IMEI ${imei}`);
    }

    const reports = await this.persistence.findReports(imei, {
      limit: query.limit,
      from: query.from,
      to: query.to,
    });

    return { imei, count: reports.length, reports };
  }

  @Get('monitor/overview')
  async monitorOverview() {
    const devices = await this.persistence.findAllDevices();
    const connectedImeis = new Set(this.registry.getConnectedImeis());

    return {
      totalDevices: devices.length,
      connectedNow: connectedImeis.size,
      devices: devices.map((device) => {
        const connectionInfo = this.registry.getConnectionInfo(device.imei);
        return {
          imei: device.imei,
          alias: device.alias,
          online: connectedImeis.has(device.imei),
          connectedAt: connectionInfo?.connectedAt ?? null,
          lastActivityAt: connectionInfo?.lastActivityAt ?? null,
          lastSeenAt: device.lastSeenAt,
          lastReportAt: device.lastReportAt,
          lastEventName: device.lastEventName,
        };
      }),
    };
  }

  @Get('monitor/events')
  async monitorRecentEvents(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const effectiveLimit = limit && limit > 0 ? Math.min(limit, 500) : 50;
    const reports = await this.persistence.findRecentReports(effectiveLimit);

    return {
      count: reports.length,
      events: reports.map((report) => ({
        id: report.id,
        imei: report.imei,
        frameKind: report.frameKind,
        eventType: report.eventType,
        eventName: report.eventName,
        eventState: report.eventState,
        latitude: report.latitude,
        longitude: report.longitude,
        speedKmh: report.speedKmh,
        batteryLevelPercent: report.batteryLevelPercent,
        generatedAt: report.generatedAt,
        receivedAt: report.receivedAt,
      })),
    };
  }
}
