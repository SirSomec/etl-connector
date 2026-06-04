const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { ConfigError, loadConfig } = require('../src/config');

function baseEnv(overrides = {}) {
  return {
    CLICKHOUSE_HOST: 'clickhouse.example.test',
    CLICKHOUSE_USER: 'rouser',
    CLICKHOUSE_PASSWORD: 'secret',
    AUTH_ADMIN_EMAIL: 'admin@example.test',
    AUTH_ADMIN_PASSWORD: 'AdminPass123',
    ...overrides
  };
}

test('loadConfig returns required values and safe defaults', () => {
  const config = loadConfig(baseEnv());

  assert.equal(config.port, 3000);
  assert.equal(config.clickhouse.host, 'clickhouse.example.test');
  assert.equal(config.clickhouse.port, 8443);
  assert.equal(config.clickhouse.database, 'etl');
  assert.equal(config.clickhouse.user, 'rouser');
  assert.equal(config.clickhouse.password, 'secret');
  assert.equal(config.clickhouse.requestTimeoutMs, 120000);
  assert.equal(
    config.clickhouse.caPath,
    '/usr/local/share/ca-certificates/Yandex/RootCA.crt'
  );
  assert.equal(config.auth.enabled, true);
  assert.equal(config.auth.adminEmail, 'admin@example.test');
  assert.equal(config.auth.adminPassword, 'AdminPass123');
  assert.match(config.auth.userStorePath, /data[\\/]users\.json$/);
  assert.equal(
    config.preload.storePath,
    path.join(process.cwd(), 'data', 'preload.sqlite')
  );
  assert.equal(config.auth.sessionCookieName, 'etl_analytics_session');
  assert.equal(config.auth.sessionTtlMs, 12 * 60 * 60 * 1000);
});

test('loadConfig accepts preload store path override', () => {
  const config = loadConfig(baseEnv({
    PRELOAD_STORE_PATH: 'C:\\runtime\\preload.sqlite'
  }));

  assert.equal(config.preload.storePath, 'C:\\runtime\\preload.sqlite');
});

test('loadConfig reports every missing required variable', () => {
  assert.throws(
    () => loadConfig({}),
    (error) => {
      assert.ok(error instanceof ConfigError);
        assert.match(error.message, /CLICKHOUSE_HOST/);
        assert.match(error.message, /CLICKHOUSE_USER/);
        assert.match(error.message, /CLICKHOUSE_PASSWORD/);
        assert.match(error.message, /AUTH_ADMIN_EMAIL/);
        assert.match(error.message, /AUTH_ADMIN_PASSWORD/);
        return true;
      }
  );
});

test('loadConfig rejects blank required variables', () => {
  assert.throws(
    () =>
      loadConfig({
        CLICKHOUSE_HOST: '   ',
        CLICKHOUSE_USER: '\t',
        CLICKHOUSE_PASSWORD: '\n',
        AUTH_ADMIN_EMAIL: ' ',
        AUTH_ADMIN_PASSWORD: '\t'
      }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /CLICKHOUSE_HOST/);
      assert.match(error.message, /CLICKHOUSE_USER/);
      assert.match(error.message, /CLICKHOUSE_PASSWORD/);
      assert.match(error.message, /AUTH_ADMIN_EMAIL/);
      assert.match(error.message, /AUTH_ADMIN_PASSWORD/);
      return true;
    }
  );
});

test('loadConfig rejects invalid numeric ports', () => {
  assert.throws(
    () =>
      loadConfig(baseEnv({
        CLICKHOUSE_PORT: 'not-a-number'
      })),
    /CLICKHOUSE_PORT must be an integer/
  );

  assert.throws(
    () =>
      loadConfig(baseEnv({
        PORT: '0'
      })),
    /PORT must be between 1 and 65535/
  );

  assert.throws(
    () =>
      loadConfig(baseEnv({
        CLICKHOUSE_REQUEST_TIMEOUT_MS: 'slow'
      })),
    /CLICKHOUSE_REQUEST_TIMEOUT_MS must be an integer/
  );
});

test('loadConfig accepts long positive ClickHouse request timeouts', () => {
  const config = loadConfig(baseEnv({
    CLICKHOUSE_REQUEST_TIMEOUT_MS: '120000'
  }));

  assert.equal(config.clickhouse.requestTimeoutMs, 120000);
});

test('loadConfig can disable auth for isolated tests', () => {
  const config = loadConfig({
    CLICKHOUSE_HOST: 'clickhouse.example.test',
    CLICKHOUSE_USER: 'rouser',
    CLICKHOUSE_PASSWORD: 'secret',
    AUTH_ENABLED: 'false'
  });

  assert.equal(config.auth.enabled, false);
  assert.equal(config.auth.adminEmail, '');
  assert.equal(config.auth.adminPassword, '');
});

test('loadConfig accepts auth overrides', () => {
  const config = loadConfig(baseEnv({
    AUTH_USER_STORE_PATH: 'C:\\auth\\users.json',
    AUTH_SESSION_SECRET: 'session-secret',
    AUTH_SESSION_COOKIE_NAME: 'custom_session',
    AUTH_SESSION_TTL_MS: '600000'
  }));

  assert.equal(config.auth.userStorePath, 'C:\\auth\\users.json');
  assert.equal(config.auth.sessionSecret, 'session-secret');
  assert.equal(config.auth.sessionCookieName, 'custom_session');
  assert.equal(config.auth.sessionTtlMs, 600000);
});
