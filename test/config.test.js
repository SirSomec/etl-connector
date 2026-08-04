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
    AUTH_SESSION_SECRET: 'session-secret',
    ...overrides
  };
}

function requiredEnv(overrides = {}) {
  return baseEnv(overrides);
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
  assert.match(config.auth.sessionStorePath, /data[\\/]sessions\.json$/);
  assert.equal(
    config.preload.storePath,
    path.join(process.cwd(), 'data', 'preload.sqlite')
  );
  assert.equal(config.preload.clickhouseRequestTimeoutMs, 600000);
  assert.equal(
    config.requestReportStatus.storePath,
    path.join(process.cwd(), 'data', 'request-report-shift-statuses.json')
  );
  assert.equal(config.auth.sessionCookieName, 'etl_analytics_session');
  assert.equal(config.auth.sessionTtlMs, 48 * 60 * 60 * 1000);
  assert.equal(config.auth.presenceHeartbeatMs, 15000);
  assert.equal(config.auth.presenceTtlMs, 45000);
});

test('scheduled report config uses safe defaults', () => {
  const config = loadConfig(requiredEnv());

  assert.equal(
    config.scheduledReports.storePath,
    path.join(process.cwd(), 'data', 'scheduled-reports.sqlite')
  );
  assert.equal(
    config.scheduledReports.fileDir,
    path.join(process.cwd(), 'data', 'scheduled-report-files')
  );
  assert.equal(config.scheduledReports.retentionDays, 60);
  assert.equal(config.scheduledReports.defaultRowLimit, 10000);
  assert.equal(config.scheduledReports.maxRowLimit, 100000);
  assert.equal(config.scheduledReports.maxFileSizeBytes, 10485760);
  assert.equal(config.scheduledReports.queryTimeoutMs, 120000);
});

test('scheduled report numeric config validates ranges', () => {
  assert.throws(
    () => loadConfig({ ...requiredEnv(), SCHEDULED_REPORT_RETENTION_DAYS: '0' }),
    /SCHEDULED_REPORT_RETENTION_DAYS must be between 1 and 3650/
  );
  assert.throws(
    () => loadConfig({ ...requiredEnv(), SCHEDULED_REPORT_MAX_ROW_LIMIT: 'abc' }),
    /SCHEDULED_REPORT_MAX_ROW_LIMIT must be an integer/
  );
});

test('loadConfig accepts preload store path override', () => {
  const config = loadConfig(baseEnv({
    PRELOAD_STORE_PATH: 'C:\\runtime\\preload.sqlite',
    CLICKHOUSE_REQUEST_TIMEOUT_MS: '120000',
    PRELOAD_CLICKHOUSE_REQUEST_TIMEOUT_MS: '900000'
  }));

  assert.equal(config.preload.storePath, 'C:\\runtime\\preload.sqlite');
  assert.equal(config.clickhouse.requestTimeoutMs, 120000);
  assert.equal(config.preload.clickhouseRequestTimeoutMs, 900000);
});

test('loadConfig includes user activity store path', () => {
  const config = loadConfig(baseEnv({
    USER_ACTIVITY_STORE_PATH: 'C:\\activity\\user-activity.sqlite'
  }));

  assert.equal(config.activity.storePath, 'C:\\activity\\user-activity.sqlite');
});

test('loadConfig includes request report status store path override', () => {
  const config = loadConfig(baseEnv({
    REQUEST_REPORT_STATUS_STORE_PATH: 'C:\\runtime\\request-report-statuses.json'
  }));

  assert.equal(config.requestReportStatus.storePath, 'C:\\runtime\\request-report-statuses.json');
});

test('loadConfig defaults user activity store to data directory', () => {
  const config = loadConfig(baseEnv());

  assert.match(config.activity.storePath, /data[\\/]user-activity\.sqlite$/);
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
    AUTH_SESSION_STORE_PATH: 'C:\\auth\\sessions.json',
    AUTH_SESSION_SECRET: 'session-secret',
    AUTH_SESSION_COOKIE_NAME: 'custom_session',
    AUTH_SESSION_TTL_MS: '600000',
    AUTH_PRESENCE_HEARTBEAT_MS: '10000',
    AUTH_PRESENCE_TTL_MS: '30000'
  }));

  assert.equal(config.auth.userStorePath, 'C:\\auth\\users.json');
  assert.equal(config.auth.sessionStorePath, 'C:\\auth\\sessions.json');
  assert.equal(config.auth.sessionSecret, 'session-secret');
  assert.equal(config.auth.sessionCookieName, 'custom_session');
  assert.equal(config.auth.sessionTtlMs, 600000);
  assert.equal(config.auth.presenceHeartbeatMs, 10000);
  assert.equal(config.auth.presenceTtlMs, 30000);
});

test('loadConfig rejects presence timeout shorter than two heartbeats', () => {
  assert.throws(
    () => loadConfig(baseEnv({
      AUTH_PRESENCE_HEARTBEAT_MS: '15000',
      AUTH_PRESENCE_TTL_MS: '20000'
    })),
    /AUTH_PRESENCE_TTL_MS must be at least twice AUTH_PRESENCE_HEARTBEAT_MS/
  );
});
