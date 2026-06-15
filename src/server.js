const express = require('express');
const { STATUS_CODES } = require('node:http');

const {
  createSessionManager,
  createUserStore,
  hasPermission
} = require('./auth');
const { ClickHouseClient } = require('./clickhouseClient');
const { loadConfig } = require('./config');
const {
  createDashboardSectionCache,
  dashboardSectionCachePathFromEnv
} = require('./dashboardSectionCache');
const {
  createWorkplaceDirectoryCache,
  workplaceDirectoryCachePathFromEnv
} = require('./workplaceDirectoryCache');
const { createPreloadService } = require('./preloadService');
const { buildSalesByProjectPreloadQueries } = require('./preloadSalesByProject');
const { SALES_PRELOAD_JOB_ID } = require('./preloadStore');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');
const {
  createUserActivityStore,
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS
} = require('./userActivityStore');
const {
  CITY_ANALYSIS_SECTIONS,
  cityAnalysisCachePathFromEnv,
  createCityAnalysisCache,
  loadCityAnalysisGigerDetails,
  loadCityAnalysisDashboardSection,
  loadCityAnalysisDashboardShell
} = require('./cityAnalysisDashboard');
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
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDetails,
  loadWorkerCancellationsDashboardShell
} = require('./workerCancellationsDashboard');
const { createWorkplaceActiveGigersCache } = require('./workplaceActiveGigersCache');
const {
  renderAccountManagement,
  renderDashboardSectionError,
  renderError,
  renderGigerDetails,
  renderGigerDetailsWorkbook,
  renderCityAnalysisDashboardSection,
  renderCityAnalysisSectionError,
  renderCityAnalysisDashboard,
  renderHeatmapDashboard,
  renderHeatmapDashboardSection,
  renderHome,
  renderLogin,
  renderPasswordChange,
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

function normalizePathForNav(path) {
  const text = String(path || '/');

  return text.length > 1 ? text.replace(/\/+$/, '') : text;
}

function activeNavForPath(path) {
  const normalized = normalizePathForNav(path);
  const navByPath = {
    '/admin/activity': 'activity',
    '/admin/preload': 'preload-admin',
    '/admin/users': 'users',
    '/dashboards/city-analysis': 'city-analysis',
    '/dashboards/heatmap': 'heatmap',
    '/dashboards/sales-by-project': 'sales-by-project',
    '/dashboards/workplace-analysis': 'workplace-analysis',
    '/dashboards/worker-cancellations': 'worker-cancellations'
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

  if (normalized.startsWith('/dashboards/workplace-analysis/')) {
    return 'workplace-analysis';
  }

  if (normalized.startsWith('/dashboards/city-analysis/')) {
    return 'city-analysis';
  }

  if (normalized.startsWith('/dashboards/heatmap/')) {
    return 'heatmap';
  }

  if (normalized.startsWith('/dashboards/sales-by-project/')) {
    return 'sales-by-project';
  }

  if (normalized.startsWith('/dashboards/worker-cancellations/')) {
    return 'worker-cancellations';
  }

  return navByPath[normalized] || 'tables';
}

function preloadMessage(code) {
  const messages = {
    'schedule-saved': 'Расписание сохранено',
    'run-started': 'Обновление запущено',
    'already-running': 'Обновление уже выполняется'
  };

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

function parseRefreshDaysFromBody(value) {
  const text = String(value || '');

  if (!/^\d+$/.test(text)) {
    throw createScheduleSettingsError();
  }

  const refreshDays = Number(text);

  if (!Number.isInteger(refreshDays) || refreshDays < 1 || refreshDays > 366) {
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

function createApp({
  config,
  client,
  activeGigersCache = null,
  cityAnalysisCache = createCityAnalysisCache(),
  dashboardSectionCache = createDashboardSectionCache(),
  workplaceDirectoryCache = createWorkplaceDirectoryCache({ filePath: null }),
  preloadService = null,
  userStore = null,
  sessionManager = null,
  activityStore = null,
  buildInfo = config && config.app ? config.app : defaultBuildInfo(),
  now = () => new Date()
}) {
  const app = express();
  const database = config.clickhouse.database;
  const preloads = preloadService;
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

    if (pathName === '/' || pathName === '/tables' || pathName.startsWith('/tables/')) {
      return 'tables';
    }

    if (pathName === '/dashboards/sales-by-project' || pathName.startsWith('/dashboards/sales-by-project/')) {
      return 'sales-by-project';
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

    if (method !== 'GET') {
      return '';
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
    const enabledValue = body && body.enabled;

    return {
      enabled: enabledValue === '1' || enabledValue === 'on' || enabledValue === 'true',
      scheduleTime: parseScheduleTimeFromBody(body && body.scheduleTime),
      refreshDays: parseRefreshDaysFromBody(body && body.refreshDays)
    };
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

    res
      .status(statusCode)
      .type('html')
      .send(
        renderPreloadManagement({
          database,
          message: options.message || '',
          error: options.error || '',
          job: preloads.getJob(SALES_PRELOAD_JOB_ID),
          overview: preloads.getOverview(),
          diagnostics: typeof preloads.getDiagnostics === 'function' ? preloads.getDiagnostics() : null,
          runs: preloads.listRuns(SALES_PRELOAD_JOB_ID, 20),
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

      const result = await preloads.runSalesByProject(normalizeManualPreloadRange(req.body));
      const message = result && (result.status === 'already-running' || result.alreadyRunning)
        ? 'already-running'
        : 'run-started';

      recordCurrentUserActivity(req, 'admin_action');
      res.redirect(303, `/admin/preload?message=${message}`);
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
        const details = await loadCityAnalysisGigerDetails(client, req.query, new Date());

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
      const details = await loadCityAnalysisGigerDetails(client, { ...req.query, export: '1' }, new Date());

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
        const dashboard = await loadCityAnalysisDashboardSection(client, req.query, section, new Date(), {
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
            cache: dashboardSectionCache
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
        { workplaceDirectoryCache }
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
            cache: dashboardSectionCache
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
      const dashboard = await loadWorkerCancellationsDashboardShell(client, req.query, new Date());

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
            cache: dashboardSectionCache
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
        const details = await loadWorkerCancellationsDetails(client, req.query, new Date());

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
    createPreloadServiceFn = createPreloadService,
    createUserActivityStoreFn = createUserActivityStore,
    logger = console
  } = options;
  const config = loadConfigFn(env);
  const client = new ClientClass(config.clickhouse);
  const activeGigersCache = createWorkplaceActiveGigersCache();
  const cityAnalysisCache = createCityAnalysisCache({
    filePath: cityAnalysisCachePathFromEnv(env)
  });
  const dashboardSectionCache = createDashboardSectionCache({
    filePath: dashboardSectionCachePathFromEnv(env)
  });
  const workplaceDirectoryCache = createWorkplaceDirectoryCache({
    filePath: workplaceDirectoryCachePathFromEnv(env)
  });
  let preloadService = null;
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

  try {
    preloadService = createPreloadServiceFn({
      client,
      storePath: config.preload.storePath,
      sanitizeError: (error) => sanitizeForResponse(error && error.message, config)
    });
  } catch (error) {
    warn(`Preload service disabled: ${sanitizeForResponse(error && error.message, config)}`);
  }

  try {
    activityStore = config.auth && config.auth.enabled === true
      ? createUserActivityStoreFn({
          filePath: config.activity && config.activity.storePath
        })
      : null;
  } catch (error) {
    const cleanup = closeResource(preloadService, 'Preload service');

    attachStartupCleanup(error, [cleanup]);
    throw error;
  }

  let app;

  try {
    app = createAppFn({
      config,
      client,
      activeGigersCache,
      cityAnalysisCache,
      dashboardSectionCache,
      workplaceDirectoryCache,
      preloadService,
      activityStore,
      buildInfo: config.app || defaultBuildInfo(env)
    });
  } catch (error) {
    const activityCleanup = closeResource(activityStore, 'User activity store');
    const preloadCleanup = closeResource(preloadService, 'Preload service');

    attachStartupCleanup(error, [activityCleanup, preloadCleanup]);
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

  server.on('close', () => {
    workplaceDirectoryRefresh.stop();
    cacheCleanup.stop();

    closeResource(activityStore, 'User activity store');
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
