const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeHtml,
  renderError,
  renderGigerDetails,
  renderGigerDetailsWorkbook,
  renderCityAnalysisDashboard,
  renderCityAnalysisDashboardSection,
  renderHeatmapDashboard,
  renderHeatmapDashboardSection,
  renderHome,
  renderPreloadManagement,
  renderSalesByProjectDashboard,
  renderSalesByProjectDashboardSection,
  renderTable,
  renderUserActivityDashboard,
  renderWorkerCancellationsDetails,
  renderWorkerCancellationsDashboard,
  renderWorkerCancellationsDashboardSection,
  renderWorkplaceAnalysisDashboard,
  renderWorkplaceAnalysisDashboardSection,
  renderWorkplacePointDayDetails,
  renderWorkplacePointDashboard,
  renderWorkplacePointDashboardSection,
  renderWorkplacePointReviews
} = require('../src/render');

test('escapeHtml escapes HTML content and attributes', () => {
  assert.equal(escapeHtml('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
});

test('renderHome shows database, escapes table names, and encodes table links', () => {
  const dangerousTable = '<script>"&\'';
  const tableWithUrlChars = 'raw events/table?day=1&ok=true';
  const html = renderHome({
    database: 'etl <main> & "quoted"',
    tables: ['events', dangerousTable, tableWithUrlChars]
  });

  assert.match(html, /Database: etl &lt;main&gt; &amp; &quot;quoted&quot;/);
  assert.match(html, /events/);
  assert.match(html, /&lt;script&gt;&quot;&amp;&#39;/);
  assert.match(
    html,
    new RegExp(`href="/tables\\?name=${escapeRegExp(encodeURIComponent(dangerousTable))}"`)
  );
  assert.match(
    html,
    new RegExp(`href="/tables\\?name=${escapeRegExp(encodeURIComponent(tableWithUrlChars))}"`)
  );
  assert.doesNotMatch(html, /<script>"&'/);
  assert.doesNotMatch(html, /raw events\/table\?day=1&ok=true/);
});

test('renderHome uses query links for dot-segment table names', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['.', '..']
  });

  assert.match(html, /href="\/tables\?name=\."/);
  assert.match(html, /href="\/tables\?name=\.\."/);
  assert.doesNotMatch(html, /href="\/tables\/\."/);
  assert.doesNotMatch(html, /href="\/tables\/\.\."/);
});

test('renderHome renders an empty state when tables is empty', () => {
  const html = renderHome({
    database: 'etl',
    tables: []
  });

  assert.match(html, /No tables found/);
});

test('renderHome includes sidebar navigation with tables active', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['mg_orders']
  });

  assert.match(html, /class="nav-link active" href="\/"/);
  assert.match(html, /Таблицы/);
  assert.match(html, /Продажи по проектам/);
  assert.match(html, /href="\/dashboards\/sales-by-project"/);
});

test('renderHome includes workplace analysis navigation', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['mg_orders']
  });

  assert.match(html, /Анализ точек/);
  assert.match(html, /href="\/dashboards\/workplace-analysis"/);
  assert.match(html, /Анализ городов/);
  assert.match(html, /href="\/dashboards\/city-analysis"/);
  assert.match(html, /Тепловая карта/);
  assert.match(html, /href="\/dashboards\/heatmap"/);
});

test('renderHome includes worker cancellations navigation', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['mg_orders']
  });

  assert.match(html, /Отмены гигерами/);
  assert.match(html, /href="\/dashboards\/worker-cancellations"/);
});

test('renderPreloadManagement renders schedule, manual run, and history', () => {
  const html = renderPreloadManagement({
    database: 'etl',
    csrfToken: 'csrf-token',
    currentUser: { role: 'admin', permissions: ['preload-admin'] },
    message: 'Сохранено',
    error: '',
    job: {
      id: 'sales-by-project',
      enabled: true,
      scheduleTime: '03:00',
      timezone: 'Europe/Moscow',
      refreshDays: 45
    },
    overview: {
      coveredFrom: '2026-05-01',
      coveredTo: '2026-06-04',
      lastSuccessAt: '2026-06-04T03:00:00.000Z',
      lastError: 'ClickHouse timeout'
    },
    runs: [
      {
        id: 1,
        trigger: 'manual',
        status: 'success',
        fromDate: '2026-05-01',
        toDate: '2026-06-01',
        startedAt: '2026-06-04T10:00:00.000Z',
        finishedAt: '2026-06-04T10:01:00.000Z',
        rowsWritten: 10,
        errorMessage: ''
      }
    ]
  });

  assert.match(html, /Предзагрузка витрин/);
  assert.match(html, /action="\/admin\/preload\/run"/);
  assert.match(html, /action="\/admin\/preload\/schedule"/);
  assert.match(html, /name="csrfToken" value="csrf-token"/);
  assert.match(html, /value="03:00"/);
  assert.match(html, /value="45"/);
  assert.match(html, /sales-by-project/);
  assert.match(html, /ClickHouse timeout/);
  assert.match(html, /class="nav-link active" href="\/admin\/preload"/);
});

test('renderPreloadManagement escapes hostile values', () => {
  const hostile = `<script>alert("x")</script>&'`;
  const html = renderPreloadManagement({
    database: `etl-${hostile}`,
    csrfToken: `csrf-${hostile}`,
    currentUser: { role: 'admin', permissions: ['preload-admin'] },
    message: `saved-${hostile}`,
    error: `error-${hostile}`,
    job: {
      id: `job-${hostile}`,
      enabled: true,
      scheduleTime: `03:00"${hostile}`,
      refreshDays: `45${hostile}`
    },
    overview: {
      coveredFrom: `from-${hostile}`,
      coveredTo: `to-${hostile}`,
      lastSuccessAt: `success-${hostile}`,
      lastError: `last-error-${hostile}`
    },
    runs: [
      {
        id: `run-${hostile}`,
        trigger: `manual-${hostile}`,
        status: `success-${hostile}`,
        fromDate: `run-from-${hostile}`,
        toDate: `run-to-${hostile}`,
        startedAt: `started-${hostile}`,
        finishedAt: `finished-${hostile}`,
        rowsWritten: `10${hostile}`,
        errorMessage: `run-error-${hostile}`
      }
    ]
  });

  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`csrf-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`saved-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`error-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`job-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`03:00"${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`45${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`from-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`to-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`success-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`last-error-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`run-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`manual-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`run-error-${hostile}`))));
  assert.doesNotMatch(html, /saved-<script>/);
  assert.doesNotMatch(html, /error-<script>/);
  assert.doesNotMatch(html, /job-<script>/);
  assert.doesNotMatch(html, /last-error-<script>/);
  assert.doesNotMatch(html, /run-error-<script>/);
  assert.doesNotMatch(html, /alert\("x"\)/);
});

test('renderPreloadManagement filters preload navigation by permission', () => {
  const withoutPermissionHtml = renderPreloadManagement({
    database: 'etl',
    currentUser: { role: 'analyst', permissions: ['tables'] },
    job: { id: 'sales-by-project' },
    overview: {},
    runs: []
  });
  const withPermissionHtml = renderPreloadManagement({
    database: 'etl',
    currentUser: { role: 'analyst', permissions: ['preload-admin'] },
    job: { id: 'sales-by-project' },
    overview: {},
    runs: []
  });

  assert.doesNotMatch(withoutPermissionHtml, /href="\/admin\/preload"/);
  assert.match(withPermissionHtml, /href="\/admin\/preload"/);
  assert.match(withPermissionHtml, /class="nav-link active" href="\/admin\/preload"/);
});

test('renderUserActivityDashboard renders escaped matrix and disabled state', () => {
  const html = renderUserActivityDashboard({
    database: 'etl',
    overview: {
      from: '2026-03-08',
      to: '2026-06-05',
      retentionDays: 90,
      users: [
        {
          id: 'user-1',
          email: 'analyst<script>@example.test',
          name: 'Analyst <One>',
          role: 'analyst',
          status: 'active',
          lastEventAt: '2026-06-05T10:00:00.000Z',
          activeDays30: 3,
          activeDays90: 3,
          days: [
            { date: '2026-06-03', level: 'view', viewEvents: 1, workEvents: 0, sections: ['tables'] },
            { date: '2026-06-04', level: 'work', viewEvents: 0, workEvents: 1, sections: ['workplace-analysis'] },
            { date: '2026-06-05', level: 'intense', viewEvents: 0, workEvents: 6, sections: ['activity'] }
          ],
          recentEvents: [
            {
              occurredAt: '2026-06-05T10:00:00.000Z',
              eventType: 'dashboard_filter',
              section: 'workplace-analysis',
              path: '/dashboards/workplace-analysis?<bad>'
            }
          ]
        }
      ]
    }
  });
  const disabledHtml = renderUserActivityDashboard({
    database: 'etl',
    disabled: true
  });

  assert.match(html, /Активность пользователей/);
  assert.match(html, /class="nav-link active" href="\/admin\/activity"/);
  assert.match(html, /Analyst &lt;One&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /analyst&lt;script&gt;@example\.test/);
  assert.match(html, /data-activity-level="intense"/);
  assert.match(html, /\/dashboards\/workplace-analysis\?&lt;bad&gt;/);
  assert.match(
    html,
    /@media \(max-width: 1120px\) \{[\s\S]*\.activity-user-summary \{[\s\S]*grid-template-columns: minmax\(180px, 1fr\) minmax\(90px, auto\) minmax\(90px, auto\);[\s\S]*\.activity-day-strip \{[\s\S]*grid-column: 1 \/ -1;/
  );
  assert.match(disabledHtml, /Авторизация отключена/);
});

test('admin-only activity navigation is visible only to admins', () => {
  const adminHtml = renderHome({
    database: 'etl',
    tables: ['mg_orders'],
    currentUser: { role: 'admin', permissions: [] }
  });
  const analystHtml = renderHome({
    database: 'etl',
    tables: ['mg_orders'],
    currentUser: {
      role: 'analyst',
      permissions: ['tables', 'users', 'preload-admin', 'admin-only']
    }
  });

  assert.match(adminHtml, /href="\/admin\/activity"/);
  assert.doesNotMatch(analystHtml, /href="\/admin\/activity"/);
});

test('renderWorkplaceAnalysisDashboard renders unified dashboard header and active filter chips', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-15',
        rangeDays: 15,
        client: ['Brand A'],
        city: ['Москва'],
        region: [],
        profession: ['Комплектовщик'],
        orderType: ['regular'],
        jobStatus: [],
        contractor: [],
        search: 'Ленина',
        includeDeletedOrders: false,
        includeHiddenOrders: false,
        sort: 'orders',
        limit: 12,
        page: 1,
        pinnedWorkplaceIds: []
      },
      filterOptions: {
        client: ['Brand A'],
        city: ['Москва'],
        region: [],
        profession: ['Комплектовщик'],
        orderType: ['regular'],
        jobStatus: [],
        contractor: []
      },
      context: { sortLabel: 'по заказу' },
      points: [],
      attentionPoints: [],
      pagination: { page: 1, limit: 12, totalWorkplaces: 0, totalPages: 1, hasPrevious: false, hasNext: false },
      attentionPagination: { page: 1, pageSize: 15, totalWorkplaces: 0, totalPages: 1, hasPrevious: false, hasNext: false }
    }
  });

  assert.match(html, /dashboard-header/);
  assert.match(html, /dashboard-eyebrow/);
  assert.match(html, /Анализ точек/);
  assert.match(html, /Период: 2026-06-01 - 2026-06-15/);
  assert.match(html, /active-filter-chips/);
  assert.match(html, /Brand A/);
  assert.match(html, /Москва/);
  assert.match(html, /Комплектовщик/);
  assert.match(html, /Ленина/);
});

test('renderWorkerCancellationsDashboard renders unified loading state', () => {
  const html = renderWorkerCancellationsDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-15',
        page: 1,
        pageSize: 100,
        sort: 'workerCancellations24h',
        direction: 'desc'
      }
    }
  });

  assert.match(html, /dashboard-header/);
  assert.match(html, /dashboard-loading-state/);
  assert.match(html, /Загружается/);
});

test('renderWorkerCancellationsDashboard renders filters and progressive table loading state', () => {
  const html = renderWorkerCancellationsDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 2,
        pageSize: 200,
        sort: 'workerCancellations24h',
        direction: 'desc'
      }
    }
  });

  assert.match(html, /dashboard-header/);
  assert.match(html, /Отмены гигерами/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/worker-cancellations"/);
  assert.match(html, /<form class="filter-bar" action="\/dashboards\/worker-cancellations" method="get">/);
  assert.match(html, /<input id="from" name="from" type="date" value="2026-05-01">/);
  assert.match(html, /<input id="to" name="to" type="date" value="2026-05-31">/);
  assert.match(html, /<option value="200" selected>200<\/option>/);
  assert.match(html, /data-worker-cancellation-modal/);
  assert.match(html, /document\.addEventListener\('click', function \(event\)/);
  assert.match(html, /data-worker-cancellation-detail-trigger/);
  assert.match(html, /Период по плановому старту смены/);
  assert.match(
    html,
    /data-dashboard-fragment-url="\/dashboards\/worker-cancellations\/section\?section=workers&amp;from=2026-05-01&amp;to=2026-05-31&amp;page=2&amp;pageSize=200&amp;sort=workerCancellations24h&amp;direction=desc"/
  );
  assert.match(html, /Загружается/);
  assert.match(html, /document\.querySelectorAll\('\[data-dashboard-fragment-url\]/);
});

test('renderWorkerCancellationsDashboard renders search and numeric range filters', () => {
  const html = renderWorkerCancellationsDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 1,
        pageSize: 50,
        sort: 'workerCancellations',
        direction: 'desc',
        search: 'user-1 <bad>',
        confirmedShiftsFrom: 5,
        confirmedShiftsTo: 10,
        workerCancellationsTo: 4,
        failedShiftsFrom: 1
      }
    }
  });

  assert.match(html, /<input id="search" name="search" type="search" value="user-1 &lt;bad&gt;"/);
  assert.match(html, /<input class="metric-range-input" id="confirmedShiftsFrom" name="confirmedShiftsFrom" type="number" min="0" step="1" value="5">/);
  assert.match(html, /<input class="metric-range-input" id="confirmedShiftsTo" name="confirmedShiftsTo" type="number" min="0" step="1" value="10">/);
  assert.match(html, /<input class="metric-range-input" id="workerCancellationsTo" name="workerCancellationsTo" type="number" min="0" step="1" value="4">/);
  assert.match(html, /<input class="metric-range-input" id="failedShiftsFrom" name="failedShiftsFrom" type="number" min="0" step="1" value="1">/);
  assert.match(
    html,
    /data-dashboard-fragment-url="\/dashboards\/worker-cancellations\/section\?section=workers&amp;from=2026-05-01&amp;to=2026-05-31&amp;pageSize=50&amp;sort=workerCancellations&amp;direction=desc&amp;search=user-1\+%3Cbad%3E&amp;confirmedShiftsFrom=5&amp;confirmedShiftsTo=10&amp;workerCancellationsTo=4&amp;failedShiftsFrom=1"/
  );
});

test('renderWorkerCancellationsDashboardSection renders sortable escaped table and full phone', () => {
  const html = renderWorkerCancellationsDashboardSection({
    section: 'workers',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 1,
        pageSize: 50,
        sort: 'workerCancellations',
        direction: 'asc'
      },
      rows: [
        {
          workerId: 'worker-1',
          fullName: 'Иванов <script>Иван</script>',
          phone: '+79990000000<script>x</script>',
          city: 'Москва<script>bad</script>',
          confirmedShifts: 10,
          workerCancellations: 3,
          workerCancellations24h: 2,
          postStartCancellations: 1,
          failedShifts: 4
        }
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        totalWorkers: 125,
        totalPages: 3,
        hasPrevious: false,
        hasNext: true
      }
    }
  });

  assert.match(html, /ФИО/);
  assert.match(html, /Телефон/);
  assert.match(html, /Город/);
  assert.match(html, /Выполнено/);
  assert.match(html, /Отмены worker/);
  assert.match(html, /Отмены worker &lt; 24ч/);
  assert.match(html, /Отмены после старта/);
  assert.match(html, /Провалы \/ failed/);
  assert.match(
    html,
    /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;pageSize=50&amp;sort=fullName&amp;direction=asc"/
  );
  assert.match(
    html,
    /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;pageSize=50&amp;sort=workerCancellations&amp;direction=desc"/
  );
  assert.match(html, /<td class="phone-cell">\+79990000000&lt;script&gt;x&lt;\/script&gt;<\/td>/);
  assert.match(
    html,
    /<button type="button" class="metric-detail-trigger" data-worker-cancellation-detail-trigger data-detail-url="\/dashboards\/worker-cancellations\/details\?from=2026-05-01&amp;to=2026-05-31&amp;workerId=worker-1&amp;metric=confirmedShifts">10<\/button>/
  );
  assert.match(
    html,
    /data-detail-url="\/dashboards\/worker-cancellations\/details\?from=2026-05-01&amp;to=2026-05-31&amp;workerId=worker-1&amp;metric=workerCancellations"/
  );
  assert.match(html, /Иванов &lt;script&gt;Иван&lt;\/script&gt;/);
  assert.match(html, /Москва&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Страница 1 из 3 · исполнителей: 125/);
  assert.match(html, /page=2/);
  assert.doesNotMatch(html, /<html/);
});

test('renderWorkerCancellationsDashboardSection renders operational risk columns with detail triggers and full phone', () => {
  const html = renderWorkerCancellationsDashboardSection({
    section: 'workers',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 1,
        pageSize: 50,
        sort: 'workerCancellations24h',
        direction: 'desc'
      },
      rows: [
        {
          workerId: 'worker-1',
          fullName: 'Ivan Petrov',
          phone: '+79990000000',
          city: 'Moscow',
          confirmedShifts: 10,
          workerCancellations: 3,
          workerCancellations24h: 3,
          postStartCancellations: 1,
          failedShifts: 0,
          riskSeverity: 'high',
          riskReasons: [
            { kind: 'worker-cancellations-24h', label: '3 отмены менее чем за 24ч' },
            { kind: 'post-start-cancellations', label: '1 отмена после старта' }
          ]
        }
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        totalWorkers: 1,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false
      }
    }
  });

  assert.match(html, /risk-badge risk-high/);
  assert.match(html, /3 отмены менее чем за 24ч/);
  assert.match(html, /1 отмена после старта/);
  assert.match(html, /data-worker-cancellation-detail-trigger/);
  assert.match(html, /<td class="phone-cell">\+79990000000<\/td>/);
});

test('renderWorkerCancellationsDashboardSection preserves search and numeric filters in table links', () => {
  const html = renderWorkerCancellationsDashboardSection({
    section: 'workers',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 1,
        pageSize: 50,
        sort: 'workerCancellations',
        direction: 'desc',
        search: 'user-1',
        confirmedShiftsFrom: 5,
        workerCancellationsTo: 4,
        failedShiftsFrom: 1
      },
      rows: [
        {
          workerId: 'worker-1',
          fullName: 'Ivan Petrov',
          phone: '+79990000000',
          city: 'Moscow',
          confirmedShifts: 10,
          workerCancellations: 3,
          workerCancellations24h: 2,
          postStartCancellations: 1,
          failedShifts: 4
        }
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        totalWorkers: 125,
        totalPages: 3,
        hasPrevious: false,
        hasNext: true
      }
    }
  });

  assert.match(
    html,
    /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;pageSize=50&amp;sort=fullName&amp;direction=asc&amp;search=user-1&amp;confirmedShiftsFrom=5&amp;workerCancellationsTo=4&amp;failedShiftsFrom=1"/
  );
  assert.match(
    html,
    /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;page=2&amp;pageSize=50&amp;sort=workerCancellations&amp;direction=desc&amp;search=user-1&amp;confirmedShiftsFrom=5&amp;workerCancellationsTo=4&amp;failedShiftsFrom=1"/
  );
  assert.match(
    html,
    /data-detail-url="\/dashboards\/worker-cancellations\/details\?from=2026-05-01&amp;to=2026-05-31&amp;workerId=worker-1&amp;metric=workerCancellations"/
  );
});

test('renderWorkerCancellationsDashboardSection renders empty state', () => {
  const html = renderWorkerCancellationsDashboardSection({
    section: 'workers',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 1,
        pageSize: 50,
        sort: 'workerCancellations',
        direction: 'desc'
      },
      rows: [],
      pagination: {
        page: 1,
        pageSize: 50,
        totalWorkers: 0,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false
      }
    }
  });

  assert.match(html, /Нет исполнителей со сменами за выбранный период/);
  assert.doesNotMatch(html, /<table>/);
  assert.doesNotMatch(html, /<html/);
});

test('renderWorkerCancellationsDashboardSection handles out-of-range pages without false empty state', () => {
  const html = renderWorkerCancellationsDashboardSection({
    section: 'workers',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 4,
        pageSize: 50,
        sort: 'workerCancellations',
        direction: 'desc'
      },
      rows: [],
      pagination: {
        page: 4,
        pageSize: 50,
        totalWorkers: 125,
        totalPages: 3,
        hasPrevious: true,
        hasNext: false
      }
    }
  });

  assert.match(html, /Страница 4 вне диапазона\. Доступно страниц: 3\./);
  assert.match(
    html,
    /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;page=3&amp;pageSize=50&amp;sort=workerCancellations&amp;direction=desc"/
  );
  assert.match(html, /Страница 3 из 3 · исполнителей: 125/);
  assert.match(html, /pagination-current" aria-current="page">3<\/span>/);
  assert.doesNotMatch(html, /Нет исполнителей со сменами за выбранный период/);
  assert.doesNotMatch(html, /Страница 4 из 4/);
  assert.doesNotMatch(html, /<html/);
});

test('renderWorkerCancellationsDetails renders escaped shift details fragment', () => {
  const html = renderWorkerCancellationsDetails({
    details: {
      metricLabel: 'Отмены worker',
      workerId: 'worker-1',
      limit: 500,
      shifts: [
        {
          shiftId: 'job-1<script>x</script>',
          brand: 'Brand <b>A</b>',
          address: 'Moscow <script>bad</script>',
          plannedStart: '2026-05-12 09:00:00',
          bookedAt: '2026-05-10 15:30:00',
          cancelledAt: '2026-05-11 18:00:00',
          cancelledBy: 'worker'
        },
        {
          shiftId: 'job-2',
          brand: '',
          address: '',
          plannedStart: '',
          bookedAt: '',
          cancelledAt: '',
          cancelledBy: ''
        }
      ]
    }
  });

  assert.match(html, /Детализация: Отмены worker/);
  assert.match(html, /Смена/);
  assert.match(html, /Бренд/);
  assert.match(html, /Адрес/);
  assert.match(html, /Старт смены/);
  assert.match(html, /Забронирована/);
  assert.match(html, /Отменена/);
  assert.match(html, /Кем отменена/);
  assert.match(html, /job-1&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /Brand &lt;b&gt;A&lt;\/b&gt;/);
  assert.match(html, /Moscow &lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /12\.05\.2026 09:00/);
  assert.match(html, /10\.05\.2026 15:30/);
  assert.match(html, /11\.05\.2026 18:00/);
  assert.match(html, /worker/);
  assert.match(html, />-<\/td>/);
  assert.doesNotMatch(html, /<html/);
  assert.doesNotMatch(html, /<script>/);
});

test('renderGigerDetails renders paged escaped giger list with modal pagination and export link', () => {
  const html = renderGigerDetails({
    details: {
      metricLabel: 'Гигеры <b>5 км</b>',
      detailUrl: '/dashboards/city-analysis/gigers?city=Москва&metric=total-located-users&page=2',
      exportUrl: '/dashboards/city-analysis/gigers/export?city=Москва&metric=total-located-users',
      pagination: {
        page: 2,
        pageSize: 20,
        totalGigers: 21,
        totalPages: 2,
        hasPrevious: true,
        hasNext: false
      },
      gigers: [
        {
          userId: 'user-1<script>x</script>',
          workerId: 'worker-1',
          fullName: 'Иванов <Иван>',
          phone: '+79990000000<script>x</script>',
          status: 'ready'
        }
      ]
    }
  });

  assert.match(html, /class="giger-details"/);
  assert.match(html, /Гигеры &lt;b&gt;5 км&lt;\/b&gt;/);
  assert.match(html, /href="\/dashboards\/city-analysis\/gigers\/export\?city=/);
  assert.match(html, /data-giger-list-page-link/);
  assert.match(html, /href="\/dashboards\/city-analysis\/gigers\?city=/);
  assert.match(html, /page=1/);
  assert.match(html, /user-1&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /Иванов &lt;Иван&gt;/);
  assert.match(html, /\+79990000000&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /Страница 2 из 2/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<html/);
});

test('renderGigerDetailsWorkbook renders excel-compatible escaped table', () => {
  const html = renderGigerDetailsWorkbook({
    details: {
      metricLabel: 'База',
      gigers: [
        {
          userId: 'user-1',
          workerId: 'worker-1<script>x</script>',
          fullName: 'Иванов Иван',
          phone: '+79990000000',
          status: 'worked'
        }
      ]
    }
  });

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /worker-1&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /Иванов Иван/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

test('renderTable escapes metadata and cells, formats complex values, and uses column order', () => {
  const html = renderTable({
    database: 'etl',
    tableName: '<events>"&\'',
    columns: [
      { name: '<id>', type: 'UInt64 & Int64', position: '<1>' },
      { name: 'payload', type: 'Object("<json>")', position: 2 },
      { name: 'missing', type: 'Nullable(String)', position: 3 }
    ],
    rows: [
      {
        payload: { html: '<img src=x onerror=alert(1)>', ok: true },
        '<id>': '<cell>"&\'',
        ignored: '<ignored>',
        missing: null
      },
      {
        '<id>': 7,
        payload: ['<array>', 'value'],
        missing: undefined
      }
    ]
  });

  assert.match(html, /&lt;events&gt;&quot;&amp;&#39;/);
  assert.match(html, /&lt;id&gt;/);
  assert.match(html, /UInt64 &amp; Int64/);
  assert.match(html, /&lt;1&gt;/);
  assert.match(html, /Object\(&quot;&lt;json&gt;&quot;\)/);
  assert.match(html, /&lt;cell&gt;&quot;&amp;&#39;/);
  assert.match(
    html,
    /{&quot;html&quot;:&quot;&lt;img src=x onerror=alert\(1\)&gt;&quot;,&quot;ok&quot;:true}/
  );
  assert.match(html, /\[&quot;&lt;array&gt;&quot;,&quot;value&quot;\]/);
  assert.equal(countOccurrences(html, '<span class="muted">NULL</span>'), 2);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<ignored>/);
  assert.ok(html.indexOf('&lt;id&gt;') < html.indexOf('payload'));
  assert.ok(html.indexOf('payload') < html.indexOf('missing'));
});

test('renderTable renders NULL for missing own row properties', () => {
  const html = renderTable({
    database: 'etl',
    tableName: 'prototype_safe',
    columns: [{ name: 'constructor', type: 'String', position: 1 }],
    rows: [{}]
  });

  assert.match(html, /<span class="muted">NULL<\/span>/);
  assert.doesNotMatch(html, /function Object/);
  assert.doesNotMatch(html, /\[native code\]/);
});

test('renderTable derives headers from rows when columns are empty', () => {
  const html = renderTable({
    database: 'etl',
    tableName: 'derived',
    columns: [],
    rows: [{ '<first>': 'one', second: 'two' }]
  });

  assert.match(html, /No columns found/);
  assert.match(html, /&lt;first&gt;/);
  assert.match(html, /second/);
  assert.match(html, /one/);
  assert.match(html, /two/);
});

test('renderTable shows empty states for no columns and no rows', () => {
  const html = renderTable({
    database: 'etl',
    tableName: 'empty_table',
    columns: [],
    rows: []
  });

  assert.match(html, /No columns found/);
  assert.match(html, /No preview rows/);
});

test('renderError escapes title and message', () => {
  const html = renderError({
    database: 'etl',
    title: 'Cannot <load> "tables"',
    message: '<b>failure</b> & "bad"'
  });

  assert.match(html, /Cannot &lt;load&gt; &quot;tables&quot;/);
  assert.match(html, /&lt;b&gt;failure&lt;\/b&gt; &amp; &quot;bad&quot;/);
  assert.doesNotMatch(html, /<b>failure<\/b>/);
});

test('renderError can keep dashboard navigation active', () => {
  const html = renderError({
    database: 'etl',
    title: 'Upstream Error',
    message: 'timeout',
    activeNav: 'sales-by-project'
  });

  assert.match(html, /class="nav-link active" href="\/dashboards\/sales-by-project"/);
  assert.doesNotMatch(html, /class="nav-link active" href="\/"/);
});

test('renderSalesByProjectDashboard escapes values and renders metrics', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-04-30'
      },
      summary: {
        orderedShifts: 10,
        workedShifts: 8,
        slaPercent: 80,
        revenueRub: 12000,
        uniqueWorkers: 5,
        workplacesWithOrders: 3,
        workplacesWithWorkedShifts: 2,
        cancelledShifts: 1,
        selfBookingPercent: 50,
        avgWorkerRateHour: 250
      },
      trendRows: [
        {
          period: '2026-04-01',
          orderedShifts: 10,
          workedShifts: 8,
          slaPercent: 80,
          revenueRub: 12000,
          cancelledShifts: 1
        }
      ],
      brandRows: [
        {
          brand: '<script>bad</script>',
          orderedShifts: 10,
          workedShifts: 8,
          slaPercent: 80,
          revenueRub: 12000,
          uniqueWorkers: 5,
          workplacesWithOrders: 3,
          workplacesWithWorkedShifts: 2,
          cancelledShifts: 1,
          selfBookingPercent: 50,
          avgWorkerRateHour: 250
        }
      ],
      statusRows: [{ status: 'confirmed', shifts: 8 }]
    }
  });

  assert.match(html, /Продажи по проектам/);
  assert.match(html, /Заказано смен/);
  assert.match(html, /10/);
  assert.match(html, /SLA/);
  assert.match(html, /80\.0%/);
  assert.match(html, /12 000/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/sales-by-project"/);
});

test('renderSalesByProjectDashboard renders mini trends from existing trend rows in KPI cards', () => {
  const dashboard = {
    filters: {
      period: 'day',
      from: '2026-04-01',
      to: '2026-04-03'
    },
    summary: {
      orderedShifts: 33,
      workedShifts: 24,
      slaPercent: 72.7,
      revenueRub: 25000,
      uniqueWorkers: 12,
      workplacesWithOrders: 4,
      workplacesWithWorkedShifts: 3,
      cancelledShifts: 2,
      selfBookingPercent: 40,
      avgWorkerRateHour: 350
    },
    trendRows: [
      {
        period: '2026-04-01',
        orderedShifts: 10,
        workedShifts: 7,
        slaPercent: 70,
        revenueRub: 7000,
        cancelledShifts: 1
      },
      {
        period: '2026-04-02',
        orderedShifts: 8,
        workedShifts: 6,
        slaPercent: 75,
        revenueRub: 6000,
        cancelledShifts: 0
      },
      {
        period: '2026-04-03',
        orderedShifts: 15,
        workedShifts: 11,
        slaPercent: 73.3,
        revenueRub: 12000,
        cancelledShifts: 1
      }
    ],
    brandRows: [],
    statusRows: []
  };
  const html = renderSalesByProjectDashboard({ database: 'etl', dashboard });

  assert.match(html, /class="mini-trend"/);
  assert.match(html, /<polyline/);
  assert.match(html, /aria-label="Динамика заказанных смен"/);
  assert.match(html, /aria-label="Динамика выполненных смен"/);
  assert.match(html, /data-mini-trend-target="orderedShifts"/);
  assert.match(html, /data-mini-trend-target="workedShifts"/);
  assert.match(html, /data-sales-trend-row data-ordered-shifts="10" data-worked-shifts="7"/);
  assert.equal(countOccurrences(html, 'class="mini-trend"'), 2);

  const onePointHtml = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard: {
      ...dashboard,
      trendRows: dashboard.trendRows.slice(0, 1)
    }
  });

  assert.doesNotMatch(onePointHtml, /class="mini-trend"/);
});

test('renderSalesByProjectDashboard progressive shell can hydrate KPI mini trends from trend fragment', () => {
  const shellHtml = renderSalesByProjectDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-06-30'
      },
      summary: {},
      trendRows: [],
      brandRows: [],
      statusRows: []
    }
  });
  const summaryHtml = renderSalesByProjectDashboardSection({
    section: 'summary',
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-06-30'
      },
      summary: {
        orderedShifts: 60,
        workedShifts: 42
      },
      trendRows: [],
      brandRows: [],
      statusRows: []
    }
  });
  const trendHtml = renderSalesByProjectDashboardSection({
    section: 'trend',
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-06-30'
      },
      summary: {},
      trendRows: [
        { period: '2026-04-01', orderedShifts: 10, workedShifts: 7 },
        { period: '2026-05-01', orderedShifts: 20, workedShifts: 15 },
        { period: '2026-06-01', orderedShifts: 30, workedShifts: 20 }
      ],
      brandRows: [],
      statusRows: []
    }
  });

  assert.match(shellHtml, /data-dashboard-fragment-url="\/dashboards\/sales-by-project\/section\?section=summary/);
  assert.match(shellHtml, /hydrateSalesMiniTrends/);
  assert.match(summaryHtml, /data-mini-trend-target="orderedShifts"/);
  assert.match(summaryHtml, /data-mini-trend-target="workedShifts"/);
  assert.match(trendHtml, /data-sales-trend-row data-ordered-shifts="10" data-worked-shifts="7"/);
});

test('renderSalesByProjectDashboard normalizes invalid mini trend values', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        period: 'day',
        from: '2026-04-01',
        to: '2026-04-06'
      },
      summary: {
        orderedShifts: 8,
        workedShifts: 5,
        slaPercent: 62.5,
        revenueRub: 5000,
        uniqueWorkers: 4,
        workplacesWithOrders: 2,
        workplacesWithWorkedShifts: 2,
        cancelledShifts: 1,
        selfBookingPercent: 25,
        avgWorkerRateHour: 300
      },
      trendRows: [
        null,
        {
          period: '2026-04-01',
          orderedShifts: Infinity,
          workedShifts: -Infinity,
          slaPercent: 0,
          revenueRub: 0,
          cancelledShifts: 0
        },
        {
          period: '2026-04-02',
          orderedShifts: 'not-a-number',
          workedShifts: 'bad',
          slaPercent: 0,
          revenueRub: 0,
          cancelledShifts: 0
        },
        {
          period: '2026-04-03',
          orderedShifts: '8',
          workedShifts: 5,
          slaPercent: 62.5,
          revenueRub: 5000,
          cancelledShifts: 1
        }
      ],
      brandRows: [],
      statusRows: []
    }
  });

  assert.match(html, /class="mini-trend"/);
  assert.match(html, /<polyline/);
  assert.equal(countOccurrences(html, 'class="mini-trend"'), 2);
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, /Infinity/);
  assert.doesNotMatch(html, /-Infinity/);
});

test('renderSalesByProjectDashboard shows SQL inspector only with permission', () => {
  const dashboard = {
    filters: {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    summary: {
      orderedShifts: 10,
      workedShifts: 8,
      slaPercent: 80,
      revenueRub: 12000
    },
    trendRows: [],
    brandRows: [],
    statusRows: []
  };
  const withoutPermission = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard,
    currentUser: { role: 'analyst', permissions: ['sales-by-project'] }
  });
  const withPermission = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard,
    currentUser: { role: 'analyst', permissions: ['sales-by-project', 'sql-inspector'] }
  });

  assert.doesNotMatch(withoutPermission, /data-sql-inspector-open/);
  assert.doesNotMatch(withoutPermission, /data-sql-inspector-modal/);
  assert.doesNotMatch(withoutPermission, /shift_facts/);
  assert.match(withPermission, /data-sql-inspector-open/);
  assert.match(withPermission, /data-sql-inspector-modal/);
  assert.match(withPermission, /Показать SQL метрики: Продажи по проектам/);
  assert.match(withPermission, /<span class="sql-keyword">SELECT<\/span>/);
  assert.match(withPermission, /shift_facts/);
});

test('renderSalesByProjectDashboard renders SQL inspectors for each KPI and data table value', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-04-30'
      },
      summary: {
        orderedShifts: 10,
        workedShifts: 8,
        slaPercent: 80,
        revenueRub: 12000,
        uniqueWorkers: 5,
        workplacesWithOrders: 3,
        workplacesWithWorkedShifts: 2,
        cancelledShifts: 1,
        selfBookingPercent: 40,
        avgWorkerRateHour: 350
      },
      trendRows: [
        {
          period: '2026-04',
          orderedShifts: 10,
          workedShifts: 8,
          slaPercent: 80,
          revenueRub: 12000,
          cancelledShifts: 1
        }
      ],
      brandRows: [
        {
          brand: 'Brand A',
          orderedShifts: 10,
          workedShifts: 8,
          slaPercent: 80,
          revenueRub: 12000,
          uniqueWorkers: 5,
          workplacesWithOrders: 3,
          workplacesWithWorkedShifts: 2,
          cancelledShifts: 1,
          selfBookingPercent: 40,
          avgWorkerRateHour: 350
        }
      ],
      statusRows: [{ status: 'confirmed', shifts: 8 }]
    },
    currentUser: { role: 'analyst', permissions: ['sales-by-project', 'sql-inspector'] }
  });

  assert.match(html, /class="kpi-card metric-info-scope"/);
  assert.match(html, /data-sql-inspector-open="sales-by-project\.summary\.ordered-shifts"/);
  assert.match(html, /data-sql-inspector-open="sales-by-project\.summary\.avg-worker-rate-hour"/);
  assert.match(html, /data-sql-inspector-open="sales-by-project\.trend\.worked-shifts"/);
  assert.match(html, /data-sql-inspector-open="sales-by-project\.brands\.self-booking-percent"/);
  assert.match(html, /data-sql-inspector-open="sales-by-project\.statuses\.shifts"/);
});

test('renderSalesByProjectDashboard includes SQL inspector script for progressive fragments', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    progressive: true,
    currentUser: { role: 'analyst', permissions: ['sales-by-project', 'sql-inspector'] },
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-04-30'
      },
      summary: {},
      trendRows: [],
      brandRows: [],
      statusRows: []
    }
  });

  assert.match(html, /data-dashboard-fragment-url/);
  assert.match(html, /data-sql-inspector-open/);
});

test('renderHeatmapDashboardSection renders escaped SQL inspector for admins', () => {
  const html = renderHeatmapDashboardSection({
    currentUser: { role: 'admin', permissions: [] },
    section: 'map',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31'
      },
      summary: {},
      points: []
    }
  });

  assert.match(html, /data-sql-inspector-modal/);
  assert.match(html, /Тепловая карта/);
  assert.match(html, /<span class="sql-param">\{from:DateTime\}<\/span>/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
});

test('dashboard visual outputs render SQL inspectors on individual values', () => {
  const currentUser = { role: 'admin', permissions: [] };
  const workplaceHtml = renderWorkplaceAnalysisDashboardSection({
    currentUser,
    section: 'points',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 1,
        limit: 10
      },
      currentDate: '2026-05-10T00:00:00.000Z',
      pagination: {},
      points: [
        {
          workplaceId: 'wp-1',
          title: 'Point A',
          totalOrderedShifts: 20,
          slaPercent: 90,
          stabilityPercent: 70,
          activeGigers5km: 12,
          activeDays: 5,
          rangeDays: 31,
          avgDailyOrder: 2.5,
          heatmapDays: [{ date: '2026-05-01', amount: 4, completedShifts: 3, level: 2 }]
        }
      ]
    }
  });
  const pointHtml = renderWorkplacePointDashboardSection({
    currentUser,
    section: 'charts',
    dashboard: {
      filters: {
        workplaceId: 'wp-1',
        from: '2026-05-01',
        to: '2026-05-31',
        profession: [],
        orderType: [],
        jobStatus: []
      },
      currentDate: '2026-05-10T00:00:00.000Z',
      dailyRows: [
        {
          period: '2026-05-01',
          orderedShifts: 4,
          completedShifts: 3,
          slaPercent: 75,
          dropoffs24h: 1,
          orderLeadAvgMinutes: 120,
          orderLeadMinMinutes: 30
        }
      ],
      professionRows: [{ profession: 'Picker', orderedShifts: 4, sharePercent: 100 }]
    }
  });
  const cityHtml = renderCityAnalysisDashboardSection({
    currentUser,
    section: 'dynamics',
    dashboard: {
      dynamics: [
        {
          period: '2026-05-01',
          orderedShifts: 8,
          appActiveUsers: 5,
          bookedUsers: 3,
          completedUsers: 2,
          activeUsersPerRequest: 1.1
        }
      ]
    }
  });
  const heatmapHtml = renderHeatmapDashboardSection({
    currentUser,
    section: 'map',
    dashboard: {
      filters: { from: '2026-05-01', to: '2026-05-31' },
      summary: {
        pointsWithOrder: 2,
        orderedShifts: 10,
        weightedActiveUsers: 12.5,
        avgWeightedActiveUsersPerShift: 1.2
      },
      points: []
    }
  });

  assert.match(workplaceHtml, /data-sql-inspector-open="workplace-analysis\.points\.sla"/);
  assert.match(workplaceHtml, /data-sql-inspector-open="workplace-analysis\.points\.heatmap"/);
  assert.match(pointHtml, /data-sql-inspector-open="workplace-point\.charts\.calendar-sla"/);
  assert.doesNotMatch(pointHtml, /<button[^>]*class="point-calendar-cell-button"[\s\S]*<button[^>]*class="sql-inspector-button"/);
  assert.match(pointHtml, /data-sql-inspector-open="workplace-point\.charts\.professions"/);
  assert.match(cityHtml, /data-sql-inspector-open="city-analysis\.dynamics\.combo-ordered-shifts"/);
  assert.match(cityHtml, /data-sql-inspector-open="city-analysis\.dynamics\.heatmap-active-users-per-request"/);
  assert.match(heatmapHtml, /data-sql-inspector-open="heatmap\.map\.weighted-active-users"/);
});

test('renderSalesByProjectDashboard shows empty states', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        period: 'day',
        from: '2026-04-01',
        to: '2026-04-02'
      },
      summary: {
        orderedShifts: 0,
        workedShifts: 0,
        slaPercent: 0,
        revenueRub: 0,
        uniqueWorkers: 0,
        workplacesWithOrders: 0,
        workplacesWithWorkedShifts: 0,
        cancelledShifts: 0,
        selfBookingPercent: 0,
        avgWorkerRateHour: 0
      },
      trendRows: [],
      brandRows: [],
      statusRows: []
    }
  });

  assert.match(html, /Нет данных за выбранный период/);
  assert.match(html, /value="2026-04-01"/);
  assert.match(html, /value="2026-04-02"/);
});

test('renderSalesByProjectDashboard renders progressive fragments with generic loader', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-04-30'
      },
      summary: {
        orderedShifts: 0,
        workedShifts: 0,
        slaPercent: 0,
        revenueRub: 0,
        uniqueWorkers: 0,
        workplacesWithOrders: 0,
        workplacesWithWorkedShifts: 0,
        cancelledShifts: 0,
        selfBookingPercent: 0,
        avgWorkerRateHour: 0
      },
      trendRows: [],
      brandRows: [],
      statusRows: []
    }
  });

  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/sales-by-project\/section\?section=summary&amp;period=month&amp;from=2026-04-01&amp;to=2026-04-30"/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/sales-by-project\/section\?section=trend&amp;period=month&amp;from=2026-04-01&amp;to=2026-04-30"/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/sales-by-project\/section\?section=brands&amp;period=month&amp;from=2026-04-01&amp;to=2026-04-30"/);
  assert.match(html, /document\.querySelectorAll\('\[data-dashboard-fragment-url\]/);
  assert.match(html, /Загружается/);
  assert.doesNotMatch(html, /<(?:div|section)[^>]+data-city-analysis-fragment-url/);
});

test('renderWorkplaceAnalysisDashboard renders filters, cards, heatmap, and escapes values', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      currentDate: '2026-06-02',
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: ['<script>client</script>', 'Brand A'],
        city: ['Москва'],
        region: [],
        profession: ['driver'],
        orderType: ['regular'],
        jobStatus: ['confirmed'],
        contractor: ['<script>contractor</script>'],
        search: '<script>search</script>',
        includeDeletedOrders: true,
        includeHiddenOrders: false,
        sort: 'sla',
        slaFrom: 50,
        slaTo: 95,
        ordersFrom: 10,
        ordersTo: 100,
        stabilityFrom: 25,
        stabilityTo: 90,
        limit: 12
      },
      filterOptions: {
        client: ['<script>client</script>', 'Brand A', 'Brand B'],
        city: ['Москва', '<script>city option</script>'],
        region: ['Region A'],
        profession: ['driver', 'picker'],
        orderType: ['regular', 'once'],
        jobStatus: ['confirmed', 'failed'],
        contractor: ['<script>contractor</script>', 'Contractor B']
      },
      context: {
        sortLabel: '<script>sort</script>',
        maxDailyAmount: 6
      },
      points: [
        {
          workplaceId: 'wp1',
          title: '<script>bad</script>',
          clientTitle: '<b>Бренд</b>',
          city: '<script>city</script>',
          region: '<em>region</em>',
          address: '<img src=x onerror=alert(1)>',
          totalOrderedShifts: 9,
          activeDays: 2,
          rangeDays: 3,
          stabilityPercent: 66.66666666666666,
          slaPercent: 55.55555555555556,
          activeGigers5km: 17,
          avgDailyOrder: 4.5,
          heatmapDays: [
            { date: '2026-06-01', amount: 3, completedShifts: 2, level: 2 },
            { date: '2026-06-02', amount: 0, completedShifts: 0, level: 0 },
            { date: '<script>date</script>', amount: 6, completedShifts: 3, level: 4 }
          ]
        }
      ]
    }
  });

  assert.match(html, /Анализ точек/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/workplace-analysis"/);
  assert.match(html, /value="2026-06-01"/);
  assert.match(html, /value="2026-06-03"/);
  assert.match(html, /name="limit"/);
  assert.match(html, /<select id="sort" name="sort">/);
  assert.match(html, /<option value="orders">/);
  assert.match(html, /<option value="sla" selected>SLA<\/option>/);
  assert.match(html, /<option value="stability">/);
  assert.match(html, /<input id="slaFrom" name="slaFrom" type="number" min="0" max="100" step="0.1" value="50">/);
  assert.match(html, /<input id="slaTo" name="slaTo" type="number" min="0" max="100" step="0.1" value="95">/);
  assert.match(html, /<input id="ordersFrom" name="ordersFrom" type="number" min="0" step="1" value="10">/);
  assert.match(html, /<input id="ordersTo" name="ordersTo" type="number" min="0" step="1" value="100">/);
  assert.match(html, /<input id="stabilityFrom" name="stabilityFrom" type="number" min="0" max="100" step="0.1" value="25">/);
  assert.match(html, /<input id="stabilityTo" name="stabilityTo" type="number" min="0" max="100" step="0.1" value="90">/);
  assert.doesNotMatch(html, /<select id="client" name="client" multiple/);
  assert.match(html, /<div class="multi-filter" data-multi-filter>/);
  assert.match(html, /<button class="multi-filter-trigger" type="button"[^>]+data-multi-filter-trigger/);
  assert.match(html, /<span id="client-summary" class="multi-filter-summary" data-multi-filter-summary data-empty-label="Все">2 выбрано<\/span>/);
  assert.match(html, /<input class="multi-filter-search" type="search" placeholder="Поиск" aria-label="Поиск: Бренд" data-multi-filter-search>/);
  assert.match(html, /<button class="multi-filter-clear" type="button" data-multi-filter-clear>Очистить<\/button>/);
  assert.match(html, /<input type="checkbox" name="client" value="&lt;script&gt;client&lt;\/script&gt;" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="client" value="Brand A" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="client" value="Brand B" data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="profession" value="driver" checked data-multi-filter-checkbox>/);
  assert.match(html, /<span>Разовые<\/span>/);
  assert.match(html, /<input type="checkbox" name="orderType" value="regular" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="jobStatus" value="confirmed" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="jobStatus" value="failed" data-multi-filter-checkbox>/);
  assert.match(html, /<input id="includeDeletedOrders" name="includeDeletedOrders" type="checkbox" value="1" checked>/);
  assert.match(html, /<input id="includeHiddenOrders" name="includeHiddenOrders" type="checkbox" value="1">/);
  assert.match(html, /function updateMultiFilterSummary/);
  assert.match(html, /data-multi-filter-search/);
  assert.match(html, /<option value="10">10<\/option>/);
  assert.match(html, /<option value="12" selected>12<\/option>/);
  assert.match(html, /<option value="20">20<\/option>/);
  assert.match(html, /<option value="50">50<\/option>/);
  assert.match(html, /value="12" selected/);
  assert.match(html, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(html, /&lt;script&gt;client&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;sort&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;contractor&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;search&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /<a class="point-card-link point-card-title-block" href="\/dashboards\/workplace-analysis\/point\?[^"]*workplaceId=wp1[^"]*from=2026-06-01[^"]*profession=driver[^"]*jobStatus=confirmed[^"]*" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /data-giger-list-modal/);
  assert.match(html, /data-giger-detail-trigger/);
  assert.match(
    html,
    /data-detail-url="\/dashboards\/workplace-analysis\/gigers\?[^"]*metric=points-active-gigers-5km[^"]*workplaceId=wp1/
  );
  assert.doesNotMatch(html, /<a class="point-card-link"[\s\S]*data-giger-detail-trigger/);
  assert.match(html, /title="&lt;script&gt;date&lt;\/script&gt;: заказано 6; выполнено 3"/);
  assert.match(html, /\.heatmap-cell\.is-current-day/);
  assert.match(html, /<span class="heatmap-cell" data-date="2026-06-01" data-level="2" title="2026-06-01: заказано 3; выполнено 2"><\/span>/);
  assert.match(html, /<span class="heatmap-cell is-current-day" data-date="2026-06-02" data-level="0" aria-current="date" title="2026-06-02: заказано 0; выполнено 0"><\/span>/);
  assert.doesNotMatch(html, /<span class="heatmap-cell is-current-day" data-date="2026-06-01"/);
  assert.doesNotMatch(html, /<script>sort<\/script>/);
  assert.doesNotMatch(html, /<script>contractor<\/script>/);
  assert.doesNotMatch(html, /<script>search<\/script>/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
  assert.doesNotMatch(html, /<b>Бренд<\/b>/);
  assert.doesNotMatch(html, /<script>city<\/script>/);
  assert.doesNotMatch(html, /<em>region<\/em>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<script>date<\/script>/);
  assert.doesNotMatch(html, /class="point-subtitle"/);
  assert.doesNotMatch(html, /class="stability-badge"/);
  assert.doesNotMatch(html, /class="heatmap-legend"/);
  assert.doesNotMatch(html, /class="legend-cell"/);
  assert.doesNotMatch(html, /&lt;b&gt;Бренд&lt;\/b&gt;/);
  assert.doesNotMatch(html, /&lt;script&gt;city&lt;\/script&gt;/);
  assert.doesNotMatch(html, /&lt;em&gt;region&lt;\/em&gt;/);
  assert.doesNotMatch(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Заказано/);
  assert.match(html, /9/);
  assert.match(html, /Стабильность/);
  assert.match(html, /SLA/);
  assert.match(html, /55\.6%/);
  assert.match(html, /66\.7%/);
  assert.match(html, /Гигеры 5 км/);
  assert.match(html, /17/);
  assert.match(html, /data-level="4"/);
});

test('renderWorkplaceAnalysisDashboard renders attention tab progressive container', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: ['Бренд'],
        city: ['Москва'],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        search: '',
        includeDeletedOrders: false,
        includeHiddenOrders: false,
        sort: 'orders',
        limit: 12
      },
      filterOptions: {
        client: ['Бренд'],
        city: ['Москва'],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: []
      },
      context: { sortLabel: 'Сначала крупнейшие по заказу', maxDailyAmount: 0 },
      points: []
    }
  });

  assert.match(html, /Обзор точек/);
  assert.match(html, /Требуют внимания/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/workplace-analysis\/section\?section=attention/);
});

test('renderWorkplaceAnalysisDashboardSection renders attention table without personal data', () => {
  const html = renderWorkplaceAnalysisDashboardSection({
    section: 'attention',
    dashboard: {
      filters: {
        attentionFrom: '2026-06-04',
        attentionTo: '2026-06-11'
      },
      attentionPoints: [
        {
          workplaceId: 'wp1',
          title: '<script>Север</script>',
          clientTitle: 'Бренд',
          city: 'Москва',
          address: 'Ленина 1',
          free7d: 6,
          ordered7d: 10,
          covered7d: 4,
          coveragePercent: 40,
          freeProfessions7d: [
            { profession: 'Picker<script>', free7d: 4 },
            { profession: 'Courier', free7d: 2 }
          ],
          maxDailyFree: 5,
          nearestFreeDate: '2026-06-04',
          totalWorkers15km: 20,
          activeWorkers30d15km: 3,
          activeWorkersPerFreeShift: 0.5,
          activeWorkers30dByStatus15km: { ready: 2, booked: 1, worked: 0, other: 0 },
          totalWorkersByStatus15km: { ready: 8, booked: 2, worked: 1, other: 9 },
          riskSeverity: 'medium',
          riskReasons: [{ kind: 'free-order', label: 'пик в ближайшие дни' }]
        }
      ]
    }
  });

  assert.match(html, /Точки, требующие внимания/);
  assert.match(html, /Своб\. 7д/);
  assert.match(html, /&lt;script&gt;Север&lt;\/script&gt;/);
  assert.match(html, /attention-profession-breakdown/);
  assert.match(html, /class="attention-profession-line">Picker&lt;script&gt; 4<\/span>/);
  assert.match(html, /class="attention-profession-line">Courier 2<\/span>/);
  assert.match(html, /class="attention-status-line">ready [\s\S]*>2<\/button><\/span>/);
  assert.match(html, /class="attention-status-line">booked [\s\S]*>1<\/button><\/span>/);
  assert.match(html, /class="attention-status-line">worked [\s\S]*>0<\/button><\/span>/);
  assert.match(html, /class="attention-status-line">прочие [\s\S]*>0<\/button><\/span>/);
  assert.match(html, /пик в ближайшие дни/);
  assert.match(html, /data-giger-detail-trigger/);
  assert.match(
    html,
    /data-detail-url="\/dashboards\/workplace-analysis\/gigers\?[^"]*metric=attention-total-workers-15km[^"]*workplaceId=wp1/
  );
  assert.match(
    html,
    /data-detail-url="\/dashboards\/workplace-analysis\/gigers\?[^"]*metric=attention-active-workers-30d-15km[^"]*status=ready[^"]*workplaceId=wp1/
  );
  assert.doesNotMatch(html, /phone|email|firstname|lastname/i);
});

test('renderWorkplaceAnalysisDashboardSection renders attention risk badges, reasons, and detail links', () => {
  const html = renderWorkplaceAnalysisDashboardSection({
    section: 'attention',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-15',
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        search: '',
        includeDeletedOrders: false,
        includeHiddenOrders: false,
        attentionPage: 1,
        attentionPageSize: 15,
        attentionSort: 'free7d',
        attentionDirection: 'desc'
      },
      attentionPoints: [
        {
          workplaceId: 'wp-risk',
          title: 'Точка риска',
          clientTitle: 'Brand A',
          address: 'Москва, Ленина 1',
          free7d: 9,
          ordered7d: 12,
          covered7d: 3,
          coveragePercent: 25,
          maxDailyFree: 6,
          nearestFreeDate: '2026-06-04',
          activeWorkers30d15km: 2,
          activeWorkersPerFreeShift: 0.2,
          riskSeverity: 'high',
          riskScore: 90,
          attentionDetailDate: '2026-06-04',
          riskReasons: [
            { kind: 'free-order', label: 'Свободный заказ 9 за 7 дней' },
            { kind: 'coverage', label: 'Покрытие 25%' },
            { kind: 'active-base', label: 'Актив 0,2 на свободную смену' }
          ]
        }
      ],
      attentionPagination: {
        page: 1,
        pageSize: 15,
        totalWorkplaces: 1,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false
      }
    }
  });

  assert.match(html, /risk-badge risk-high/);
  assert.match(html, /Высокий/);
  assert.match(html, /Свободный заказ 9 за 7 дней/);
  assert.match(html, /Покрытие 25%/);
  assert.match(html, /Актив 0,2 на свободную смену/);
  assert.match(html, /\/dashboards\/workplace-analysis\/point\?workplaceId=wp-risk/);
  assert.match(html, /2026-06-04/);
  assert.doesNotMatch(html, /<html/);
});

test('renderWorkplaceAnalysisDashboardSection calculates attention reasons for legacy cached rows', () => {
  const html = renderWorkplaceAnalysisDashboardSection({
    section: 'attention',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-15',
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        search: '',
        includeDeletedOrders: false,
        includeHiddenOrders: false,
        attentionPage: 1,
        attentionPageSize: 15,
        attentionSort: 'free7d',
        attentionDirection: 'desc'
      },
      attentionPoints: [
        {
          workplaceId: 'wp-cached',
          title: 'Cached point',
          free7d: 9,
          ordered7d: 12,
          covered7d: 3,
          coveragePercent: 25,
          maxDailyFree: 6,
          activeWorkers30d15km: 2,
          activeWorkersPerFreeShift: 0.2,
          riskSeverity: 'high'
        }
      ],
      attentionPagination: {
        page: 1,
        pageSize: 15,
        totalWorkplaces: 1,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false
      }
    }
  });

  assert.match(html, /attention-reason-free-order/);
  assert.match(html, /attention-reason-coverage/);
  assert.match(html, /attention-reason-active-base/);
  assert.match(html, /attention-reason-peak-day/);
  assert.doesNotMatch(html, /attention-reason-muted/);
});

test('renderWorkplaceAnalysisDashboardSection renders compact sortable attention table without horizontal scroll', () => {
  const html = renderWorkplaceAnalysisDashboardSection({
    section: 'attention',
    currentUser: { role: 'analyst', permissions: ['workplace-analysis', 'sql-inspector'] },
    dashboard: {
      filters: {
        attentionFrom: '2026-06-04',
        attentionTo: '2026-06-11',
        from: '2026-06-01',
        to: '2026-06-04',
        attentionPage: 1,
        attentionPageSize: 15,
        attentionSort: 'attentionScore',
        attentionDirection: 'desc'
      },
      attentionPoints: [
        {
          workplaceId: 'wp1',
          title: 'Длинное название точки',
          clientTitle: 'Бренд',
          city: 'Москва',
          address: 'Ленина 1',
          free7d: 124,
          ordered7d: 200,
          covered7d: 76,
          coveragePercent: 38,
          maxDailyFree: 21,
          nearestFreeDate: '2026-06-04',
          totalWorkers15km: 52386,
          activeWorkers30d15km: 986,
          activeWorkersPerFreeShift: 8,
          activeWorkers30dByStatus15km: { ready: 17, booked: 2, worked: 5, other: 0 },
          totalWorkersByStatus15km: { ready: 3562, booked: 32, worked: 2209, other: 46583 },
          priorityReason: 'пик в ближайшие дни'
        }
      ],
      attentionPagination: {
        page: 1,
        pageSize: 15,
        totalWorkplaces: 16,
        totalPages: 2,
        hasPrevious: false,
        hasNext: true
      }
    }
  });
  const pageHtml = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-04',
        rangeDays: 4,
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        search: '',
        includeDeletedOrders: false,
        includeHiddenOrders: false,
        sort: 'orders',
        limit: 12
      },
      filterOptions: {
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: []
      },
      context: { sortLabel: 'Сначала крупнейшие по заказу', maxDailyAmount: 0 },
      points: []
    }
  });

  assert.match(html, /<table class="attention-table">/);
  assert.match(html, /class="attention-point-cell"/);
  assert.match(html, /attention-stack-cell/);
  assert.match(html, /class="attention-metric-content"/);
  assert.match(html, /attention-status-breakdown/);
  assert.match(html, /class="attention-status-line">ready [\s\S]*>3 562<\/button><\/span>/);
  assert.match(
    html,
    /<td class="number-cell attention-stack-cell metric-info-scope">[\s\S]*<div class="attention-metric-inline">[\s\S]*<div class="attention-metric-content">[\s\S]*52 386[\s\S]*<\/div><button type="button" class="sql-inspector-button"/
  );
  assert.doesNotMatch(html, /ready 3 562 · booked 32 · worked 2 209 · прочие 46 583/);
  assert.match(html, /class="sortable-header"/);
  assert.match(html, /attentionSort=free7d/);
  assert.match(html, /attentionDirection=asc/);
  assert.match(html, /attentionPage=2/);
  assert.match(html, /Страница 1 из 2/);
  assert.doesNotMatch(html, /table-scroll/);
  assert.doesNotMatch(pageHtml, /\.attention-table\s*\{[^}]*min-width: 1280px;/);
  assert.match(pageHtml, /\.attention-table\s*\{[^}]*min-width: 0;/);
  assert.doesNotMatch(pageHtml, /\.attention-table td\.metric-info-scope\s*\{[^}]*display:\s*flex/);
  assert.match(pageHtml, /\.attention-metric-inline\s*\{[^}]*display:\s*flex/);
});

test('renderWorkplaceAnalysisDashboard aligns heatmap columns from Monday to Sunday', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-03',
        to: '2026-06-05',
        rangeDays: 3,
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: [],
        search: '',
        limit: 12
      },
      filterOptions: {
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: []
      },
      context: {
        sortLabel: 'orders first',
        maxDailyAmount: 3
      },
      points: [
        {
          workplaceId: 'wp1',
          title: 'Point',
          clientTitle: 'Brand',
          city: 'Moscow',
          region: 'Moscow',
          address: 'Street',
          totalOrderedShifts: 6,
          activeDays: 3,
          rangeDays: 3,
          stabilityPercent: 100,
          avgDailyOrder: 2,
          heatmapDays: [
            { date: '2026-06-03', amount: 1, completedShifts: 1, level: 1 },
            { date: '2026-06-04', amount: 2, completedShifts: 1, level: 2 },
            { date: '2026-06-05', amount: 3, completedShifts: 2, level: 4 }
          ]
        }
      ]
    }
  });
  const firstEmptyIndex = html.indexOf('<span class="heatmap-cell empty"');
  const firstDateIndex = html.indexOf('title="2026-06-03: заказано 1; выполнено 1"');

  assert.match(html, /grid-auto-flow: column/);
  assert.match(html, /grid-template-rows: repeat\(7, 10px\)/);
  assert.equal(countOccurrences(html, '<span class="heatmap-cell empty"'), 4);
  assert.ok(firstEmptyIndex > -1);
  assert.ok(firstEmptyIndex < firstDateIndex);
});

test('renderWorkplaceAnalysisDashboard keeps long point titles from stretching cards', () => {
  const longTitle = 'Very long workplace title with branch number 123 and extra operational qualifiers repeated repeated repeated';
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: [],
        search: '',
        limit: 12
      },
      filterOptions: {
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: []
      },
      context: {
        sortLabel: 'orders first',
        maxDailyAmount: 3
      },
      points: [
        {
          workplaceId: 'wp-long-title',
          title: longTitle,
          totalOrderedShifts: 6,
          activeDays: 2,
          rangeDays: 3,
          stabilityPercent: 66.66666666666666,
          slaPercent: 75,
          activeGigers5km: 4,
          avgDailyOrder: 3,
          heatmapDays: [
            { date: '2026-06-01', amount: 3, completedShifts: 2, level: 4 }
          ]
        }
      ]
    }
  });

  assert.match(html, /\.point-card-head\s*\{[^}]*display:\s*block;[\s\S]*?font-size:\s*11px;[\s\S]*?min-height:\s*calc\(3 \* 1\.25em\);[\s\S]*?max-height:\s*calc\(3 \* 1\.25em\);[\s\S]*?overflow:\s*hidden;/);
  assert.match(html, /\.point-pin-form\s*\{[^}]*float:\s*right;/);
  assert.match(html, /\.point-card-title-block\s*\{[^}]*display:\s*inline;/);
  assert.match(html, /\.point-title\s*\{[^}]*font-size:\s*11px;[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(
    html,
    new RegExp(`<div class="point-card-head">\\s*<form[\\s\\S]*?<a class="point-card-link point-card-title-block"`)
  );
  assert.match(html, new RegExp(`<span class="point-title" title="${escapeRegExp(escapeHtml(longTitle))}">${escapeRegExp(escapeHtml(longTitle))}</span>`));
});

test('renderWorkplaceAnalysisDashboard keeps point metric values on one line', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: [],
        search: '',
        limit: 12
      },
      filterOptions: {
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: []
      },
      context: {
        sortLabel: 'orders first',
        maxDailyAmount: 3
      },
      points: [
        {
          workplaceId: 'wp-metric-value',
          title: 'Point',
          totalOrderedShifts: 6,
          activeDays: 3,
          rangeDays: 3,
          stabilityPercent: 100,
          slaPercent: 100,
          activeGigers5km: 1234567890,
          avgDailyOrder: 3,
          heatmapDays: []
        }
      ]
    }
  });

  assert.match(html, /\.point-metric-value\s*\{[^}]*white-space:\s*nowrap;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;/);
  assert.doesNotMatch(html, /\.point-metric-value\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(html, />100\.0%<\/div>/);
});

test('renderWorkplaceAnalysisDashboard renders pin checkboxes and preserves pinned workplaces', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        pinnedWorkplaceIds: ['wp1'],
        client: ['Brand A'],
        city: [],
        region: [],
        profession: ['picker'],
        orderType: [],
        jobStatus: [],
        contractor: [],
        search: '',
        limit: 10,
        page: 1,
        offset: 0
      },
      filterOptions: {
        client: ['Brand A'],
        city: [],
        region: [],
        profession: ['picker'],
        orderType: [],
        jobStatus: [],
        contractor: []
      },
      context: {
        sortLabel: 'orders first',
        maxDailyAmount: 3
      },
      points: [
        {
          workplaceId: 'wp1',
          title: 'Pinned point',
          pinned: true,
          totalOrderedShifts: 6,
          activeDays: 2,
          rangeDays: 3,
          stabilityPercent: 66.66666666666666,
          slaPercent: 75,
          activeGigers5km: 4,
          avgDailyOrder: 3,
          heatmapDays: [
            { date: '2026-06-01', amount: 3, completedShifts: 2, level: 4 }
          ]
        },
        {
          workplaceId: 'wp2',
          title: 'Regular point',
          pinned: false,
          totalOrderedShifts: 4,
          activeDays: 1,
          rangeDays: 3,
          stabilityPercent: 33.33333333333333,
          slaPercent: 50,
          activeGigers5km: 2,
          avgDailyOrder: 4,
          heatmapDays: [
            { date: '2026-06-01', amount: 2, completedShifts: 1, level: 3 }
          ]
        }
      ],
      pagination: {
        page: 1,
        limit: 10,
        totalWorkplaces: 20,
        totalPages: 2,
        hasPrevious: false,
        hasNext: true
      }
    }
  });

  assert.match(html, /<article class="point-card pinned">/);
  assert.match(html, /<input type="hidden" name="pinnedWorkplaceId" value="wp1">/);
  assert.match(html, /<form class="point-pin-form" action="\/dashboards\/workplace-analysis" method="get" data-workplace-pin-form="1">/);
  assert.match(html, /<input name="pinnedWorkplaceId" type="checkbox" value="wp1" checked>/);
  assert.match(html, /<input name="pinnedWorkplaceId" type="checkbox" value="wp2">/);
  assert.doesNotMatch(html, /onchange="this\.form\.submit\(\)"/);
  assert.match(html, /function updatePinnedWorkplaceState\(form\)/);
  assert.match(html, /window\.history\.replaceState\(\{\}, '', href\);/);
  assert.match(html, /href="\/dashboards\/workplace-analysis\?from=2026-06-01&amp;to=2026-06-03&amp;pinnedWorkplaceId=wp1&amp;client=Brand\+A&amp;profession=picker&amp;limit=10&amp;page=2">/);
});

test('renderWorkplacePointDashboard renders unified header and preserves point calendar actions', () => {
  const html = renderWorkplacePointDashboard({
    database: 'etl',
    progressive: false,
    dashboard: {
      filters: {
        workplaceId: 'wp-risk',
        from: '2026-06-01',
        to: '2026-06-15',
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        salaryFrom: null,
        salaryTo: null,
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      currentDate: '2026-06-04',
      point: {
        workplaceId: 'wp-risk',
        title: 'Точка риска',
        clientTitle: 'Brand A',
        address: 'Москва, Ленина 1'
      },
      summary: {
        orderedShifts: 12,
        completedShifts: 3,
        slaPercent: 25,
        stabilityPercent: 40,
        uniqueCompletedWorkers: 3,
        uniqueBookedWorkers: 4,
        ratingAvg: 4.2,
        ratingCount: 5,
        dropoffs24h: 2,
        radius5km: 2,
        radius10km: 4,
        radius15km: 8,
        radius20km: 12
      },
      dailyRows: [
        {
          date: '2026-06-04',
          period: '2026-06-04',
          orderedShifts: 6,
          completedShifts: 1,
          slaPercent: 16.666,
          dropoffs24h: 2,
          orderLeadAvgMinutes: 60,
          orderLeadMinMinutes: 20
        }
      ],
      professionRows: []
    }
  });

  assert.match(html, /dashboard-header/);
  assert.match(html, /Карточка точки/);
  assert.match(html, /Точка риска/);
  assert.match(html, /Москва, Ленина 1/);
  assert.match(html, /data-workplace-point-day-detail-trigger/);
  assert.match(html, /data-sla-level="1"[^>]*data-risk-level="high"/);
  assert.match(html, /data-risk-level="high"/);
  assert.match(html, /2026-06-04/);

  const lastSlaRuleIndex = html.indexOf('.point-calendar-cell[data-sla-level="5"]');
  const highRiskRuleIndex = html.indexOf('.point-calendar-cell[data-risk-level="high"]');
  const mediumRiskRuleIndex = html.indexOf('.point-calendar-cell[data-risk-level="medium"]');

  assert.ok(lastSlaRuleIndex > -1);
  assert.ok(highRiskRuleIndex > lastSlaRuleIndex);
  assert.ok(mediumRiskRuleIndex > lastSlaRuleIndex);
});

test('renderWorkplacePointDashboard renders filters, point metrics, and compact charts', () => {
  const html = renderWorkplacePointDashboard({
    database: 'etl',
    dashboard: {
      currentDate: '2026-06-03',
      filters: {
        workplaceId: 'wp1',
        from: '2026-06-01',
        to: '2026-07-02',
        profession: ['picker'],
        orderType: ['regular'],
        jobStatus: ['confirmed'],
        includeDeletedOrders: false,
        includeHiddenOrders: true
      },
      point: {
        workplaceId: 'wp1',
        title: '<script>Point</script>',
        clientTitle: 'Brand',
        city: 'Moscow',
        region: 'Moscow',
        address: 'Moscow, Lenina 10'
      },
      filterOptions: {
        profession: ['picker', 'driver'],
        orderType: ['regular', 'once'],
        jobStatus: ['confirmed', 'failed']
      },
      summary: {
        orderedShifts: 12,
        completedShifts: 9,
        slaPercent: 75,
        stabilityPercent: 50,
        uniqueCompletedWorkers: 5,
        uniqueBookedWorkers: 8,
        ratingAll: 4.6,
        ratingLast10: 4.8,
        ratingReviewCount: 34,
        dropoffs24h: 2,
        radiusWorkers: {
          5: 11,
          10: 23,
          15: 31,
          20: 45
        },
        radiusActiveSessionWorkers: {
          5: 4,
          10: 9,
          15: 12,
          20: 18
        }
      },
      dailyRows: [
        {
          period: '2026-06-01',
          orderedShifts: 7,
          completedShifts: 5,
          slaPercent: 71.42857142857143,
          dropoffs24h: 1,
          orderLeadAvgMinutes: 2160,
          orderLeadMinMinutes: 240
        },
        {
          period: '2026-06-02',
          orderedShifts: 3,
          completedShifts: 3,
          slaPercent: 100,
          dropoffs24h: 0,
          orderLeadAvgMinutes: null,
          orderLeadMinMinutes: null
        },
        {
          period: '2026-07-01',
          orderedShifts: 4,
          completedShifts: 1,
          slaPercent: 25,
          dropoffs24h: 2,
          orderLeadAvgMinutes: 90,
          orderLeadMinMinutes: 30
        }
      ],
      professionRows: [
        {
          profession: 'picker',
          orderedShifts: 9,
          sharePercent: 75
        }
      ]
    }
  });

  assert.match(html, /Детализация точки/);
  assert.match(html, /&lt;script&gt;Point&lt;\/script&gt;/);
  assert.match(html, /value="2026-06-01"/);
  assert.match(html, /value="wp1"/);
  assert.match(html, /<input type="checkbox" name="profession" value="picker" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input id="includeHiddenOrders" name="includeHiddenOrders" type="checkbox" value="1" checked>/);
  assert.match(html, /Уникальные завершали/);
  assert.match(html, /Уникальные бронировали/);
  assert.match(html, /Слеты &lt; 24ч/);
  assert.match(html, /5 км/);
  assert.match(html, /20 км/);
  assert.match(html, /class="detail-grid point-detail-grid"/);
  assert.match(html, /<div class="detail-panel calendar-panel">/);
  assert.match(html, /class="point-calendar"/);
  assert.match(html, /class="point-calendar-weekdays"/);
  assert.match(html, /class="point-calendar-grid"/);
  assert.match(html, /class="point-calendar-cell"/);
  assert.match(html, /\.point-calendar-cell\.is-current-day/);
  assert.match(html, /data-workplace-point-day-modal/);
  assert.match(html, /data-workplace-point-day-modal-body/);
  assert.match(html, /data-workplace-point-review-modal/);
  assert.match(html, /data-workplace-point-review-modal-body/);
  assert.match(html, /data-workplace-point-review-trigger/);
  assert.match(html, /4\.6 \/ 4\.8/);
  assert.match(html, /data-detail-url="\/dashboards\/workplace-analysis\/point\/reviews\?workplaceId=wp1"/);
  assert.match(html, /data-giger-list-modal/);
  assert.match(html, /data-giger-detail-trigger/);
  assert.match(
    html,
    /data-detail-url="\/dashboards\/workplace-analysis\/point\/gigers\?[^"]*metric=unique-completed-workers/
  );
  assert.match(
    html,
    /data-detail-url="\/dashboards\/workplace-analysis\/point\/gigers\?[^"]*metric=unique-booked-workers/
  );
  assert.match(
    html,
    /data-detail-url="\/dashboards\/workplace-analysis\/point\/gigers\?[^"]*metric=radius-active-session-workers[^"]*radiusKm=15/
  );
  assert.match(html, /metric=radius-workers[^"]*radiusKm=5[\s\S]*>11<\/button>\s*\/\s*<button[\s\S]*metric=radius-active-session-workers[^"]*radiusKm=5[\s\S]*>4<\/button>/);
  assert.match(html, /metric=radius-workers[^"]*radiusKm=20[\s\S]*>45<\/button>\s*\/\s*<button[\s\S]*metric=radius-active-session-workers[^"]*radiusKm=20[\s\S]*>18<\/button>/);
  assert.match(html, /2026-06-02/);
  assert.match(html, /Календарь заказа и SLA/);
  assert.match(html, /Профессии точки/);
  assert.match(html, /75\.0%/);
  assert.doesNotMatch(html, /<script>Point<\/script>/);
  assert.doesNotMatch(html, /Заказ и SLA по дням/);
  assert.doesNotMatch(html, /Слеты по дням/);
  assert.doesNotMatch(html, /class="compact-value-list"/);

  const calendarPanelStart = html.indexOf('<div class="detail-panel calendar-panel">');
  const professionPanelStart = html.indexOf('<div class="detail-panel profession-panel">');
  const calendarPanelHtml = html.slice(calendarPanelStart, professionPanelStart);

  assert.ok(calendarPanelStart > -1);
  assert.ok(professionPanelStart > calendarPanelStart);
  assert.doesNotMatch(calendarPanelHtml, /mini-chart-track/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-weekday">Пн<\/div>/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-weekday">Вс<\/div>/);
  assert.match(calendarPanelHtml, /<h3 class="point-calendar-month-title">Июнь 2026<\/h3>/);
  assert.match(calendarPanelHtml, /<h3 class="point-calendar-month-title">Июль 2026<\/h3>/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-cell" data-date="2026-06-01" data-sla-level="4"/);
  assert.match(calendarPanelHtml, /data-workplace-point-day-detail-trigger/);
  assert.match(calendarPanelHtml, /data-detail-url="\/dashboards\/workplace-analysis\/point\/details\?[^"]*workplaceId=wp1[^"]*date=2026-06-01/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-date">1<\/div>/);
  assert.match(calendarPanelHtml, /<span title="Заказ">З<\/span>\s*<strong>7<\/strong>/);
  assert.match(calendarPanelHtml, /<span title="SLA">SLA<\/span>\s*<strong>71\.4%<\/strong>/);
  assert.match(calendarPanelHtml, /<span title="Слеты">Сл<\/span>\s*<strong>1<\/strong>/);
  assert.match(calendarPanelHtml, /<span title="Размещение среднее">Ср<\/span>\s*<strong>1д12ч<\/strong>/);
  assert.match(calendarPanelHtml, /<span title="Размещение минимум">М<\/span>\s*<strong>4ч<\/strong>/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-cell" data-date="2026-06-02" data-sla-level="5"/);
  assert.match(calendarPanelHtml, /<span title="Слеты">Сл<\/span>\s*<strong>0<\/strong>/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-cell is-current-day" data-date="2026-06-03" aria-current="date" title=/);
  assert.doesNotMatch(calendarPanelHtml, /data-date="2026-06-03" data-sla-level=/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-cell" data-date="2026-06-30"/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-date">30<\/div>/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-cell" data-date="2026-07-01" data-sla-level="1"/);
  assert.match(calendarPanelHtml, /<span title="Размещение среднее">Ср<\/span>\s*<strong>1ч30м<\/strong>/);
  assert.match(calendarPanelHtml, /<span title="Размещение минимум">М<\/span>\s*<strong>30м<\/strong>/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-cell" data-date="2026-07-02" title=/);
  assert.doesNotMatch(calendarPanelHtml, /data-date="2026-07-02" data-sla-level=/);
  assert.equal(countOccurrences(calendarPanelHtml, 'class="point-calendar-date"'), 32);
});

test('renderWorkplacePointDayDetails renders escaped compact table fragment', () => {
  const html = renderWorkplacePointDayDetails({
    details: {
      date: '2026-06-02',
      rows: [
        {
          orderId: 'order-1',
          jobId: 'job-1',
          profession: '<bad>',
          orderStartLocal: '2026-06-02 09:00:00',
          plannedHours: 8,
          workerFullName: 'Иванов <Иван>',
          workerPhone: '+79990000000',
          confirmedStatus: 'confirmed',
          actualHours: 7.5,
          actualTimeLocal: '2026-06-02 09:10 - 2026-06-02 16:40',
          paymentAmount: 4500,
          cancelledShifts: 0,
          lastCancelledAtLocal: ''
        }
      ]
    }
  });

  assert.match(html, /Детализация дня: 2026-06-02/);
  assert.match(html, /<th>Заказ<\/th>/);
  assert.match(html, /<th>Профессия<\/th>/);
  assert.match(html, /<th>Старт<\/th>/);
  assert.match(html, /<th>План<\/th>/);
  assert.match(html, /<th>Гигер<\/th>/);
  assert.match(html, /<th>Телефон<\/th>/);
  assert.match(html, /<th>Статус<\/th>/);
  assert.match(html, /order-1/);
  assert.match(html, /&lt;bad&gt;/);
  assert.match(html, /Иванов &lt;Иван&gt;/);
  assert.match(html, /\+79990000000/);
  assert.match(html, /confirmed/);
  assert.match(html, /7\.5/);
  assert.match(html, /class="actual-time-cell"/);
  assert.match(html, /<col class="actual-time-col">/);
  assert.match(html, /4 500/);
  assert.match(html, /class="compact-detail-table"/);
  assert.doesNotMatch(html, /<html/);
});

test('renderWorkplacePointReviews renders escaped review fragment', () => {
  const html = renderWorkplacePointReviews({
    details: {
      reviews: [
        {
          reviewId: 'review-1',
          jobId: 'job-1',
          rating: 5,
          text: 'Отзыв <script>',
          authorFullName: 'Иван <Иванов>',
          authorPhone: '+79990000000',
          createdAtLocal: '2026-06-05 12:00:00'
        }
      ]
    }
  });

  assert.match(html, /Отзывы точки/);
  assert.match(html, /<th>Оценка<\/th>/);
  assert.match(html, /<th>ФИО<\/th>/);
  assert.match(html, /<th>Телефон<\/th>/);
  assert.match(html, /<th>Дата<\/th>/);
  assert.match(html, /<th>Отзыв<\/th>/);
  assert.match(html, /Иван &lt;Иванов&gt;/);
  assert.match(html, /\+79990000000/);
  assert.match(html, /05\.06\.2026 12:00/);
  assert.match(html, /Отзыв &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<html/);
});

test('renderWorkplaceAnalysisDashboard renders pagination links with current filters', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: ['Brand A'],
        city: ['Moscow', 'Kazan'],
        region: [],
        profession: [],
        orderType: ['regular'],
        jobStatus: ['confirmed', 'failed'],
        contractor: [],
        search: 'North hub',
        limit: 10,
        page: 2,
        offset: 10
      },
      filterOptions: {
        client: ['Brand A'],
        city: ['Moscow', 'Kazan'],
        region: [],
        profession: [],
        orderType: ['regular'],
        jobStatus: ['confirmed', 'failed'],
        contractor: []
      },
      context: {
        sortLabel: 'orders first',
        maxDailyAmount: 0
      },
      points: [],
      pagination: {
        page: 2,
        limit: 10,
        totalWorkplaces: 45,
        totalPages: 5,
        hasPrevious: true,
        hasNext: true
      }
    }
  });

  assert.match(html, /<nav class="pagination" aria-label="Пагинация точек">/);
  assert.match(html, /Страница 2/);
  assert.match(html, /aria-current="page">2<\/span>/);
  assert.match(html, /<a class="pagination-link pagination-page" href="\/dashboards\/workplace-analysis\?from=2026-06-01&amp;to=2026-06-03&amp;client=Brand\+A&amp;city=Moscow&amp;city=Kazan&amp;orderType=regular&amp;jobStatus=confirmed&amp;jobStatus=failed&amp;search=North\+hub&amp;limit=10">1<\/a>/);
  assert.match(html, /<a class="pagination-link pagination-page" href="\/dashboards\/workplace-analysis\?from=2026-06-01&amp;to=2026-06-03&amp;client=Brand\+A&amp;city=Moscow&amp;city=Kazan&amp;orderType=regular&amp;jobStatus=confirmed&amp;jobStatus=failed&amp;search=North\+hub&amp;limit=10&amp;page=3">3<\/a>/);
  assert.match(html, /<form class="pagination-jump" action="\/dashboards\/workplace-analysis" method="get">/);
  assert.match(html, /<input type="hidden" name="client" value="Brand A">/);
  assert.match(html, /<input type="hidden" name="city" value="Moscow">/);
  assert.match(html, /<input type="hidden" name="city" value="Kazan">/);
  assert.match(html, /<input type="hidden" name="jobStatus" value="confirmed">/);
  assert.match(html, /<input type="hidden" name="jobStatus" value="failed">/);
  assert.match(html, /name="page" type="number" min="1" max="5" value="2"/);
  assert.match(
    html,
    /href="\/dashboards\/workplace-analysis\?from=2026-06-01&amp;to=2026-06-03&amp;client=Brand\+A&amp;city=Moscow&amp;city=Kazan&amp;orderType=regular&amp;jobStatus=confirmed&amp;jobStatus=failed&amp;search=North\+hub&amp;limit=10">Назад/
  );
  assert.match(
    html,
    /href="\/dashboards\/workplace-analysis\?from=2026-06-01&amp;to=2026-06-03&amp;client=Brand\+A&amp;city=Moscow&amp;city=Kazan&amp;orderType=regular&amp;jobStatus=confirmed&amp;jobStatus=failed&amp;search=North\+hub&amp;limit=10&amp;page=3">Вперед/
  );
});

test('renderWorkplaceAnalysisDashboard preserves deleted and hidden order flags in pagination', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        search: '',
        includeDeletedOrders: true,
        includeHiddenOrders: true,
        limit: 10,
        page: 2,
        offset: 10
      },
      filterOptions: {
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: []
      },
      context: {
        sortLabel: 'orders first',
        maxDailyAmount: 0
      },
      points: [],
      pagination: {
        page: 2,
        limit: 10,
        totalWorkplaces: 25,
        totalPages: 3,
        hasPrevious: true,
        hasNext: true
      }
    }
  });

  assert.match(html, /includeDeletedOrders=1/);
  assert.match(html, /includeHiddenOrders=1/);
  assert.match(html, /<input type="hidden" name="includeDeletedOrders" value="1">/);
  assert.match(html, /<input type="hidden" name="includeHiddenOrders" value="1">/);
});

test('renderWorkplaceAnalysisDashboard preserves sort in pagination', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        search: '',
        sort: 'stability',
        slaFrom: 50,
        ordersTo: 100,
        stabilityFrom: 25,
        limit: 10,
        page: 2,
        offset: 10
      },
      filterOptions: {
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: []
      },
      context: {
        sortLabel: 'stability first',
        maxDailyAmount: 0
      },
      points: [],
      pagination: {
        page: 2,
        limit: 10,
        totalWorkplaces: 25,
        totalPages: 3,
        hasPrevious: true,
        hasNext: true
      }
    }
  });

  assert.match(html, /sort=stability/);
  assert.match(html, /slaFrom=50/);
  assert.match(html, /ordersTo=100/);
  assert.match(html, /stabilityFrom=25/);
  assert.match(html, /<input type="hidden" name="sort" value="stability">/);
  assert.match(html, /<input type="hidden" name="slaFrom" value="50">/);
  assert.match(html, /<input type="hidden" name="ordersTo" value="100">/);
  assert.match(html, /<input type="hidden" name="stabilityFrom" value="25">/);
});

test('renderWorkplaceAnalysisDashboard shows empty state', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: [],
        search: '',
        limit: 12
      },
      filterOptions: {
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: []
      },
      context: {
        sortLabel: 'Сначала крупнейшие по заказу',
        maxDailyAmount: 0
      },
      points: []
    }
  });

  assert.match(html, /Нет точек с заказами за выбранный период/);
  assert.match(html, /value="2026-06-01"/);
});

test('renderCityAnalysisDashboard renders filters, active navigation, KPI cards, panels, and escaped data', () => {
  const html = renderCityAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        city: '<script>city</script>',
        from: '2026-05-01',
        to: '2026-05-31',
        client: ['<script>client</script>'],
        profession: ['picker'],
        orderType: ['regular'],
        jobStatus: ['booked'],
        contractor: ['<script>contractor</script>'],
        salaryFrom: 250,
        salaryTo: 450.5,
        includeDeletedOrders: true,
        includeHiddenOrders: false
      },
      filterOptions: {
        city: ['Москва', '<script>city</script>'],
        client: ['<script>client</script>', 'Brand A'],
        profession: ['picker', 'driver'],
        orderType: ['regular', 'once'],
        jobStatus: ['booked', 'confirmed'],
        contractor: ['<script>contractor</script>', 'Contractor B']
      },
      context: {
        hasCity: true,
        hasCityCoordinates: true,
        periodLabel: '2026-05-01 - 2026-05-31'
      },
      summary: {
        orderedShifts: 120,
        activeOrderRequests: 34,
        totalLocatedUsers: 5000,
        readyLocatedUsers: 900,
        readyStatusLocatedUsers: 420,
        bookedStatusLocatedUsers: 310,
        workedStatusLocatedUsers: 170,
        appActiveUsers: 400,
        app30dActiveUsers: 560,
        app30dReadyStatusUsers: 210,
        app30dBookedStatusUsers: 190,
        app30dWorkedStatusUsers: 160,
        bookedUsers: 130,
        completedUsers: 75,
        avgDaily30dActiveUsersPerRequest: 11.25
      },
      composition: {
        brands: [{ label: '<script>brand</script>', orderedShifts: 80, sharePercent: 66.666 }],
        professions: [{ label: 'Курьер<script>bad</script>', orderedShifts: 40, sharePercent: 33.333 }],
        rateBuckets: [{ label: '250-350', orderedShifts: 60, sharePercent: 50, avgSalaryPerHour: 310 }]
      },
      dynamics: [
        {
          period: '2026-05-01<script>period</script>',
          orderedShifts: 50,
          appActiveUsers: 20,
          bookedUsers: 10,
          completedUsers: 7,
          activeUsersPerRequest: 2.5
        }
      ]
    }
  });

  assert.match(html, /<h1>Анализ городов<\/h1>/);
  assert.match(html, /Период: 2026-05-01 - 2026-05-31/);
  assert.match(html, /пользователи с последней локацией в радиусе 15 км от точек города/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/city-analysis"/);
  assert.match(html, /<form class="filter-bar" action="\/dashboards\/city-analysis" method="get">/);
  assert.match(html, /<select id="city" name="city">/);
  assert.match(html, /<option value="">Выберите город<\/option>/);
  assert.match(html, /<option value="&lt;script&gt;city&lt;\/script&gt;" selected>&lt;script&gt;city&lt;\/script&gt;<\/option>/);
  assert.match(html, /<input id="from" name="from" type="date" value="2026-05-01">/);
  assert.match(html, /<input id="to" name="to" type="date" value="2026-05-31">/);
  assert.match(html, /<input type="checkbox" name="client" value="&lt;script&gt;client&lt;\/script&gt;" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="profession" value="picker" checked data-multi-filter-checkbox>/);
  assert.match(html, /<span>Регулярные<\/span>/);
  assert.match(html, /<input type="checkbox" name="orderType" value="regular" checked data-multi-filter-checkbox>/);
  assert.match(html, /Статус задания/);
  assert.match(html, /<input type="checkbox" name="jobStatus" value="booked" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="contractor" value="&lt;script&gt;contractor&lt;\/script&gt;" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input id="salaryFrom" name="salaryFrom" type="number" min="0" step="any" value="250">/);
  assert.match(html, /<input id="salaryTo" name="salaryTo" type="number" min="0" step="any" value="450\.5">/);
  assert.match(html, /<input id="includeDeletedOrders" name="includeDeletedOrders" type="checkbox" value="1" checked>/);
  assert.match(html, /<input id="includeHiddenOrders" name="includeHiddenOrders" type="checkbox" value="1">/);
  assert.doesNotMatch(html, /<input id="includeHiddenOrders" name="includeHiddenOrders" type="checkbox" value="1" checked>/);
  assert.match(html, /<h2>Баланс спроса и базы<\/h2>/);
  assert.match(html, /<button type="submit">Применить<\/button>/);
  assert.match(html, /Заказ/);
  assert.match(html, /Не удаленные заявки/);
  assert.match(html, /Общая база/);
  assert.match(html, /Активная база/);
  assert.match(html, /ready [\s\S]*>420<\/button> · booked [\s\S]*>310<\/button> · worked [\s\S]*>170<\/button>/);
  assert.match(html, /Входили в приложение/);
  assert.match(html, /Активная за 30 дней/);
  assert.match(html, /ready [\s\S]*>210<\/button> · booked [\s\S]*>190<\/button> · worked [\s\S]*>160<\/button>/);
  assert.match(html, /Откликались/);
  assert.match(html, /Завершали/);
  assert.match(html, /30д активные \/ заявка/);
  assert.match(html, /5 000/);
  assert.match(html, /130/);
  assert.match(html, /11,3/);
  assert.match(html, /data-giger-list-modal/);
  assert.match(html, /data-giger-detail-trigger/);
  assert.match(
    html,
    /data-detail-url="\/dashboards\/city-analysis\/gigers\?[^"]*metric=total-located-users/
  );
  assert.match(
    html,
    /data-detail-url="\/dashboards\/city-analysis\/gigers\?[^"]*metric=app-active-users/
  );
  assert.match(
    html,
    /data-detail-url="\/dashboards\/city-analysis\/gigers\?[^"]*metric=completed-users/
  );
  assert.match(html, /Состав заказа/);
  assert.match(html, /Бренды/);
  assert.match(html, /Специальности/);
  assert.match(html, /Ставки/);
  assert.match(html, /&lt;script&gt;brand&lt;\/script&gt;/);
  assert.match(html, /Курьер&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /60 смен/);
  assert.match(html, /50\.0%/);
  assert.match(html, /средняя ставка 310/);
  assert.match(html, /Динамика/);
  assert.match(html, /2026-05-01&lt;script&gt;period&lt;\/script&gt;/);
  assert.match(html, /заказ 50/);
  assert.match(html, /входы 20/);
  assert.match(html, /отклики 10/);
  assert.match(html, /завершения 7/);
  assert.match(html, /актив\/заявка 2,5/);
  const miniMetaStyle = html.match(/\.mini-meta\s*\{(?<rules>[^}]+)\}/);
  assert.ok(miniMetaStyle);
  assert.doesNotMatch(miniMetaStyle.groups.rules, /white-space:\s*nowrap/);
  assert.match(miniMetaStyle.groups.rules, /overflow-wrap:\s*anywhere/);
  assert.match(html, /&lt;script&gt;client&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;contractor&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>city<\/script>/);
  assert.doesNotMatch(html, /<script>client<\/script>/);
  assert.doesNotMatch(html, /<script>contractor<\/script>/);
  assert.doesNotMatch(html, /<script>brand<\/script>/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
  assert.doesNotMatch(html, /<script>period<\/script>/);
});

test('renderCityAnalysisDashboard renders progressive city fragments for selected city', () => {
  const html = renderCityAnalysisDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        city: 'Москва',
        from: '2026-05-01',
        to: '2026-05-31',
        client: ['Brand A'],
        profession: ['Комплектовщик'],
        orderType: ['regular'],
        jobStatus: ['confirmed'],
        contractor: [],
        salaryFrom: 250,
        salaryTo: null,
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      filterOptions: {
        city: ['Москва'],
        client: ['Brand A'],
        profession: ['Комплектовщик'],
        orderType: ['regular'],
        jobStatus: ['confirmed'],
        contractor: []
      },
      context: {
        hasCity: true,
        isProgressive: true,
        periodLabel: '2026-05-01 - 2026-05-31'
      },
      summary: {},
      composition: { brands: [], professions: [], rateBuckets: [] },
      dynamics: []
    }
  });

  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/city-analysis\/section\?section=summary-demand&amp;from=2026-05-01&amp;to=2026-05-31&amp;city=/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/city-analysis\/section\?section=summary-base&amp;from=2026-05-01/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/city-analysis\/section\?section=composition&amp;from=2026-05-01/);
  assert.match(html, /data-city-analysis-progressive/);
  assert.match(html, /Загружается/);
  assert.doesNotMatch(html, /<(?:div|section)[^>]+data-city-analysis-fragment-url/);
  assert.doesNotMatch(html, /<div class="kpi-value">0<\/div>/);
});

test('renderCityAnalysisDashboardSection renders requested fragment without full layout', () => {
  const dashboard = {
    filters: { city: 'Москва', from: '2026-05-01', to: '2026-05-31' },
    context: {
      hasCity: true,
      hasCityCoordinates: true,
      periodLabel: '2026-05-01 - 2026-05-31'
    },
    summary: {
      orderedShifts: 120,
      activeOrderRequests: 34,
      totalLocatedUsers: 5000,
      readyLocatedUsers: 900,
      readyStatusLocatedUsers: 420,
      bookedStatusLocatedUsers: 310,
      workedStatusLocatedUsers: 170,
      appActiveUsers: 400,
      app30dActiveUsers: 560,
      app30dReadyStatusUsers: 210,
      app30dBookedStatusUsers: 190,
      app30dWorkedStatusUsers: 160,
      bookedUsers: 130,
      completedUsers: 75,
      avgDaily30dActiveUsersPerRequest: 11.25
    },
    composition: {
      brands: [{ label: 'Brand A', orderedShifts: 80, sharePercent: 66.666 }],
      professions: [],
      rateBuckets: []
    },
    dynamics: []
  };

  const summaryHtml = renderCityAnalysisDashboardSection({ dashboard, section: 'summary-demand' });
  const baseHtml = renderCityAnalysisDashboardSection({ dashboard, section: 'summary-base' });
  const appHtml = renderCityAnalysisDashboardSection({ dashboard, section: 'summary-app' });
  const responsesHtml = renderCityAnalysisDashboardSection({ dashboard, section: 'summary-responses' });
  const compositionHtml = renderCityAnalysisDashboardSection({ dashboard, section: 'composition' });

  assert.match(summaryHtml, /Заказ/);
  assert.match(summaryHtml, /Не удаленные заявки/);
  assert.match(summaryHtml, /120/);
  assert.doesNotMatch(summaryHtml, /<html/);
  assert.match(appHtml, /Входили в приложение/);
  assert.match(appHtml, /Активная за 30 дней/);
  assert.match(appHtml, /560/);
  assert.match(baseHtml, /data-giger-detail-trigger/);
  assert.match(baseHtml, /metric=total-located-users/);
  assert.match(baseHtml, /metric=ready-located-users/);
  assert.match(appHtml, /metric=app-active-users/);
  assert.match(appHtml, /metric=app-30d-active-users/);
  assert.match(responsesHtml, /metric=booked-users/);
  assert.match(responsesHtml, /metric=completed-users/);
  assert.match(appHtml, /ready [\s\S]*>210<\/button> · booked [\s\S]*>190<\/button> · worked [\s\S]*>160<\/button>/);
  assert.doesNotMatch(appHtml, /<html/);
  assert.match(compositionHtml, /Состав заказа/);
  assert.match(compositionHtml, /Brand A/);
});

test('renderCityAnalysisDashboardSection renders SQL inspectors for every city metric fragment value', () => {
  const currentUser = { role: 'admin', permissions: [] };
  const summaryDashboard = {
    summary: {
      orderedShifts: 120,
      activeOrderRequests: 34,
      totalLocatedUsers: 5000,
      readyLocatedUsers: 900,
      readyStatusLocatedUsers: 420,
      bookedStatusLocatedUsers: 310,
      workedStatusLocatedUsers: 170,
      appActiveUsers: 400,
      app30dActiveUsers: 560,
      app30dReadyStatusUsers: 210,
      app30dBookedStatusUsers: 190,
      app30dWorkedStatusUsers: 160,
      bookedUsers: 130,
      completedUsers: 75,
      avgDaily30dActiveUsersPerRequest: 11.25
    },
    context: {
      hasCity: true,
      hasCityCoordinates: true
    }
  };
  const summaryHtml = [
    'summary-demand',
    'summary-base',
    'summary-app',
    'summary-responses',
    'summary-ratio'
  ]
    .map((section) => renderCityAnalysisDashboardSection({ dashboard: summaryDashboard, section, currentUser }))
    .join('');
  const compositionHtml = renderCityAnalysisDashboardSection({
    currentUser,
    section: 'composition',
    dashboard: {
      composition: {
        brands: [{ label: 'Brand A', orderedShifts: 80, sharePercent: 66.666 }],
        professions: [{ label: 'Picker', orderedShifts: 40, sharePercent: 33.333 }],
        rateBuckets: [{ label: '250-350', orderedShifts: 60, sharePercent: 50, avgSalaryPerHour: 310 }]
      }
    }
  });
  const dynamicsHtml = renderCityAnalysisDashboardSection({
    currentUser,
    section: 'dynamics',
    dashboard: {
      dynamics: [
        {
          period: '2026-05-01',
          orderedShifts: 50,
          appActiveUsers: 20,
          bookedUsers: 10,
          completedUsers: 7,
          activeUsersPerRequest: 2.5
        }
      ]
    }
  });
  const html = `${summaryHtml}${compositionHtml}${dynamicsHtml}`;
  const expectedIds = [
    'city-analysis.summary.ordered-shifts',
    'city-analysis.summary.active-order-requests',
    'city-analysis.summary.total-located-users',
    'city-analysis.summary.ready-located-users',
    'city-analysis.summary.app-active-users',
    'city-analysis.summary.app-30d-active-users',
    'city-analysis.summary.booked-users',
    'city-analysis.summary.completed-users',
    'city-analysis.summary.avg-daily-30d-active-users-per-request',
    'city-analysis.composition.brands',
    'city-analysis.composition.brands.ordered-shifts',
    'city-analysis.composition.professions',
    'city-analysis.composition.professions.ordered-shifts',
    'city-analysis.composition.rate-buckets',
    'city-analysis.composition.rate-buckets.ordered-shifts',
    'city-analysis.dynamics.multiples-ordered-shifts',
    'city-analysis.dynamics.multiples-app-active-users',
    'city-analysis.dynamics.multiples-booked-users',
    'city-analysis.dynamics.multiples-completed-users',
    'city-analysis.dynamics.multiples-active-users-per-request',
    'city-analysis.dynamics.funnel-ordered-shifts',
    'city-analysis.dynamics.funnel-app-active-users',
    'city-analysis.dynamics.funnel-booked-users',
    'city-analysis.dynamics.funnel-completed-users',
    'city-analysis.dynamics.index-ordered-shifts',
    'city-analysis.dynamics.index-app-active-users',
    'city-analysis.dynamics.index-booked-users',
    'city-analysis.dynamics.index-completed-users',
    'city-analysis.dynamics.index-active-users-per-request'
  ];

  for (const id of expectedIds) {
    assert.match(html, new RegExp(`data-sql-inspector-open="${escapeRegExp(id)}"`));
  }
});

test('renderCityAnalysisDashboardSection renders five dynamics subtabs', () => {
  const html = renderCityAnalysisDashboardSection({
    section: 'dynamics',
    dashboard: {
      filters: { city: 'Москва', from: '2026-05-01', to: '2026-05-31' },
      context: {
        hasCity: true,
        hasCityCoordinates: true,
        periodLabel: '2026-05-01 - 2026-05-31'
      },
      summary: {},
      composition: { brands: [], professions: [], rateBuckets: [] },
      dynamics: [
        {
          period: '2026-05-01',
          orderedShifts: 50,
          appActiveUsers: 20,
          bookedUsers: 10,
          completedUsers: 7,
          activeUsersPerRequest: 2.5
        },
        {
          period: '2026-05-02',
          orderedShifts: 75,
          appActiveUsers: 30,
          bookedUsers: 16,
          completedUsers: 12,
          activeUsersPerRequest: 3
        }
      ]
    }
  });

  assert.match(html, /city-dynamics-tabs/);
  assert.equal(countOccurrences(html, 'name="city-dynamics-tab"'), 5);
  assert.match(html, /city-dynamics-panel-combo/);
  assert.match(html, /city-dynamics-panel-multiples/);
  assert.match(html, /city-dynamics-panel-heatmap/);
  assert.match(html, /city-dynamics-panel-funnel/);
  assert.match(html, /city-dynamics-panel-index/);
  assert.match(html, /Спрос vs исполнители/);
  assert.match(html, /Small multiples/);
  assert.match(html, /Тепловая карта/);
  assert.match(html, /Воронка/);
  assert.match(html, /Индексы/);
  assert.match(html, /2026-05-02/);
  assert.match(html, /75/);
  assert.doesNotMatch(html, /<html/);
});

test('renderHeatmapDashboard renders filters, navigation, and progressive map placeholder', () => {
  const html = renderHeatmapDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        year: 2026,
        month: 5,
        periodKey: '2026-05',
        from: '2026-05-01',
        to: '2026-05-31',
        activeFromDateTime: '2026-05-01 00:00:00',
        activeToExclusiveDateTime: '2026-06-01 00:00:00',
        client: ['<script>client</script>'],
        excludedProfession: ['Курьер<script>bad</script>'],
        addressSearch: 'Тверская<script>addr</script>',
        activeBaseMode: 'ready',
        activeBasePeriod: 'selected'
      },
      filterOptions: {
        client: ['<script>client</script>', 'Brand A'],
        excludedProfession: ['Курьер<script>bad</script>', 'Комплектовщик']
      },
      summary: {
        pointsWithOrder: 0,
        orderedShifts: 0,
        weightedActiveUsers: 0,
        avgWeightedActiveUsersPerShift: 0
      },
      points: []
    }
  });

  assert.match(html, /<h1>Тепловая карта<\/h1>/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/heatmap"/);
  assert.match(html, /<form class="filter-bar" action="\/dashboards\/heatmap" method="get">/);
  assert.match(html, /<select id="year" name="year">/);
  assert.match(html, /<option value="2026" selected>2026<\/option>/);
  assert.match(html, /<select id="month" name="month">/);
  assert.match(html, /<option value="5" selected>Май<\/option>/);
  assert.match(html, /<label for="addressSearch">Поиск по адресу<\/label>/);
  assert.match(html, /<input id="addressSearch" name="addressSearch" type="search" value="Тверская&lt;script&gt;addr&lt;\/script&gt;"/);
  assert.match(html, /name="activeBaseMode" value="all"/);
  assert.match(html, /name="activeBaseMode" value="ready" checked/);
  assert.match(html, /name="activeBasePeriod" value="last30d"/);
  assert.match(html, /name="activeBasePeriod" value="selected" checked/);
  assert.match(html, /Все зарегистрированные/);
  assert.match(html, /ready, booked, worked/);
  assert.match(html, /Выбранный месяц/);
  assert.match(html, /<input type="checkbox" name="client" value="&lt;script&gt;client&lt;\/script&gt;" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="excludedProfession" value="Курьер&lt;script&gt;bad&lt;\/script&gt;" checked data-multi-filter-checkbox>/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/heatmap\/section\?section=map&amp;year=2026&amp;month=5/);
  assert.match(html, /addressSearch=%D0%A2%D0%B2%D0%B5%D1%80%D1%81%D0%BA%D0%B0%D1%8F%3Cscript%3Eaddr%3C%2Fscript%3E/);
  assert.match(html, /activeBasePeriod=selected/);
  assert.match(html, /Загружается/);
  assert.match(html, /Активная база: 2026-05-01 00:00:00 - 2026-06-01 00:00:00/);
  assert.doesNotMatch(html, /<script>client<\/script>/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
});

test('renderHeatmapDashboardSection renders Leaflet map, legend, KPI, and escaped point rows', () => {
  const dashboard = {
    filters: {
      year: 2026,
      month: 5,
      periodKey: '2026-05',
      from: '2026-05-01',
      to: '2026-05-31',
      client: [],
      excludedProfession: [],
      activeBaseMode: 'all'
    },
    summary: {
      pointsWithOrder: 2,
      orderedShifts: 120,
      weightedActiveUsers: 110,
      avgWeightedActiveUsersPerShift: 110 / 120
    },
    points: [
      {
        workplaceId: 'workplace-1',
        workplaceTitle: 'Точка<script>bad</script>',
        region: 'Москва<script>bad</script>',
        city: 'Москва',
        street: 'Тверская',
        orderedShifts: 100,
        orderRequests: 25,
        weightedActiveUsers: 30,
        weightedActiveUsersPerShift: 0.3,
        radiusUsers: { near: 20, medium: 12, far: 8 },
        balanceLevel: 'low',
        color: 'hsl(24, 72%, 44%)',
        lon: 37.6,
        lat: 55.7
      },
      {
        workplaceId: 'workplace-2',
        workplaceTitle: 'Точка 2',
        region: 'Татарстан',
        city: 'Казань',
        street: 'Кремлевская',
        orderedShifts: 20,
        orderRequests: 5,
        weightedActiveUsers: 80,
        weightedActiveUsersPerShift: 4,
        radiusUsers: { near: 50, medium: 35, far: 20 },
        balanceLevel: 'high',
        color: 'hsl(132, 64%, 35%)',
        lon: 49.1,
        lat: 55.8
      }
    ]
  };
  const html = renderHeatmapDashboardSection({ dashboard, section: 'map' });

  assert.match(html, /leaflet\.css/);
  assert.match(html, /leaflet\.js/);
  assert.match(html, /data-heatmap-leaflet-map/);
  assert.match(html, /data-heatmap-points="/);
  assert.match(html, /&quot;lat&quot;:55\.7/);
  assert.match(html, /&quot;lon&quot;:37\.6/);
  assert.match(html, /&quot;color&quot;:&quot;hsl\(24, 72%, 44%\)&quot;/);
  assert.match(html, /&quot;detailHref&quot;:&quot;\/dashboards\/workplace-analysis\/point\?workplaceId=workplace-1&amp;from=2026-05-01&amp;to=2026-05-31&quot;/);
  assert.match(html, /tile\.openstreetmap\.org/);
  assert.match(html, /L\.circleMarker/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Точки с заказом/);
  assert.match(html, /Взвешенная база \/ смена/);
  assert.match(html, /0,9/);
  assert.match(html, /Москва&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /Точка&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /Татарстан/);
  assert.match(html, /5 км/);
  assert.match(html, /10 км/);
  assert.match(html, /15 км/);
  assert.doesNotMatch(html, /<h2>Точки заказа<\/h2>/);
  assert.doesNotMatch(html, /heatmap-region-table/);
  assert.doesNotMatch(html, /<table>/);
  assert.doesNotMatch(html, /<html/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
});

test('renderCityAnalysisDashboard shows empty states for missing city and missing coordinates', () => {
  const baseDashboard = {
    filters: {
      city: '',
      from: '2026-05-01',
      to: '2026-05-31',
      client: [],
      profession: [],
      orderType: [],
      jobStatus: [],
      contractor: [],
      salaryFrom: null,
      salaryTo: null,
      includeDeletedOrders: false,
      includeHiddenOrders: false
    },
    filterOptions: {
      city: ['Москва'],
      client: [],
      profession: [],
      orderType: [],
      jobStatus: [],
      contractor: []
    },
    context: {
      hasCity: false,
      hasCityCoordinates: false,
      periodLabel: '2026-05-01 - 2026-05-31'
    },
    summary: {
      orderedShifts: 0,
      activeOrderRequests: 0,
      totalLocatedUsers: 0,
      readyLocatedUsers: 0,
      readyStatusLocatedUsers: 0,
      bookedStatusLocatedUsers: 0,
      workedStatusLocatedUsers: 0,
      appActiveUsers: 0,
      bookedUsers: 0,
      completedUsers: 0,
      avgDaily30dActiveUsersPerRequest: 0
    },
    composition: {
      brands: [],
      professions: [],
      rateBuckets: []
    },
    dynamics: []
  };
  const noCityHtml = renderCityAnalysisDashboard({
    database: 'etl',
    dashboard: baseDashboard
  });
  const noCoordinatesHtml = renderCityAnalysisDashboard({
    database: 'etl',
    dashboard: {
      ...baseDashboard,
      filters: {
        ...baseDashboard.filters,
        city: 'Москва'
      },
      context: {
        ...baseDashboard.context,
        hasCity: true,
        hasCityCoordinates: false
      },
      composition: {
        brands: [{ label: 'Brand A', orderedShifts: 12, sharePercent: 60 }],
        professions: [{ label: 'Комплектовщик', orderedShifts: 8, sharePercent: 40 }],
        rateBuckets: [{ label: '250-350', orderedShifts: 20, sharePercent: 100, avgSalaryPerHour: 320 }]
      },
      dynamics: [
        {
          period: '2026-05-01',
          orderedShifts: 20,
          appActiveUsers: 5,
          bookedUsers: 4,
          completedUsers: 3,
          activeUsersPerRequest: 1.2
        }
      ]
    }
  });

  assert.match(noCityHtml, /Выберите город для анализа\./);
  assert.doesNotMatch(noCityHtml, /Состав заказа/);
  assert.doesNotMatch(noCityHtml, /Динамика/);
  assert.doesNotMatch(noCityHtml, /Нет координат точек для расчета базы в радиусе 15 км\./);
  assert.match(noCoordinatesHtml, /Нет координат точек для расчета базы в радиусе 15 км\./);
  assert.match(noCoordinatesHtml, /<option value="Москва" selected>Москва<\/option>/);
  assert.match(noCoordinatesHtml, /Состав заказа/);
  assert.match(noCoordinatesHtml, /Динамика/);
  assert.match(noCoordinatesHtml, /Brand A/);
  assert.match(noCoordinatesHtml, /2026-05-01/);
});

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
