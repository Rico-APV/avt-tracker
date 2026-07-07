import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_DATABASE: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().truthy('true').falsy('false').default(false),
  DB_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),

  TRACKER_TCP_HOST: Joi.string().default('0.0.0.0'),
  TRACKER_TCP_PORT: Joi.number().port().default(6001),
  TRACKER_TCP_SOCKET_TIMEOUT_MS: Joi.number().integer().min(0).default(900000),
  TRACKER_TCP_MAX_BUFFER_BYTES: Joi.number().integer().min(1024).default(65536),
});
