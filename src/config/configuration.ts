export interface AppConfig {
  port: number;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    synchronize: boolean;
    logging: boolean;
  };
  tracker: {
    tcpHost: string;
    tcpPort: number;
    socketTimeoutMs: number;
    maxBufferBytes: number;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'avt',
    password: process.env.DB_PASSWORD ?? 'avt',
    database: process.env.DB_DATABASE ?? 'avt_tracker',
    synchronize: (process.env.DB_SYNCHRONIZE ?? 'false') === 'true',
    logging: (process.env.DB_LOGGING ?? 'false') === 'true',
  },
  tracker: {
    tcpHost: process.env.TRACKER_TCP_HOST ?? '0.0.0.0',
    tcpPort: parseInt(process.env.TRACKER_TCP_PORT ?? '6001', 10),
    socketTimeoutMs: parseInt(
      process.env.TRACKER_TCP_SOCKET_TIMEOUT_MS ?? '900000',
      10,
    ),
    maxBufferBytes: parseInt(
      process.env.TRACKER_TCP_MAX_BUFFER_BYTES ?? '65536',
      10,
    ),
  },
});
