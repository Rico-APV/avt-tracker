import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { DatabaseModule } from './database/database.module';
import { TrackerModule } from './tracker/tracker.module';
import { StarlinkModule } from './starlink/starlink.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    TrackerModule,
    StarlinkModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
