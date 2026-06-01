const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  ClickHouseClient,
  ClickHouseError,
  parseJSONEachRow,
  quoteIdentifier
} = require('../src/clickhouseClient');

function baseConfig() {
  return {
    host: 'clickhouse.example.test',
    port: 8443,
    database: 'etl',
    user: 'rouser',
    password: 'secret',
    caPath: '/certs/root.crt'
  };
}

function fakeRequest(responseBody, statusCode = 200) {
  const calls = [];

  function request(options, callback) {
    calls.push(options);
    const req = new EventEmitter();

    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.setEncoding = () => {};
      callback(res);

      process.nextTick(() => {
        if (responseBody) {
          res.emit('data', responseBody);
        }
        res.emit('end');
      });
    };

    return req;
  }

  return { calls, request };
}

test('parseJSONEachRow parses newline-delimited ClickHouse JSON rows and blank bodies', () => {
  assert.deepEqual(parseJSONEachRow('{"name":"events"}\n{"name":"orders"}\n'), [
    { name: 'events' },
    { name: 'orders' }
  ]);
  assert.deepEqual(parseJSONEachRow(''), []);
  assert.deepEqual(parseJSONEachRow('\n'), []);
});

test('quoteIdentifier wraps identifiers and escapes backticks', () => {
  assert.equal(quoteIdentifier('events'), '`events`');
  assert.equal(quoteIdentifier('event`log'), '`event``log`');
  assert.throws(() => quoteIdentifier(''), /Identifier must be a non-empty string/);
});

test('listTables sends authenticated HTTPS request and parses table names', async () => {
  const transport = fakeRequest('{"name":"events"}\n{"name":"orders"}\n');
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  const tables = await client.listTables();

  assert.deepEqual(tables, ['events', 'orders']);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].method, 'GET');
  assert.equal(transport.calls[0].hostname, 'clickhouse.example.test');
  assert.equal(transport.calls[0].port, 8443);
  assert.equal(transport.calls[0].ca, 'CA');
  assert.equal(transport.calls[0].headers['X-ClickHouse-User'], 'rouser');
  assert.equal(transport.calls[0].headers['X-ClickHouse-Key'], 'secret');
  assert.match(decodeURIComponent(transport.calls[0].path), /system\.tables/);
  assert.match(decodeURIComponent(transport.calls[0].path), /param_database=etl/);
});

test('getColumns reads metadata for one table', async () => {
  const transport = fakeRequest(
    '{"name":"id","type":"UInt64","position":1}\n{"name":"created_at","type":"DateTime","position":2}\n'
  );
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  const columns = await client.getColumns('events');

  assert.deepEqual(columns, [
    { name: 'id', type: 'UInt64', position: 1 },
    { name: 'created_at', type: 'DateTime', position: 2 }
  ]);
  assert.match(decodeURIComponent(transport.calls[0].path), /system\.columns/);
  assert.match(decodeURIComponent(transport.calls[0].path), /param_database=etl/);
  assert.match(decodeURIComponent(transport.calls[0].path), /param_table=events/);
});

test('getPreview quotes database and table identifiers and parses rows', async () => {
  const transport = fakeRequest('{"id":1,"name":"first"}\n');
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  const rows = await client.getPreview('event`log', 2);

  assert.deepEqual(rows, [{ id: 1, name: 'first' }]);
  assert.match(
    decodeURIComponent(transport.calls[0].path),
    /SELECT \* FROM `etl`\.`event``log` LIMIT 2 FORMAT JSONEachRow/
  );
});

test('getPreview rejects invalid limits', async () => {
  const transport = fakeRequest('');
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  await assert.rejects(() => client.getPreview('events', 0), /Limit must be between 1 and 1000/);
  await assert.rejects(() => client.getPreview('events', 1001), /Limit must be between 1 and 1000/);
  assert.equal(transport.calls.length, 0);
});

test('execute rejects failed ClickHouse responses without leaking password', async () => {
  const transport = fakeRequest('Authentication failed for secret', 500);
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  await assert.rejects(
    () => client.execute('SELECT 1', {}, 'test query'),
    (error) => {
      assert.ok(error instanceof ClickHouseError);
      assert.equal(error.statusCode, 500);
      assert.match(error.message, /test query failed with HTTP 500/);
      assert.doesNotMatch(error.message, /secret/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    }
  );
});
