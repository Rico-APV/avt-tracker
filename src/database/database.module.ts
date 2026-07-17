import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackerDevice } from '../tracker/entities/tracker-device.entity';
import { TrackerReport } from '../tracker/entities/tracker-report.entity';
import { TrackerEvent } from '../tracker/entities/tracker-event.entity';
import { StarlinkDevice } from '../starlink/entities/starlink-device.entity';
import { StarlinkReport } from '../starlink/entities/starlink-report.entity';
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
          entities: [
            TrackerDevice,
            TrackerReport,
            TrackerEvent,
            StarlinkDevice,
            StarlinkReport,
          ],
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          migrationsRun: false,
          // Never enable in production: schema drift should always go
          // through a reviewed migration file instead.
          synchronize: db.synchronize,
          logging: db.logging,
          // RDS Postgres rejects plaintext connections by default
          // ("no pg_hba.conf entry ... no encryption"). rejectUnauthorized
          // is false because we're not bundling the RDS CA cert yet -
          // this still encrypts the connection, it just doesn't verify
          // the server certificate chain. Tighten this later by loading
          // the RDS CA bundle and setting rejectUnauthorized: true.
          ssl: db.ssl ? { rejectUnauthorized: false } : false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
