const express = require('express');
const fs = require('node:fs/promises');
const { STATUS_CODES } = require('node:http');
const path = require('node:path');

const {
  createSessionManager,
  createUserStore,
  hasPermission
} = require('./auth');
const { ClickHouseClient } = require('./clickhouseClient');
const { loadConfig } = require('./config');
const { createWorkplaceDirectoryCache } = require('./workplaceDirectoryCache');
const { createPreloadService } = require('./preloadService');
const { createCityGigerScopeService } = require('./cityGigerScopeService');
const { createCityAnalysisAsyncSectionService } = require('./cityAnalysisAsyncSectionService');
const { createScheduledReportStore } = require('./scheduledReportStore');
const { createScheduledReportMailer, sanitizeMailError } = require('./scheduledReportMailer');
const { createScheduledReportRunner } = require('./scheduledReportRunner');
const { createScheduledReportScheduler } = require('./scheduledReportScheduler');
const { createScheduledReportService } = require('./scheduledReportService');
const {
  assertSafeReportSql,
  normalizeReportLimits,
  wrapReportSql
} = require('./scheduledReportSql');
const { buildSalesByProjectPreloadQueries } = require('./preloadSalesByProject');
const {
  SALES_PRELOAD_JOB_ID,
  WORKPLACE_POINT_PRELOAD_JOB_ID,
  WORKER_CANCELLATIONS_PRELOAD_JOB_ID
} = require('./preloadStore');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');
const { parseMultipartFormData } = require('./multipartFormData');
const {
  buildRequestReportCheckWorkbook,
  findRequestReportRowsWithoutConfirmedShift,
  parseRequestsReportWorkbook
} = require('./requestReportMissingConfirmed');
const {
  createRequestReportJobStore
} = require('./requestReportJobStore');
const { buildXlsxWorkbook } = require('./xlsxWorkbook');
const {
  runRequestReportConfirmedCheckJob
} = require('./requestReportJobRunner');
const {
  createRequestReportShiftStatusStore
} = require('./requestReportShiftStatusStore');
const {
  createUserActivityStore,
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS
} = require('./userActivityStore');
const {
  CITY_ANALYSIS_SECTIONS,
  cityGigerDetailsFromScope,
  cityGigerScopeKey,
  loadCityAnalysisGigerDetails,
  loadCityAnalysisGigerScopeRows,
  loadCityAnalysisDashboardSection,
  loadCityAnalysisDashboardShell,
  mergeCityAnalysisRows,
  normalizeCityAnalysisFilters,
  normalizeCityGigerDetailsInput
} = require('./cityAnalysisDashboard');
const {
  REGION_ANALYSIS_SECTIONS,
  loadRegionAnalysisGigerDetails,
  loadRegionAnalysisDashboardSection,
  loadRegionAnalysisDashboardShell
} = require('./regionAnalysisDashboard');
const {
  HEATMAP_SECTIONS,
  loadHeatmapDashboardSection,
  loadHeatmapDashboardShell
} = require('./heatmapDashboard');
const {
  SALES_BY_PROJECT_SECTIONS,
  loadSalesByProjectDashboardSection,
  loadSalesByProjectDashboardShell
} = require('./salesByProjectDashboard');
const {
  BRAND_ANALYSIS_SECTIONS,
  loadBrandAnalysisReviews,
  loadBrandAnalysisDashboardSection,
  loadBrandAnalysisDashboardShell
} = require('./brandAnalysisDashboard');
const {
  WORKPLACE_ANALYSIS_SECTIONS,
  loadWorkplaceAnalysisGigerDetails,
  loadWorkplaceAnalysisDashboardSection,
  loadWorkplaceAnalysisDashboardShell
} = require('./workplaceAnalysisDashboard');
const {
  WORKPLACE_POINT_SECTIONS,
  loadWorkplacePointDashboardSection,
  loadWorkplacePointDashboardShell,
  loadWorkplacePointDayDetails,
  loadWorkplacePointGigerDetails,
  loadWorkplacePointReviews
} = require('./workplacePointDashboard');
const {
  WORKER_CANCELLATIONS_SECTIONS,
  loadWorkerBlacklistDetails,
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDetails,
  loadWorkerCancellationsDashboardShell
} = require('./workerCancellationsDashboard');
const {
  renderAccountManagement,
  renderBrandAnalysisDashboard,
  renderBrandAnalysisReviews,
  renderBrandAnalysisDashboardSection,
  renderDashboardSectionError,
  renderError,
  renderGigerDetails,
  renderGigerDetailsWorkbook,
  renderCityAnalysisDashboardSection,
  renderCityAnalysisSectionError,
  renderCityAnalysisDashboard,
  renderRegionAnalysisDashboard,
  renderRegionAnalysisDashboardSection,
  renderHeatmapDashboard,
  renderHeatmapDashboardSection,
  renderHome,
  renderLogin,
  renderMailSettingsPage,
  renderPasswordChange,
  renderPreloadManagement,
  renderRequestReportMissingConfirmedPage,
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
} = require('./render');

function sanitizeForResponse(message, config) {
  const text = String(message || '');
  let safeMessage = text.trim() === '' ? 'Unexpected error' : text;
  const secrets = [
    config && config.clickhouse && config.clickhouse.password,
    config && config.auth && config.auth.adminPassword,
    config && config.auth && config.auth.sessionSecret
  ].filter((secret) => typeof secret === 'string' && secret !== '');

  for (const secret of secrets) {
    safeMessage = safeMessage.split(secret).join('[redacted]');
  }

  return safeMessage;
}

function statusCodeFromError(error) {
  const statusCode = error && (error.status || error.statusCode);

  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 499) {
    return statusCode;
  }

  return 502;
}

function queryStringWithout(originalUrl, keys) {
  const query = String(originalUrl || '').split('?')[1] || '';
  const params = new URLSearchParams(query);

  for (const key of keys) {
    params.delete(key);
  }

  return params.toString();
}

function attachGigerDetailsUrls(req, details, exportPath) {
  const exportQuery = queryStringWithout(req.originalUrl, ['page', 'export']);
  const suffix = exportQuery === '' ? '' : `?${exportQuery}`;

  return {
    ...details,
    detailUrl: req.originalUrl,
    exportUrl: `${exportPath}${suffix}`
  };
}

function sendGigerDetailsWorkbook(res, details, filename) {
  res
    .status(200)
    .set('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .send(renderGigerDetailsWorkbook({ details }));
}

function sendRequestReportCheckWorkbook(res, workbook) {
  res
    .status(200)
    .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .set('Content-Disposition', 'attachment; filename="request-report-check.xlsx"')
    .send(workbook);
}

function normalizePathForNav(path) {
  const text = String(path || '/');

  return text.length > 1 ? text.replace(/\/+$/, '') : text;
}

function activeNavForPath(path) {
  const normalized = normalizePathForNav(path);
  const navByPath = {
    '/admin/activity': 'activity',
    '/admin/mail-settings': 'mail-settings',
    '/admin/preload': 'preload-admin',
    '/admin/users': 'users',
    '/dashboards/city-analysis': 'city-analysis',
    '/dashboards/heatmap': 'heatmap',
    '/dashboards/brand-analysis': 'brand-analysis',
    '/dashboards/sales-by-project': 'sales-by-project',
    '/dashboards/workplace-analysis': 'workplace-analysis',
    '/dashboards/worker-cancellations': 'worker-cancellations',
    '/reports/scheduled': 'scheduled-reports',
    '/tools/request-report-confirmed-check': 'request-report-matching'
  };

  if (normalized.startsWith('/admin/users/')) {
    return 'users';
  }

  if (normalized.startsWith('/admin/activity/')) {
    return 'activity';
  }

  if (normalized.startsWith('/admin/preload/')) {
    return 'preload-admin';
  }

  if (normalized.startsWith('/admin/mail-settings/')) {
    return 'mail-settings';
  }

  if (normalized.startsWith('/reports/scheduled/')) {
    return 'scheduled-reports';
  }

  if (normalized.startsWith('/dashboards/workplace-analysis/')) {
    return 'workplace-analysis';
  }

  if (normalized.startsWith('/dashboards/city-analysis/')) {
    return 'city-analysis';
  }

  if (normalized.startsWith('/dashboards/region-analysis/')) {
    return 'region-analysis';
  }

  if (normalized.startsWith('/dashboards/heatmap/')) {
    return 'heatmap';
  }

  if (normalized.startsWith('/dashboards/sales-by-project/')) {
    return 'sales-by-project';
  }

  if (normalized.startsWith('/dashboards/brand-analysis/')) {
    return 'brand-analysis';
  }

  if (normalized.startsWith('/dashboards/worker-cancellations/')) {
    return 'worker-cancellations';
  }

  if (normalized.startsWith('/tools/request-report-confirmed-check/')) {
    return 'request-report-matching';
  }

  return navByPath[normalized] || 'tables';
}

function preloadMessage(code) {
  const messages = {
    'schedule-saved': 'Расписание сохранено',
    'run-started': 'Обновление запущено',
    'already-running': 'Обновление уже выполняется'
  };

  if (String(code || '') === 'city-cache-cleared') {
    return 'Кеш анализа городов удален';
  }

  return messages[String(code || '')] || '';
}

function formatDateUTC(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function timeMs(value) {
  const number = value instanceof Date ? value.getTime() : Number(value);

  return Number.isFinite(number) ? number : Date.now();
}

function millisecondsUntilNextUtcDay(value) {
  const current = timeMs(value);
  const date = new Date(current);
  const nextUtcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);

  return Math.max(0, nextUtcDay - current);
}

function defaultBuildInfo(env = process.env, now = new Date()) {
  return {
    version: env.APP_VERSION || env.GIT_SHA || env.COMMIT_SHA || 'unknown',
    startedAt: now.toISOString()
  };
}

function currentMonthRange(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  return {
    from: formatDateUTC(from),
    to: formatDateUTC(to),
    fromDateTime: `${formatDateUTC(from)} 00:00:00`,
    toDateTime: `${formatDateUTC(to)} 00:00:00`
  };
}

function stripJSONEachRow(query) {
  return String(query || '').replace(/\s*FORMAT JSONEachRow\s*$/i, '');
}

function scheduleDailyCacheCleanup({
  caches,
  logger = console,
  now = () => new Date(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  const cleanupCaches = (caches || []).filter((cache) => cache && typeof cache.pruneExpired === 'function');
  let stopped = false;
  let timer = null;

  function warn(message) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(message);
      return;
    }

    if (logger && typeof logger.log === 'function') {
      logger.log(message);
    }
  }

  async function pruneExpiredCaches() {
    const current = now();

    await Promise.all(cleanupCaches.map(async (cache) => {
      try {
        await cache.pruneExpired(current);
      } catch (error) {
        warn(`Cache cleanup failed: ${error && error.message ? error.message : 'Unexpected error'}`);
      }
    }));
  }

  function scheduleNext() {
    if (stopped || cleanupCaches.length === 0) {
      return;
    }

    const delay = Math.max(1, millisecondsUntilNextUtcDay(now()));

    timer = setTimeoutFn(async () => {
      await pruneExpiredCaches();
      scheduleNext();
    }, delay);

    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  pruneExpiredCaches();
  scheduleNext();

  return {
    stop() {
      stopped = true;

      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
    }
  };
}

function createManualRangeError() {
  const error = new Error('Неверный диапазон дат');

  error.status = 400;
  return error;
}

function createScheduleSettingsError() {
  const error = new Error('Неверные настройки расписания');

  error.status = 400;
  return error;
}

function parseScheduleTimeFromBody(value) {
  const text = String(value || '');
  const match = /^(\d{2}):(\d{2})$/.exec(text);

  if (!match) {
    throw createScheduleSettingsError();
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    throw createScheduleSettingsError();
  }

  return text;
}

function preloadScheduleWindowMinimum(jobId) {
  if (jobId === WORKER_CANCELLATIONS_PRELOAD_JOB_ID) return 60;
  return jobId === WORKPLACE_POINT_PRELOAD_JOB_ID ? 30 : 45;
}

function preloadScheduleFutureWindowMinimum(jobId) {
  return jobId === WORKER_CANCELLATIONS_PRELOAD_JOB_ID ? 0 : preloadScheduleWindowMinimum(jobId);
}

function parseRefreshDaysFromBody(value, minimumDays = 45) {
  const text = String(value || '');

  if (!/^\d+$/.test(text)) {
    throw createScheduleSettingsError();
  }

  const refreshDays = Number(text);

  if (!Number.isInteger(refreshDays) || refreshDays < minimumDays || refreshDays > 366) {
    throw createScheduleSettingsError();
  }

  return refreshDays;
}

function parseManualDate(value) {
  const text = String(value || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createManualRangeError();
  }

  const date = new Date(`${text}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== text) {
    throw createManualRangeError();
  }

  return { text, date };
}

function normalizeManualPreloadRange(body) {
  const from = parseManualDate(body && body.from);
  const to = parseManualDate(body && body.to);

  if (from.date.getTime() > to.date.getTime()) {
    throw createManualRangeError();
  }

  const exclusiveTo = new Date(to.date.getTime());

  exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);

  return {
    fromDate: from.text,
    toDate: formatDateUTC(exclusiveTo)
  };
}

function citySummaryFromGigerScopes(service, section, input, now) {
  if (!service || (section !== 'summary-base' && section !== 'summary-app')) {
    return null;
  }

  if (normalizeCityAnalysisFilters(input, now).city === '') {
    return null;
  }

  const metrics = section === 'summary-base'
    ? ['total-located-users']
    : ['app-active-users', 'app-30d-active-users'];
  const scopes = metrics.map((metric) => {
    const detailInput = normalizeCityGigerDetailsInput({ ...input, metric }, now);
    const key = cityGigerScopeKey(detailInput);

    return { metric, key, state: service.request(key, detailInput).state };
  });

  if (scopes.some((scope) => scope.state !== 'ready')) {
    return { state: 'loading' };
  }

  const summaries = Object.fromEntries(scopes.map((scope) => [scope.metric, service.summarize(scope.key)]));

  if (Object.values(summaries).some((summary) => summary === null)) {
    return { state: 'loading' };
  }

  if (section === 'summary-base') {
    const summary = summaries['total-located-users'];

    return {
      state: 'ready',
      summaryRows: [{
        total_located_users: summary.total,
        ready_located_users: summary.readyBase,
        ready_status_located_users: summary.ready,
        booked_status_located_users: summary.booked,
        worked_status_located_users: summary.worked
      }]
    };
  }

  const active = summaries['app-active-users'];
  const active30d = summaries['app-30d-active-users'];

  return {
    state: 'ready',
    summaryRows: [{
      app_active_users: active.total,
      app_30d_active_users: active30d.total,
      app_30d_ready_status_users: active30d.ready,
      app_30d_booked_status_users: active30d.booked,
      app_30d_worked_status_users: active30d.worked
    }]
  };
}

function citySummaryDashboardFromScope(input, now, summaryRows) {
  const filters = normalizeCityAnalysisFilters(input, now);

  return mergeCityAnalysisRows(filters, {
    cityOptionRows: [],
    filterOptionRows: [],
    // Координаты уже были успешно использованы при построении области гигеров.
    cityCoordinateRows: [{ city: filters.city }],
    summaryRows,
    brandRows: [],
    professionRows: [],
    rateRows: [],
    dynamicRows: [],
    cityRankingRows: []
  });
}

function cityAsyncSectionKey(section, input, now) {
  const filters = normalizeCityAnalysisFilters(input, now);

  return JSON.stringify({
    section,
    city: filters.city,
    from: filters.from,
    to: filters.to,
    client: filters.client,
    profession: filters.profession,
    orderType: filters.orderType,
    jobStatus: filters.jobStatus,
    contractor: filters.contractor,
    salaryFrom: filters.salaryFrom,
    salaryTo: filters.salaryTo,
    includeDeletedOrders: filters.includeDeletedOrders,
    includeHiddenOrders: filters.includeHiddenOrders
  });
}

function createApp({
  config,
  client,
  activeGigersCache = null,
  cityAnalysisCache = null,
  cityGigerScopeService = null,
  cityAnalysisAsyncSectionService = null,
  dashboardSectionCache = null,
  workplaceDirectoryCache = createWorkplaceDirectoryCache({ filePath: null, disabled: true }),
  preloadService = null,
  scheduledReportService = null,
  requestReportShiftStatusStore = createRequestReportShiftStatusStore({
    filePath: config.requestReportStatus && config.requestReportStatus.storePath
  }),
  userStore = null,
  sessionManager = null,
  activityStore = null,
  buildInfo = config && config.app ? config.app : defaultBuildInfo(),
  now = () => new Date(),
  requestReportJobStore = createRequestReportJobStore({ now: () => now().getTime() }),
  requestReportJobRunner = runRequestReportConfirmedCheckJob,
  setImmediateFn = setImmediate
}) {
  const app = express();
  const database = config.clickhouse.database;
  const preloads = preloadService;
  const cityGigerScopes = cityGigerScopeService;
  const cityAsyncSections = cityAnalysisAsyncSectionService;
  const scheduledReports = scheduledReportService;
  const authConfig = config.auth || { enabled: false };
  const authEnabled = authConfig.enabled === true;
  const accounts = userStore || (authEnabled
    ? createUserStore({
        filePath: authConfig.userStorePath,
        adminEmail: authConfig.adminEmail,
        adminPassword: authConfig.adminPassword,
        passwordHashOptions: {
          iterations: authConfig.passwordHashIterations
        }
      })
    : null);
  const sessions = sessionManager || (authEnabled
    ? createSessionManager({
        cookieName: authConfig.sessionCookieName,
        ttlMs: authConfig.sessionTtlMs,
        secret: authConfig.sessionSecret || undefined
      })
    : null);
  const activity = authEnabled ? activityStore : null;

  app.locals.activityStore = activity;

  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  });

  function sanitizedPath(req) {
    return req.path || '/';
  }

  function sectionForPath(pathName) {
    if (pathName === '/login' || pathName === '/logout') {
      return 'auth';
    }

    if (pathName === '/account/password') {
      return 'auth';
    }

    if (pathName === '/admin/users' || pathName.startsWith('/admin/users/')) {
      return 'users';
    }

    if (pathName === '/admin/activity' || pathName.startsWith('/admin/activity/')) {
      return 'activity';
    }

    if (pathName === '/admin/preload' || pathName.startsWith('/admin/preload/')) {
      return 'preload-admin';
    }

    if (pathName === '/admin/mail-settings' || pathName.startsWith('/admin/mail-settings/')) {
      return 'mail-settings';
    }

    if (pathName === '/reports/scheduled' || pathName.startsWith('/reports/scheduled/')) {
      return 'scheduled-reports';
    }

    if (pathName === '/' || pathName === '/tables' || pathName.startsWith('/tables/')) {
      return 'tables';
    }

    if (pathName === '/dashboards/sales-by-project' || pathName.startsWith('/dashboards/sales-by-project/')) {
      return 'sales-by-project';
    }

    if (pathName === '/dashboards/brand-analysis' || pathName.startsWith('/dashboards/brand-analysis/')) {
      return 'brand-analysis';
    }

    if (pathName === '/dashboards/city-analysis' || pathName.startsWith('/dashboards/city-analysis/')) {
      return 'city-analysis';
    }

    if (pathName === '/dashboards/heatmap' || pathName.startsWith('/dashboards/heatmap/')) {
      return 'heatmap';
    }

    if (pathName === '/dashboards/workplace-analysis' || pathName.startsWith('/dashboards/workplace-analysis/')) {
      return 'workplace-analysis';
    }

    if (pathName === '/dashboards/worker-cancellations' || pathName.startsWith('/dashboards/worker-cancellations/')) {
      return 'worker-cancellations';
    }

    if (pathName === '/tools/request-report-confirmed-check' || pathName.startsWith('/tools/request-report-confirmed-check/')) {
      return 'request-report-matching';
    }

    return 'other';
  }

  function isProgressiveSectionPath(pathName) {
    return pathName === '/section' || pathName.endsWith('/section');
  }

  function isExportPath(pathName) {
    return pathName === '/export' || pathName.endsWith('/export');
  }

  function isDetailPath(pathName) {
    return !isExportPath(pathName) && (
      pathName === '/gigers' ||
      pathName.endsWith('/gigers') ||
      pathName === '/reviews' ||
      pathName.endsWith('/reviews') ||
      pathName === '/details' ||
      pathName.endsWith('/details')
    );
  }

  function requestHasFilters(req) {
    return Object.keys(req.query || {}).some((key) => key !== 'section');
  }

  function activityEventType(req) {
    const method = req.method;
    const pathName = sanitizedPath(req);

    if (method === 'POST' && pathName === '/login') {
      return 'login';
    }

    if (method === 'POST' && pathName === '/logout') {
      return 'logout';
    }

    if (method === 'POST' && pathName === '/account/password') {
      return 'password_change';
    }

    if (method === 'POST' && pathName.startsWith('/admin/')) {
      return 'admin_action';
    }

    if (method === 'POST' && pathName.startsWith('/reports/scheduled')) {
      return 'admin_action';
    }

    if (method !== 'GET') {
      return '';
    }

    if (/^\/reports\/scheduled\/runs\/[^/]+\/download$/.test(pathName)) {
      return 'export';
    }

    if (isProgressiveSectionPath(pathName)) {
      return '';
    }

    if (isExportPath(pathName)) {
      return 'export';
    }

    if (isDetailPath(pathName)) {
      return 'detail_open';
    }

    if (pathName.startsWith('/dashboards/') && requestHasFilters(req)) {
      return 'dashboard_filter';
    }

    return 'page_view';
  }

  function recordActivity(req, user, eventType) {
    if (!activity || !user || !eventType) {
      return;
    }

    const pathName = sanitizedPath(req);

    try {
      activity.recordEvent({
        userId: user.id,
        email: user.email,
        role: user.role,
        eventType,
        method: req.method,
        path: pathName,
        section: sectionForPath(pathName),
        occurredAt: now().toISOString()
      });
    } catch (error) {
      console.warn(`Activity event recording failed: ${sanitizeForResponse(error && error.message, config)}`);
    }
  }

  function recordCurrentUserActivity(req, eventType) {
    recordActivity(req, req.auth && req.auth.user, eventType);
  }

  function viewContext(req) {
    if (!req || !req.auth) {
      return {};
    }

    return {
      currentUser: req.auth.user,
      csrfToken: req.auth.session.csrfToken
    };
  }

  function requestReportStatusUserId(req) {
    return (req && req.auth && req.auth.user && req.auth.user.id) || 'anonymous';
  }

  function sendError(res, statusCode, title, message, activeNav = 'tables', context = {}) {
    res
      .status(statusCode)
      .type('html')
      .send(
        renderError({
          database,
          title,
          message: sanitizeForResponse(message, config),
          activeNav,
          ...context
        })
      );
  }

  function sendJsonError(res, statusCode, message) {
    res.status(statusCode).json({
      error: sanitizeForResponse(message, config)
    });
  }

  function asyncRoute(handler) {
    return (req, res, next) => {
      Promise.resolve(handler(req, res, next)).catch(next);
    };
  }

  function safeReturnTo(value) {
    const text = String(value || '/');

    if (!text.startsWith('/') || text.startsWith('//') || /[\r\n]/.test(text)) {
      return '/';
    }

    return text;
  }

  function passwordChangeRequired(user) {
    return user && user.source !== 'env' && user.mustChangePassword === true;
  }

  function passwordChangeAllowedPath(pathName) {
    return pathName === '/account/password' ||
      pathName === '/logout' ||
      pathName === '/login' ||
      pathName === '/healthz';
  }

  function enforcePasswordChange(req, res, auth) {
    if (!passwordChangeRequired(auth && auth.user) || passwordChangeAllowedPath(req.path)) {
      return true;
    }

    if (req.method === 'GET') {
      res.redirect(
        302,
        `/account/password?required=1&returnTo=${encodeURIComponent(req.originalUrl || '/')}`
      );
      return false;
    }

    sendError(
      res,
      403,
      'Forbidden',
      'Сначала смените временный пароль.',
      activeNavForPath(req.path),
      viewContext(req)
    );
    return false;
  }

  async function loadRequestAuth(req) {
    if (!authEnabled) {
      req.auth = null;
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(req, 'auth')) {
      return req.auth;
    }

    const session = sessions.getSession(req);

    if (!session) {
      req.auth = null;
      return null;
    }

    const user = await accounts.findByEmail(session.email);

    if (!user) {
      sessions.destroySession(req);
      req.auth = null;
      return null;
    }

    req.auth = { user, session };

    return req.auth;
  }

  function requireAuth(permission = null) {
    return asyncRoute(async (req, res, next) => {
      if (!authEnabled) {
        next();
        return;
      }

      const auth = await loadRequestAuth(req);

      if (!auth) {
        if (req.method === 'GET') {
          res.redirect(302, `/login?returnTo=${encodeURIComponent(req.originalUrl || '/')}`);
          return;
        }

        sendError(res, 401, 'Unauthorized', 'Требуется вход в систему');
        return;
      }

      if (!enforcePasswordChange(req, res, auth)) {
        return;
      }

      if (permission && !hasPermission(auth.user, permission)) {
        sendError(
          res,
          403,
          'Недостаточно прав',
          'Недостаточно прав для выбранного раздела.',
          activeNavForPath(req.path),
          viewContext(req)
        );
        return;
      }

      next();
    });
  }

  function requireAnyReportPermission() {
    return asyncRoute(async (req, res, next) => {
      if (!authEnabled) {
        next();
        return;
      }

      const auth = await loadRequestAuth(req);

      if (!auth) {
        if (req.method === 'GET') {
          res.redirect(302, `/login?returnTo=${encodeURIComponent(req.originalUrl || '/')}`);
          return;
        }

        sendError(res, 401, 'Unauthorized', 'Требуется вход в систему');
        return;
      }

      if (!enforcePasswordChange(req, res, auth)) {
        return;
      }

      if (
        !hasPermission(auth.user, 'scheduled-report-author')
        && !hasPermission(auth.user, 'scheduled-report-delivery')
      ) {
        sendError(
          res,
          403,
          'Недостаточно прав',
          'Недостаточно прав для выбранного раздела.',
          activeNavForPath(req.path),
          viewContext(req)
        );
        return;
      }

      next();
    });
  }

  function requireJsonAuth(permission = null) {
    return asyncRoute(async (req, res, next) => {
      if (!authEnabled) {
        next();
        return;
      }

      const auth = await loadRequestAuth(req);

      if (!auth) {
        sendJsonError(res, 401, 'Требуется вход в систему');
        return;
      }

      if (passwordChangeRequired(auth.user)) {
        sendJsonError(res, 403, 'Сначала смените временный пароль.');
        return;
      }

      if (permission && !hasPermission(auth.user, permission)) {
        sendJsonError(res, 403, 'Недостаточно прав для выбранного раздела.');
        return;
      }

      next();
    });
  }

  function requireAdmin() {
    return asyncRoute(async (req, res, next) => {
      if (!authEnabled) {
        next();
        return;
      }

      const auth = await loadRequestAuth(req);

      if (!auth) {
        if (req.method === 'GET') {
          res.redirect(302, `/login?returnTo=${encodeURIComponent(req.originalUrl || '/')}`);
          return;
        }

        sendError(res, 401, 'Unauthorized', 'Требуется вход в систему');
        return;
      }

      if (!enforcePasswordChange(req, res, auth)) {
        return;
      }

      if (auth.user.role !== 'admin') {
        sendError(
          res,
          403,
          'Недостаточно прав',
          'Недостаточно прав для выбранного раздела.',
          activeNavForPath(req.path),
          viewContext(req)
        );
        return;
      }

      next();
    });
  }

  function verifyCsrf(req, res, activeNav = 'users') {
    if (!authEnabled) {
      return true;
    }

    if (sessions.verifyCsrf(req, String((req.body && req.body.csrfToken) || ''))) {
      return true;
    }

    sendError(res, 403, 'Forbidden', 'Неверный CSRF-токен', activeNav, viewContext(req));

    return false;
  }

  function verifyJsonCsrf(req, res) {
    if (!authEnabled) {
      return true;
    }

    try {
      if (sessions.verifyCsrf(req, String((req.body && req.body.csrfToken) || ''))) {
        return true;
      }
    } catch {
      // Fall through to a JSON 403 below.
    }

    sendJsonError(res, 403, 'Неверный CSRF-токен');

    return false;
  }

  function permissionsFromBody(body) {
    if (!body) {
      return [];
    }

    if (Array.isArray(body.permissions)) {
      return body.permissions;
    }

    if (typeof body.permissions === 'string') {
      return [body.permissions];
    }

    return [];
  }

  function preloadScheduleFromBody(body) {
    const safeBody = body || {};
    const enabledValue = body && body.enabled;
    const hasWindowFields = Object.prototype.hasOwnProperty.call(safeBody, 'refreshPastDays')
      || Object.prototype.hasOwnProperty.call(safeBody, 'refreshFutureDays');
    const jobId = String(safeBody.jobId || SALES_PRELOAD_JOB_ID);
    const refreshMinimumDays = preloadScheduleWindowMinimum(jobId);
    const input = {
      jobId,
      enabled: enabledValue === '1' || enabledValue === 'on' || enabledValue === 'true',
      scheduleTime: parseScheduleTimeFromBody(safeBody.scheduleTime)
    };

    if (hasWindowFields) {
      input.refreshPastDays = parseRefreshDaysFromBody(
        Object.prototype.hasOwnProperty.call(safeBody, 'refreshPastDays')
          ? safeBody.refreshPastDays
          : safeBody.refreshDays,
        refreshMinimumDays
      );
      input.refreshFutureDays = parseRefreshDaysFromBody(
        Object.prototype.hasOwnProperty.call(safeBody, 'refreshFutureDays')
          ? safeBody.refreshFutureDays
          : (safeBody.refreshDays || String(refreshMinimumDays)),
        preloadScheduleFutureWindowMinimum(jobId)
      );

      return input;
    }

    return {
      ...input,
      refreshDays: parseRefreshDaysFromBody(safeBody.refreshDays, refreshMinimumDays)
    };
  }

  function currentUserId(req) {
    return (req && req.auth && req.auth.user && req.auth.user.id) || 'anonymous';
  }

  function parsePositiveIntegerFromBody(value, fallback) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    const integer = Math.floor(parsed);

    return integer > 0 ? integer : fallback;
  }

  function booleanFromBody(value) {
    return value === true || value === '1' || value === 'on' || value === 'true';
  }

  function scheduledReportsConfig() {
    return config.scheduledReports || {};
  }

  function scheduledReportMessage(code) {
    const messages = {
      'report-created': 'Отчет создан',
      'report-updated': 'Отчет сохранен',
      'schedule-created': 'Расписание создано',
      'schedule-updated': 'Расписание сохранено',
      'run-started': 'Запуск отчета начат',
      'already-running': 'Отчет уже выполняется',
      saved: 'SMTP настройки сохранены',
      'test-sent': 'Тестовое письмо отправлено'
    };

    return messages[String(code || '')] || '';
  }

  function scheduledReportsUrl(reportId, message) {
    const params = new URLSearchParams();

    if (reportId !== undefined && reportId !== null && String(reportId) !== '') {
      params.set('reportId', String(reportId));
    }
    if (message) {
      params.set('message', message);
    }

    const query = params.toString();

    return query ? `/reports/scheduled?${query}` : '/reports/scheduled';
  }

  function normalizeScheduledReportBody(body) {
    const safeBody = body || {};
    const reportConfig = scheduledReportsConfig();
    const rowLimit = parsePositiveIntegerFromBody(safeBody.rowLimit, reportConfig.defaultRowLimit || 10000);
    const timeoutMs = parsePositiveIntegerFromBody(safeBody.timeoutMs, reportConfig.queryTimeoutMs || 120000);
    const sql = String(safeBody.sql || '').trim();

    assertSafeReportSql(sql);

    return {
      title: String(safeBody.title || '').trim(),
      description: String(safeBody.description || '').trim(),
      sql,
      rowLimit,
      timeoutMs,
      enabled: booleanFromBody(safeBody.enabled)
    };
  }

  function normalizeRecipientsFromBody(value) {
    const values = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,;]/);

    return values
      .map((recipient) => String(recipient || '').trim())
      .filter(Boolean);
  }

  function parseScheduledReportTime(value) {
    return parseScheduleTimeFromBody(value || '09:00');
  }

  function normalizeScheduledScheduleBody(reportId, body) {
    const safeBody = body || {};

    return {
      reportId: String(reportId),
      enabled: booleanFromBody(safeBody.enabled),
      scheduleTime: parseScheduledReportTime(safeBody.scheduleTime),
      timezone: 'Europe/Moscow',
      recipients: normalizeRecipientsFromBody(safeBody.recipients),
      emailSubject: String(safeBody.emailSubject || '').trim(),
      emailBody: String(safeBody.emailBody || '').trim()
    };
  }

  function normalizeMailSettingsBody(body) {
    const safeBody = body || {};
    const secureMode = String(safeBody.secureMode || 'starttls').trim();

    return {
      host: String(safeBody.host || '').trim(),
      port: parsePositiveIntegerFromBody(safeBody.port, 587),
      secureMode: secureMode === 'ssl' ? 'ssl' : 'starttls',
      username: String(safeBody.username || '').trim(),
      password: String(safeBody.password || ''),
      fromEmail: String(safeBody.fromEmail || '').trim(),
      fromName: String(safeBody.fromName || '').trim(),
      clearPassword: booleanFromBody(safeBody.clearPassword)
    };
  }

  function selectedScheduledReportId(req, reports) {
    const explicit = (req.params && req.params.reportId)
      || (req.body && (req.body.reportId || req.body.selectedReportId))
      || (req.query && (req.query.reportId || req.query.selectedReportId));

    if (explicit !== undefined && explicit !== null && String(explicit) !== '') {
      return String(explicit);
    }

    const firstReport = Array.isArray(reports) && reports.length > 0 ? reports[0] : null;

    return firstReport && firstReport.id !== undefined && firstReport.id !== null ? String(firstReport.id) : '';
  }

  function canDownloadScheduledRun(run) {
    return Boolean(
      run
      && run.filePath
      && (run.status === 'success' || run.status === 'failed')
      && isScheduledRunWithinRetention(run)
    );
  }

  function scheduledScheduleForReport(reportId, scheduleId) {
    if (!scheduledReports || typeof scheduledReports.getSchedule !== 'function') {
      return null;
    }

    const schedule = scheduledReports.getSchedule(scheduleId);

    if (!schedule || String(schedule.reportId) !== String(reportId)) {
      return null;
    }

    return schedule;
  }

  function sendScheduledScheduleNotFound(req, res) {
    sendError(
      res,
      404,
      'Not Found',
      'Schedule not found for selected report.',
      'scheduled-reports',
      viewContext(req)
    );
  }

  function scheduledReportCapabilities(req) {
    if (!authEnabled) {
      return {
        canAuthor: true,
        canDeliver: true
      };
    }

    const user = req.auth && req.auth.user;

    return {
      canAuthor: hasPermission(user, 'scheduled-report-author'),
      canDeliver: hasPermission(user, 'scheduled-report-delivery')
    };
  }

  async function scheduledReportPageModel(req, options = {}) {
    if (!scheduledReports) {
      const error = new Error('Scheduled reports are not configured');

      error.status = 503;
      throw error;
    }

    const reports = scheduledReports.listReports();
    const selectedId = options.selectedReportId || selectedScheduledReportId(req, reports);
    const selectedReport = selectedId
      ? reports.find((report) => String(report.id) === String(selectedId))
        || (typeof scheduledReports.getReport === 'function' ? scheduledReports.getReport(selectedId) : null)
      : null;
    const reportId = selectedReport && selectedReport.id;
    const schedules = selectedReport && typeof scheduledReports.listSchedules === 'function'
      ? scheduledReports.listSchedules(reportId)
      : [];
    const runs = selectedReport && typeof scheduledReports.listRuns === 'function'
      ? scheduledReports.listRuns({ reportId, limit: 50 }).map((run) => ({
          ...run,
          canDownload: canDownloadScheduledRun(run)
        }))
      : [];

    return {
      reports,
      selectedReport,
      schedules,
      runs
    };
  }

  async function sendScheduledReportsPage(req, res, statusCode = 200, options = {}) {
    const model = await scheduledReportPageModel(req, options);
    const capabilities = scheduledReportCapabilities(req);

    if (options.recordActivity) {
      recordCurrentUserActivity(req, activityEventType(req));
    }

    res
      .status(statusCode)
      .type('html')
      .send(
        renderScheduledReportsPage({
          database,
          ...model,
          ...capabilities,
          message: options.message || '',
          error: options.error || '',
          preview: options.preview,
          ...viewContext(req)
        })
      );
  }

  async function previewScheduledReport(body) {
    const reportConfig = scheduledReportsConfig();
    const input = normalizeScheduledReportBody(body);
    const limits = normalizeReportLimits(input, {
      ...reportConfig,
      defaultRowLimit: Math.min(Number(reportConfig.defaultRowLimit) || 50, 50),
      maxRowLimit: 50
    });
    const wrapped = wrapReportSql(input.sql, { rowLimit: Math.min(limits.rowLimit, 50) });
    const rows = await client.queryJSONEachRow(
      `${wrapped.query}\nFORMAT JSONEachRow`,
      {
        ...wrapped.params,
        ...wrapped.settings
      },
      'scheduled report preview'
    );
    const safeRows = Array.isArray(rows) ? rows : [];
    const columns = safeRows.length > 0 ? Object.keys(safeRows[0]) : [];

    return { rows: safeRows, columns };
  }

  function scheduledReportFileDir() {
    return path.resolve(scheduledReportsConfig().fileDir || path.join(process.cwd(), 'data', 'scheduled-report-files'));
  }

  function isPathInsideDir(filePath, directory) {
    const relative = path.relative(directory, filePath);

    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  function safeScheduledReportFilename(runId) {
    const safeRunId = String(runId || 'report').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'report';

    return `scheduled-report-${safeRunId}.xlsx`;
  }

  function scheduledReportRetentionDays() {
    const days = Number(scheduledReportsConfig().retentionDays);

    return Number.isFinite(days) && days > 0 ? Math.floor(days) : 60;
  }

  function isScheduledRunWithinRetention(run) {
    const finishedTime = Date.parse(String(run && run.finishedAt || ''));

    if (!Number.isFinite(finishedTime)) {
      return false;
    }

    const cutoff = now().getTime() - scheduledReportRetentionDays() * 24 * 60 * 60 * 1000;

    return finishedTime >= cutoff;
  }

  async function readScheduledRunFile(run) {
    if (!canDownloadScheduledRun(run) || !isScheduledRunWithinRetention(run)) {
      return null;
    }

    const fileDir = scheduledReportFileDir();
    const filePath = path.resolve(String(run.filePath || ''));

    if (!isPathInsideDir(filePath, fileDir)) {
      return null;
    }

    try {
      const stat = await fs.stat(filePath);

      if (!stat.isFile()) {
        return null;
      }

      return {
        buffer: await fs.readFile(filePath),
        filename: safeScheduledReportFilename(run.id)
      };
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  function accountMessage(code) {
    const messages = {
      created: 'Учетная запись создана',
      updated: 'Учетная запись обновлена',
      deleted: 'Учетная запись удалена'
    };

    return messages[String(code || '')] || '';
  }

  async function sendAccountManagement(req, res, statusCode = 200, options = {}) {
    const users = await accounts.listUsers();

    if (options.recordActivity) {
      recordCurrentUserActivity(req, activityEventType(req));
    }

    res
      .status(statusCode)
      .type('html')
      .send(
        renderAccountManagement({
          database,
          users,
          message: options.message || '',
          error: options.error || '',
          ...viewContext(req)
        })
      );
  }

  function sendPreloadUnavailable(req, res) {
    sendError(
      res,
      503,
      'Service Unavailable',
      'Сервис предзагрузки недоступен',
      'preload-admin',
      viewContext(req)
    );
  }

  async function sendPreloadManagement(req, res, statusCode = 200, options = {}) {
    if (!preloads) {
      sendPreloadUnavailable(req, res);
      return;
    }

    if (options.recordActivity) {
      recordCurrentUserActivity(req, activityEventType(req));
    }

    const diagnostics = typeof preloads.getDiagnostics === 'function' ? preloads.getDiagnostics() : null;
    const jobs = typeof preloads.listJobs === 'function'
      ? preloads.listJobs()
      : [preloads.getJob(SALES_PRELOAD_JOB_ID)].filter(Boolean);
    const jobPanels = jobs
      .filter(Boolean)
      .map((job) => {
        const jobId = job.id || SALES_PRELOAD_JOB_ID;

        return {
          job,
          overview: typeof preloads.getOverview === 'function' ? preloads.getOverview(jobId) : {},
          diagnostics,
          runs: typeof preloads.listRuns === 'function' ? preloads.listRuns(jobId, 20) : []
        };
      });

    res
      .status(statusCode)
      .type('html')
      .send(
        renderPreloadManagement({
          database,
          message: options.message || '',
          error: options.error || '',
          jobs: jobPanels,
          ...viewContext(req)
        })
      );
  }

  async function loadDiagnostics() {
    const range = currentMonthRange(now());
    const preloadQueries = buildSalesByProjectPreloadQueries();
    const params = {
      param_from: range.fromDateTime,
      param_to: range.toDateTime
    };
    const [cityRows, orderRows, shiftRows] = await Promise.all([
      client.queryJSONEachRow(
        [
          'SELECT uniqExact(ifNull(w.address__city, \'\')) AS city_count',
          'FROM mg_orders AS o',
          'LEFT JOIN mg_workplaces AS w ON o.workplace = w._id',
          actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' }),
          `WHERE ${actualOrderDomainCondition('o', 'c', 'ct')}`,
          'AND o.start >= {from:DateTime}',
          'AND o.start < {to:DateTime}',
          "AND ifNull(w.address__city, '') != ''",
          'FORMAT JSONEachRow'
        ].join('\n'),
        params,
        'diagnostics city options'
      ),
      client.queryJSONEachRow(
        `SELECT count() AS rows FROM (${stripJSONEachRow(preloadQueries.orderFacts)}) FORMAT JSONEachRow`,
        params,
        'diagnostics sales preload order facts'
      ),
      client.queryJSONEachRow(
        `SELECT count() AS rows FROM (${stripJSONEachRow(preloadQueries.shiftFacts)}) FORMAT JSONEachRow`,
        params,
        'diagnostics sales preload shift facts'
      )
    ]);

    return {
      app: buildInfo,
      clickhouse: {
        database,
        checkedRange: {
          from: range.from,
          to: range.to
        },
        cityOptionsCurrentMonth: Number((cityRows[0] && cityRows[0].city_count) || 0),
        salesPreloadCurrentMonth: {
          orderFacts: Number((orderRows[0] && orderRows[0].rows) || 0),
          shiftFacts: Number((shiftRows[0] && shiftRows[0].rows) || 0)
        }
      },
      preload: preloads && typeof preloads.getDiagnostics === 'function'
        ? preloads.getDiagnostics()
        : null
    };
  }

  async function renderNamedTable(req, res) {
    const tableName = req.query.name;

    if (typeof tableName !== 'string' || tableName.trim() === '') {
      sendError(res, 400, 'Bad Request', 'Missing table name', 'tables', viewContext(req));
      return;
    }

    const tables = await client.listTables();

    if (!tables.includes(tableName)) {
      sendError(res, 404, 'Table not found', `Table not found: ${tableName}`, 'tables', viewContext(req));
      return;
    }

    const [columns, rows] = await Promise.all([
      client.getColumns(tableName),
      client.getPreview(tableName)
    ]);

    recordCurrentUserActivity(req, activityEventType(req));

    res
      .status(200)
      .type('html')
      .send(renderTable({ database, tableName, columns, rows, ...viewContext(req) }));
  }

  app.get('/healthz', (req, res) => {
    res.type('text').send('ok');
  });

  app.get(
    '/login',
    asyncRoute(async (req, res) => {
      if (authEnabled) {
        const auth = await loadRequestAuth(req);

        if (auth) {
          res.redirect(302, safeReturnTo(req.query.returnTo));
          return;
        }
      }

      res
        .status(200)
        .type('html')
        .send(
          renderLogin({
            database,
            email: req.query.email || '',
            returnTo: req.query.returnTo || '/'
          })
        );
    })
  );

  app.post(
    '/login',
    asyncRoute(async (req, res) => {
      if (!authEnabled) {
        res.redirect(303, '/');
        return;
      }

      const email = String((req.body && req.body.email) || '');
      const password = String((req.body && req.body.password) || '');
      const returnTo = safeReturnTo(req.body && req.body.returnTo);
      const user = await accounts.verifyCredentials(email, password);

      if (!user) {
        res
          .status(401)
          .type('html')
          .send(
            renderLogin({
              database,
              email,
              error: 'Неверная почта или пароль',
              returnTo
            })
          );
        return;
      }

      const session = sessions.createSession(user);

      recordActivity(req, user, 'login');
      res.setHeader('Set-Cookie', session.cookieHeader);
      res.redirect(303, returnTo);
    })
  );

  app.post(
    '/logout',
    requireAuth(),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, activeNavForPath(req.path))) {
        return;
      }

      recordCurrentUserActivity(req, 'logout');
      res.setHeader('Set-Cookie', sessions.destroySession(req));
      res.redirect(303, '/login');
    })
  );

  app.get(
    '/account/password',
    requireAuth(),
    asyncRoute(async (req, res) => {
      res
        .status(200)
        .type('html')
        .send(
          renderPasswordChange({
            database,
            required: req.query.required === '1',
            returnTo: req.query.returnTo || '/',
            ...viewContext(req)
          })
        );
    })
  );

  app.post(
    '/account/password',
    requireAuth(),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'account-password')) {
        return;
      }

      const returnTo = safeReturnTo(req.body && req.body.returnTo);

      try {
        await accounts.changeOwnPassword(req.auth.user.id, {
          currentPassword: req.body.currentPassword,
          newPassword: req.body.newPassword,
          confirmPassword: req.body.confirmPassword
        });

        recordCurrentUserActivity(req, 'password_change');
        res.redirect(303, returnTo);
      } catch (error) {
        res
          .status(400)
          .type('html')
          .send(
            renderPasswordChange({
              database,
              error: error && error.message,
              required: passwordChangeRequired(req.auth.user),
              returnTo,
              ...viewContext(req)
            })
          );
      }
    })
  );

  app.get(
    '/admin/users',
    requireAuth('users'),
    asyncRoute(async (req, res) => {
      await sendAccountManagement(req, res, 200, {
        message: accountMessage(req.query.message),
        recordActivity: true
      });
    })
  );

  app.post(
    '/admin/users/create',
    requireAuth('users'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'users')) {
        return;
      }

      try {
        await accounts.createUser({
          email: req.body.email,
          name: req.body.name,
          role: req.body.role,
          permissions: permissionsFromBody(req.body),
          password: req.body.password
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, '/admin/users?message=created');
      } catch (error) {
        await sendAccountManagement(req, res, 400, {
          error: error && error.message
        });
      }
    })
  );

  app.post(
    '/admin/users/:id/update',
    requireAuth('users'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'users')) {
        return;
      }

      try {
        await accounts.updateUser(req.params.id, {
          email: req.body.email,
          name: req.body.name,
          role: req.body.role,
          permissions: permissionsFromBody(req.body),
          password: req.body.password
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, '/admin/users?message=updated');
      } catch (error) {
        await sendAccountManagement(req, res, 400, {
          error: error && error.message
        });
      }
    })
  );

  app.post(
    '/admin/users/:id/delete',
    requireAuth('users'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'users')) {
        return;
      }

      try {
        await accounts.deleteUser(req.params.id);

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, '/admin/users?message=deleted');
      } catch (error) {
        await sendAccountManagement(req, res, 400, {
          error: error && error.message
        });
      }
    })
  );

  app.get(
    '/admin/diagnostics',
    requireAuth('preload-admin'),
    asyncRoute(async (req, res) => {
      const diagnostics = await loadDiagnostics();

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('json')
        .send(JSON.stringify(diagnostics, null, 2));
    })
  );

  app.get(
    '/admin/preload',
    requireAuth('preload-admin'),
    asyncRoute(async (req, res) => {
      await sendPreloadManagement(req, res, 200, {
        message: preloadMessage(req.query.message),
        recordActivity: true
      });
    })
  );

  app.post(
    '/admin/preload/schedule',
    requireAuth('preload-admin'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'preload-admin')) {
        return;
      }

      if (!preloads) {
        sendPreloadUnavailable(req, res);
        return;
      }

      preloads.saveSchedule(preloadScheduleFromBody(req.body));

      recordCurrentUserActivity(req, 'admin_action');
      res.redirect(303, '/admin/preload?message=schedule-saved');
    })
  );

  app.post(
    '/admin/preload/run',
    requireAuth('preload-admin'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'preload-admin')) {
        return;
      }

      if (!preloads) {
        sendPreloadUnavailable(req, res);
        return;
      }

      const jobId = String((req.body && req.body.jobId) || SALES_PRELOAD_JOB_ID);
      const range = normalizeManualPreloadRange(req.body);
      const result = typeof preloads.runJob === 'function'
        ? await preloads.runJob({ jobId, ...range })
        : await preloads.runSalesByProject(range);
      const message = result && (result.status === 'already-running' || result.alreadyRunning)
        ? 'already-running'
        : 'run-started';

      recordCurrentUserActivity(req, 'admin_action');
      res.redirect(303, `/admin/preload?message=${message}`);
    })
  );

  app.post(
    '/admin/preload/cache/city-analysis/clear',
    requireAuth('preload-admin'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'preload-admin')) {
        return;
      }

      if (cityAnalysisCache && typeof cityAnalysisCache.clear === 'function') {
        await cityAnalysisCache.clear();
      }

      recordCurrentUserActivity(req, 'admin_action');
      res.redirect(303, '/admin/preload?message=city-cache-cleared');
    })
  );

  app.get(
    '/admin/activity',
    requireAdmin(),
    asyncRoute(async (req, res) => {
      if (!authEnabled || !activity) {
        res
          .status(200)
          .type('html')
          .send(renderUserActivityDashboard({ database, disabled: true, ...viewContext(req) }));
        return;
      }

      try {
        const currentDate = now();
        const to = formatDateUTC(currentDate);
        const fromDate = new Date(currentDate.getTime());

        fromDate.setUTCDate(fromDate.getUTCDate() - (DEFAULT_USER_ACTIVITY_RETENTION_DAYS - 1));

        activity.pruneOldEvents(DEFAULT_USER_ACTIVITY_RETENTION_DAYS);

        const users = await accounts.listUsers();
        const overview = activity.getActivityOverview({
          from: formatDateUTC(fromDate),
          to,
          users
        });

        recordCurrentUserActivity(req, 'page_view');
        res
          .status(200)
          .type('html')
          .send(renderUserActivityDashboard({ database, overview, ...viewContext(req) }));
      } catch (error) {
        sendError(
          res,
          502,
          'Activity Store Error',
          error && error.message,
          'activity',
          viewContext(req)
        );
      }
    })
  );

  app.get(
    '/reports/scheduled',
    requireAnyReportPermission(),
    asyncRoute(async (req, res) => {
      await sendScheduledReportsPage(req, res, 200, {
        message: scheduledReportMessage(req.query.message),
        recordActivity: true
      });
    })
  );

  app.post(
    '/reports/scheduled/create',
    requireAuth('scheduled-report-author'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'scheduled-reports')) {
        return;
      }

      try {
        const saved = scheduledReports.createReport({
          ...normalizeScheduledReportBody(req.body),
          userId: currentUserId(req)
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, scheduledReportsUrl(saved && saved.id, 'report-created'));
      } catch (error) {
        await sendScheduledReportsPage(req, res, 400, {
          error: sanitizeForResponse(error && error.message, config)
        });
      }
    })
  );

  app.post(
    '/reports/scheduled/:reportId/update',
    requireAuth('scheduled-report-author'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'scheduled-reports')) {
        return;
      }

      try {
        scheduledReports.updateReport(req.params.reportId, {
          ...normalizeScheduledReportBody(req.body),
          userId: currentUserId(req)
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, scheduledReportsUrl(req.params.reportId, 'report-updated'));
      } catch (error) {
        await sendScheduledReportsPage(req, res, 400, {
          selectedReportId: req.params.reportId,
          error: sanitizeForResponse(error && error.message, config)
        });
      }
    })
  );

  app.post(
    '/reports/scheduled/:reportId/preview',
    requireAuth('scheduled-report-author'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'scheduled-reports')) {
        return;
      }

      try {
        const preview = await previewScheduledReport(req.body);

        await sendScheduledReportsPage(req, res, 200, {
          selectedReportId: req.params.reportId,
          preview
        });
      } catch (error) {
        await sendScheduledReportsPage(req, res, 400, {
          selectedReportId: req.params.reportId,
          preview: { error: sanitizeForResponse(error && error.message, config) },
          error: sanitizeForResponse(error && error.message, config)
        });
      }
    })
  );

  app.post(
    '/reports/scheduled/:reportId/schedules/create',
    requireAuth('scheduled-report-delivery'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'scheduled-reports')) {
        return;
      }

      try {
        scheduledReports.createSchedule({
          ...normalizeScheduledScheduleBody(req.params.reportId, req.body),
          userId: currentUserId(req)
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, scheduledReportsUrl(req.params.reportId, 'schedule-created'));
      } catch (error) {
        await sendScheduledReportsPage(req, res, 400, {
          selectedReportId: req.params.reportId,
          error: sanitizeForResponse(error && error.message, config)
        });
      }
    })
  );

  app.post(
    '/reports/scheduled/:reportId/schedules/:scheduleId/update',
    requireAuth('scheduled-report-delivery'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'scheduled-reports')) {
        return;
      }

      if (!scheduledScheduleForReport(req.params.reportId, req.params.scheduleId)) {
        sendScheduledScheduleNotFound(req, res);
        return;
      }

      try {
        scheduledReports.updateSchedule(req.params.scheduleId, {
          ...normalizeScheduledScheduleBody(req.params.reportId, req.body),
          userId: currentUserId(req)
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, scheduledReportsUrl(req.params.reportId, 'schedule-updated'));
      } catch (error) {
        await sendScheduledReportsPage(req, res, 400, {
          selectedReportId: req.params.reportId,
          error: sanitizeForResponse(error && error.message, config)
        });
      }
    })
  );

  app.post(
    '/reports/scheduled/:reportId/schedules/:scheduleId/run',
    requireAuth('scheduled-report-delivery'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'scheduled-reports')) {
        return;
      }

      if (!scheduledScheduleForReport(req.params.reportId, req.params.scheduleId)) {
        sendScheduledScheduleNotFound(req, res);
        return;
      }

      const result = await scheduledReports.runSchedule({
        reportId: req.params.reportId,
        scheduleId: req.params.scheduleId,
        trigger: 'manual',
        userId: currentUserId(req)
      });
      const message = result && (result.status === 'running' || result.alreadyRunning)
        ? 'already-running'
        : 'run-started';

      recordCurrentUserActivity(req, 'admin_action');
      res.redirect(303, scheduledReportsUrl(req.params.reportId, message));
    })
  );

  app.get(
    '/reports/scheduled/runs/:runId/download',
    requireAuth('scheduled-report-delivery'),
    asyncRoute(async (req, res) => {
      const run = scheduledReports && typeof scheduledReports.getRun === 'function'
        ? scheduledReports.getRun(req.params.runId)
        : null;
      const file = await readScheduledRunFile(run);

      if (!file) {
        sendError(
          res,
          404,
          'Not Found',
          'Файл отчета не найден.',
          'scheduled-reports',
          viewContext(req)
        );
        return;
      }

      recordCurrentUserActivity(req, 'export');
      res
        .status(200)
        .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .set('Content-Disposition', `attachment; filename="${file.filename}"`)
        .send(file.buffer);
    })
  );

  app.get(
    '/admin/mail-settings',
    requireAdmin(),
    asyncRoute(async (req, res) => {
      const settings = scheduledReports && typeof scheduledReports.getMailSettings === 'function'
        ? scheduledReports.getMailSettings()
        : { hasPassword: false };

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderMailSettingsPage({
          database,
          settings,
          message: scheduledReportMessage(req.query.message),
          ...viewContext(req)
        }));
    })
  );

  app.post(
    '/admin/mail-settings',
    requireAdmin(),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'mail-settings')) {
        return;
      }

      try {
        scheduledReports.saveMailSettings({
          ...normalizeMailSettingsBody(req.body),
          userId: currentUserId(req)
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, '/admin/mail-settings?message=saved');
      } catch (error) {
        const settings = scheduledReports && typeof scheduledReports.getMailSettings === 'function'
          ? scheduledReports.getMailSettings()
          : { hasPassword: false };

        res
          .status(400)
          .type('html')
          .send(renderMailSettingsPage({
            database,
            settings,
            error: sanitizeForResponse(error && error.message, config),
            ...viewContext(req)
          }));
      }
    })
  );

  app.post(
    '/admin/mail-settings/test',
    requireAdmin(),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'mail-settings')) {
        return;
      }

      const recipient = String((req.body && req.body.testRecipient) || '').trim();

      try {
        if (scheduledReports && typeof scheduledReports.sendTestMail === 'function') {
          await scheduledReports.sendTestMail({
            recipient,
            userId: currentUserId(req)
          });
        } else if (!scheduledReports || !scheduledReports.getMailSettings || !scheduledReports.getMailSettings().host) {
          throw new Error('SMTP is not configured');
        }

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, '/admin/mail-settings?message=test-sent');
      } catch (error) {
        const settings = scheduledReports && typeof scheduledReports.getMailSettings === 'function'
          ? scheduledReports.getMailSettings()
          : { hasPassword: false };

        res
          .status(400)
          .type('html')
          .send(renderMailSettingsPage({
            database,
            settings,
            testRecipient: recipient,
            error: sanitizeForResponse(error && error.message, config),
            ...viewContext(req)
          }));
      }
    })
  );

  app.get(
    '/',
    requireAuth('tables'),
    asyncRoute(async (req, res) => {
      const tables = await client.listTables();

      recordCurrentUserActivity(req, activityEventType(req));
      res.status(200).type('html').send(renderHome({ database, tables, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/sales-by-project',
    requireAuth('sales-by-project'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadSalesByProjectDashboardShell(client, req.query);

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderSalesByProjectDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/sales-by-project/section',
    requireAuth('sales-by-project'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!SALES_BY_PROJECT_SECTIONS.has(section)) {
        sendError(
          res,
          400,
          'Bad Request',
          `Unknown sales by project section: ${section}`,
          'sales-by-project',
          viewContext(req)
        );
        return;
      }

      try {
        const dashboard = await loadSalesByProjectDashboardSection(client, req.query, section, new Date(), {
          cache: dashboardSectionCache,
          preloadService: preloads
        });

        res
          .status(200)
          .type('html')
          .send(renderSalesByProjectDashboardSection({ dashboard, section, ...viewContext(req) }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/brand-analysis',
    requireAuth('brand-analysis'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadBrandAnalysisDashboardShell(client, req.query);

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderBrandAnalysisDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/brand-analysis/section',
    requireAuth('brand-analysis'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!BRAND_ANALYSIS_SECTIONS.has(section)) {
        sendError(
          res,
          400,
          'Bad Request',
          `Unknown brand analysis section: ${section}`,
          'brand-analysis',
          viewContext(req)
        );
        return;
      }

      try {
        const dashboard = await loadBrandAnalysisDashboardSection(client, req.query, section, new Date(), {
          cache: dashboardSectionCache
        });

        res
          .status(200)
          .type('html')
          .send(renderBrandAnalysisDashboardSection({ dashboard, section, ...viewContext(req) }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/brand-analysis/reviews',
    requireAuth('brand-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadBrandAnalysisReviews(client, req.query, new Date());

        recordCurrentUserActivity(req, activityEventType(req));
        res
          .status(200)
          .type('html')
          .send(renderBrandAnalysisReviews({ details }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/region-analysis/gigers',
    requireAuth('city-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadRegionAnalysisGigerDetails(client, req.query, new Date());

        recordCurrentUserActivity(req, activityEventType(req));
        res.status(200).type('html').send(
          renderGigerDetails({ details: attachGigerDetailsUrls(req, details, '/dashboards/region-analysis/gigers/export') })
        );
      } catch (error) {
        res.status(statusCodeFromError(error)).type('html').send(
          renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) })
        );
      }
    })
  );

  app.get(
    '/dashboards/region-analysis/gigers/export',
    requireAuth('city-analysis'),
    asyncRoute(async (req, res) => {
      const details = await loadRegionAnalysisGigerDetails(client, { ...req.query, export: '1' }, new Date());

      recordCurrentUserActivity(req, activityEventType(req));
      sendGigerDetailsWorkbook(res, details, 'region-analysis-gigers.xls');
    })
  );

  app.get(
    '/dashboards/region-analysis',
    requireAuth('city-analysis'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadRegionAnalysisDashboardShell(client, req.query, new Date());

      recordCurrentUserActivity(req, activityEventType(req));
      res.status(200).type('html').send(
        renderRegionAnalysisDashboard({ database, dashboard, progressive: true, ...viewContext(req) })
      );
    })
  );

  app.get(
    '/dashboards/region-analysis/section',
    requireAuth('city-analysis'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!REGION_ANALYSIS_SECTIONS.has(section)) {
        sendError(res, 400, 'Bad Request', `Unknown region analysis section: ${section}`, 'region-analysis', viewContext(req));
        return;
      }

      try {
        const dashboard = await loadRegionAnalysisDashboardSection(client, req.query, section, new Date());
        res.status(200).type('html').send(renderRegionAnalysisDashboardSection({ dashboard, section, ...viewContext(req) }));
      } catch (error) {
        res.status(statusCodeFromError(error)).type('html').send(
          renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) })
        );
      }
    })
  );

  app.get(
    '/dashboards/city-analysis',
    requireAuth('city-analysis'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadCityAnalysisDashboardShell(client, req.query, new Date(), {
        cache: cityAnalysisCache
      });

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderCityAnalysisDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/city-analysis/gigers',
    requireAuth('city-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const detailInput = normalizeCityGigerDetailsInput(req.query, new Date());
        const scopeKey = cityGigerScopeKey(detailInput);
        const scope = cityGigerScopes && cityGigerScopes.request(scopeKey, detailInput);

        if (scope && scope.state !== 'ready') {
          res.status(202).type('html').send(
            '<div class="giger-details" data-giger-scope-pending>' +
              '<p class="loading">Готовим список гигеров для выбранного среза. Окно обновится автоматически.</p>' +
            '</div>'
          );
          return;
        }

        const details = scope
          ? cityGigerDetailsFromScope(detailInput, cityGigerScopes.readPage(scopeKey, detailInput.offset, detailInput.pageSize))
          : await loadCityAnalysisGigerDetails(client, req.query, new Date());

        recordCurrentUserActivity(req, activityEventType(req));
        res
          .status(200)
          .type('html')
          .send(
            renderGigerDetails({
              details: attachGigerDetailsUrls(req, details, '/dashboards/city-analysis/gigers/export')
            })
          );
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/city-analysis/gigers/export',
    requireAuth('city-analysis'),
    asyncRoute(async (req, res) => {
      const detailInput = normalizeCityGigerDetailsInput(req.query, new Date());
      const scopeKey = cityGigerScopeKey(detailInput);
      const scope = cityGigerScopes && cityGigerScopes.request(scopeKey, detailInput);

      if (scope && scope.state !== 'ready') {
        const error = new Error('Выгрузка станет доступна после подготовки списка гигеров.');
        error.status = 409;
        throw error;
      }

      const details = scope
        ? cityGigerDetailsFromScope(detailInput, cityGigerScopes.readPage(scopeKey, 0, Number.MAX_SAFE_INTEGER))
        : await loadCityAnalysisGigerDetails(client, { ...req.query, export: '1' }, new Date());

      recordCurrentUserActivity(req, activityEventType(req));
      sendGigerDetailsWorkbook(res, details, 'city-analysis-gigers.xls');
    })
  );

  app.get(
    '/dashboards/city-analysis/section',
    requireAuth('city-analysis'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!CITY_ANALYSIS_SECTIONS.has(section)) {
        sendError(
          res,
          400,
          'Bad Request',
          `Unknown city analysis section: ${section}`,
          'city-analysis',
          viewContext(req)
        );
        return;
      }

      try {
        const requestNow = new Date();
        const usesAsyncSection =
          (section === 'summary-ratio' || section === 'dynamics') &&
          cityAsyncSections &&
          cityAsyncSections.client &&
          normalizeCityAnalysisFilters(req.query, requestNow).city !== '';
        const asyncSection = usesAsyncSection && cityAsyncSections && cityAsyncSections.request(
          cityAsyncSectionKey(section, req.query, requestNow),
          () => loadCityAnalysisDashboardSection(cityAsyncSections.client, req.query, section, requestNow, {
            cache: cityAnalysisCache
          })
        );

        if (asyncSection && asyncSection.state !== 'ready') {
          res.status(202).type('html').send(
            '<p class="loading">Готовим данные для этого блока. Блок обновится автоматически.</p>'
          );
          return;
        }

        if (asyncSection && asyncSection.state === 'failed') {
          throw asyncSection.error;
        }

        const scopeSummary = citySummaryFromGigerScopes(cityGigerScopes, section, req.query, requestNow);

        if (scopeSummary && scopeSummary.state !== 'ready') {
          res.status(202).type('html').send(
            '<p class="loading">Готовим данные для этого показателя. Блок обновится автоматически.</p>'
          );
          return;
        }

        const dashboard = asyncSection
          ? asyncSection.value
          : scopeSummary
          ? citySummaryDashboardFromScope(req.query, requestNow, scopeSummary.summaryRows)
          : await loadCityAnalysisDashboardSection(client, req.query, section, requestNow, {
          cache: cityAnalysisCache
          });

        res
          .status(200)
          .type('html')
          .send(renderCityAnalysisDashboardSection({ dashboard, section, ...viewContext(req) }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(
            renderCityAnalysisSectionError({
              section,
              message: sanitizeForResponse(error && error.message, config)
            })
          );
      }
    })
  );

  app.get(
    '/dashboards/heatmap',
    requireAuth('heatmap'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadHeatmapDashboardShell(client, req.query, new Date());

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderHeatmapDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/heatmap/section',
    requireAuth('heatmap'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!HEATMAP_SECTIONS.has(section)) {
        sendError(
          res,
          400,
          'Bad Request',
          `Unknown heatmap section: ${section}`,
          'heatmap',
          viewContext(req)
        );
        return;
      }

      try {
        const dashboard = await loadHeatmapDashboardSection(client, req.query, section, new Date(), {
          cache: dashboardSectionCache
        });

        res
          .status(200)
          .type('html')
          .send(renderHeatmapDashboardSection({ dashboard, section, ...viewContext(req) }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/workplace-analysis',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadWorkplaceAnalysisDashboardShell(client, req.query, new Date());

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderWorkplaceAnalysisDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/workplace-analysis/gigers',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadWorkplaceAnalysisGigerDetails(client, req.query, new Date());

        recordCurrentUserActivity(req, activityEventType(req));
        res
          .status(200)
          .type('html')
          .send(
            renderGigerDetails({
              details: attachGigerDetailsUrls(req, details, '/dashboards/workplace-analysis/gigers/export')
            })
          );
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/workplace-analysis/gigers/export',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      const details = await loadWorkplaceAnalysisGigerDetails(client, { ...req.query, export: '1' }, new Date());

      recordCurrentUserActivity(req, activityEventType(req));
      sendGigerDetailsWorkbook(res, details, 'workplace-analysis-gigers.xls');
    })
  );

  app.get(
    '/dashboards/workplace-analysis/section',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!WORKPLACE_ANALYSIS_SECTIONS.has(section)) {
        sendError(
          res,
          400,
          'Bad Request',
          `Unknown workplace analysis section: ${section}`,
          'workplace-analysis',
          viewContext(req)
        );
        return;
      }

      try {
        const dashboard = await loadWorkplaceAnalysisDashboardSection(
          client,
          req.query,
          section,
          new Date(),
          {
            activeGigersCache,
            cache: dashboardSectionCache,
            preloadService: preloads
          }
        );

        res
          .status(200)
          .type('html')
          .send(renderWorkplaceAnalysisDashboardSection({ dashboard, section, ...viewContext(req) }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/workplace-analysis/workplaces/suggest',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const suggestions = await workplaceDirectoryCache.suggest(client, req.query.q, 20);

        res.status(200).json({ suggestions });
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res.status(statusCode).json({
          error: sanitizeForResponse(error && error.message, config)
        });
      }
    })
  );

  app.get(
    '/dashboards/workplace-analysis/point',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadWorkplacePointDashboardShell(
        client,
        req.query,
        new Date(),
        { loadFilterOptions: false }
      );

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderWorkplacePointDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/workplace-analysis/point/section',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!WORKPLACE_POINT_SECTIONS.has(section)) {
        sendError(
          res,
          400,
          'Bad Request',
          `Unknown workplace point section: ${section}`,
          'workplace-analysis',
          viewContext(req)
        );
        return;
      }

      try {
        const dashboard = await loadWorkplacePointDashboardSection(
          client,
          req.query,
          section,
          new Date(),
          {
            cache: dashboardSectionCache,
            preloadService: preloads
          }
        );

        res
          .status(200)
          .type('html')
          .send(renderWorkplacePointDashboardSection({ dashboard, section, ...viewContext(req) }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/workplace-analysis/point/gigers',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadWorkplacePointGigerDetails(client, req.query, new Date());

        recordCurrentUserActivity(req, activityEventType(req));
        res
          .status(200)
          .type('html')
          .send(
            renderGigerDetails({
              details: attachGigerDetailsUrls(req, details, '/dashboards/workplace-analysis/point/gigers/export')
            })
          );
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/workplace-analysis/point/gigers/export',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      const details = await loadWorkplacePointGigerDetails(client, { ...req.query, export: '1' }, new Date());

      recordCurrentUserActivity(req, activityEventType(req));
      sendGigerDetailsWorkbook(res, details, 'workplace-point-gigers.xls');
    })
  );

  app.get(
    '/dashboards/workplace-analysis/point/reviews',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadWorkplacePointReviews(client, req.query, new Date());

        recordCurrentUserActivity(req, activityEventType(req));
        res
          .status(200)
          .type('html')
          .send(renderWorkplacePointReviews({ details }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/workplace-analysis/point/details',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadWorkplacePointDayDetails(client, req.query, new Date());

        recordCurrentUserActivity(req, activityEventType(req));
        res
          .status(200)
          .type('html')
          .send(renderWorkplacePointDayDetails({ details }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/worker-cancellations',
    requireAuth('worker-cancellations'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadWorkerCancellationsDashboardShell(client, req.query, new Date(), {
        cache: dashboardSectionCache,
        preloadService
      });

      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderWorkerCancellationsDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/worker-cancellations/section',
    requireAuth('worker-cancellations'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!WORKER_CANCELLATIONS_SECTIONS.has(section)) {
        res
          .status(400)
          .type('html')
          .send(
            renderDashboardSectionError({
              message: sanitizeForResponse(`Unknown worker cancellations section: ${section}`, config)
            })
          );
        return;
      }

      try {
        const dashboard = await loadWorkerCancellationsDashboardSection(
          client,
          req.query,
          section,
          new Date(),
          {
            cache: dashboardSectionCache,
            preloadService
          }
        );

        res
          .status(200)
          .type('html')
          .send(renderWorkerCancellationsDashboardSection({ dashboard, section, ...viewContext(req) }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/worker-cancellations/details',
    requireAuth('worker-cancellations'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadWorkerCancellationsDetails(client, req.query, new Date(), { preloadService });

        recordCurrentUserActivity(req, activityEventType(req));
        res
          .status(200)
          .type('html')
          .send(renderWorkerCancellationsDetails({ details }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/dashboards/worker-cancellations/blacklists',
    requireAuth('worker-cancellations'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadWorkerBlacklistDetails(client, req.query);

        recordCurrentUserActivity(req, activityEventType(req));
        res
          .status(200)
          .type('html')
          .send(renderWorkerBlacklistDetails({ details }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );

  app.get(
    '/tools/request-report-confirmed-check',
    requireAuth('request-report-matching'),
    asyncRoute(async (req, res) => {
      recordCurrentUserActivity(req, activityEventType(req));
      res
        .status(200)
        .type('html')
        .send(renderRequestReportMissingConfirmedPage({ database, ...viewContext(req) }));
    })
  );

  app.post(
    '/tools/request-report-confirmed-check/status',
    requireAuth('request-report-matching'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'request-report-matching')) {
        return;
      }

      try {
        const saved = await requestReportShiftStatusStore.setStatus({
          userId: requestReportStatusUserId(req),
          rowKey: String((req.body && req.body.rowKey) || ''),
          status: String((req.body && req.body.status) || '')
        });

        res.status(200).json(saved);
      } catch (error) {
        res.status(400).json({
          error: sanitizeForResponse(error && error.message, config)
        });
      }
    })
  );

  app.post(
    '/tools/request-report-confirmed-check/jobs',
    requireJsonAuth('request-report-matching'),
    asyncRoute(async (req, res) => {
      let form;

      try {
        form = await parseMultipartFormData(req, { maxBytes: 10 * 1024 * 1024 });
      } catch (error) {
        sendJsonError(res, statusCodeFromError(error), error && error.message);
        return;
      }

      req.body = form.fields || {};

      if (!verifyJsonCsrf(req, res)) {
        return;
      }

      const file = form.files && form.files.reportFile;
      const filename = file && file.filename ? file.filename : '';

      if (!file || !file.buffer || file.buffer.length === 0) {
        sendJsonError(res, 400, 'Выберите XLSX-файл.');
        return;
      }

      if (!filename.toLowerCase().endsWith('.xlsx')) {
        sendJsonError(res, 400, 'Поддерживаются только XLSX-файлы.');
        return;
      }

      const job = requestReportJobStore.createJob();
      const context = viewContext(req);
      const csrfToken = context.csrfToken || String((form.fields && form.fields.csrfToken) || '');
      const statusUserId = requestReportStatusUserId(req);

      requestReportJobStore.updateJob(job.id, {
        status: 'queued',
        progress: 0,
        stage: 'Ожидает запуска',
        detail: 'Файл принят'
      });

      setImmediateFn(async () => {
        try {
          requestReportJobStore.updateJob(job.id, {
            status: 'running',
            progress: 0,
            stage: 'Подготовка',
            detail: 'Проверка запущена'
          });

          const html = await requestReportJobRunner({
            client,
            file,
            fileBuffer: file.buffer,
            filename,
            csrfToken,
            statusUserId,
            attachStatuses: (userId, rows) => requestReportShiftStatusStore.attachStatuses(userId, rows),
            onProgress: (event = {}) => {
              requestReportJobStore.updateJob(job.id, {
                status: 'running',
                progress: event.progress,
                stage: event.stage,
                detail: event.detail,
                counters: event.counts
              });
            }
          });

          requestReportJobStore.completeJob(job.id, {
            html,
            detail: 'Проверка завершена'
          });
        } catch (error) {
          requestReportJobStore.failJob(
            job.id,
            sanitizeForResponse(error && error.message, config)
          );
        }
      });

      res.status(202).json({
        jobId: job.id,
        id: job.id
      });
    })
  );

  app.get(
    '/tools/request-report-confirmed-check/jobs/:jobId',
    requireJsonAuth('request-report-matching'),
    asyncRoute(async (req, res) => {
      requestReportJobStore.pruneExpired();

      const snapshot = requestReportJobStore.getSnapshot(req.params.jobId);

      if (!snapshot) {
        sendJsonError(res, 404, 'Задача проверки не найдена.');
        return;
      }

      res.status(200).json(snapshot);
    })
  );

  app.post(
    '/tools/request-report-confirmed-check',
    requireAuth('request-report-matching'),
    asyncRoute(async (req, res) => {
      let form;

      try {
        form = await parseMultipartFormData(req, { maxBytes: 10 * 1024 * 1024 });
      } catch (error) {
        res
          .status(statusCodeFromError(error))
          .type('html')
          .send(
            renderRequestReportMissingConfirmedPage({
              database,
              error: sanitizeForResponse(error && error.message, config),
              ...viewContext(req)
            })
          );
        return;
      }

      req.body = form.fields || {};

      if (!verifyCsrf(req, res, 'request-report-matching')) {
        return;
      }

      const file = form.files && form.files.reportFile;
      const filename = file && file.filename ? file.filename : '';

      if (!file || !file.buffer || file.buffer.length === 0) {
        res
          .status(400)
          .type('html')
          .send(
            renderRequestReportMissingConfirmedPage({
              database,
              error: 'Выберите XLSX-файл.',
              ...viewContext(req)
            })
          );
        return;
      }

      if (!filename.toLowerCase().endsWith('.xlsx')) {
        res
          .status(400)
          .type('html')
          .send(
            renderRequestReportMissingConfirmedPage({
              database,
              filename,
              error: 'Поддерживаются только XLSX-файлы.',
              ...viewContext(req)
            })
          );
        return;
      }

      let parsed;

      try {
        parsed = parseRequestsReportWorkbook(file.buffer);
      } catch (error) {
        res
          .status(400)
          .type('html')
          .send(
            renderRequestReportMissingConfirmedPage({
              database,
              filename,
              error: sanitizeForResponse(error && error.message, config),
              ...viewContext(req)
            })
          );
        return;
      }

      const lookup = await findRequestReportRowsWithoutConfirmedShift(client, parsed.rows);
      const action = String((form.fields && form.fields.action) || '');
      const statusUserId = requestReportStatusUserId(req);

      if (action === 'export') {
        const checkedRowsWithReviewStatuses = await requestReportShiftStatusStore.attachStatuses(
          statusUserId,
          lookup.checkedRows || []
        );
        const workbook = buildRequestReportCheckWorkbook({
          sourceSheet: parsed.sourceSheet,
          rows: checkedRowsWithReviewStatuses
        });

        sendRequestReportCheckWorkbook(res, workbook);
        return;
      }

      const rowsWithReviewStatuses = await requestReportShiftStatusStore.attachStatuses(
        statusUserId,
        lookup.rows
      );
      const result = {
        ...lookup,
        rows: rowsWithReviewStatuses,
        warnings: [
          ...(Array.isArray(parsed.warnings) ? parsed.warnings : []),
          ...(Array.isArray(lookup.warnings) ? lookup.warnings : [])
        ]
      };

      res
        .status(200)
        .type('html')
        .send(renderRequestReportMissingConfirmedPage({ database, filename, result, ...viewContext(req) }));
    })
  );

  app.get('/tables', requireAuth('tables'), asyncRoute(renderNamedTable));

  app.get('/tables/:tableName', requireAuth('tables'), (req, res) => {
    res.redirect(302, `/tables?name=${encodeURIComponent(req.params.tableName)}`);
  });

  app.use((req, res) => {
    sendError(res, 404, 'Not Found', 'Not Found', activeNavForPath(req.path), viewContext(req));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const statusCode = statusCodeFromError(error);
    const title = statusCode === 502 ? 'Upstream Error' : STATUS_CODES[statusCode] || 'Bad Request';

    if ((req.path || '').startsWith('/tools/request-report-confirmed-check/jobs')) {
      sendJsonError(res, statusCode, error && error.message);
      return;
    }

    sendError(res, statusCode, title, error && error.message, activeNavForPath(req.path), viewContext(req));
  });

  return app;
}

function start(options = {}) {
  const {
    env = process.env,
    loadConfigFn = loadConfig,
    ClientClass = ClickHouseClient,
    createAppFn = createApp,
    createWorkplaceDirectoryCacheFn = createWorkplaceDirectoryCache,
    createPreloadServiceFn = createPreloadService,
    createScheduledReportStoreFn = createScheduledReportStore,
    createScheduledReportMailerFn = createScheduledReportMailer,
    createScheduledReportRunnerFn = createScheduledReportRunner,
    createScheduledReportSchedulerFn = createScheduledReportScheduler,
    createScheduledReportServiceFn = createScheduledReportService,
    createUserActivityStoreFn = createUserActivityStore,
    logger = console
  } = options;
  const config = loadConfigFn(env);
  const client = new ClientClass(config.clickhouse);
  const preloadClient = new ClientClass({
    ...config.clickhouse,
    requestTimeoutMs: config.preload.clickhouseRequestTimeoutMs || 600000
  });
  const activeGigersCache = null;
  const cityAnalysisCache = null;
  const dashboardSectionCache = null;
  const workplaceDirectoryCache = createWorkplaceDirectoryCacheFn({ env });
  let preloadService = null;
  let cityGigerScopeService = null;
  let cityAnalysisAsyncSectionService = null;
  let scheduledReportService = null;
  let scheduledReportStore = null;
  let scheduledReportScheduler = null;
  let activityStore = null;

  function warn(message) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(message);
      return;
    }

    if (logger && typeof logger.log === 'function') {
      logger.log(message);
    }
  }

  function closeResource(resource, label) {
    if (!resource || typeof resource.close !== 'function') {
      return null;
    }

    try {
      const closeResult = resource.close();

      if (closeResult && typeof closeResult.catch === 'function') {
        return closeResult.catch((error) => {
          warn(`${label} close failed: ${sanitizeForResponse(error && error.message, config)}`);
        });
      }
    } catch (error) {
      warn(`${label} close failed: ${sanitizeForResponse(error && error.message, config)}`);
    }

    return null;
  }

  function attachStartupCleanup(error, cleanupResults) {
    const cleanupPromises = cleanupResults.filter((result) => result && typeof result.then === 'function');

    if (cleanupPromises.length > 0 && error && typeof error === 'object') {
      error.startupCleanup = Promise.allSettled(cleanupPromises);
    }
  }

  function closeScheduledReportScheduler() {
    if (!scheduledReportScheduler) {
      return null;
    }

    if (typeof scheduledReportScheduler.stop === 'function') {
      try {
        scheduledReportScheduler.stop();
      } catch (error) {
        warn(`Scheduled report scheduler stop failed: ${sanitizeForResponse(error && error.message, config)}`);
      }
    }

    if (typeof scheduledReportScheduler.drain !== 'function') {
      return null;
    }

    try {
      const drainResult = scheduledReportScheduler.drain();

      if (drainResult && typeof drainResult.catch === 'function') {
        return drainResult.catch((error) => {
          warn(`Scheduled report scheduler drain failed: ${sanitizeForResponse(error && error.message, config)}`);
        });
      }
    } catch (error) {
      warn(`Scheduled report scheduler drain failed: ${sanitizeForResponse(error && error.message, config)}`);
    }

    return null;
  }

  function closeScheduledReportResources() {
    if (scheduledReportService && typeof scheduledReportService.close === 'function') {
      return closeResource(scheduledReportService, 'Scheduled report service');
    }

    const schedulerCleanup = closeScheduledReportScheduler();

    if (schedulerCleanup && typeof schedulerCleanup.then === 'function') {
      return schedulerCleanup.then(() => closeResource(scheduledReportStore, 'Scheduled report store'));
    }

    return closeResource(scheduledReportStore, 'Scheduled report store');
  }

  try {
    preloadService = createPreloadServiceFn({
      client: preloadClient,
      storePath: config.preload.storePath,
      activeGigersCache,
      sanitizeError: (error) => sanitizeForResponse(error && error.message, config)
    });
  } catch (error) {
    warn(`Preload service disabled: ${sanitizeForResponse(error && error.message, config)}`);
  }

  if (config.cityGigerScopes) {
    try {
      cityGigerScopeService = createCityGigerScopeService({
        client: preloadClient,
        loadRows: loadCityAnalysisGigerScopeRows,
        storePath: config.cityGigerScopes.storePath,
        logger
      });
    } catch (error) {
      warn(`City giger scope service disabled: ${sanitizeForResponse(error && error.message, config)}`);
    }
  }

  cityAnalysisAsyncSectionService = createCityAnalysisAsyncSectionService({ client: preloadClient, logger });

  try {
    if (config.scheduledReports) {
      scheduledReportStore = createScheduledReportStoreFn({
        filePath: config.scheduledReports.storePath,
        fileDir: config.scheduledReports.fileDir
      });
      const scheduledReportMailer = createScheduledReportMailerFn({});
      const scheduledReportRunner = createScheduledReportRunnerFn({
        client,
        store: scheduledReportStore,
        fileDir: config.scheduledReports.fileDir,
        config: config.scheduledReports,
        mailer: scheduledReportMailer,
        sanitizeError: (error) => sanitizeForResponse(
          sanitizeMailError(error, scheduledReportStore.getMailSettingsSecret()),
          config
        )
      });
      scheduledReportScheduler = createScheduledReportSchedulerFn({
        store: scheduledReportStore,
        runner: scheduledReportRunner
      });

      scheduledReportService = createScheduledReportServiceFn({
        store: scheduledReportStore,
        scheduler: scheduledReportScheduler
      });

      if (scheduledReportService && typeof scheduledReportService.sendTestMail !== 'function') {
        scheduledReportService.sendTestMail = ({ recipient }) => scheduledReportMailer.sendReport({
          settings: scheduledReportStore.getMailSettingsSecret(),
          recipients: [recipient],
          subject: 'SMTP test',
          body: 'SMTP settings test',
          filename: 'smtp-test.xlsx',
          fileBuffer: buildXlsxWorkbook({
            sheetName: 'SMTP',
            headers: ['status'],
            rows: [['ok']]
          })
        });
      }
    }
  } catch (error) {
    const scheduledCleanup = closeScheduledReportResources();
    const preloadCleanup = closeResource(preloadService, 'Preload service');

    attachStartupCleanup(error, [scheduledCleanup, preloadCleanup]);
    throw error;
  }

  try {
    activityStore = config.auth && config.auth.enabled === true
      ? createUserActivityStoreFn({
          filePath: config.activity && config.activity.storePath
        })
      : null;
  } catch (error) {
    const scheduledCleanup = closeScheduledReportResources();
    const cleanup = closeResource(preloadService, 'Preload service');

    attachStartupCleanup(error, [scheduledCleanup, cleanup]);
    throw error;
  }

  let app;

  try {
    app = createAppFn({
      config,
      client,
      activeGigersCache,
      cityAnalysisCache,
      cityGigerScopeService,
      cityAnalysisAsyncSectionService,
      dashboardSectionCache,
      workplaceDirectoryCache,
      preloadService,
      scheduledReportService,
      activityStore,
      buildInfo: config.app || defaultBuildInfo(env)
    });
  } catch (error) {
    const activityCleanup = closeResource(activityStore, 'User activity store');
    const scheduledCleanup = closeScheduledReportResources();
    const preloadCleanup = closeResource(preloadService, 'Preload service');

    attachStartupCleanup(error, [activityCleanup, scheduledCleanup, preloadCleanup]);
    throw error;
  }

  const server = app.listen(config.port, () => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : config.port;

    logger.log(`ETL Analytics listening on port ${port}`);
  });
  const workplaceDirectoryRefresh = workplaceDirectoryCache.scheduleRefresh(client);
  const cacheCleanup = scheduleDailyCacheCleanup({
    caches: [cityAnalysisCache, dashboardSectionCache],
    logger
  });
  const cityGigerScopeRefresh = cityGigerScopeService && typeof cityGigerScopeService.refreshKnownScopes === 'function'
    ? scheduleDailyCacheCleanup({
        caches: [{ pruneExpired: () => cityGigerScopeService.refreshKnownScopes() }],
        logger
      })
    : { stop() {} };

  server.on('close', () => {
    workplaceDirectoryRefresh.stop();
    cacheCleanup.stop();
    cityGigerScopeRefresh.stop();

    closeResource(activityStore, 'User activity store');
    closeScheduledReportResources();
    closeResource(cityGigerScopeService, 'City giger scope service');
    closeResource(preloadService, 'Preload service');
  });

  return server;
}

if (require.main === module) {
  async function handleStartupError(error) {
    let config;

    try {
      config = loadConfig();
    } catch (_) {
      config = {
        clickhouse: { password: process.env.CLICKHOUSE_PASSWORD },
        auth: {
          adminPassword: process.env.AUTH_ADMIN_PASSWORD,
          sessionSecret: process.env.AUTH_SESSION_SECRET
        }
      };
    }

    console.error(sanitizeForResponse(error && error.message, config));
    process.exitCode = 1;

    if (error && error.startupCleanup && typeof error.startupCleanup.then === 'function') {
      try {
        await error.startupCleanup;
      } catch (_) {
        // closeResource already logs sanitized close errors.
      }
    }
  }

  try {
    start();
  } catch (error) {
    handleStartupError(error);
  }
}

module.exports = {
  activeNavForPath,
  createApp,
  millisecondsUntilNextUtcDay,
  sanitizeForResponse,
  scheduleDailyCacheCleanup,
  start
};
