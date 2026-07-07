import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackerDevice } from './entities/tracker-device.entity';
import { TrackerReport } from './entities/tracker-report.entity';
import { TrackerEvent } from './entities/tracker-event.entity';
import { TrackerParserService } from './parser/tracker-parser.service';
import { TrackerPersistenceService } from './persistence/tracker-persistence.service';
import { TrackerConnectionRegistryService } from './tcp/tracker-connection-registry.service';
import { TrackerTcpServer } from './tcp/tracker-tcp-server.service';
import { TrackerEventPublisherService } from './publishing/tracker-event-publisher.service';
import { TrackerEventOutboxService } from './events/tracker-event-outbox.service';
import { TrackerController } from './tracker.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrackerDevice, TrackerReport, TrackerEvent]),
  ],
  controllers: [TrackerController],
  providers: [
    TrackerParserService,
    TrackerPersistenceService,
    TrackerConnectionRegistryService,
    TrackerTcpServer,
    TrackerEventPublisherService,
    TrackerEventOutboxService,
  ],
  exports: [TrackerParserService, TrackerPersistenceService],
})
export class TrackerModule {}
