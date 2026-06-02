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
  const timeouts = [];

  function request(options, callback) {
    calls.push(options);
    const req = new EventEmitter();

    req.setTimeout = (timeoutMs) => {
      timeouts.push(timeoutMs);
      return req;
    };
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

  return { calls, request, timeouts };
}

function fakeRequestError(error) {
  const calls = [];

  function request(options) {
    calls.push(options);
    const req = new EventEmitter();

    req.setTimeout = () => req;
    req.end = () => {
      process.nextTick(() => {
        req.emit('error', error);
      });
    };

    return req;
  }

  return { calls, request };
}

function fakeResponseError(error) {
  function request(options, callback) {
    const req = new EventEmitter();

    req.setTimeout = () => req;
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = () => {};
      callback(res);

      process.nextTick(() => {
        if (res.listenerCount('error') > 0) {
          res.emit('error', error);
        }
        res.emit('end');
      });
    };

    return req;
  }

  return { request };
}

function fakeAbortedResponse() {
  function request(options, callback) {
    const req = new EventEmitter();

    req.setTimeout = () => req;
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = () => {};
      callback(res);

      process.nextTick(() => {
        res.emit('aborted');
        res.emit('end');
      });
    };

    return req;
  }

  return { request };
}

function fakeStalledRequest() {
  const calls = [];
  let timeoutMs;
  let destroyedWith;

  function request(options) {
    calls.push(options);
    const req = new EventEmitter();

    req.setTimeout = (ms, callback) => {
      timeoutMs = ms;
      setTimeout(callback, 1);
      return req;
    };
    req.destroy = (error) => {
      destroyedWith = error;
      process.nextTick(() => {
        req.emit('error', error);
      });
    };
    req.end = () => {};

    return req;
  }

  return {
    calls,
    request,
    get timeoutMs() {
      return timeoutMs;
    },
    get destroyedWith() {
      return destroyedWith;
    }
  };
}

function queryParams(call) {
  return new URLSearchParams(call.path.slice(2));
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
  assert.equal(quoteIdentifier('event`log\\raw'), '`event\\`log\\\\raw`');
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
  assert.equal(transport.timeouts[0], 120000);
  assert.equal(transport.calls[0].headers['X-ClickHouse-User'], 'rouser');
  assert.equal(transport.calls[0].headers['X-ClickHouse-Key'], 'secret');
  assert.match(decodeURIComponent(transport.calls[0].path), /system\.tables/);
  assert.match(decodeURIComponent(transport.calls[0].path), /param_database=etl/);
});

test('queryJSONEachRow executes a query and returns parsed rows', async () => {
  const transport = fakeRequest('{"period":"2026-04-01","ordered":3}\n');
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  const rows = await client.queryJSONEachRow(
    'SELECT {period:String} AS period, {ordered:UInt64} AS ordered FORMAT JSONEachRow',
    {
      param_period: '2026-04-01',
      param_ordered: 3
    },
    'dashboard query'
  );

  assert.deepEqual(rows, [{ period: '2026-04-01', ordered: 3 }]);

  const params = queryParams(transport.calls[0]);
  assert.equal(
    params.get('query'),
    'SELECT {period:String} AS period, {ordered:UInt64} AS ordered FORMAT JSONEachRow'
  );
  assert.equal(params.get('param_period'), '2026-04-01');
  assert.equal(params.get('param_ordered'), '3');
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

test('getPreview sends identifiers and limit as ClickHouse query parameters', async () => {
  const transport = fakeRequest('{"id":1,"name":"first"}\n');
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });
  const dangerousTable = 'event`log\\raw; DROP TABLE system.users';

  const rows = await client.getPreview(dangerousTable, 2);
  const params = queryParams(transport.calls[0]);
  const query = params.get('query');

  assert.deepEqual(rows, [{ id: 1, name: 'first' }]);
  assert.equal(
    query,
    'SELECT * FROM {database:Identifier}.{table:Identifier} LIMIT {limit:UInt64} FORMAT JSONEachRow'
  );
  assert.equal(params.get('param_database'), 'etl');
  assert.equal(params.get('param_table'), dangerousTable);
  assert.equal(params.get('param_limit'), '2');
  assert.equal(query.includes(dangerousTable), false);
  assert.equal(query.includes('DROP TABLE'), false);
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

test('execute rejects response stream errors with ClickHouseError', async () => {
  const transport = fakeResponseError(new Error('stream failed'));
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  await assert.rejects(
    () => client.execute('SELECT 1', {}, 'stream query'),
    (error) => {
      assert.ok(error instanceof ClickHouseError);
      assert.match(error.message, /stream query failed: stream failed/);
      return true;
    }
  );
});

test('execute rejects aborted responses with ClickHouseError', async () => {
  const transport = fakeAbortedResponse();
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  await assert.rejects(
    () => client.execute('SELECT 1', {}, 'aborted query'),
    (error) => {
      assert.ok(error instanceof ClickHouseError);
      assert.match(error.message, /aborted query failed: Response aborted/);
      return true;
    }
  );
});

test('execute times out stalled requests and destroys the request', async () => {
  const transport = fakeStalledRequest();
  const client = new ClickHouseClient(
    { ...baseConfig(), requestTimeoutMs: 5 },
    {
      request: transport.request,
      readFileSync: () => 'CA'
    }
  );

  await assert.rejects(
    () =>
      Promise.race([
        client.execute('SELECT 1', {}, 'slow query'),
        new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('execute did not time out')), 30);
        })
      ]),
    (error) => {
      assert.ok(error instanceof ClickHouseError);
      assert.match(error.message, /slow query failed: Request timed out after 5 ms/);
      return true;
    }
  );
  assert.equal(transport.timeoutMs, 5);
  assert.ok(transport.destroyedWith instanceof Error);
});

test('execute does not let params override reserved database or query values', async () => {
  const transport = fakeRequest('ok\n');
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  await client.execute(
    'SELECT 1',
    {
      database: 'other',
      query: 'SELECT password FROM secrets',
      param_database: 'analytics'
    },
    'reserved params query'
  );

  const params = queryParams(transport.calls[0]);
  assert.equal(params.get('database'), 'etl');
  assert.equal(params.get('query'), 'SELECT 1');
  assert.equal(params.get('param_database'), 'analytics');
});

test('execute redacts configured password from request errors', async () => {
  const transport = fakeRequestError(new Error('socket failed with secret'));
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  await assert.rejects(
    () => client.execute('SELECT 1', {}, 'request query'),
    (error) => {
      assert.ok(error instanceof ClickHouseError);
      assert.doesNotMatch(error.message, /secret/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    }
  );
});
