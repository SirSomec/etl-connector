const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp, sanitizeForResponse } = require('../src/server');

function baseConfig() {
  return {
    port: 0,
    clickhouse: {
      database: 'etl',
      password: 'super-secret'
    }
  };
}

function createFakeClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    async listTables() {
      calls.push(['listTables']);
      return ['events', 'orders'];
    },
    async getColumns(tableName) {
      calls.push(['getColumns', tableName]);
      return [
        { name: 'id', type: 'UInt64', position: 1 },
        { name: 'created_at', type: 'DateTime', position: 2 }
      ];
    },
    async getPreview(tableName) {
      calls.push(['getPreview', tableName]);
      return [
        { id: 1, created_at: '2026-06-01T00:00:00Z' },
        { id: 2, created_at: '2026-06-01T00:01:00Z' }
      ];
    }
  };

  return Object.assign(client, overrides);
}

async function withServer(client, callback, config = baseConfig()) {
  const app = createApp({ config, client });
  const server = app.listen(0);

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function fetchText(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();

  return { response, text };
}

test('GET / renders available tables from metadata', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Available Tables/);
    assert.match(text, /events/);
    assert.match(text, /orders/);
  });

  assert.deepEqual(client.calls, [['listTables']]);
});

test('GET /tables renders columns and preview rows for a known table', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/tables?name=events');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /events/);
    assert.match(text, /id/);
    assert.match(text, /UInt64/);
    assert.match(text, /created_at/);
    assert.match(text, /2026-06-01T00:00:00Z/);
  });

  assert.deepEqual(client.calls, [
    ['listTables'],
    ['getColumns', 'events'],
    ['getPreview', 'events']
  ]);
});

test('GET /tables with missing name returns 400 with sanitized error page', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/tables');

    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Missing table name/);
    assert.doesNotMatch(text, /super-secret/);
  });

  assert.deepEqual(client.calls, []);
});

test('GET /tables returns 404 when table is not in metadata', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/tables?name=missing');

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Table not found/);
  });

  assert.deepEqual(client.calls, [['listTables']]);
});

test('route errors are sanitized before rendering', async () => {
  const client = createFakeClient({
    async listTables() {
      throw new Error('ClickHouse rejected password super-secret');
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/');

    assert.equal(response.status, 502);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.doesNotMatch(text, /super-secret/);
  });
});

test('sanitizeForResponse redacts configured password and normalizes blank messages', () => {
  assert.equal(
    sanitizeForResponse('connection failed for super-secret', baseConfig()),
    'connection failed for [redacted]'
  );
  assert.equal(sanitizeForResponse('', baseConfig()), 'Unexpected error');
  assert.equal(sanitizeForResponse(null, baseConfig()), 'Unexpected error');
});

test('GET /healthz returns ok as plain text', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/healthz');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain\b/);
    assert.equal(text, 'ok');
  });

  assert.deepEqual(client.calls, []);
});

test('unknown routes return 404', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/unknown');

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Not Found/);
  });

  assert.deepEqual(client.calls, []);
});
