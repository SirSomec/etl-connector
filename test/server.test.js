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
    assert.match(first.text, /10/);
    assert.doesNotMatch(first.text, /<html/);
    assert.equal(second.response.status, 200);
  });

  const pointCalls = client.calls.filter((call) =>
    call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace point')
  );

  assert.deepEqual(pointCalls.map((call) => call[1]), ['workplace point summary']);
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
    assert.equal(typeof createAppArgs.cityAnalysisCache.getOrLoad, 'function');
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
