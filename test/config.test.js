const test = require('node:test');
const assert = require('node:assert/strict');

const { ConfigError, loadConfig } = require('../src/config');

test('loadConfig returns required values and safe defaults', () => {
  const config = loadConfig({
    CLICKHOUSE_HOST: 'clickhouse.example.test',
    CLICKHOUSE_USER: 'rouser',
    CLICKHOUSE_PASSWORD: 'secret'
  });

  assert.equal(config.port, 3000);
  assert.equal(config.clickhouse.host, 'clickhouse.example.test');
  assert.equal(config.clickhouse.port, 8443);
  assert.equal(config.clickhouse.database, 'etl');
  assert.equal(config.clickhouse.user, 'rouser');
  assert.equal(config.clickhouse.password, 'secret');
  assert.equal(
    config.clickhouse.caPath,
    '/usr/local/share/ca-certificates/Yandex/RootCA.crt'
  );
});

test('loadConfig reports every missing required variable', () => {
  assert.throws(
    () => loadConfig({}),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /CLICKHOUSE_HOST/);
      assert.match(error.message, /CLICKHOUSE_USER/);
      assert.match(error.message, /CLICKHOUSE_PASSWORD/);
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
        CLICKHOUSE_PASSWORD: '\n'
      }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /CLICKHOUSE_HOST/);
      assert.match(error.message, /CLICKHOUSE_USER/);
      assert.match(error.message, /CLICKHOUSE_PASSWORD/);
      return true;
    }
  );
});

test('loadConfig rejects invalid numeric ports', () => {
  assert.throws(
    () =>
      loadConfig({
        CLICKHOUSE_HOST: 'clickhouse.example.test',
        CLICKHOUSE_USER: 'rouser',
        CLICKHOUSE_PASSWORD: 'secret',
        CLICKHOUSE_PORT: 'not-a-number'
      }),
    /CLICKHOUSE_PORT must be an integer/
  );

  assert.throws(
    () =>
      loadConfig({
        CLICKHOUSE_HOST: 'clickhouse.example.test',
        CLICKHOUSE_USER: 'rouser',
        CLICKHOUSE_PASSWORD: 'secret',
        PORT: '0'
      }),
    /PORT must be between 1 and 65535/
  );
});
