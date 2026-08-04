const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeHtml,
  renderError,
  renderGigerDetails,
  renderGigerDetailsWorkbook,
  renderBrandAnalysisDashboard,
  renderBrandAnalysisReviews,
  renderBrandAnalysisDashboardSection,
  renderCityAnalysisDashboard,
  renderCityAnalysisDashboardSection,
  renderHeatmapDashboard,
  renderHeatmapDashboardSection,
  renderHome,
  renderMailSettingsPage,
  renderPreloadManagement,
  renderRegionAnalysisDashboard,
  renderRegionAnalysisDashboardSection,
  renderRequestReportMissingConfirmedPage,
  renderRequestReportMissingConfirmedResult,
  renderSalesByProjectDashboard,
  renderSalesByProjectDashboardSection,
  renderScheduledReportsPage,
  renderTable,
  renderUserActivityDashboard,
  renderWorkerBlacklistDetails,
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

test('renderRequestReportMissingConfirmedPage renders upload form and requested result columns', () => {
  const html = renderRequestReportMissingConfirmedPage({
    database: 'etl',
    currentUser: {
      email: 'analyst@example.test',
      role: 'analyst',
      permissions: ['request-report-matching']
    },
    csrfToken: 'csrf-token',
    filename: 'requests-report.xlsx',
    result: {
      summary: {
        totalRows: 5,
        rowsWithId: 5,
        checkedExternalIds: 5,
        confirmedRows: 1,
        missingConfirmedRows: 4
      },
      rows: [
        {
          reviewStatusKey: 'lkk:101',
          reviewStatus: 'verified',
          reviewStatusLabel: 'Проверена',
          organization: 'АО "Тандер"',
          workplace: 'Точка <1>',
          address: 'ул. Ленина, 1',
          employee: 'Иванов Иван',
          startText: '2026-06-01 09:00',
          actualDuration: '7.5',
          isActExists: true,
          actExistsLabel: 'Есть',
          crmUrl: 'https://crm.mygig.ru/coordination?searchDate[]=2026-06-01&searchDate[]=2026-06-01&workplaceIds[]=63e9cbf44eece00008747426'
        },
        {
          reviewStatusKey: 'lkk:102',
          reviewStatus: 'return-later',
          reviewStatusLabel: 'Вернуться позже',
          organization: 'ООО Ноль',
          workplace: 'Точка 0',
          startText: '2026-06-01 10:00',
          actualDuration: '0',
          isActExists: false,
          actExistsLabel: 'Нет'
        },
        {
          reviewStatusKey: 'lkk:103',
          reviewStatus: '',
          reviewStatusLabel: '',
          organization: 'ООО Пусто',
          workplace: 'Точка пусто',
          startText: '2026-06-01 11:00',
          actualDuration: ''
        },
        {
          reviewStatusKey: 'lkk:104',
          reviewStatus: '',
          reviewStatusLabel: '',
          organization: 'ООО Неявка',
          workplace: 'Точка неявка',
          startText: '2026-06-01 12:00',
          actualDuration: 'Неявка'
        }
      ],
      warnings: ['Предупреждение <одно>']
    }
  });

  assert.match(html, /action="\/tools\/request-report-confirmed-check"/);
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /data-request-report-check-form/);
  assert.match(html, /data-request-report-jobs-url="\/tools\/request-report-confirmed-check\/jobs"/);
  assert.match(html, /data-request-report-progress hidden/);
  assert.match(html, /data-request-report-progress-bar/);
  assert.match(html, /data-request-report-progress-percent/);
  assert.match(html, /data-request-report-progress-stage/);
  assert.match(html, /data-request-report-progress-detail/);
  assert.match(html, /data-request-report-progress-eta/);
  assert.match(html, /Осталось/);
  assert.match(html, /estimatedRemainingMs/);
  assert.match(html, /payload\.jobId/);
  assert.match(html, /job\.jobId/);
  assert.match(html, /responseError\(response, 'Не удалось запустить проверку\.'/);
  assert.match(html, /nativeSubmitRequestReportForm/);
  assert.match(html, /canFallbackToSync/);
  assert.match(html, /data-request-report-progress-counters/);
  assert.match(html, /data-request-report-result-target/);
  assert.match(html, /name="action" value="export"/);
  assert.match(html, /Проверить и скачать Excel/);
  assert.match(html, /name="csrfToken" value="csrf-token"/);
  assert.match(html, /Организация/);
  assert.match(html, /Рабочая точка/);
  assert.match(html, /Адрес/);
  assert.match(html, /Сотрудник/);
  assert.match(html, /Время с/);
  assert.match(html, /<th>Фактическая продолжительность за вычетом перерыва<\/th>/);
  assert.match(html, /<th>Лист учета<\/th>/);
  assert.match(html, /<th>Статус проверки<\/th>/);
  assert.match(html, /requests-report.xlsx/);
  assert.match(html, /АО &quot;Тандер&quot;/);
  assert.match(html, /Точка &lt;1&gt;/);
  assert.match(
    html,
    /<a href="https:\/\/crm\.mygig\.ru\/coordination\?searchDate\[\]=2026-06-01&amp;searchDate\[\]=2026-06-01&amp;workplaceIds\[\]=63e9cbf44eece00008747426" target="_blank" rel="noopener noreferrer">7\.5<\/a>/
  );
  assert.match(html, /data-request-duration-filter/);
  assert.match(html, /<option value="non-zero">Есть не 0<\/option>/);
  assert.match(html, /<option value="zero">Есть 0<\/option>/);
  assert.match(html, /<option value="empty">Нет значения<\/option>/);
  assert.match(html, /<option value="absence">Есть неявка<\/option>/);
  assert.match(html, /data-request-status-filter/);
  assert.match(html, /<option value="verified">Проверена<\/option>/);
  assert.match(html, /<option value="return-later">Вернуться позже<\/option>/);
  assert.match(html, /data-request-act-filter/);
  assert.match(html, /<option value="yes">Есть<\/option>/);
  assert.match(html, /<option value="no">Нет<\/option>/);
  assert.match(html, /data-request-report-status-control/);
  assert.match(html, /data-request-report-status-key="lkk:101"/);
  assert.match(html, /data-request-review-status="verified"/);
  assert.match(html, /data-request-review-status="return-later"/);
  assert.match(html, /data-request-act-exists="yes"/);
  assert.match(html, /data-request-act-exists="no"/);
  assert.match(html, /✓ Есть/);
  assert.match(html, /— Нет/);
  assert.match(html, /class="request-report-row request-report-row-verified"/);
  assert.match(html, /class="request-report-row request-report-row-return-later"/);
  assert.match(html, /\.request-report-row-verified > td \{\s*background: rgba\(34, 197, 94, 0\.14\);/);
  assert.match(html, /\.request-report-row-return-later > td \{\s*background: rgba\(239, 68, 68, 0\.12\);/);
  assert.match(html, /data-request-review-status=""/);
  assert.match(html, /option value="verified" selected>Проверена<\/option>/);
  assert.match(html, /option value="return-later" selected>Вернуться позже<\/option>/);
  assert.match(html, /data-request-duration-category="non-zero"/);
  assert.match(html, /data-request-duration-category="zero"/);
  assert.match(html, /data-request-duration-category="empty"/);
  assert.match(html, /data-request-duration-category="absence"/);
  assert.match(html, /data-request-duration-filter-empty hidden/);
  assert.match(html, /Предупреждение &lt;одно&gt;/);
  assert.doesNotMatch(html, /ID ЛКК<\/th>/);
});

test('renderRequestReportMissingConfirmedResult returns reusable result fragment with filters', () => {
  const html = renderRequestReportMissingConfirmedResult({
    csrfToken: 'csrf-token',
    filename: 'fragment-report.xlsx',
    result: {
      summary: {
        totalRows: 2,
        rowsWithId: 2,
        confirmedRows: 1,
        missingConfirmedRows: 1
      },
      rows: [
        {
          reviewStatusKey: 'lkk:201',
          reviewStatus: 'verified',
          organization: 'ООО Фрагмент',
          workplace: 'Точка 2',
          startText: '2026-06-02 09:00',
          actualDuration: '0',
          isActExists: true,
          actExistsLabel: 'Есть'
        }
      ],
      warnings: ['warning <one>']
    }
  });

  assert.match(html, /^<section class="section" data-request-report-result-fragment>/);
  assert.match(html, /fragment-report.xlsx/);
  assert.match(html, /data-request-report-result/);
  assert.match(html, /data-request-duration-filter/);
  assert.match(html, /data-request-status-filter/);
  assert.match(html, /data-request-act-filter/);
  assert.match(html, /data-request-report-status-control/);
  assert.match(html, /data-request-report-status-key="lkk:201"/);
  assert.match(html, /data-request-act-exists="yes"/);
  assert.match(html, /data-request-duration-filter-empty hidden/);
  assert.match(html, /warning &lt;one&gt;/);
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
  assert.match(html, /action="\/admin\/preload\/cache\/city-analysis\/clear"/);
  assert.match(html, /Удалить кеш анализа городов/);
  assert.match(html, /name="csrfToken" value="csrf-token"/);
  assert.match(html, /value="03:00"/);
  assert.match(html, /value="45"/);
  assert.match(html, /sales-by-project/);
  assert.match(html, /ClickHouse timeout/);
  assert.match(html, /class="nav-link active" href="\/admin\/preload"/);
});

test('renderPreloadManagement renders multiple preload jobs with independent forms', () => {
  const html = renderPreloadManagement({
    database: 'etl',
    csrfToken: 'csrf-token',
    currentUser: { role: 'admin', permissions: ['preload-admin'] },
    jobs: [
      {
        job: {
          id: 'sales-by-project',
          title: 'Продажи по проектам',
          enabled: true,
          scheduleTime: '03:00',
          refreshPastDays: 45,
          refreshFutureDays: 45
        },
        overview: { coveredFrom: '2026-05-01', coveredTo: '2026-06-01' },
        runs: []
      },
      {
        job: {
          id: 'workplace-analysis',
          title: 'Анализ точек',
          enabled: false,
          scheduleTime: '04:00',
          refreshPastDays: 60,
          refreshFutureDays: 30
        },
        overview: { coveredFrom: '2026-05-02', coveredTo: '2026-08-01' },
        runs: []
      },
      {
        job: {
          id: 'workplace-point',
          title: 'Карточка точки',
          enabled: true,
          scheduleTime: '08:00',
          refreshPastDays: 30,
          refreshFutureDays: 30
        },
        overview: { coveredFrom: '2026-06-02', coveredTo: '2026-08-02' },
        diagnostics: {
          workplacePoint: {
            coverage: { days: 61 },
            tables: { orderFacts: 10, shiftFacts: 20, radiusRollups: 4 }
          }
        },
        runs: []
      }
    ]
  });

  assert.match(html, /sales-by-project/);
  assert.match(html, /workplace-analysis/);
  assert.match(html, /workplace-point/);
  assert.match(html, /value="sales-by-project"/);
  assert.match(html, /value="workplace-analysis"/);
  assert.match(html, /value="workplace-point"/);
  assert.match(html, /name="refreshPastDays"/);
  assert.match(html, /name="refreshFutureDays"/);
  assert.match(html, /name="refreshPastDays" type="number" min="45"/);
  assert.match(html, /name="refreshFutureDays" type="number" min="45"/);
  assert.match(html, /workplace-point-refresh-past-days" name="refreshPastDays" type="number" min="30" max="366" value="30"/);
  assert.match(html, /workplace-point-refresh-future-days" name="refreshFutureDays" type="number" min="30" max="366" value="30"/);
  assert.match(html, /Radius rollups/);
  assert.match(html, /<div class="kpi-value">4<\/div>/);
  assert.match(html, /value="60"/);
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

test('scheduled reports page renders author and delivery controls with escaped values', () => {
  const hostile = `<script>alert("x")</script>&'`;
  const html = renderScheduledReportsPage({
    database: `etl-${hostile}`,
    currentUser: { role: 'admin', permissions: [] },
    csrfToken: `csrf-${hostile}`,
    reports: [
      { id: 1, title: `Daily ${hostile}`, enabled: true, updatedAt: '2026-06-25T06:00:00.000Z' },
      { id: 4, title: 'Other report', enabled: false, updatedAt: '' }
    ],
    selectedReport: {
      id: 1,
      title: `Daily ${hostile}`,
      description: `Description ${hostile}`,
      sql: `SELECT '${hostile}' AS value`,
      rowLimit: 100,
      timeoutMs: 120000,
      enabled: true
    },
    schedules: [
      {
        id: 2,
        reportId: 1,
        enabled: true,
        scheduleTime: '09:00',
        timezone: 'Europe/Moscow',
        recipients: ['a@example.test', `recipient-${hostile}@example.test`],
        emailSubject: `Subject ${hostile}`,
        emailBody: `Body ${hostile}`
      }
    ],
    runs: [
      {
        id: 3,
        status: `success-${hostile}`,
        trigger: 'manual',
        rowCount: 1,
        fileSizeBytes: 128,
        startedAt: '2026-06-25T06:59:00.000Z',
        finishedAt: '2026-06-25T07:00:00.000Z',
        recipients: ['a@example.test'],
        error: '',
        canDownload: true
      },
      {
        id: 5,
        status: 'failed',
        trigger: 'schedule',
        rowCount: 0,
        fileSizeBytes: 0,
        startedAt: '2026-06-25T08:00:00.000Z',
        finishedAt: '',
        recipients: [`bad-${hostile}@example.test`],
        error: `Error ${hostile}`,
        canDownload: false
      }
    ],
    canAuthor: true,
    canDeliver: true,
    message: `Saved ${hostile}`,
    error: `Problem ${hostile}`
  });

  assert.match(html, /Регулярные отчеты/);
  assert.match(html, /class="nav-link active" href="\/reports\/scheduled"/);
  assert.match(html, /href="\/reports\/scheduled\?reportId=1"/);
  assert.match(html, /scheduled-report-selected/);
  assert.match(html, /action="\/reports\/scheduled\/create"/);
  assert.match(html, /action="\/reports\/scheduled\/1\/update"/);
  assert.match(html, /formaction="\/reports\/scheduled\/1\/preview"/);
  assert.match(html, /name="title"/);
  assert.match(html, /name="description"/);
  assert.match(html, /name="sql"/);
  assert.match(html, /name="rowLimit"/);
  assert.match(html, /name="timeoutMs"/);
  assert.match(html, /name="enabled"/);
  assert.match(html, /action="\/reports\/scheduled\/1\/schedules\/create"/);
  assert.match(html, /action="\/reports\/scheduled\/1\/schedules\/2\/update"/);
  assert.match(html, /action="\/reports\/scheduled\/1\/schedules\/2\/run"/);
  assert.match(html, /name="scheduleTime"/);
  assert.match(html, /name="timezone"/);
  assert.match(html, /name="recipients"/);
  assert.match(html, /name="emailSubject"/);
  assert.match(html, /name="emailBody"/);
  assert.match(html, /href="\/reports\/scheduled\/runs\/3\/download"/);
  assert.doesNotMatch(html, /href="\/reports\/scheduled\/runs\/5\/download"/);
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`csrf-${hostile}`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`SELECT '${hostile}' AS value`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`recipient-${hostile}@example.test`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`Error ${hostile}`))));
  assert.doesNotMatch(html, /<script>alert\("x"\)<\/script>/);
});

test('scheduled reports page encodes preview route id', () => {
  const html = renderScheduledReportsPage({
    database: 'etl',
    currentUser: { role: 'analyst', permissions: ['scheduled-report-author'] },
    csrfToken: 'csrf-token',
    reports: [{ id: 'report <1>/x', title: 'Unsafe id' }],
    selectedReport: {
      id: 'report <1>/x',
      title: 'Unsafe id',
      sql: 'SELECT 1',
      rowLimit: 100,
      timeoutMs: 120000,
      enabled: true
    },
    canAuthor: true,
    canDeliver: false
  });

  assert.match(html, /name="csrfToken" value="csrf-token"/);
  assert.match(html, /formaction="\/reports\/scheduled\/report%20%3C1%3E%2Fx\/preview"/);
  assert.doesNotMatch(html, /formaction="\/reports\/scheduled\/report <1>\/x\/preview"/);
});

test('scheduled reports page separates author and delivery capabilities', () => {
  const authorHtml = renderScheduledReportsPage({
    database: 'etl',
    currentUser: { role: 'analyst', permissions: ['scheduled-report-author'] },
    csrfToken: 'csrf',
    reports: [{ id: 1, title: 'Daily' }],
    selectedReport: { id: 1, title: 'Daily', sql: 'SELECT 1', enabled: true },
    schedules: [{ id: 2, reportId: 1, recipients: ['a@example.test'] }],
    runs: [{ id: 3, canDownload: true }],
    canAuthor: true,
    canDeliver: false
  });
  const deliveryHtml = renderScheduledReportsPage({
    database: 'etl',
    currentUser: { role: 'analyst', permissions: ['scheduled-report-delivery'] },
    csrfToken: 'csrf',
    reports: [{ id: 1, title: 'Daily' }],
    selectedReport: { id: 1, title: 'Daily', sql: 'SELECT 1', enabled: true },
    schedules: [{ id: 2, reportId: 1, recipients: ['a@example.test'] }],
    runs: [{ id: 3, status: 'success', trigger: 'manual', canDownload: true }],
    canAuthor: false,
    canDeliver: true
  });
  const readOnlyHtml = renderScheduledReportsPage({
    database: 'etl',
    currentUser: { role: 'analyst', permissions: [] },
    csrfToken: 'csrf',
    reports: [{ id: 1, title: 'Daily' }],
    selectedReport: { id: 1, title: 'Daily', sql: 'SELECT 1' },
    canAuthor: false,
    canDeliver: false
  });

  assert.match(authorHtml, /action="\/reports\/scheduled\/create"/);
  assert.match(authorHtml, /name="sql"/);
  assert.doesNotMatch(authorHtml, /name="recipients"/);
  assert.doesNotMatch(authorHtml, /\/download"/);

  assert.doesNotMatch(deliveryHtml, /action="\/reports\/scheduled\/create"/);
  assert.doesNotMatch(deliveryHtml, /name="sql"/);
  assert.match(deliveryHtml, /name="recipients"/);
  assert.match(deliveryHtml, /href="\/reports\/scheduled\/runs\/3\/download"/);

  assert.match(readOnlyHtml, /Нет доступов для управления регулярными отчетами/);
  assert.doesNotMatch(readOnlyHtml, /action="\/reports\/scheduled\/create"/);
  assert.doesNotMatch(readOnlyHtml, /name="sql"/);
  assert.doesNotMatch(readOnlyHtml, /name="recipients"/);
});

test('mail settings page renders SMTP forms without exposing password', () => {
  const hostile = `<script>alert("smtp")</script>&'`;
  const html = renderMailSettingsPage({
    database: `etl-${hostile}`,
    currentUser: { role: 'admin', permissions: [] },
    csrfToken: `csrf-${hostile}`,
    settings: {
      host: `smtp-${hostile}.example.test`,
      port: 587,
      secureMode: 'starttls',
      username: `user-${hostile}`,
      password: `secret-${hostile}`,
      hasPassword: true,
      fromEmail: `from-${hostile}@example.test`,
      fromName: `MyGig ${hostile}`
    },
    testRecipient: `test-${hostile}@example.test`,
    message: `Saved ${hostile}`,
    error: `Error ${hostile}`
  });

  assert.match(html, /class="nav-link active" href="\/admin\/mail-settings"/);
  assert.match(html, /action="\/admin\/mail-settings"/);
  assert.match(html, /action="\/admin\/mail-settings\/test"/);
  assert.match(html, /name="host"/);
  assert.match(html, /name="port"/);
  assert.match(html, /name="secureMode"/);
  assert.match(html, /value="starttls" selected/);
  assert.match(html, /value="ssl"/);
  assert.match(html, /name="username"/);
  assert.match(html, /name="password"/);
  assert.match(html, /name="clearPassword"/);
  assert.match(html, /name="fromEmail"/);
  assert.match(html, /name="fromName"/);
  assert.match(html, /name="testRecipient"/);
  assert.match(html, /Пароль сохранен/);
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`smtp-${hostile}.example.test`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`test-${hostile}@example.test`))));
  assert.match(html, new RegExp(escapeRegExp(escapeHtml(`csrf-${hostile}`))));
  assert.doesNotMatch(html, new RegExp(escapeRegExp(`secret-${hostile}`)));
  assert.doesNotMatch(html, /<script>alert\("smtp"\)<\/script>/);
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
        direction: 'desc',
        client: ['Brand A'],
        city: ['Moscow']
      },
      filterOptions: {
        client: ['Brand A', 'Brand B'],
        city: ['Moscow', 'Kazan']
      }
    }
  });

  assert.match(html, /dashboard-header/);
  assert.match(html, /Отмены гигерами/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/worker-cancellations"/);
  assert.match(html, /<form class="filter-bar" action="\/dashboards\/worker-cancellations" method="get">/);
  assert.match(html, /<input id="from" name="from" type="date" value="2026-05-01">/);
  assert.match(html, /<input id="to" name="to" type="date" value="2026-05-31">/);
  assert.match(html, /data-multi-filter/);
  assert.match(html, /<input type="checkbox" name="client" value="Brand A" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="client" value="Brand B" data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="city" value="Moscow" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="city" value="Kazan" data-multi-filter-checkbox>/);
  assert.match(html, /<option value="200" selected>200<\/option>/);
  assert.match(html, /data-worker-cancellation-modal/);
  assert.match(html, /document\.addEventListener\('click', function \(event\)/);
  assert.match(html, /data-worker-cancellation-detail-trigger/);
  assert.match(html, /Период по плановому старту смены/);
  assert.match(
    html,
    /data-dashboard-fragment-url="\/dashboards\/worker-cancellations\/section\?section=workers&amp;from=2026-05-01&amp;to=2026-05-31&amp;page=2&amp;pageSize=200&amp;sort=workerCancellations24h&amp;direction=desc&amp;client=Brand\+A&amp;city=Moscow"/
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
        direction: 'asc',
        client: ['Brand A'],
        city: ['Moscow']
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
    /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;pageSize=50&amp;sort=fullName&amp;direction=asc&amp;client=Brand\+A&amp;city=Moscow"/
  );
  assert.match(
    html,
    /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;pageSize=50&amp;sort=workerCancellations&amp;direction=desc&amp;client=Brand\+A&amp;city=Moscow"/
  );
  assert.match(html, /<td class="phone-cell">\+79990000000&lt;script&gt;x&lt;\/script&gt;<\/td>/);
  assert.match(
    html,
    /<button type="button" class="metric-detail-trigger" data-worker-cancellation-detail-trigger data-detail-url="\/dashboards\/worker-cancellations\/details\?from=2026-05-01&amp;to=2026-05-31&amp;workerId=worker-1&amp;metric=confirmedShifts&amp;client=Brand\+A&amp;city=Moscow">10<\/button>/
  );
  assert.match(
    html,
    /data-detail-url="\/dashboards\/worker-cancellations\/details\?from=2026-05-01&amp;to=2026-05-31&amp;workerId=worker-1&amp;metric=workerCancellations&amp;client=Brand\+A&amp;city=Moscow"/
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

test('renderWorkerBlacklistDetails renders escaped current lists and audit caveat', () => {
  const html = renderWorkerBlacklistDetails({
    details: {
      workerId: 'worker-1',
      blacklists: [
        {
          scope: 'client',
          clientName: 'Brand <b>A</b>',
          workplaceName: '',
          city: ''
        },
        {
          scope: 'workplace',
          clientName: 'Brand A',
          workplaceName: 'Store <script>x</script>',
          city: 'Moscow'
        }
      ],
      lastEventAtLocal: '2026-07-14 21:04:32',
      lastEventOperator: 'Ivan <Operator>',
      lastEventContext: {
        clientName: 'Brand A',
        contractorName: 'Brand <Legal>',
        workplaceName: 'Store <Context>',
        city: 'Moscow',
        eventDistanceSeconds: 35
      }
    }
  });

  assert.match(html, /worker-blacklist-details/);
  assert.match(html, /Brand &lt;b&gt;A&lt;\/b&gt;/);
  assert.match(html, /Store &lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /Ivan &lt;Operator&gt;/);
  assert.match(html, /Brand &lt;Legal&gt;/);
  assert.match(html, /Store &lt;Context&gt;/);
  assert.match(html, /через 35 сек/);
  assert.match(html, /не подтверждение текущего состояния списка/);
  assert.match(html, /14\.07\.2026 21:04/);
  assert.match(html, /не указывает конкретный список/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<html/);
});

test('renderRegionAnalysisDashboard adds the giger modal for the regional export trigger', () => {
  const html = renderRegionAnalysisDashboard({
    database: 'etl',
    dashboard: { filters: { region: 'Московская', from: '2026-08-01', to: '2026-08-04', period: 'week', cohort: [], client: ['Бренд A'] }, regionOptions: ['Московская'], brandOptions: ['Бренд A', 'Бренд B'] },
    progressive: true
  });
  assert.match(html, /data-giger-detail-trigger/);
  assert.match(html, /data-giger-list-modal/);
  assert.match(html, /event\.target\.closest\('\[data-dashboard-fragment-link\]'\)/);
  assert.match(html, /Бренды/);
  assert.match(html, /Бренд A/);
});

test('renderRegionAnalysisDashboardSection makes regional city metrics sortable', () => {
  const html = renderRegionAnalysisDashboardSection({
    section: 'cities',
    dashboard: {
      filters: { region: 'Московская', from: '2026-08-01', to: '2026-08-04', period: 'week', sort: 'openDemand', direction: 'desc' },
      cityRows: [{ city: 'Москва', orderedShifts: 12, openDemand: 3, slaPercent: 66.7, coveragePercent: 75, workedShifts: 8, workplaces: 4 }]
    }
  });

  assert.match(html, /class="sortable-header"/);
  assert.match(html, /data-dashboard-fragment-link/);
  assert.match(html, /data-region-city-sort/);
  assert.match(html, /\/dashboards\/region-analysis\/section\?section=cities/);
  assert.match(html, /sort=workedShifts&amp;direction=desc/);
  assert.match(html, /sort=openDemand&amp;direction=asc/);
  assert.match(html, /aria-sort="descending"/);
});

test('renderWorkerBlacklistDetails shows journal context when current arrays are empty', () => {
  const html = renderWorkerBlacklistDetails({
    details: {
      workerId: 'worker-1',
      blacklists: [],
      lastEventAtLocal: '2026-03-18 08:45:48',
      lastEventOperator: 'Operator',
      lastEventContext: {
        clientName: 'Магнит',
        contractorName: 'Магнит (АО "Тандер")',
        workplaceName: 'Магнит Москва 1',
        city: 'Москва',
        eventDistanceSeconds: 35
      }
    }
  });

  assert.match(html, /В актуальных массивах/);
  assert.match(html, /Магнит \(АО &quot;Тандер&quot;\)/);
  assert.match(html, /Магнит Москва 1/);
  assert.match(html, /контекст события/);
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
  assert.match(cityHtml, /data-sql-inspector-open="city-analysis\.dynamics\.line-ordered-shifts"/);
  assert.match(cityHtml, /data-sql-inspector-open="city-analysis\.dynamics\.bar-ordered-shifts"/);
  assert.match(cityHtml, /data-sql-inspector-open="city-analysis\.dynamics\.line-active-users-per-request"/);
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

test('renderBrandAnalysisDashboard renders brand selector and progressive sections', () => {
  const html = renderBrandAnalysisDashboard({
    database: 'etl',
    progressive: true,
    currentUser: { role: 'analyst', permissions: ['brand-analysis'] },
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-04-30',
        brandId: 'Brand <A>',
        city: ['Москва'],
        region: ['ЦФО']
      },
      brandOptions: [
        { id: 'Brand <A>', title: 'Brand <A>' },
        { id: 'Brand B', title: 'Brand B' }
      ],
      filterOptions: {
        city: ['Москва'],
        region: ['ЦФО']
      },
      selectedBrandTitle: 'Brand <A>',
      summary: {},
      trendRows: [],
      workplaceRows: [],
      professionRows: [],
      statusRows: []
    }
  });

  assert.match(html, /Анализ брендов/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/brand-analysis"/);
  assert.match(html, /<form class="filter-bar" action="\/dashboards\/brand-analysis" method="get">/);
  assert.match(html, /<option value="Brand &lt;A&gt;" selected>Brand &lt;A&gt;<\/option>/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/brand-analysis\/section\?section=summary&amp;period=month&amp;from=2026-04-01&amp;to=2026-04-30&amp;brandId=Brand\+%3CA%3E&amp;city=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0&amp;region=%D0%A6%D0%A4%D0%9E"/);
  assert.match(html, /name="city" value="Москва" checked/);
  assert.match(html, /name="region" value="ЦФО" checked/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/brand-analysis\/section\?section=workplaces/);
  assert.match(html, /window\.initBrandTrendCharts/);
  assert.match(html, /window\.initBrandTrendCharts\(document\)/);
  assert.match(html, /brand-trend-value-label/);
  assert.match(html, /data-brand-trend-detailed/);
  assert.match(html, /shouldShowDenseLabel/);
  assert.match(html, /filterReadableLabels/);
  assert.match(html, /withSlaCallouts/);
  assert.match(html, /brand-trend-callout-line/);
  assert.match(html, /dynamicRange/);
  assert.match(html, /rangeScale/);
  assert.match(html, /Загружается/);
  assert.doesNotMatch(html, /Brand <A>/);
});

test('renderBrandAnalysisDashboard asks to choose brand when no brand is selected', () => {
  const html = renderBrandAnalysisDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-04-30',
        brandId: ''
      },
      brandOptions: [{ id: 'client-1', title: 'Brand A' }],
      selectedBrandTitle: '',
      summary: {},
      trendRows: [],
      workplaceRows: [],
      professionRows: [],
      statusRows: []
    }
  });

  assert.match(html, /Выберите бренд/);
  assert.doesNotMatch(html, /data-dashboard-fragment-url="\/dashboards\/brand-analysis\/section/);
});

test('renderBrandAnalysisReviews paginates brand reviews by 50 rows', () => {
  const reviews = Array.from({ length: 51 }, (_, index) => ({
    rating: 5,
    workplaceTitle: `Point ${index + 1}`,
    city: 'City',
    authorFullName: `Author ${index + 1}`,
    authorPhone: '+79990000000',
    createdAtLocal: '2026-04-12 10:00:00',
    text: `Review ${index + 1}`
  }));
  const html = renderBrandAnalysisReviews({
    details: {
      filters: { brandId: 'Brand A', city: ['City'], region: ['Region'], page: 2 },
      reviews
    }
  });
  const bodyRows = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';

  assert.equal((bodyRows.match(/<tr>/g) || []).length, 1);
  assert.match(html, /Страница 2 из 2/);
  assert.match(html, /Показано: 1 из 51/);
  assert.match(html, /data-review-list-page-link="1"/);
  assert.match(html, /page=1/);
  assert.doesNotMatch(html, /page=3/);
});

test('renderBrandAnalysisDashboardSection renders KPI, tables and SQL inspectors', () => {
  const currentUser = { role: 'analyst', permissions: ['brand-analysis', 'sql-inspector'] };
  const summaryHtml = renderBrandAnalysisDashboardSection({
    section: 'summary',
    currentUser,
    dashboard: {
      filters: { brandId: 'client-1' },
      selectedBrandTitle: 'Brand A',
      summary: {
        orderedShifts: 20,
        workedShifts: 15,
        coveredShifts: 17,
        openDemand: 3,
        slaPercent: 75,
        coveragePercent: 85,
        revenueRub: 30000,
        uniqueWorkers: 9,
        workplacesWithOrders: 4,
        workplacesWithWorkedShifts: 3,
        cancelledShifts: 2,
        selfBookingPercent: 40,
        orderStabilityPercent: 33.33333333333333,
        avgWorkerRateHour: 320,
        avgCustomerRateHour: 450
      }
    }
  });
  const trendHtml = renderBrandAnalysisDashboardSection({
    section: 'trend',
    currentUser,
    dashboard: {
      trendRows: [
        {
          period: '2026-04-01',
          orderedShifts: 20,
          workedShifts: 15,
          coveredShifts: 17,
          openDemand: 3,
          slaPercent: 75,
          coveragePercent: 85,
          revenueRub: 30000,
          cancelledShifts: 2,
          respondedUserIds: ['user-1', 'user-2'],
          workedUserIds: ['user-2'],
          uniqueRespondedUsers: 2,
          uniqueWorkedUsers: 1
        }
      ]
    }
  });
  const workplacesHtml = renderBrandAnalysisDashboardSection({
    section: 'workplaces',
    currentUser,
    dashboard: {
      workplaceRows: [
        {
          workplaceTitle: 'Точка <1>',
          city: 'Москва',
          orderedShifts: 20,
          workedShifts: 15,
          coveragePercent: 85,
          slaPercent: 75,
          revenueRub: 30000,
          cancelledShifts: 2
        }
      ]
    }
  });
  const regionsHtml = renderBrandAnalysisDashboardSection({
    section: 'regions',
    currentUser,
    dashboard: {
      regionRows: [{
        region: 'ЦФО',
        orderedShifts: 20,
        openDemand: 3,
        slaPercent: 75,
        coveragePercent: 85,
        workedShifts: 15,
        workplaces: 4,
        orderTrend: [
          { period: '2026-04-01', orderedShifts: 8 },
          { period: '2026-04-08', orderedShifts: 20 }
        ]
      }]
    }
  });
  const professionsHtml = renderBrandAnalysisDashboardSection({
    section: 'professions',
    currentUser,
    dashboard: {
      professionRows: [
        {
          profession: 'Комплектовщик',
          orderedShifts: 20,
          workedShifts: 15,
          slaPercent: 75,
          revenueRub: 30000,
          cancelledShifts: 2
        }
      ]
    }
  });
  const statusesHtml = renderBrandAnalysisDashboardSection({
    section: 'statuses',
    currentUser,
    dashboard: {
      statusRows: [{ status: 'confirmed', shifts: 15 }]
    }
  });

  assert.match(summaryHtml, /Основные показатели/);
  assert.match(summaryHtml, /30 000/);
  assert.match(summaryHtml, /data-sql-inspector-open="brand-analysis\.summary\.ordered-shifts"/);
  assert.match(summaryHtml, /data-sql-inspector-open="brand-analysis\.summary\.open-demand"/);
  assert.match(summaryHtml, /data-sql-inspector-open="brand-analysis\.summary\.avg-customer-rate-hour"/);
  assert.match(trendHtml, /data-brand-trend-charts/);
  assert.match(trendHtml, /class="brand-trend-chart-grid"/);
  assert.match(trendHtml, /data-brand-trend-period="day"/);
  assert.match(trendHtml, /data-brand-trend-period="week"/);
  assert.match(trendHtml, /data-brand-trend-period="month"/);
  assert.match(trendHtml, /data-brand-trend-period="quarter"/);
  assert.match(trendHtml, /data-brand-trend-chart="fulfillment"/);
  assert.match(trendHtml, /data-brand-trend-chart="workers"/);
  assert.match(trendHtml, /data-brand-trend-expand="fulfillment"/);
  assert.match(trendHtml, /data-brand-trend-expand="workers"/);
  assert.match(trendHtml, /data-brand-trend-modal/);
  assert.match(trendHtml, /data-brand-trend-modal-chart/);
  const fulfillmentSvg = trendHtml.match(/<article class="mini-panel brand-trend-chart" data-brand-trend-chart="fulfillment">[\s\S]*?<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1] || '';
  const workersSvg = trendHtml.match(/<article class="mini-panel brand-trend-chart" data-brand-trend-chart="workers">[\s\S]*?<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1] || '';
  assert.match(fulfillmentSvg, /<rect class="brand-trend-bar"/);
  assert.match(fulfillmentSvg, /<path class="brand-trend-line"/);
  assert.match(workersSvg, /<path class="brand-trend-line"/);
  assert.match(workersSvg, /<circle class="brand-trend-point"/);
  assert.doesNotMatch(trendHtml, /<table>/);
  assert.match(trendHtml, /"respondedUserIds":\["user-1","user-2"\]/);
  assert.match(trendHtml, /"workedUserIds":\["user-2"\]/);
  assert.match(trendHtml, /data-sql-inspector-open="brand-analysis\.trend"/);
  assert.match(workplacesHtml, /Точка &lt;1&gt;/);
  assert.doesNotMatch(workplacesHtml, /Точка <1>/);
  assert.match(workplacesHtml, /data-sql-inspector-open="brand-analysis\.workplaces\.sla"/);
  assert.match(regionsHtml, /Регионы присутствия бренда/);
  assert.match(regionsHtml, /Свободный заказ/);
  assert.match(regionsHtml, /data-brand-region-table/);
  assert.match(regionsHtml, /data-brand-region-sort="openDemand"/);
  assert.match(regionsHtml, /data-brand-region-open-demand="3"/);
  assert.match(regionsHtml, /class="brand-region-demand-trend/);
  assert.match(regionsHtml, /linear-gradient\(90deg/);
  assert.match(regionsHtml, /Динамика заказа: 8 → 20/);
  assert.match(regionsHtml, /data-sql-inspector-open="brand-analysis\.regions\.coverage"/);
  assert.match(professionsHtml, /data-sql-inspector-open="brand-analysis\.professions\.worked-shifts"/);
  assert.match(statusesHtml, /data-sql-inspector-open="brand-analysis\.statuses\.shifts"/);
});

test('renderBrandAnalysisDashboard includes client-side sorting for brand regions without fragment links', () => {
  const html = renderBrandAnalysisDashboard({
    database: 'etl',
    progressive: false,
    currentUser: { role: 'analyst', permissions: ['brand-analysis'] },
    dashboard: {
      filters: { period: 'month', from: '2026-04-01', to: '2026-04-30', brandId: 'Brand A', city: [], region: [] },
      brandOptions: [{ id: 'Brand A', title: 'Brand A' }],
      selectedBrandTitle: 'Brand A',
      summary: {}, trendRows: [], workplaceRows: [], professionRows: [], statusRows: [],
      regionRows: [
        { region: 'ЦФО', orderedShifts: 20, openDemand: 3, slaPercent: 75, coveragePercent: 85, workedShifts: 15, workplaces: 4 }
      ]
    }
  });

  assert.match(html, /document\.addEventListener\('click', function \(event\)[\s\S]*data-brand-region-sort/);
  assert.match(html, /body\.appendChild\(row\)/);
  assert.match(html, /data-brand-region-sort-direction/);
  assert.doesNotMatch(html, /data-brand-region-sort[^>]*data-dashboard-fragment-link/);
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
          slaPastPercent: 66.66666666666666,
          slaForecastPercent: 75,
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
  assert.match(html, /67% \/ 75%/);
  assert.doesNotMatch(html, /55\.6%/);
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
  assert.match(html, /data-dashboard-fragment-defer="#workplace-tab-attention"/);
  assert.match(html, /loadDeferredDashboardFragment/);
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
          slaPastPercent: 100,
          slaForecastPercent: 100,
          activeGigers5km: 1234567890,
          avgDailyOrder: 3,
          heatmapDays: []
        }
      ]
    }
  });

  assert.match(html, /\.point-metric-value\s*\{[^}]*font-size:\s*12px;[\s\S]*?white-space:\s*nowrap;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;/);
  assert.match(html, /\.point-metric-value\.compact\s*\{[^}]*font-size:\s*10px;/);
  assert.doesNotMatch(html, /\.point-metric-value\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(html, /<div class="point-metric-value compact">100% \/ 100%<\/div>/);
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
        slaPastPercent: 71.42857142857143,
        slaForecastPercent: 80,
        stabilityPercent: 50,
        uniqueCompletedWorkers: 5,
        uniqueBookedWorkers: 8,
        avgCompletedShiftsPerActiveWorkerWeek: 1.2,
        avgCompletedShiftsPerActiveWorkerMonth: 3.4,
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
          forecastSlaPercent: 100,
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
  assert.match(html, /Вып\. смен\/исп\. в неделю/);
  assert.match(html, /Вып\. смен\/исп\. в месяц/);
  assert.match(html, /1,2/);
  assert.match(html, /3,4/);
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
  assert.match(html, /71% \/ 80%/);
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
  assert.match(calendarPanelHtml, /<div class="point-calendar-cell" data-date="2026-07-01" data-sla-level="5" title="[^"]*SLA 100\.0%[^"]*" data-risk-level="low"/);
  assert.match(calendarPanelHtml, /data-date="2026-07-01"[\s\S]*?<span title="SLA">SLA<\/span>\s*<strong>100\.0%<\/strong>/);
  assert.match(calendarPanelHtml, /<span title="Размещение среднее">Ср<\/span>\s*<strong>1ч30м<\/strong>/);
  assert.match(calendarPanelHtml, /<span title="Размещение минимум">М<\/span>\s*<strong>30м<\/strong>/);
  assert.match(calendarPanelHtml, /<div class="point-calendar-cell" data-date="2026-07-02" title=/);
  assert.doesNotMatch(calendarPanelHtml, /data-date="2026-07-02" data-sla-level=/);
  assert.equal(countOccurrences(calendarPanelHtml, 'class="point-calendar-date"'), 32);
});

test('renderWorkplacePointDashboard renders year heatmap above calendar without horizontal page scroll', () => {
  const html = renderWorkplacePointDashboard({
    database: 'etl',
    currentUser: { role: 'analyst', permissions: ['workplace-analysis', 'sql-inspector'] },
    dashboard: {
      filters: {
        workplaceId: 'wp1',
        from: '2026-06-01',
        to: '2026-06-30',
        currentDate: '2026-07-02',
        profession: [],
        orderType: [],
        jobStatus: [],
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      currentDate: '2026-07-02',
      point: {
        workplaceId: 'wp1',
        title: 'Point',
        clientTitle: 'Brand',
        city: 'Moscow',
        region: 'Moscow',
        address: 'Moscow, Street'
      },
      summary: {},
      filterOptions: { profession: [], orderType: [], jobStatus: [] },
      yearHeatmapRows: [
        { period: '2026-01-01', orderedShifts: 3, completedShifts: 2 },
        { period: '2026-02-01', orderedShifts: 8, completedShifts: 6 },
        { period: '2026-07-02', orderedShifts: 0, completedShifts: 0 }
      ],
      dailyRows: [
        {
          period: '2026-06-01',
          orderedShifts: 1,
          completedShifts: 1,
          slaPercent: 100,
          forecastSlaPercent: 0,
          dropoffs24h: 0
        }
      ],
      professionRows: []
    }
  });

  const yearStart = html.indexOf('class="detail-panel year-heatmap-panel"');
  const calendarStart = html.indexOf('class="detail-panel calendar-panel"');

  assert.ok(yearStart > -1);
  assert.ok(calendarStart > yearStart);
  assert.match(html, /data-sql-inspector-open="workplace-point\.charts\.year-heatmap"/);
  assert.match(html, /class="point-year-heatmap-month-label">Янв<\/div>/);
  assert.match(html, /class="point-year-heatmap-month-label">Фев<\/div>/);
  assert.match(html, /class="point-year-heatmap-months" style="--point-year-heatmap-week-columns: \d+;"/);
  assert.match(html, /class="point-year-heatmap-month" style="grid-column: span 5; --point-year-heatmap-month-weeks: 5;"/);
  assert.match(html, /<span class="point-year-heatmap-cell is-current-day" data-date="2026-07-02" data-level="0" aria-current="date"/);
  assert.match(html, /\.point-year-heatmap\s*\{[^}]*width:\s*75%;/);
  assert.match(html, /\.point-year-heatmap-months\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--point-year-heatmap-week-columns,\s*63\),\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.point-year-heatmap-grid\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--point-year-heatmap-month-weeks,\s*5\),\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\);[^}]*grid-auto-flow:\s*column;/);
  assert.doesNotMatch(html, /\.point-year-heatmap[\s\S]{0,260}overflow-x:\s*auto/);
});

test('renderWorkplacePointDashboard defers heavy point fragments and limits fragment concurrency', () => {
  const html = renderWorkplacePointDashboard({
    database: 'etl',
    progressive: true,
    currentUser: { role: 'analyst', permissions: ['workplace-analysis'] },
    dashboard: {
      filters: {
        workplaceId: 'wp1',
        from: '2026-06-01',
        to: '2026-06-30',
        profession: [],
        orderType: [],
        jobStatus: [],
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      point: {
        workplaceId: 'wp1',
        title: 'Point',
        address: 'Moscow, Street'
      },
      filterOptions: { profession: [], orderType: [], jobStatus: [] }
    }
  });

  assert.match(html, /section=summary/);
  assert.match(html, /section=charts/);
  assert.match(html, /data-dashboard-fragment-url="[^"]*section=radius[^"]*" data-dashboard-fragment-defer="idle"/);
  assert.match(html, /data-dashboard-fragment-url="[^"]*section=year-heatmap[^"]*" data-dashboard-fragment-defer="visible"/);
  assert.match(html, /var dashboardFragmentLimit = 2;/);
  assert.match(html, /function enqueueDashboardFragment\(root\)/);
  assert.match(html, /requestIdleCallback/);
  assert.match(html, /IntersectionObserver/);
});

test('renderWorkplacePointDashboardSection does not duplicate year heatmap in charts fragment', () => {
  const html = renderWorkplacePointDashboardSection({
    section: 'charts',
    currentUser: { role: 'analyst', permissions: ['workplace-analysis', 'sql-inspector'] },
    dashboard: {
      filters: {
        workplaceId: 'wp1',
        from: '2026-06-01',
        to: '2026-06-30',
        profession: [],
        orderType: [],
        jobStatus: [],
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      currentDate: '2026-07-02',
      dailyRows: [
        {
          period: '2026-06-01',
          orderedShifts: 1,
          completedShifts: 1,
          slaPercent: 100,
          forecastSlaPercent: 0,
          dropoffs24h: 0
        }
      ],
      professionRows: []
    }
  });

  assert.match(html, /class="detail-panel calendar-panel"/);
  assert.doesNotMatch(html, /class="detail-panel year-heatmap-panel"/);
  assert.doesNotMatch(html, /workplace-point\.charts\.year-heatmap/);
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
  assert.match(html, /data-city-dynamic-chart/);
  assert.match(html, /data-city-dynamic-series-toggle="orderedShifts"/);
  assert.match(html, /data-city-dynamic-series="orderedShifts"/);
  assert.match(html, /data-city-dynamic-has-selection/);
  assert.match(html, /document\.addEventListener\('click'[\s\S]*data-city-dynamic-series-toggle/);
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

  assert.match(html, /class="city-dashboard-tabs"/);
  assert.match(html, /role="tablist" aria-label="Разделы анализа городов"/);
  assert.match(html, /class="city-dashboard-panel city-dashboard-panel-ranking"/);
  assert.match(html, /class="city-dashboard-panel city-dashboard-panel-city"/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/city-analysis\/section\?section=city-ranking&amp;from=2026-05-01&amp;to=2026-05-31/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/city-analysis\/section\?section=summary-demand&amp;from=2026-05-01&amp;to=2026-05-31&amp;city=/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/city-analysis\/section\?section=summary-base&amp;from=2026-05-01/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/city-analysis\/section\?section=composition&amp;from=2026-05-01/);
  assert.match(html, /data-city-analysis-progressive/);
  assert.match(html, /Загружается/);
  assert.doesNotMatch(html, /<(?:div|section)[^>]+data-city-analysis-fragment-url/);
  assert.doesNotMatch(html, /<div class="kpi-value">0<\/div>/);
});

test('renderCityAnalysisDashboardSection renders city ranking data for local filtering and sorting', () => {
  const html = renderCityAnalysisDashboardSection({
    section: 'city-ranking',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03'
      },
      cityRanking: {
        brands: ['Brand A', 'Brand <bad>'],
        rows: [
          {
            city: 'Москва<script>',
            brand: 'Brand A',
            orderedShifts: 10,
            workplaceCount: 2,
            orderCount: 3,
            coveredShifts: 8
          },
          {
            city: 'Казань',
            brand: 'Brand <bad>',
            orderedShifts: 4,
            workplaceCount: 1,
            orderCount: 1,
            coveredShifts: 4
          }
        ],
        summaryRows: [
          {
            city: 'Москва<script>',
            orderedShifts: 10,
            workplaceCount: 2,
            brandCount: 1,
            orderCount: 3,
            coveredShifts: 8,
            slaPercent: 80
          },
          {
            city: 'Казань',
            orderedShifts: 4,
            workplaceCount: 1,
            brandCount: 1,
            orderCount: 1,
            coveredShifts: 4,
            slaPercent: 100
          }
        ]
      }
    }
  });

  assert.match(html, /data-city-ranking-table/);
  assert.match(html, /data-city-ranking-json=/);
  assert.match(html, /data-city-ranking-brand/);
  assert.match(html, /data-city-ranking-export/);
  assert.match(html, />Выгрузить в Excel</);
  assert.match(html, /data-city-ranking-sort="orderedShifts"/);
  assert.match(html, /data-city-ranking-sort="workplaceCount"/);
  assert.match(html, /data-city-ranking-sort="brandCount"/);
  assert.match(html, /data-city-ranking-sort="slaPercent"/);
  assert.match(html, /Brand &lt;bad&gt;/);
  assert.match(html, /Москва&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="[^"]*sort=/);
  assert.doesNotMatch(html, /\/dashboards\/city-analysis\/section[^"]*export=/);
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
    'city-analysis.dynamics.line-ordered-shifts',
    'city-analysis.dynamics.line-app-active-users',
    'city-analysis.dynamics.line-booked-users',
    'city-analysis.dynamics.line-completed-users',
    'city-analysis.dynamics.line-active-users-per-request',
    'city-analysis.dynamics.bar-ordered-shifts',
    'city-analysis.dynamics.bar-app-active-users',
    'city-analysis.dynamics.bar-booked-users',
    'city-analysis.dynamics.bar-completed-users',
    'city-analysis.dynamics.bar-active-users-per-request'
  ];

  for (const id of expectedIds) {
    assert.match(html, new RegExp(`data-sql-inspector-open="${escapeRegExp(id)}"`));
  }
});

test('renderCityAnalysisDashboardSection renders line and bar chart variants for city dynamics', () => {
  const html = renderCityAnalysisDashboardSection({
    currentUser: { role: 'admin', permissions: [] },
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

  assert.match(html, /city-chart-variant-tabs/);
  assert.equal(countOccurrences(html, 'name="city-dynamics-chart-variant"'), 2);
  assert.match(html, /for="city-dynamics-chart-line">Линии<\/label>/);
  assert.match(html, /for="city-dynamics-chart-bar">Столбцы<\/label>/);
  assert.match(html, /city-chart-variant-panel-line/);
  assert.match(html, /city-chart-variant-panel-bar/);
  assert.match(html, /data-city-dynamic-chart/);
  assert.match(html, /city-line-chart/);
  assert.match(html, /<svg class="city-line-chart-svg"/);
  assert.equal(countOccurrences(html, 'class="city-line-series'), 5);
  assert.match(html, /<polyline class="city-line-series city-series-demand" data-city-dynamic-series="orderedShifts"/);
  assert.match(html, /<circle class="city-line-point city-series-demand" data-city-dynamic-series="orderedShifts"/);
  assert.match(html, /city-line-legend/);
  assert.match(html, /city-bar-chart/);
  assert.match(html, /city-bar-chart-grid/);
  assert.equal(countOccurrences(html, 'class="city-bar-column'), 10);
  assert.match(html, /<div class="city-bar-column" data-city-dynamic-series="orderedShifts"/);
  assert.match(html, /city-bar-legend/);
  assert.equal(countOccurrences(html, 'data-city-dynamic-series-toggle='), 10);
  assert.equal(countOccurrences(html, 'data-city-dynamic-legend-item='), 10);
  assert.equal(countOccurrences(html, 'aria-pressed="false"'), 10);
  assert.match(html, /Заказ/);
  assert.match(html, /Входы/);
  assert.match(html, /Отклики/);
  assert.match(html, /Завершения/);
  assert.match(html, /Актив\/заявка/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.line-ordered-shifts"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.line-app-active-users"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.line-booked-users"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.line-completed-users"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.line-active-users-per-request"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.bar-ordered-shifts"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.bar-app-active-users"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.bar-booked-users"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.bar-completed-users"/);
  assert.match(html, /data-sql-inspector-open="city-analysis\.dynamics\.bar-active-users-per-request"/);
  assert.doesNotMatch(html, /Small multiples/);
  assert.doesNotMatch(html, /Тепловая карта/);
  assert.doesNotMatch(html, /Воронка/);
  assert.doesNotMatch(html, /Индексы/);
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
        activeBasePeriod: 'selected',
        workerConcentrationLayer: 'on'
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
  assert.match(html, /<input type="checkbox" name="workerConcentrationLayer" value="on" checked>/);
  assert.match(html, /Концентрация исполнителей/);
  assert.match(html, /Все зарегистрированные/);
  assert.match(html, /ready, booked, worked/);
  assert.match(html, /Выбранный месяц/);
  assert.match(html, /<input type="checkbox" name="client" value="&lt;script&gt;client&lt;\/script&gt;" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input type="checkbox" name="excludedProfession" value="Курьер&lt;script&gt;bad&lt;\/script&gt;" checked data-multi-filter-checkbox>/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/heatmap\/section\?section=map&amp;year=2026&amp;month=5/);
  assert.match(html, /addressSearch=%D0%A2%D0%B2%D0%B5%D1%80%D1%81%D0%BA%D0%B0%D1%8F%3Cscript%3Eaddr%3C%2Fscript%3E/);
  assert.match(html, /activeBasePeriod=selected/);
  assert.match(html, /workerConcentrationLayer=on/);
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
      activeBaseMode: 'all',
      workerConcentrationLayer: 'on'
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
    ],
    workerConcentration: [
      { lon: 37.62, lat: 55.75, activeUsers: 12, intensity: 0.8 },
      { lon: 49.12, lat: 55.79, activeUsers: 5, intensity: 0.3 },
      { lon: 30.3, lat: 59.9, activeUsers: 999, intensity: 0 }
    ]
  };
  const html = renderHeatmapDashboardSection({
    dashboard,
    section: 'map',
    currentUser: { role: 'admin', permissions: [] }
  });

  assert.match(html, /leaflet\.css/);
  assert.match(html, /leaflet\.js/);
  assert.match(html, /data-heatmap-leaflet-map/);
  assert.match(html, /data-heatmap-points="/);
  assert.match(html, /data-worker-concentration="/);
  assert.match(html, /&quot;activeUsers&quot;:12/);
  assert.match(html, /&quot;intensity&quot;:0\.8/);
  assert.doesNotMatch(html, /&quot;activeUsers&quot;:999/);
  assert.match(html, /workerConcentrationLayer/);
  assert.match(html, /drawWorkerConcentrationLayer/);
  assert.match(html, /if \(intensity <= 0\) \{/);
  assert.match(html, /canvas\.style\.opacity = '0\.9';/);
  assert.match(html, /canvas\.style\.zIndex = '450';/);
  assert.match(html, /var radius = Math\.max\(32, Math\.min\(128, 32 \+ intensity \* 96\)\);/);
  assert.match(html, /var coreAlpha = 0\.36 \+ intensity \* 0\.44;/);
  assert.match(html, /var midAlpha = 0\.16 \+ intensity \* 0\.26;/);
  assert.match(html, /map\.on\('zoomstart zoom zoomend viewreset move resize moveend', redraw\);/);
  assert.ok(
    html.indexOf('map.fitBounds(bounds') < html.indexOf('drawWorkerConcentrationLayer(map, root, workerConcentration);')
  );
  assert.match(html, /data-sql-inspector-open="heatmap\.map\.worker-concentration"/);
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

test('renderHeatmapDashboardSection renders worker concentration when demand points are empty', () => {
  const html = renderHeatmapDashboardSection({
    section: 'map',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        workerConcentrationLayer: 'on'
      },
      summary: {},
      points: [],
      workerConcentration: [
        { lon: 37.62, lat: 55.75, activeUsers: 12, intensity: 0.8 }
      ]
    }
  });

  assert.match(html, /data-heatmap-leaflet-map/);
  assert.match(html, /data-heatmap-points="\[\]"/);
  assert.match(html, /data-worker-concentration="/);
  assert.match(html, /heatmap-gradient-workers/);
  assert.doesNotMatch(html, /<p class="empty">/);
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
