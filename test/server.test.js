const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { activeNavForPath, createApp, sanitizeForResponse, start } = require('../src/server');

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
    },
    async queryJSONEachRow(query, params, operation) {
      calls.push(['queryJSONEachRow', operation, params]);

      if (operation === 'sales by project orders summary') {
        return [{ ordered_shifts: 10, workplaces_with_orders: 3, avg_worker_rate_hour: 250 }];
      }

      if (operation === 'sales by project shifts summary') {
        return [
          {
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 5,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4
          }
        ];
      }

      if (operation === 'sales by project orders trend') {
        return [{ period: '2026-04-01', ordered_shifts: 10 }];
      }

      if (operation === 'sales by project shifts trend') {
        return [{ period: '2026-04-01', worked_shifts: 8, revenue_rub: 12000, cancelled_shifts: 1 }];
      }

      if (operation === 'sales by project brand orders') {
        return [{ brand: 'Бренд', ordered_shifts: 10, workplaces_with_orders: 3, avg_worker_rate_hour: 250 }];
      }

      if (operation === 'sales by project brand shifts') {
        return [
          {
            brand: 'Бренд',
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 5,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4
          }
        ];
      }

      if (operation === 'sales by project status breakdown') {
        return [{ status: 'confirmed', shifts: 8 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Точка',
            technical_name: 'tech',
            client_title: 'Бренд',
            city: 'Москва',
            region: 'Москва',
            street: 'Ленина 10',
            total_ordered_shifts: 9,
            active_days: 2
          }
        ];
      }

      if (operation === 'workplace analysis daily orders') {
        return [
          { workplace_id: 'wp1', order_date: '2026-06-01', ordered_shifts: 3 },
          { workplace_id: 'wp1', order_date: '2026-06-03', ordered_shifts: 6 }
        ];
      }

      return [];
    }
  };

  return Object.assign(client, overrides);
}

async function withServer(client, callback, config = baseConfig()) {
  const app = createApp({ config, client });
  const server = app.listen(0);

  try {
    await waitForListening(server);

    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await closeServer(server);
  }
}

async function waitForListening(server) {
  if (server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

async function closeServer(server) {
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

async function fetchText(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();

  return { response, text };
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

test('GET / renders available tables from metadata', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.equal(response.headers.has('x-powered-by'), false);
    assert.match(text, /Available Tables/);
    assert.match(text, /events/);
    assert.match(text, /orders/);
  });

  assert.deepEqual(client.calls, [['listTables']]);
});

test('GET /dashboards/sales-by-project renders dashboard', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/sales-by-project?period=month&from=2026-04-01&to=2026-04-30'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Продажи по проектам/);
    assert.match(text, /Заказано смен/);
    assert.match(text, /Бренд/);
    assert.match(text, /confirmed/);
  });

  assert.equal(client.calls.filter((call) => call[0] === 'queryJSONEachRow').length, 7);
});

test('GET /dashboards/sales-by-project keeps dashboard nav active on upstream errors', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      throw new Error(`${operation} failed`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/sales-by-project');

    assert.equal(response.status, 502);
    assert.match(text, /Upstream Error/);
    assert.match(text, /class="nav-link active" href="\/dashboards\/sales-by-project"/);
    assert.doesNotMatch(text, /class="nav-link active" href="\/"/);
  });
});

test('GET /dashboards/workplace-analysis renders dashboard with query filters', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis?from=2026-06-01&to=2026-06-03&city=Москва&orderType=regular'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Анализ точек/);
    assert.match(text, /Точка/);
    assert.match(text, /Заказано/);
    assert.match(text, /66\.7%/);
  });

  const workplaceCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace analysis')
  );

  assert.equal(workplaceCalls.length, 2);

  for (const call of workplaceCalls) {
    assert.equal(call[2].param_from, '2026-06-01 00:00:00');
    assert.equal(call[2].param_to, '2026-06-04 00:00:00');
    assert.equal(call[2].param_city, 'Москва');
    assert.equal(call[2].param_order_type, 'regular');
  }
});

test('GET /dashboards/workplace-analysis renders at least ten point cards when data is available', async () => {
  const workplaceRows = Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;

    return {
      workplace_id: `wp${number}`,
      workplace_title: `Point ${number}`,
      technical_name: `tech-${number}`,
      client_title: `Brand ${number}`,
      city: 'Moscow',
      region: 'Moscow',
      street: `Street ${number}`,
      total_ordered_shifts: 30 - index,
      active_days: 2
    };
  });
  const dailyRows = workplaceRows.flatMap((row, index) => [
    { workplace_id: row.workplace_id, order_date: '2026-06-01', ordered_shifts: 10 - (index % 3) },
    { workplace_id: row.workplace_id, order_date: '2026-06-03', ordered_shifts: 5 - (index % 2) }
  ]);
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);

      if (operation === 'workplace analysis top workplaces') {
        return workplaceRows;
      }

      if (operation === 'workplace analysis daily orders') {
        return dailyRows;
      }

      return [];
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis?from=2026-06-01&to=2026-06-03&limit=12'
    );

    assert.equal(response.status, 200);
    assert.equal(countOccurrences(text, '<article class="point-card">'), 12);
    assert.equal(countOccurrences(text, '<div class="heatmap" aria-label='), 12);
    assert.doesNotMatch(text, /empty-state/);
  });
});

test('GET /dashboards/workplace-analysis keeps navigation active on trailing slash route errors', async () => {
  const client = createFakeClient();

  client.queryJSONEachRow = async (query, params, operation) => {
    client.calls.push(['queryJSONEachRow', operation, params]);
    throw new Error('ClickHouse rejected password super-secret');
  };

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/workplace-analysis/');

    assert.equal(response.status, 502);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.match(text, /class="nav-link active" href="\/dashboards\/workplace-analysis"/);
    assert.doesNotMatch(text, /super-secret/);
  });
});

test('activeNavForPath normalizes dashboard trailing slashes', () => {
  assert.equal(activeNavForPath('/dashboards/workplace-analysis/'), 'workplace-analysis');
  assert.equal(activeNavForPath('/dashboards/sales-by-project/'), 'sales-by-project');
  assert.equal(activeNavForPath('/'), 'tables');
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

test('GET /tables with duplicate names returns 400 without querying metadata', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/tables?name=events&name=orders');

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

test('GET /tables/:tableName redirects to query route', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response } = await fetchText(baseUrl, '/tables/events', {
      redirect: 'manual'
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/tables?name=events');
  });

  assert.deepEqual(client.calls, []);
});

test('malformed encoded table paths preserve Express 400 errors with sanitized HTML', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/tables/%E0%A4%A');

    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Bad Request/);
    assert.doesNotMatch(text, /super-secret/);
  });

  assert.deepEqual(client.calls, []);
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

test('start uses injectable dependencies and logs the listening port without secrets', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    }
  };
  const clientConfigs = [];
  const logMessages = [];
  let createAppArgs;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
      clientConfigs.push(clickhouseConfig);
    }
  }

  const server = start({
    loadConfigFn: () => config,
    ClientClass: FakeClient,
    createAppFn: (args) => {
      createAppArgs = args;

      return http.createServer((req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.end('started');
      });
    },
    logger: {
      log(message) {
        logMessages.push(message);
      }
    }
  });

  try {
    await waitForListening(server);

    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const text = await response.text();

    assert.equal(text, 'started');
    assert.deepEqual(clientConfigs, [config.clickhouse]);
    assert.equal(createAppArgs.config, config);
    assert.ok(createAppArgs.client instanceof FakeClient);
    assert.equal(logMessages.length, 1);
    assert.match(logMessages[0], new RegExp(`port ${port}`));
    assert.doesNotMatch(logMessages[0], /super-secret/);
  } finally {
    await closeServer(server);
  }
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
