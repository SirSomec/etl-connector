const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  activeNavForPath,
  createApp,
  millisecondsUntilNextUtcDay,
  sanitizeForResponse,
  scheduleDailyCacheCleanup,
  start
} = require('../src/server');

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

      if (operation === 'workplace analysis filter options') {
        return [
          { filter: 'client', value: 'Бренд' },
          { filter: 'city', value: 'Москва' },
          { filter: 'city', value: 'Казань' },
          { filter: 'region', value: 'Москва' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'orderType', value: 'once' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'jobStatus', value: 'failed' },
          { filter: 'contractor', value: 'Ромашка' }
        ];
      }

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 1 }];
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

      if (operation === 'workplace directory refresh') {
        return [
          {
            workplace_id: 'wp-lenina-10',
            workplace_title: 'Северный хаб',
            technical_name: 'north-hub',
            client_title: 'Бренд',
            region: 'Москва',
            city: 'Москва',
            street: 'Ленина 10'
          },
          {
            workplace_id: 'wp-tverskaya',
            workplace_title: 'Южная точка',
            technical_name: 'south-point',
            client_title: 'Бренд',
            region: 'Москва',
            city: 'Москва',
            street: 'Тверская 1'
          }
        ];
      }

      if (operation === 'city analysis city options') {
        return [{ city: 'Москва' }, { city: 'Казань' }];
      }

      if (operation === 'city analysis filter options') {
        return [
          { filter: 'client', value: 'Brand A' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'contractor', value: 'ООО Ромашка' }
        ];
      }

      if (operation === 'city analysis city coordinates') {
        return [{ workplace_id: 'wp1' }];
      }

      if (operation === 'city analysis summary') {
        return [
          {
            ordered_shifts: 50,
            active_order_requests: 10,
            total_located_users: 120,
            ready_located_users: 80,
            app_active_users: 35,
            booked_users: 14,
            completed_users: 9,
            avg_daily_30d_active_users_per_request: 2.5
          }
        ];
      }

      if (operation === 'city analysis summary demand') {
        return [{ ordered_shifts: 50, active_order_requests: 10 }];
      }

      if (operation === 'city analysis summary base') {
        return [
          {
            total_located_users: 120,
            ready_located_users: 80,
            ready_status_located_users: 20,
            booked_status_located_users: 30,
            worked_status_located_users: 30
          }
        ];
      }

      if (operation === 'city analysis summary app') {
        return [{ app_active_users: 35 }];
      }

      if (operation === 'city analysis summary responses') {
        return [{ booked_users: 14, completed_users: 9 }];
      }

      if (operation === 'city analysis summary ratio') {
        return [{ avg_daily_30d_active_users_per_request: 2.5 }];
      }

      if (operation === 'city analysis brands') {
        return [{ label: 'Brand A', ordered_shifts: 50 }];
      }

      if (operation === 'city analysis professions') {
        return [{ label: 'Комплектовщик', ordered_shifts: 50 }];
      }

      if (operation === 'city analysis rate buckets') {
        return [{ label: '250-350', ordered_shifts: 50, avg_salary_per_hour: 300 }];
      }

      if (operation === 'city analysis dynamics') {
        return [
          {
            period: '2026-06-01',
            ordered_shifts: 20,
            app_active_users: 12,
            booked_users: 7,
            completed_users: 4,
            active_users_per_request: 2
          }
        ];
      }

      if (operation === 'heatmap filter options') {
        return [
          { filter: 'client', value: 'Brand A' },
          { filter: 'profession', value: 'Курьер' }
        ];
      }

      if (operation === 'heatmap demand points') {
        return [
          {
            region: 'Москва',
            city: 'Москва',
            street: 'Тверская',
            workplace_id: 'workplace-1',
            workplace_title: 'Точка 1',
            ordered_shifts: 100,
            order_requests: 25,
            lon: 37.6,
            lat: 55.7,
            weighted_active_users: 30,
            active_users_5km: 20,
            active_users_10km: 12,
            active_users_15km: 8
          }
        ];
      }

      if (operation === 'worker cancellations total workers') {
        return [{ total_workers: 1 }];
      }

      if (operation === 'worker cancellations workers') {
        return [
          {
            worker_id: 'worker-1',
            full_name: 'Иван Петров',
            phone: '+79990000000',
            city: 'Москва',
            confirmed_shifts: 10,
            worker_cancellations: 3,
            worker_cancellations_24h: 2,
            post_start_cancellations: 1,
            failed_shifts: 4
          }
        ];
      }

      if (operation === 'worker cancellations detail shifts') {
        return [
          {
            shift_id: 'job-1',
            brand: 'Brand A',
            address: 'Moscow, Lenina, 10',
            planned_start: '2026-05-12 09:00:00',
            booked_at: '2026-05-10 15:30:00',
            cancelled_at: '2026-05-11 18:00:00',
            cancelled_by: 'worker'
          }
        ];
      }

      return [];
    }
  };

  return Object.assign(client, overrides);
}

function createFakePreloadService(overrides = {}) {
  const calls = [];
  const service = {
    calls,
    getOverview() {
      calls.push(['getOverview']);
      return {
        coveredFrom: '2026-05-01',
        coveredTo: '2026-06-04',
        lastSuccessAt: '',
        lastError: ''
      };
    },
    getDiagnostics() {
      calls.push(['getDiagnostics']);
      return {
        salesByProject: {
          coverage: {
            minDate: '2026-05-01',
            maxDate: '2026-06-03',
            days: 3
          },
          tables: {
            dailyRows: 7,
            orderFacts: 11,
            shiftFacts: 13
          },
          lastRuns: []
        }
      };
    },
    getJob() {
      calls.push(['getJob']);
      return {
        id: 'sales-by-project',
        enabled: true,
        scheduleTime: '03:00',
        timezone: 'Europe/Moscow',
        refreshDays: 45
      };
    },
    listRuns() {
      calls.push(['listRuns']);
      return [];
    },
    saveSchedule(input) {
      calls.push(['saveSchedule', input]);
      return { id: 'sales-by-project', ...input };
    },
    async runSalesByProject(input) {
      calls.push(['runSalesByProject', input]);
      return { status: 'success', rowsWritten: 1 };
    },
    close() {}
  };

  return Object.assign(service, overrides);
}

async function withServer(client, callback, config = baseConfig(), options = {}) {
  const app = createApp({ config, client, ...options });
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

function formBody(values) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    const valuesList = Array.isArray(value) ? value : [value];

    for (const item of valuesList) {
      params.append(key, item);
    }
  }

  return params.toString();
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function flushMicrotasks() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test('millisecondsUntilNextUtcDay returns delay to next UTC midnight', () => {
  assert.equal(
    millisecondsUntilNextUtcDay(new Date('2026-06-15T10:00:00.000Z')),
    14 * 60 * 60 * 1000
  );
  assert.equal(millisecondsUntilNextUtcDay(new Date('2026-06-15T23:59:59.999Z')), 1);
});

test('scheduleDailyCacheCleanup prunes caches on start and schedules UTC midnight cleanup', async () => {
  let nowValue = new Date('2026-06-15T10:00:00.000Z');
  const pruneCalls = [];
  const timers = [];
  const clearedTimers = [];
  const cleanup = scheduleDailyCacheCleanup({
    caches: [
      {
        async pruneExpired(current) {
          pruneCalls.push(current.toISOString());
        }
      }
    ],
    now: () => nowValue,
    setTimeoutFn(callback, delay) {
      const timer = {
        callback,
        delay,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        }
      };

      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      clearedTimers.push(timer);
    },
    logger: {
      warn() {}
    }
  });

  await flushMicrotasks();

  assert.deepEqual(pruneCalls, ['2026-06-15T10:00:00.000Z']);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 14 * 60 * 60 * 1000);
  assert.equal(timers[0].unrefCalled, true);

  nowValue = new Date('2026-06-16T00:00:00.000Z');
  await timers[0].callback();

  assert.deepEqual(pruneCalls, ['2026-06-15T10:00:00.000Z', '2026-06-16T00:00:00.000Z']);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 24 * 60 * 60 * 1000);

  cleanup.stop();

  assert.deepEqual(clearedTimers, [timers[1]]);
});

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
    assert.match(text, /Загружается/);
    assert.match(text, /\/dashboards\/sales-by-project\/section\?section=summary/);
    assert.match(text, /\/dashboards\/sales-by-project\/section\?section=trend/);
  });

  assert.equal(client.calls.filter((call) => call[0] === 'queryJSONEachRow').length, 0);
});

test('GET /dashboards/sales-by-project/section renders cached dashboard fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const path =
      '/dashboards/sales-by-project/section?section=summary&period=month&from=2026-04-01&to=2026-04-30';
    const first = await fetchText(baseUrl, path);
    const second = await fetchText(baseUrl, path);

    assert.equal(first.response.status, 200);
    assert.match(first.response.headers.get('content-type'), /^text\/html\b/);
    assert.match(first.text, /kpi-card/);
    assert.match(first.text, /10/);
    assert.doesNotMatch(first.text, /<html/);
    assert.equal(second.response.status, 200);
  });

  const salesCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('sales by project')
  );

  assert.deepEqual(salesCalls.map((call) => call[1]), [
    'sales by project orders summary',
    'sales by project shifts summary'
  ]);
  assert.equal(salesCalls[0][2].param_from, '2026-04-01 00:00:00');
  assert.equal(salesCalls[0][2].param_to, '2026-05-01 00:00:00');
});

test('GET /dashboards/sales-by-project/section renders preload dashboard fragment', async () => {
  const client = createFakeClient();
  const preloadService = createFakePreloadService();

  preloadService.readSalesByProjectSectionRows = async (input) => {
    preloadService.calls.push(['readSalesByProjectSectionRows', input]);

    return {
      orderSummaryRows: [
        {
          ordered_shifts: 10,
          workplaces_with_orders: 3
        }
      ],
      shiftSummaryRows: [
        {
          worked_shifts: 8,
          revenue_rub: 12000,
          unique_workers: 5,
          workplaces_with_worked_shifts: 2,
          cancelled_shifts: 1,
          self_booked_confirmed_shifts: 4,
          avg_worker_rate_hour: 300
        }
      ]
    };
  };

  await withServer(
    client,
    async (baseUrl) => {
      const { response, text } = await fetchText(
        baseUrl,
        '/dashboards/sales-by-project/section?section=summary&period=month&from=2026-04-01&to=2026-04-30'
      );

      assert.equal(response.status, 200);
      assert.match(text, /Источник: витрина/);
      assert.match(text, /10/);
    },
    baseConfig(),
    { preloadService }
  );

  const salesCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('sales by project')
  );

  assert.deepEqual(preloadService.calls, [
    [
      'readSalesByProjectSectionRows',
      {
        section: 'summary',
        period: 'month',
        fromDate: '2026-04-01',
        toDate: '2026-05-01'
      }
    ]
  ]);
  assert.equal(salesCalls.length, 0);
});

test('GET /dashboards/sales-by-project/section redacts upstream errors in fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      throw new Error(`${operation} failed with password super-secret`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/sales-by-project/section?section=summary'
    );

    assert.equal(response.status, 502);
    assert.match(text, /sales by project orders summary failed with password \[redacted\]/);
    assert.doesNotMatch(text, /super-secret/);
    assert.doesNotMatch(text, /<html/);
  });
});

test('GET /dashboards/workplace-analysis renders dashboard with query filters', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis?from=2026-06-01&to=2026-06-03&city=Москва&city=Казань&orderType=regular&orderType=once&jobStatus=confirmed&jobStatus=failed'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Анализ точек/);
    assert.match(text, /Загружается/);
    assert.match(text, /\/dashboards\/workplace-analysis\/section\?section=points/);
    assert.match(text, /data-workplace-suggest-url="\/dashboards\/workplace-analysis\/workplaces\/suggest"/);
    assert.match(text, /<datalist id="workplace-search-suggestions"><\/datalist>/);
    assert.doesNotMatch(text, /<article class="point-card"/);
  });

  const optionCalls = client.calls.filter((call) => call[1] === 'workplace analysis filter options');
  const workplaceCalls = client.calls.filter(
    (call) =>
      call[0] === 'queryJSONEachRow' &&
      String(call[1]).startsWith('workplace analysis') &&
      call[1] !== 'workplace analysis filter options'
  );

  assert.equal(optionCalls.length, 1);
  assert.equal(optionCalls[0][2].param_from, '2026-06-01 00:00:00');
  assert.equal(optionCalls[0][2].param_to, '2026-06-04 00:00:00');
  assert.equal(Object.prototype.hasOwnProperty.call(optionCalls[0][2], 'param_cities'), false);
  assert.equal(workplaceCalls.length, 0);
});

test('GET /dashboards/workplace-analysis/workplaces/suggest returns cached point suggestions', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const shortQuery = await fetchText(baseUrl, '/dashboards/workplace-analysis/workplaces/suggest?q=Лени');
    assert.equal(shortQuery.response.status, 200);
    assert.deepEqual(JSON.parse(shortQuery.text), { suggestions: [] });

    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/workplaces/suggest?q=Ленин'
    );
    const body = JSON.parse(text);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json\b/);
    assert.deepEqual(body.suggestions.map((item) => item.workplaceId), ['wp-lenina-10']);
    assert.equal(body.suggestions[0].title, 'Северный хаб');
    assert.equal(body.suggestions[0].address, 'Москва, Москва, Ленина 10');
  });

  const directoryCalls = client.calls.filter((call) => call[1] === 'workplace directory refresh');

  assert.equal(directoryCalls.length, 1);
});

test('GET /dashboards/workplace-analysis/section renders at least ten point cards when data is available', async () => {
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

      if (operation === 'workplace analysis filter options') {
        return [];
      }

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
      '/dashboards/workplace-analysis/section?section=points&from=2026-06-01&to=2026-06-03&limit=12'
    );

    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /<html/);
    assert.equal(countOccurrences(text, '<article class="point-card">'), 12);
    assert.equal(countOccurrences(text, '<div class="heatmap" aria-label='), 12);
    assert.doesNotMatch(text, /empty-state/);
  });
});

test('GET /dashboards/workplace-analysis/section renders attention fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params, query]);

      if (operation === 'workplace analysis attention points') {
        return [
          {
            workplace_id: 'wp-attention',
            workplace_title: 'Attention point',
            client_title: 'Brand',
            city: 'Moscow',
            street: 'Street 1',
            ordered_7d: 12,
            covered_7d: 5,
            free_7d: 7,
            max_daily_free: 4,
            days_with_free: 2,
            nearest_free_date: '2026-06-04',
            total_workers_15km: 18,
            active_workers_30d_15km: 6,
            active_status_ready: 4,
            active_status_booked: 1,
            active_status_worked: 1
          }
        ];
      }

      return [];
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/section?section=attention&client=Brand'
    );

    assert.equal(response.status, 200);
    assert.doesNotMatch(text, /<html/);
    assert.match(text, /Точки, требующие внимания/);
    assert.match(text, /Attention point/);
    assert.match(text, /Своб\. 7д/);
    assert.match(text, /class="attention-status-line">ready [\s\S]*>4<\/button><\/span>/);
    assert.match(text, /class="attention-status-line">booked [\s\S]*>1<\/button><\/span>/);
    assert.match(text, /class="attention-status-line">worked [\s\S]*>1<\/button><\/span>/);
  });

  const attentionCall = client.calls.find((call) => call[1] === 'workplace analysis attention points');

  assert.ok(attentionCall);
  assert.equal(attentionCall[2].param_clients, "['Brand']");
  assert.equal(attentionCall[3].includes("ifNull(j.status, '') IN ('booked', 'going', 'inprogress', 'checkingin', 'checkingout', 'completed', 'delayed', 'waiting')"), true);
  assert.equal(attentionCall[3].includes("ifNull(j.status, '') = 'confirmed'"), true);
  assert.equal(attentionCall[3].includes("dateDiff('minute', j.start_fact, j.finish_fact) > 0"), true);
});

test('GET /dashboards/workplace-analysis/point renders point detail page', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params, query]);

      if (operation === 'workplace point metadata') {
        return [{ workplace_id: 'wp1', workplace_title: 'Point 1', client_title: 'Brand' }];
      }

      if (operation === 'workplace point filter options') {
        return [
          { filter: 'profession', value: 'picker' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' }
        ];
      }

      if (operation === 'workplace point summary') {
        return [
          {
            ordered_shifts: 10,
            completed_shifts: 8,
            active_days: 2,
            unique_completed_workers: 4,
            unique_booked_workers: 6,
            dropoffs_24h: 1
          }
        ];
      }

      if (operation === 'workplace point daily') {
        return [{ period: '2026-06-01', ordered_shifts: 10, completed_shifts: 8, dropoffs_24h: 1 }];
      }

      if (operation === 'workplace point professions') {
        return [{ profession: 'picker', ordered_shifts: 10 }];
      }

      if (operation === 'workplace point radius workers') {
        return [{ radius_km: 5, workers: 12 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/point?workplaceId=wp1&from=2026-06-01&to=2026-06-30&profession=picker&orderType=regular&jobStatus=confirmed'
    );

    assert.equal(response.status, 200);
    assert.match(text, /Детализация точки/);
    assert.match(text, /Point 1/);
    assert.match(text, /Загружается/);
    assert.match(text, /\/dashboards\/workplace-analysis\/point\/section\?section=summary/);
    assert.doesNotMatch(text, /Уникальные завершали/);
    assert.match(text, /class="nav-link active" href="\/dashboards\/workplace-analysis"/);
  });

  const pointCalls = client.calls.filter((call) =>
    call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace point')
  );

  assert.equal(pointCalls.length, 2);
  for (const call of pointCalls) {
    assert.equal(call[2].param_workplace_id, 'wp1');
    assert.equal(call[2].param_from, '2026-06-01 00:00:00');
    assert.equal(call[2].param_to, '2026-07-01 00:00:00');
  }
});

test('GET /dashboards/workplace-analysis/point/section renders cached point summary fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params, query]);

      if (operation === 'workplace point summary') {
        return [
          {
            ordered_shifts: 10,
            completed_shifts: 8,
            active_days: 2,
            unique_completed_workers: 4,
            unique_booked_workers: 6,
            dropoffs_24h: 1
          }
        ];
      }

      if (operation === 'workplace point review summary') {
        return [{ review_count: 5, avg_rating_all: 4.5, avg_rating_last_10: 4.7 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const path =
      '/dashboards/workplace-analysis/point/section?section=summary&workplaceId=wp1&from=2026-06-01&to=2026-06-30';
    const first = await fetchText(baseUrl, path);
    const second = await fetchText(baseUrl, path);

    assert.equal(first.response.status, 200);
    assert.match(first.response.headers.get('content-type'), /^text\/html\b/);
    assert.match(first.text, /Уникальные завершали/);
    assert.match(first.text, /Рейтинг точки/);
    assert.match(first.text, /10/);
    assert.doesNotMatch(first.text, /<html/);
    assert.equal(second.response.status, 200);
  });

  const pointCalls = client.calls.filter((call) =>
    call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace point')
  );

  assert.deepEqual(pointCalls.map((call) => call[1]), [
    'workplace point summary',
    'workplace point review summary'
  ]);
});

test('GET /dashboards/workplace-analysis/point/details renders day details fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params, query]);

      if (operation === 'workplace point day orders') {
        return [
          {
            order_id: 'order-1',
            profession: 'Комплектовщик',
            order_start_local: '2026-06-02 09:00:00',
            planned_hours: 8
          }
        ];
      }

      if (operation === 'workplace point day jobs') {
        return [
          {
            order_id: 'order-1',
            job_id: 'job-1',
            status: 'confirmed',
            worker_id: 'worker-1',
            actual_hours: 7.5,
            actual_time_local: '2026-06-02 09:10 - 2026-06-02 16:40',
            is_factual: 1
          }
        ];
      }

      if (operation === 'workplace point day workers') {
        return [
          {
            worker_id: 'worker-1',
            worker_full_name: 'Иванов Иван',
            worker_phone: '+79990000000'
          }
        ];
      }

      if (operation === 'workplace point day payments') {
        return [
          {
            job_id: 'job-1',
            payment_amount: 4500
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/point/details?workplaceId=wp1&date=2026-06-02&profession=Комплектовщик&orderType=regular&jobStatus=confirmed'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Детализация дня: 2026-06-02/);
    assert.match(text, /Иванов Иван/);
    assert.match(text, /\+79990000000/);
    assert.doesNotMatch(text, /<html/);
  });

  const calls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace point day')
  );

  assert.deepEqual(calls.map((call) => call[1]), [
    'workplace point day orders',
    'workplace point day jobs',
    'workplace point day workers',
    'workplace point day payments'
  ]);
  assert.equal(calls[0][2].param_workplace_id, 'wp1');
  assert.equal(calls[0][2].param_from, '2026-06-02 00:00:00');
  assert.equal(calls[0][2].param_to, '2026-06-03 00:00:00');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][2], 'param_job_statuses'), false);
  assert.equal(calls[1][2].param_job_statuses, "['confirmed','completed']");
});

test('GET /dashboards/workplace-analysis/point/details renders bad request as fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/point/details?workplaceId=wp1&date=bad'
    );

    assert.equal(response.status, 400);
    assert.match(text, /date/);
    assert.doesNotMatch(text, /<html/);
  });
});

test('GET /dashboards/workplace-analysis/point/reviews renders point reviews fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params, query]);

      if (operation === 'workplace point reviews') {
        return [
          {
            review_id: 'review-1',
            job_id: 'job-1',
            rating: 5,
            text: 'Хорошая точка',
            author_full_name: 'Иван Иванов',
            author_phone: '+79990000000',
            created_at_local: '2026-06-05 12:00:00'
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/point/reviews?workplaceId=wp1'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Отзывы точки/);
    assert.match(text, /Иван Иванов/);
    assert.match(text, /\+79990000000/);
    assert.match(text, /05\.06\.2026 12:00/);
    assert.doesNotMatch(text, /<html/);
  });

  const calls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace point reviews')
  );

  assert.deepEqual(calls.map((call) => call[1]), ['workplace point reviews']);
  assert.equal(calls[0][2].param_workplace_id, 'wp1');
  assert.equal(calls[0][3].includes('ORDER BY r.createdAt DESC, r._id DESC'), true);
});

test('GET /dashboards/workplace-analysis/gigers renders giger details fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params, query]);

      if (operation === 'workplace analysis giger details total') {
        return [{ total_gigers: 21 }];
      }

      if (operation === 'workplace analysis giger details') {
        return [
          {
            user_id: 'user-1',
            worker_id: 'worker-1',
            full_name: 'Ivan Petrov',
            phone: '+79990000000',
            status: 'ready'
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/gigers?workplaceId=wp1&metric=points-active-gigers-5km&page=1'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Ivan Petrov/);
    assert.match(text, /\+79990000000/);
    assert.match(text, /data-giger-list-page-link/);
    assert.match(text, /\/dashboards\/workplace-analysis\/gigers\/export\?/);
    assert.doesNotMatch(text, /<html/);
  });

  const calls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace analysis giger')
  );

  assert.deepEqual(calls.map((call) => call[1]), [
    'workplace analysis giger details total',
    'workplace analysis giger details'
  ]);
  assert.equal(calls[0][2].param_workplace_id, 'wp1');
  assert.equal(calls[1][2].param_limit, 20);
});

test('GET /dashboards/city-analysis/gigers/export downloads excel-compatible giger list', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params, query]);

      if (operation === 'city analysis giger details total') {
        return [{ total_gigers: 1 }];
      }

      if (operation === 'city analysis giger details') {
        return [
          {
            user_id: 'user-1',
            worker_id: 'worker-1',
            full_name: 'Ivan Petrov',
            phone: '+79990000000',
            status: 'worked'
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/city-analysis/gigers/export?city=Moscow&metric=total-located-users'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/vnd\.ms-excel\b/);
    assert.match(response.headers.get('content-disposition'), /attachment; filename="city-analysis-gigers\.xls"/);
    assert.match(text, /Ivan Petrov/);
    assert.match(text, /\+79990000000/);
    assert.match(text, /<table>/);
  });

  const detailsCall = client.calls.find((call) => call[1] === 'city analysis giger details');

  assert.equal(detailsCall[2].param_city, 'Moscow');
  assert.equal(detailsCall[2].param_limit, 20);
});

test('GET /dashboards/workplace-analysis/point/gigers renders point detail giger fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params, query]);

      if (operation === 'workplace point giger details total') {
        return [{ total_gigers: 1 }];
      }

      if (operation === 'workplace point giger details') {
        return [
          {
            user_id: 'user-1',
            worker_id: 'worker-1',
            full_name: 'Ivan Petrov',
            phone: '+79990000000',
            status: 'booked'
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/point/gigers?workplaceId=wp1&metric=unique-completed-workers&page=1'
    );

    assert.equal(response.status, 200);
    assert.match(text, /Ivan Petrov/);
    assert.match(text, /\/dashboards\/workplace-analysis\/point\/gigers\/export\?/);
    assert.doesNotMatch(text, /<html/);
  });

  const calls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace point giger')
  );

  assert.deepEqual(calls.map((call) => call[1]), [
    'workplace point giger details total',
    'workplace point giger details'
  ]);
  assert.equal(calls[1][2].param_workplace_id, 'wp1');
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

test('GET /dashboards/city-analysis renders dashboard with query filters', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/city-analysis?from=2026-06-01&to=2026-06-03&city=Москва&client=Brand%20A&profession=Комплектовщик&orderType=regular&jobStatus=confirmed&contractor=ООО%20Ромашка&salaryFrom=250&salaryTo=450'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Анализ городов/);
    assert.match(text, /Баланс спроса и базы/);
    assert.match(text, /Общая база/);
  });

  const cityCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('city analysis')
  );

  assert.deepEqual(cityCalls.map((call) => call[1]), [
    'city analysis city options',
    'city analysis filter options'
  ]);

  const filterOptionsCall = cityCalls[1];

  assert.equal(filterOptionsCall[2].param_from, '2026-06-01 00:00:00');
  assert.equal(filterOptionsCall[2].param_to, '2026-06-04 00:00:00');
  assert.equal(filterOptionsCall[2].param_city, 'Москва');
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall[2], 'param_clients'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall[2], 'param_professions'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall[2], 'param_order_types'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall[2], 'param_job_statuses'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall[2], 'param_contractors'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall[2], 'param_salary_from'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall[2], 'param_salary_to'), false);

  for (const call of cityCalls.slice(2)) {
    assert.equal(call[2].param_from, '2026-06-01 00:00:00');
    assert.equal(call[2].param_to, '2026-06-04 00:00:00');
    assert.equal(call[2].param_city, 'Москва');
    assert.equal(call[2].param_clients, "['Brand A']");
    assert.equal(call[2].param_professions, "['Комплектовщик']");
    assert.equal(call[2].param_order_types, "['regular']");
    assert.equal(call[2].param_job_statuses, "['confirmed']");
    assert.equal(call[2].param_contractors, "['ООО Ромашка']");
    assert.equal(call[2].param_salary_from, 250);
    assert.equal(call[2].param_salary_to, 450);
  }
});

test('GET /dashboards/city-analysis/section renders cached city dashboard fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const path =
      '/dashboards/city-analysis/section?section=summary-demand&from=2026-06-01&to=2026-06-03&city=РњРѕСЃРєРІР°&client=Brand%20A';
    const first = await fetchText(baseUrl, path);
    const second = await fetchText(baseUrl, path);

    assert.equal(first.response.status, 200);
    assert.match(first.response.headers.get('content-type'), /^text\/html\b/);
    assert.match(first.text, /kpi-card/);
    assert.match(first.text, /50/);
    assert.doesNotMatch(first.text, /<html/);
    assert.equal(second.response.status, 200);
  });

  const cityCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('city analysis')
  );

  assert.deepEqual(cityCalls.map((call) => call[1]), ['city analysis summary demand']);
  assert.equal(cityCalls[0][2].param_from, '2026-06-01 00:00:00');
  assert.equal(cityCalls[0][2].param_to, '2026-06-04 00:00:00');
  assert.equal(cityCalls[0][2].param_city, 'РњРѕСЃРєРІР°');
  assert.equal(cityCalls[0][2].param_clients, "['Brand A']");
});

test('GET /dashboards/city-analysis/section redacts upstream errors in fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);
      throw new Error('ClickHouse rejected password super-secret');
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/city-analysis/section?section=summary-demand&city=РњРѕСЃРєРІР°'
    );

    assert.equal(response.status, 502);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.doesNotMatch(text, /super-secret/);
    assert.doesNotMatch(text, /<html/);
  });
});

test('GET /dashboards/city-analysis keeps navigation active and redacts upstream errors', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);
      throw new Error('ClickHouse rejected password super-secret');
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/city-analysis?city=Москва');

    assert.equal(response.status, 502);
    assert.match(text, /Upstream Error/);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.match(text, /class="nav-link active" href="\/dashboards\/city-analysis"/);
    assert.doesNotMatch(text, /super-secret/);
  });
});

test('GET /dashboards/heatmap renders dashboard with query filters', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/heatmap?year=2026&month=5&client=Brand%20A&excludedProfession=Курьер&addressSearch=Тверская&activeBaseMode=ready&activeBasePeriod=selected'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Тепловая карта/);
    assert.match(text, /data-dashboard-fragment-url="\/dashboards\/heatmap\/section\?section=map/);
    assert.match(text, /addressSearch=%D0%A2%D0%B2%D0%B5%D1%80%D1%81%D0%BA%D0%B0%D1%8F/);
    assert.match(text, /activeBasePeriod=selected/);
    assert.match(text, /Загружается/);
    assert.doesNotMatch(text, /class="country-heatmap-map" data-heatmap-leaflet-map/);
  });

  const heatmapCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('heatmap')
  );

  assert.deepEqual(heatmapCalls.map((call) => call[1]), ['heatmap filter options']);
  assert.equal(heatmapCalls[0][2].param_from, '2026-05-01 00:00:00');
  assert.equal(heatmapCalls[0][2].param_to, '2026-06-01 00:00:00');
  assert.equal(Object.prototype.hasOwnProperty.call(heatmapCalls[0][2], 'param_clients'), false);
});

test('GET /dashboards/heatmap/section renders cached heatmap fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const path =
      '/dashboards/heatmap/section?section=map&year=2026&month=5&client=Brand%20A&excludedProfession=Курьер&addressSearch=Тверская&activeBaseMode=ready&activeBasePeriod=selected';
    const first = await fetchText(baseUrl, path);
    const second = await fetchText(baseUrl, path);

    assert.equal(first.response.status, 200);
    assert.match(first.response.headers.get('content-type'), /^text\/html\b/);
    assert.match(first.text, /data-heatmap-leaflet-map/);
    assert.match(first.text, /tile\.openstreetmap\.org/);
    assert.match(first.text, /Москва/);
    assert.doesNotMatch(first.text, /<h2>Точки заказа<\/h2>/);
    assert.doesNotMatch(first.text, /<table>/);
    assert.doesNotMatch(first.text, /<html/);
    assert.equal(second.response.status, 200);
  });

  const heatmapCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('heatmap')
  );

  assert.deepEqual(heatmapCalls.map((call) => call[1]), ['heatmap demand points']);
  assert.equal(heatmapCalls[0][2].param_clients, "['Brand A']");
  assert.equal(heatmapCalls[0][2].param_excluded_professions, "['Курьер']");
  assert.equal(heatmapCalls[0][2].param_address_search, 'Тверская');
  assert.equal(heatmapCalls[0][2].param_active_from, '2026-05-01 00:00:00');
  assert.equal(heatmapCalls[0][2].param_active_to, '2026-06-01 00:00:00');
});

test('GET /dashboards/heatmap/section redacts upstream errors in fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);
      throw new Error('ClickHouse rejected password super-secret');
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/heatmap/section?section=map');

    assert.equal(response.status, 502);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.doesNotMatch(text, /super-secret/);
    assert.doesNotMatch(text, /<html/);
  });
});

test('GET /dashboards/heatmap keeps navigation active and redacts upstream errors', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);
      throw new Error('ClickHouse rejected password super-secret');
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/heatmap');

    assert.equal(response.status, 502);
    assert.match(text, /Upstream Error/);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.match(text, /class="nav-link active" href="\/dashboards\/heatmap"/);
    assert.doesNotMatch(text, /super-secret/);
  });
});

test('GET /dashboards/worker-cancellations renders dashboard shell without heavy query', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-cancellations?from=2026-05-01&to=2026-05-31&page=2&pageSize=200&sort=failedShifts&direction=asc'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Отмены гигерами/);
    assert.match(text, /Загружается/);
    assert.match(
      text,
      /data-dashboard-fragment-url="\/dashboards\/worker-cancellations\/section\?section=workers/
    );
    assert.match(text, /pageSize=200/);
    assert.match(text, /sort=failedShifts/);
    assert.match(text, /direction=asc/);
  });

  const workerCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('worker cancellations')
  );

  assert.equal(workerCalls.length, 0);
});

test('GET /dashboards/worker-cancellations/section renders cached workers fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const path =
      '/dashboards/worker-cancellations/section?section=workers&from=2026-05-01&to=2026-05-31&pageSize=50&sort=workerCancellations&direction=desc';
    const first = await fetchText(baseUrl, path);
    const second = await fetchText(baseUrl, path);

    assert.equal(first.response.status, 200);
    assert.match(first.response.headers.get('content-type'), /^text\/html\b/);
    assert.match(first.text, /Иван Петров/);
    assert.match(first.text, /\+79990000000/);
    assert.match(first.text, /Отмены worker/);
    assert.match(first.text, /Провалы \/ failed/);
    assert.doesNotMatch(first.text, /<html/);
    assert.equal(second.response.status, 200);
  });

  const workerCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('worker cancellations')
  );

  assert.deepEqual(workerCalls.map((call) => call[1]), [
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);

  for (const call of workerCalls) {
    assert.equal(call[2].param_from, '2026-05-01 00:00:00');
    assert.equal(call[2].param_to, '2026-06-01 00:00:00');
  }
});

test('GET /dashboards/worker-cancellations/section passes search and numeric ranges to data query', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-cancellations/section?section=workers&from=2026-05-01&to=2026-05-31&pageSize=50&sort=workerCancellations&direction=desc&search=user-1&confirmedShiftsFrom=5&workerCancellationsTo=4&failedShiftsFrom=1'
    );

    assert.equal(response.status, 200);
    assert.match(text, /\+79990000000/);
    assert.doesNotMatch(text, /<html/);
  });

  const workerCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('worker cancellations')
  );

  assert.equal(workerCalls.length, 2);

  for (const call of workerCalls) {
    assert.equal(call[2].param_search, 'user-1');
    assert.equal(call[2].param_confirmed_shifts_from, 5);
    assert.equal(call[2].param_worker_cancellations_to, 4);
    assert.equal(call[2].param_failed_shifts_from, 1);
  }
});

test('GET /dashboards/worker-cancellations/details renders selected metric fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-cancellations/details?from=2026-05-01&to=2026-05-31&workerId=worker-1&metric=workerCancellations'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Детализация: Отмены worker/);
    assert.match(text, /Brand A/);
    assert.match(text, /Moscow, Lenina, 10/);
    assert.match(text, /12\.05\.2026 09:00/);
    assert.match(text, /10\.05\.2026 15:30/);
    assert.match(text, /11\.05\.2026 18:00/);
    assert.doesNotMatch(text, /<html/);
  });

  const detailCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && call[1] === 'worker cancellations detail shifts'
  );

  assert.equal(detailCalls.length, 1);
  assert.equal(detailCalls[0][2].param_from, '2026-05-01 00:00:00');
  assert.equal(detailCalls[0][2].param_to, '2026-06-01 00:00:00');
  assert.equal(detailCalls[0][2].param_worker_id, 'worker-1');
  assert.equal(detailCalls[0][2].param_limit, 500);
});

test('GET /dashboards/worker-cancellations/details rejects unknown metric as fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-cancellations/details?workerId=worker-1&metric=bad'
    );

    assert.equal(response.status, 400);
    assert.match(text, /Unknown worker cancellation metric: bad/);
    assert.doesNotMatch(text, /<html/);
  });
});

test('GET /dashboards/worker-cancellations/section redacts upstream errors in fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);
      throw new Error('ClickHouse rejected password super-secret');
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-cancellations/section?section=workers'
    );

    assert.equal(response.status, 502);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.doesNotMatch(text, /super-secret/);
    assert.doesNotMatch(text, /<html/);
  });
});

test('GET /dashboards/worker-cancellations/section renders unknown section error as fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/worker-cancellations/section?section=bad');

    assert.equal(response.status, 400);
    assert.match(text, /Unknown worker cancellations section: bad/);
    assert.doesNotMatch(text, /<html/);
  });
});

test('GET /dashboards/worker-cancellations keeps navigation active and redacts upstream errors', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);
      throw new Error('ClickHouse rejected password super-secret');
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/worker-cancellations/');

    assert.ok([200, 404, 502].includes(response.status));
    assert.match(text, /class="nav-link active" href="\/dashboards\/worker-cancellations"/);
    assert.doesNotMatch(text, /super-secret/);

    if (response.status === 502) {
      assert.match(text, /ClickHouse rejected password \[redacted\]/);
    }
  });
});

test('activeNavForPath normalizes dashboard trailing slashes', () => {
  assert.equal(activeNavForPath('/admin/preload'), 'preload-admin');
  assert.equal(activeNavForPath('/admin/preload/run'), 'preload-admin');
  assert.equal(activeNavForPath('/dashboards/workplace-analysis/'), 'workplace-analysis');
  assert.equal(activeNavForPath('/dashboards/sales-by-project/'), 'sales-by-project');
  assert.equal(activeNavForPath('/dashboards/city-analysis'), 'city-analysis');
  assert.equal(activeNavForPath('/dashboards/city-analysis/'), 'city-analysis');
  assert.equal(activeNavForPath('/dashboards/heatmap'), 'heatmap');
  assert.equal(activeNavForPath('/dashboards/heatmap/'), 'heatmap');
  assert.equal(activeNavForPath('/dashboards/worker-cancellations'), 'worker-cancellations');
  assert.equal(activeNavForPath('/dashboards/worker-cancellations/'), 'worker-cancellations');
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

test('HTML responses disable intermediary caching', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response } = await fetchText(baseUrl, '/dashboards/city-analysis');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('pragma'), 'no-cache');
    assert.equal(response.headers.get('expires'), '0');
  });
});

test('GET /admin/diagnostics returns build, ClickHouse and preload diagnostics', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);

      if (operation === 'diagnostics city options') {
        return [{ city_count: 2 }];
      }

      if (operation === 'diagnostics sales preload order facts') {
        return [{ rows: 11 }];
      }

      if (operation === 'diagnostics sales preload shift facts') {
        return [{ rows: 13 }];
      }

      return [];
    }
  });
  const preloadService = createFakePreloadService();

  await withServer(
    client,
    async (baseUrl) => {
      const { response, text } = await fetchText(baseUrl, '/admin/diagnostics');
      const body = JSON.parse(text);

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^application\/json\b/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(body.app.version, 'test-build');
      assert.equal(body.clickhouse.database, 'etl');
      assert.equal(body.clickhouse.cityOptionsCurrentMonth, 2);
      assert.equal(body.clickhouse.salesPreloadCurrentMonth.orderFacts, 11);
      assert.equal(body.clickhouse.salesPreloadCurrentMonth.shiftFacts, 13);
      assert.equal(body.preload.salesByProject.tables.orderFacts, 11);
    },
    {
      ...baseConfig(),
      app: {
        version: 'test-build',
        startedAt: '2026-06-15T10:00:00.000Z'
      }
    },
    { preloadService, now: () => new Date('2026-06-15T12:00:00.000Z') }
  );
});

test('preload admin routes render, save schedule, and run manual refresh', async () => {
  const client = createFakeClient();
  const preloadService = createFakePreloadService();
  const cityAnalysisCache = {
    calls: [],
    clear() {
      this.calls.push(['clear']);
    }
  };

  await withServer(
    client,
    async (baseUrl) => {
      const page = await fetchText(baseUrl, '/admin/preload');

      assert.equal(page.response.status, 200);
      assert.match(page.text, /Order facts/);
      assert.match(page.text, /11/);
      assert.match(page.text, /Shift facts/);
      assert.match(page.text, /13/);
      assert.match(page.text, /Предзагрузка витрин/);

      const messagePage = await fetchText(baseUrl, '/admin/preload?message=run-started');

      assert.equal(messagePage.response.status, 200);
      assert.match(messagePage.text, /Обновление запущено/);

      const saved = await fetchText(baseUrl, '/admin/preload/schedule', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: formBody({
          enabled: '1',
          scheduleTime: '04:30',
          refreshDays: '60'
        })
      });

      assert.equal(saved.response.status, 303);
      assert.equal(saved.response.headers.get('location'), '/admin/preload?message=schedule-saved');

      const run = await fetchText(baseUrl, '/admin/preload/run', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: formBody({
          from: '2026-05-01',
          to: '2026-05-31'
        })
      });

      assert.equal(run.response.status, 303);
      assert.equal(run.response.headers.get('location'), '/admin/preload?message=run-started');

      const clearCache = await fetchText(baseUrl, '/admin/preload/cache/city-analysis/clear', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: formBody({})
      });

      assert.equal(clearCache.response.status, 303);
      assert.equal(clearCache.response.headers.get('location'), '/admin/preload?message=city-cache-cleared');

      const clearedMessagePage = await fetchText(baseUrl, '/admin/preload?message=city-cache-cleared');

      assert.equal(clearedMessagePage.response.status, 200);
      assert.match(clearedMessagePage.text, /Кеш анализа городов удален/);
    },
    baseConfig(),
    { preloadService, cityAnalysisCache }
  );

  assert.deepEqual(cityAnalysisCache.calls, [['clear']]);
  assert.deepEqual(preloadService.calls, [
    ['getJob'],
    ['getOverview'],
    ['getDiagnostics'],
    ['listRuns'],
    ['getJob'],
    ['getOverview'],
    ['getDiagnostics'],
    ['listRuns'],
    [
      'saveSchedule',
      {
        enabled: true,
        scheduleTime: '04:30',
        refreshDays: 60
      }
    ],
    [
      'runSalesByProject',
      {
        fromDate: '2026-05-01',
        toDate: '2026-06-01'
      }
    ],
    ['getJob'],
    ['getOverview'],
    ['getDiagnostics'],
    ['listRuns']
  ]);
});

test('POST /admin/preload/schedule rejects invalid schedule settings', async () => {
  const invalidCases = [
    { scheduleTime: 'bad', refreshDays: '60' },
    { scheduleTime: '24:00', refreshDays: '60' },
    { scheduleTime: '04:30', refreshDays: '0' },
    { scheduleTime: '04:30', refreshDays: '0.5' },
    { scheduleTime: '04:30', refreshDays: '999999' }
  ];

  for (const invalidCase of invalidCases) {
    const client = createFakeClient();
    const preloadService = createFakePreloadService();

    await withServer(
      client,
      async (baseUrl) => {
        const result = await fetchText(baseUrl, '/admin/preload/schedule', {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: formBody({
            enabled: '1',
            ...invalidCase
          })
        });

        assert.equal(result.response.status, 400);
        assert.match(result.text, /Неверные настройки расписания/);
      },
      baseConfig(),
      { preloadService }
    );

    assert.deepEqual(preloadService.calls, []);
  }
});

test('POST /admin/preload/run redirects when refresh is already running', async () => {
  const client = createFakeClient();
  const preloadService = createFakePreloadService();

  preloadService.runSalesByProject = async (input) => {
    preloadService.calls.push(['runSalesByProject', input]);
    return { status: 'already-running' };
  };

  await withServer(
    client,
    async (baseUrl) => {
      const run = await fetchText(baseUrl, '/admin/preload/run', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: formBody({
          from: '2026-05-01',
          to: '2026-05-31'
        })
      });

      assert.equal(run.response.status, 303);
      assert.equal(run.response.headers.get('location'), '/admin/preload?message=already-running');
    },
    baseConfig(),
    { preloadService }
  );

  assert.deepEqual(preloadService.calls, [
    [
      'runSalesByProject',
      {
        fromDate: '2026-05-01',
        toDate: '2026-06-01'
      }
    ]
  ]);
});

test('POST /admin/preload/run rejects invalid manual date ranges', async () => {
  const client = createFakeClient();
  const preloadService = createFakePreloadService();

  await withServer(
    client,
    async (baseUrl) => {
      const response = await fetchText(baseUrl, '/admin/preload/run', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: formBody({
          from: '2026-02-31',
          to: '2026-03-01'
        })
      });

      assert.equal(response.response.status, 400);
      assert.match(response.text, /Неверный диапазон дат/);
    },
    baseConfig(),
    { preloadService }
  );

  assert.deepEqual(preloadService.calls, []);
});

test('createApp does not create a user activity store when none is supplied', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-app-activity-'));
  const app = createApp({
    config: {
      ...baseConfig(),
      auth: {
        enabled: true
      },
      activity: {
        storePath: path.join(tempDir, 'activity.sqlite')
      }
    },
    client: createFakeClient(),
    userStore: {},
    sessionManager: {},
    activityStore: null
  });

  try {
    assert.equal(app.locals.activityStore, null);
  } finally {
    if (app.locals.activityStore && typeof app.locals.activityStore.close === 'function') {
      app.locals.activityStore.close();
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('start uses injectable dependencies and logs the listening port without secrets', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    }
  };
  const clientConfigs = [];
  const logMessages = [];
  let createAppArgs;
  let preloadServiceArgs;
  let fakePreloadService;
  let preloadServiceClosed = false;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
      clientConfigs.push(clickhouseConfig);
    }
  }

  const server = start({
    loadConfigFn: () => config,
    ClientClass: FakeClient,
    createPreloadServiceFn: (args) => {
      preloadServiceArgs = args;

      fakePreloadService = {
        close() {
          preloadServiceClosed = true;
        }
      };

      return fakePreloadService;
    },
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
    assert.equal(createAppArgs.preloadService, fakePreloadService);
    assert.equal(preloadServiceArgs.client, createAppArgs.client);
    assert.equal(preloadServiceArgs.storePath, config.preload.storePath);
    assert.equal(typeof createAppArgs.cityAnalysisCache.getOrLoad, 'function');
    assert.equal(logMessages.length, 1);
    assert.match(logMessages[0], new RegExp(`port ${port}`));
    assert.doesNotMatch(logMessages[0], /super-secret/);
  } finally {
    await closeServer(server);
  }

  assert.equal(preloadServiceClosed, true);
});

test('start wires user activity store path and closes it with server', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    },
    auth: {
      enabled: true
    },
    activity: {
      storePath: 'C:\\activity\\user-activity.sqlite'
    }
  };
  const activityStoreCalls = [];
  let createAppArgs;
  let activityStore;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
    }
  }

  const server = start({
    loadConfigFn: () => config,
    ClientClass: FakeClient,
    createPreloadServiceFn: () => null,
    createUserActivityStoreFn: (args) => {
      activityStoreCalls.push(args);

      activityStore = {
        closed: false,
        close() {
          this.closed = true;
        }
      };

      return activityStore;
    },
    createAppFn: (args) => {
      createAppArgs = args;

      return http.createServer((req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.end(args.activityStore === activityStore ? 'activity' : 'missing');
      });
    },
    logger: {
      log() {}
    }
  });

  try {
    await waitForListening(server);

    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const text = await response.text();

    assert.equal(text, 'activity');
    assert.deepEqual(activityStoreCalls, [{ filePath: config.activity.storePath }]);
    assert.equal(createAppArgs.activityStore, activityStore);
    assert.equal(activityStore.closed, false);
  } finally {
    await closeServer(server);
  }

  assert.equal(activityStore.closed, true);
});

test('start logs sanitized activity close failures and still closes preload service', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    },
    auth: {
      enabled: true
    },
    activity: {
      storePath: 'C:\\activity\\user-activity.sqlite'
    }
  };
  const warningMessages = [];
  let preloadServiceClosed = false;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
    }
  }

  const server = start({
    loadConfigFn: () => config,
    ClientClass: FakeClient,
    createPreloadServiceFn: () => ({
      close() {
        preloadServiceClosed = true;
      }
    }),
    createUserActivityStoreFn: () => ({
      close() {
        throw new Error('activity close failed with password super-secret');
      }
    }),
    createAppFn: () => http.createServer((req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end('started');
    }),
    logger: {
      log() {},
      warn(message) {
        warningMessages.push(message);
      }
    }
  });

  try {
    await waitForListening(server);
  } finally {
    await closeServer(server);
  }

  assert.equal(preloadServiceClosed, true);
  assert.equal(warningMessages.length, 1);
  assert.match(warningMessages[0], /User activity store close failed: activity close failed with password \[redacted\]/);
  assert.doesNotMatch(warningMessages[0], /super-secret/);
});

test('start closes preload service when user activity store creation fails', () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    },
    auth: {
      enabled: true
    },
    activity: {
      storePath: 'C:\\activity\\user-activity.sqlite'
    }
  };
  const warningMessages = [];
  let preloadServiceClosed = false;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
    }
  }

  assert.throws(
    () => start({
      loadConfigFn: () => config,
      ClientClass: FakeClient,
      createPreloadServiceFn: () => ({
        close() {
          preloadServiceClosed = true;
          throw new Error('preload close failed with password super-secret');
        }
      }),
      createUserActivityStoreFn: () => {
        throw new Error('activity store open failed with password super-secret');
      },
      createAppFn: () => http.createServer(),
      logger: {
        log() {},
        warn(message) {
          warningMessages.push(message);
        }
      }
    }),
    /activity store open failed with password super-secret/
  );

  assert.equal(preloadServiceClosed, true);
  assert.equal(warningMessages.length, 1);
  assert.match(warningMessages[0], /Preload service close failed: preload close failed with password \[redacted\]/);
  assert.doesNotMatch(warningMessages[0], /super-secret/);
});

test('start exposes async preload cleanup when user activity store creation fails', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    },
    auth: {
      enabled: true
    },
    activity: {
      storePath: 'C:\\activity\\user-activity.sqlite'
    }
  };
  let preloadServiceClosed = false;
  let thrownError = null;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
    }
  }

  try {
    start({
      loadConfigFn: () => config,
      ClientClass: FakeClient,
      createPreloadServiceFn: () => ({
        close() {
          return new Promise((resolve) => {
            setTimeout(() => {
              preloadServiceClosed = true;
              resolve();
            }, 0);
          });
        }
      }),
      createUserActivityStoreFn: () => {
        throw new Error('activity store open failed with password super-secret');
      },
      createAppFn: () => http.createServer(),
      logger: {
        log() {},
        warn() {}
      }
    });
  } catch (error) {
    thrownError = error;
  }

  assert.match(thrownError && thrownError.message, /activity store open failed with password super-secret/);
  assert.equal(preloadServiceClosed, false);
  assert.equal(typeof thrownError.startupCleanup.then, 'function');

  await thrownError.startupCleanup;

  assert.equal(preloadServiceClosed, true);
});

test('start closes activity and preload services when app creation fails', () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    },
    auth: {
      enabled: true
    },
    activity: {
      storePath: 'C:\\activity\\user-activity.sqlite'
    }
  };
  let activityStoreClosed = false;
  let preloadServiceClosed = false;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
    }
  }

  assert.throws(
    () => start({
      loadConfigFn: () => config,
      ClientClass: FakeClient,
      createPreloadServiceFn: () => ({
        close() {
          preloadServiceClosed = true;
        }
      }),
      createUserActivityStoreFn: () => ({
        close() {
          activityStoreClosed = true;
        }
      }),
      createAppFn: () => {
        throw new Error('app creation failed with password super-secret');
      },
      logger: {
        log() {},
        warn() {}
      }
    }),
    /app creation failed with password super-secret/
  );

  assert.equal(activityStoreClosed, true);
  assert.equal(preloadServiceClosed, true);
});

test('start exposes async activity and preload cleanup when app creation fails', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    },
    auth: {
      enabled: true
    },
    activity: {
      storePath: 'C:\\activity\\user-activity.sqlite'
    }
  };
  let activityStoreClosed = false;
  let preloadServiceClosed = false;
  let thrownError = null;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
    }
  }

  try {
    start({
      loadConfigFn: () => config,
      ClientClass: FakeClient,
      createPreloadServiceFn: () => ({
        close() {
          return new Promise((resolve) => {
            setTimeout(() => {
              preloadServiceClosed = true;
              resolve();
            }, 0);
          });
        }
      }),
      createUserActivityStoreFn: () => ({
        close() {
          return new Promise((resolve) => {
            setTimeout(() => {
              activityStoreClosed = true;
              resolve();
            }, 0);
          });
        }
      }),
      createAppFn: () => {
        throw new Error('app creation failed with password super-secret');
      },
      logger: {
        log() {},
        warn() {}
      }
    });
  } catch (error) {
    thrownError = error;
  }

  assert.match(thrownError && thrownError.message, /app creation failed with password super-secret/);
  assert.equal(activityStoreClosed, false);
  assert.equal(preloadServiceClosed, false);
  assert.equal(typeof thrownError.startupCleanup.then, 'function');

  await thrownError.startupCleanup;

  assert.equal(activityStoreClosed, true);
  assert.equal(preloadServiceClosed, true);
});

test('start does not create user activity store when auth is disabled', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    },
    auth: {
      enabled: false
    },
    activity: {
      storePath: 'C:\\activity\\user-activity.sqlite'
    }
  };
  let createAppArgs;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
    }
  }

  const server = start({
    loadConfigFn: () => config,
    ClientClass: FakeClient,
    createPreloadServiceFn: () => null,
    createUserActivityStoreFn: () => {
      throw new Error('activity store should not be created');
    },
    createAppFn: (args) => {
      createAppArgs = args;

      return http.createServer((req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.end(args.activityStore === null ? 'no-activity' : 'activity');
      });
    },
    logger: {
      log() {}
    }
  });

  try {
    await waitForListening(server);

    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const text = await response.text();

    assert.equal(text, 'no-activity');
    assert.equal(createAppArgs.activityStore, null);
  } finally {
    await closeServer(server);
  }
});

test('start falls back without preload service when preload creation fails', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    }
  };
  const warningMessages = [];
  const logMessages = [];
  let createAppArgs;

  class FakeClient {
    constructor(clickhouseConfig) {
      this.clickhouseConfig = clickhouseConfig;
    }
  }

  const server = start({
    loadConfigFn: () => config,
    ClientClass: FakeClient,
    createPreloadServiceFn: () => {
      throw new Error('failed to open sqlite with password super-secret');
    },
    createAppFn: (args) => {
      createAppArgs = args;

      return http.createServer((req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.end(args.preloadService === null ? 'fallback' : 'preload');
      });
    },
    logger: {
      log(message) {
        logMessages.push(message);
      },
      warn(message) {
        warningMessages.push(message);
      }
    }
  });

  try {
    await waitForListening(server);

    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const text = await response.text();

    assert.equal(text, 'fallback');
    assert.equal(createAppArgs.preloadService, null);
    assert.equal(warningMessages.length, 1);
    assert.match(warningMessages[0], /failed to open sqlite with password \[redacted\]/);
    assert.doesNotMatch(warningMessages[0], /super-secret/);
    assert.equal(logMessages.length, 1);
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
