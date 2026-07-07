import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackerDevice } from '../tracker/entities/tracker-device.entity';
import { TrackerReport } from '../tracker/entities/tracker-report.entity';
import { AppConfig } from '../config/configuration';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const db = configService.get('database', { infer: true });
        return {
          type: 'postgres' as const,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          entities: [TrackerDevice, TrackerReport],
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          migrationsRun: false,
          // Never enable in production: schema drift should always go
          // through a reviewed migration file instead.
          synchronize: db.synchronize,
          logging: db.logging,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
