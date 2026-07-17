import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ListStarlinkReportsQueryDto } from './dto/list-starlink-reports-query.dto';
import { StarlinkConnectionRegistryService } from './tcp/starlink-connection-registry.service';
import { StarlinkPersistenceService } from './persistence/starlink-persistence.service';

/**
 * Read-only HTTP surface for whatever the StarLink TCP listener has stored
 * so far. No auth yet - mirrors `TrackerController`, only meant for
 * verifying/monitoring that data is flowing in correctly.
 */
@Controller('starlink')
export class StarlinkController {
  constructor(
    private readonly persistence: StarlinkPersistenceService,
    private readonly registry: StarlinkConnectionRegistryService,
  ) {}

  @Get('devices')
  async listDevices() {
    const devices = await this.persistence.findAllDevices();
    return devices.map((device) => ({
      deviceId: device.deviceId,
      alias: device.alias,
      online: this.registry.isConnected(device.deviceId),
      lastSeenAt: device.lastSeenAt,
      lastReportAt: device.lastReportAt,
      lastPosition:
        device.lastLatitude != null && device.lastLongitude != null
          ? { latitude: device.lastLatitude, longitude: device.lastLongitude }
          : null,
      lastEvent:
        device.lastEventId != null
          ? { id: device.lastEventId, name: device.lastEventName }
          : null,
      lastIgnition: device.lastIgnition,
      battery: device.lastBatteryVoltage,
      mainPower: device.lastMainPowerVoltage,
    }));
  }

  @Get('devices/:deviceId/reports')
  async listReports(
    @Param('deviceId') deviceId: string,
    @Query() query: ListStarlinkReportsQueryDto,
  ) {
    const device = await this.persistence.findDevice(deviceId);
    if (!device) {
      throw new NotFoundException(
        `No StarLink device known with id ${deviceId}`,
      );
    }

    const reports = await this.persistence.findReports(deviceId, {
      limit: query.limit,
      from: query.from,
      to: query.to,
    });

    return { deviceId, count: reports.length, reports };
  }

  @Get('monitor/overview')
  async monitorOverview() {
    const devices = await this.persistence.findAllDevices();
    const connectedIds = new Set(this.registry.getConnectedDeviceIds());

    return {
      totalDevices: devices.length,
      connectedNow: connectedIds.size,
      devices: devices.map((device) => {
        const connectionInfo = this.registry.getConnectionInfo(device.deviceId);
        return {
          deviceId: device.deviceId,
          alias: device.alias,
          online: connectedIds.has(device.deviceId),
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
        deviceId: report.deviceId,
        eventId: report.eventId,
        eventName: report.eventName,
        alarm: report.alarm,
        latitude: report.latitude,
        longitude: report.longitude,
        speedKnots: report.speedKnots,
        speedKmh: report.speedKmh,
        batteryVoltage: report.batteryVoltage,
        deviceTime: report.deviceTime,
        receivedAt: report.receivedAt,
      })),
    };
  }
}
