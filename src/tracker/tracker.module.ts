import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackerDevice } from './entities/tracker-device.entity';
import { TrackerReport } from './entities/tracker-report.entity';
import { TrackerParserService } from './parser/tracker-parser.service';
import { TrackerPersistenceService } from './persistence/tracker-persistence.service';
import { TrackerConnectionRegistryService } from './tcp/tracker-connection-registry.service';
import { TrackerTcpServer } from './tcp/tracker-tcp-server.service';
import { TrackerController } from './tracker.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TrackerDevice, TrackerReport])],
  controllers: [TrackerController],
  providers: [
    TrackerParserService,
    TrackerPersistenceService,
    TrackerConnectionRegistryService,
    TrackerTcpServer,
  ],
  exports: [TrackerParserService, TrackerPersistenceService],
})
export class TrackerModule {}
