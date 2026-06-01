class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readInt(env, name, defaultValue) {
  const rawValue = env[name] || String(defaultValue);
  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || String(value) !== String(rawValue)) {
    throw new ConfigError(`${name} must be an integer`);
  }

  if (value < 1 || value > 65535) {
    throw new ConfigError(`${name} must be between 1 and 65535`);
  }

  return value;
}

function loadConfig(env = process.env) {
  const required = ['CLICKHOUSE_HOST', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD'];
  const missing = required.filter(
    (name) => typeof env[name] !== 'string' || env[name].trim() === ''
  );

  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    port: readInt(env, 'PORT', 3000),
    clickhouse: {
      host: env.CLICKHOUSE_HOST,
      port: readInt(env, 'CLICKHOUSE_PORT', 8443),
      database: env.CLICKHOUSE_DATABASE || 'etl',
      user: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
      caPath:
        env.CLICKHOUSE_CA_PATH ||
        '/usr/local/share/ca-certificates/Yandex/RootCA.crt'
    }
  };
}

module.exports = {
  ConfigError,
  loadConfig
};
