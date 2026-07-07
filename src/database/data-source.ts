import 'dotenv/config';
import { DataSource } from 'typeorm';
import { TrackerDevice } from '../tracker/entities/tracker-device.entity';
import { TrackerReport } from '../tracker/entities/tracker-report.entity';

/**
 * Standalone DataSource used only by the TypeORM CLI (migration
 * generate/run/revert). The running Nest app wires Postgres through
 * DatabaseModule instead, but both must describe the same entities/schema.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'avt',
  password: process.env.DB_PASSWORD ?? 'avt',
  database: process.env.DB_DATABASE ?? 'avt_tracker',
  entities: [TrackerDevice, TrackerReport],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
