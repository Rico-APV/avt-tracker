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
    ssl: boolean;
  };
  tracker: {
    tcpHost: string;
    tcpPort: number;
    socketTimeoutMs: number;
    maxBufferBytes: number;
    /** Logs every raw frame + its parsed result - noisy, opt-in only. */
    logRawMessages: boolean;
  };
  starlink: {
    tcpHost: string;
    tcpPort: number;
    socketTimeoutMs: number;
    maxBufferBytes: number;
    /** Logs every raw line + its parsed result - noisy, opt-in only. */
    logRawMessages: boolean;
  };
  notifications: {
    awsRegion: string;
    /** Undefined disables publishing entirely (e.g. local dev). */
    snsTopicArn: string | undefined;
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
    // RDS Postgres enforces SSL by default; the local docker-compose
    // Postgres doesn't have it configured at all, so this must stay
    // opt-in per environment rather than always-on.
    ssl: (process.env.DB_SSL ?? 'false') === 'true',
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
    logRawMessages:
      (process.env.TRACKER_TCP_LOG_MESSAGES ?? 'false') === 'true',
  },
  starlink: {
    tcpHost: process.env.STARLINK_TCP_HOST ?? '0.0.0.0',
    // 5136 is Traccar's documented default port for this protocol - see
    // StarlinkParserService docs for why Traccar's decoder was the source.
    tcpPort: parseInt(process.env.STARLINK_TCP_PORT ?? '5136', 10),
    socketTimeoutMs: parseInt(
      process.env.STARLINK_TCP_SOCKET_TIMEOUT_MS ?? '900000',
      10,
    ),
    maxBufferBytes: parseInt(
      process.env.STARLINK_TCP_MAX_BUFFER_BYTES ?? '8192',
      10,
    ),
    logRawMessages:
      (process.env.STARLINK_TCP_LOG_MESSAGES ?? 'false') === 'true',
  },
  notifications: {
    awsRegion: process.env.AWS_REGION ?? 'us-east-2',
    snsTopicArn: process.env.SNS_TOPIC_ARN || undefined,
  },
});
