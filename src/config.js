const path = require('node:path');

const DEFAULT_PRELOAD_STORE_PATH = path.join(process.cwd(), 'data', 'preload.sqlite');

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readInteger(env, name, defaultValue) {
  const rawValue = env[name] || String(defaultValue);
  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || String(value) !== String(rawValue)) {
    throw new ConfigError(`${name} must be an integer`);
  }

  return value;
}

function readPort(env, name, defaultValue) {
  const value = readInteger(env, name, defaultValue);

  if (value < 1 || value > 65535) {
    throw new ConfigError(`${name} must be between 1 and 65535`);
  }

  return value;
}

function readPositiveInt(env, name, defaultValue, maxValue) {
  const value = readInteger(env, name, defaultValue);

  if (value < 1 || value > maxValue) {
    throw new ConfigError(`${name} must be between 1 and ${maxValue}`);
  }

  return value;
}

function isAuthEnabled(env) {
  return String(env.AUTH_ENABLED || 'true').toLowerCase() !== 'false';
}

function loadConfig(env = process.env) {
  const authEnabled = isAuthEnabled(env);
  const required = ['CLICKHOUSE_HOST', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD'];

  if (authEnabled) {
    required.push('AUTH_ADMIN_EMAIL', 'AUTH_ADMIN_PASSWORD');
  }

  const missing = required.filter(
    (name) => typeof env[name] !== 'string' || env[name].trim() === ''
  );

  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    port: readPort(env, 'PORT', 3000),
    clickhouse: {
      host: env.CLICKHOUSE_HOST,
      port: readPort(env, 'CLICKHOUSE_PORT', 8443),
      database: env.CLICKHOUSE_DATABASE || 'etl',
      user: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
      requestTimeoutMs: readPositiveInt(
        env,
        'CLICKHOUSE_REQUEST_TIMEOUT_MS',
        120000,
        600000
      ),
      caPath:
        env.CLICKHOUSE_CA_PATH ||
        '/usr/local/share/ca-certificates/Yandex/RootCA.crt'
    },
    preload: {
      storePath: env.PRELOAD_STORE_PATH || DEFAULT_PRELOAD_STORE_PATH
    },
    auth: {
      enabled: authEnabled,
      adminEmail: authEnabled ? env.AUTH_ADMIN_EMAIL : '',
      adminPassword: authEnabled ? env.AUTH_ADMIN_PASSWORD : '',
      userStorePath:
        env.AUTH_USER_STORE_PATH || path.join(process.cwd(), 'data', 'users.json'),
      sessionSecret: env.AUTH_SESSION_SECRET || '',
      sessionCookieName: env.AUTH_SESSION_COOKIE_NAME || 'etl_analytics_session',
      sessionTtlMs: readPositiveInt(
        env,
        'AUTH_SESSION_TTL_MS',
        12 * 60 * 60 * 1000,
        30 * 24 * 60 * 60 * 1000
      ),
      passwordHashIterations: readPositiveInt(
        env,
        'AUTH_PASSWORD_HASH_ITERATIONS',
        210000,
        1000000
      )
    }
  };
}

module.exports = {
  ConfigError,
  loadConfig
};
