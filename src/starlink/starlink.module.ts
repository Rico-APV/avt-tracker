import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StarlinkDevice } from './entities/starlink-device.entity';
import { StarlinkReport } from './entities/starlink-report.entity';
import { StarlinkParserService } from './parser/starlink-parser.service';
import { StarlinkPersistenceService } from './persistence/starlink-persistence.service';
import { StarlinkConnectionRegistryService } from './tcp/starlink-connection-registry.service';
import { StarlinkTcpServer } from './tcp/starlink-tcp-server.service';
import { StarlinkController } from './starlink.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StarlinkDevice, StarlinkReport])],
  controllers: [StarlinkController],
  providers: [
    StarlinkParserService,
    StarlinkPersistenceService,
    StarlinkConnectionRegistryService,
    StarlinkTcpServer,
  ],
  exports: [StarlinkParserService, StarlinkPersistenceService],
})
export class StarlinkModule {}
