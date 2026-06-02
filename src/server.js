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
  CITY_ANALYSIS_SECTIONS,
  cityAnalysisCachePathFromEnv,
  createCityAnalysisCache,
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
  loadWorkplaceAnalysisDashboardSection,
  loadWorkplaceAnalysisDashboardShell
} = require('./workplaceAnalysisDashboard');
const {
  WORKPLACE_POINT_SECTIONS,
  loadWorkplacePointDashboardSection,
  loadWorkplacePointDashboardShell
} = require('./workplacePointDashboard');
const { createWorkplaceActiveGigersCache } = require('./workplaceActiveGigersCache');
const {
  renderAccountManagement,
  renderDashboardSectionError,
  renderError,
  renderCityAnalysisDashboardSection,
  renderCityAnalysisSectionError,
  renderCityAnalysisDashboard,
  renderHeatmapDashboard,
  renderHeatmapDashboardSection,
  renderHome,
  renderLogin,
  renderSalesByProjectDashboard,
  renderSalesByProjectDashboardSection,
  renderTable,
  renderWorkplaceAnalysisDashboard,
  renderWorkplaceAnalysisDashboardSection,
  renderWorkplacePointDashboard,
  renderWorkplacePointDashboardSection
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

function normalizePathForNav(path) {
  const text = String(path || '/');

  return text.length > 1 ? text.replace(/\/+$/, '') : text;
}

function activeNavForPath(path) {
  const normalized = normalizePathForNav(path);
  const navByPath = {
    '/admin/users': 'users',
    '/dashboards/city-analysis': 'city-analysis',
    '/dashboards/heatmap': 'heatmap',
    '/dashboards/sales-by-project': 'sales-by-project',
    '/dashboards/workplace-analysis': 'workplace-analysis'
  };

  if (normalized.startsWith('/admin/users/')) {
    return 'users';
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

  return navByPath[normalized] || 'tables';
}

function createApp({
  config,
  client,
  activeGigersCache = null,
  cityAnalysisCache = createCityAnalysisCache(),
  dashboardSectionCache = createDashboardSectionCache(),
  userStore = null,
  sessionManager = null
}) {
  const app = express();
  const database = config.clickhouse.database;
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

  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));

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

      res.setHeader('Set-Cookie', sessions.destroySession(req));
      res.redirect(303, '/login');
    })
  );

  app.get(
    '/admin/users',
    requireAuth('users'),
    asyncRoute(async (req, res) => {
      await sendAccountManagement(req, res, 200, {
        message: accountMessage(req.query.message)
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

        res.redirect(303, '/admin/users?message=deleted');
      } catch (error) {
        await sendAccountManagement(req, res, 400, {
          error: error && error.message
        });
      }
    })
  );

  app.get(
    '/',
    requireAuth('tables'),
    asyncRoute(async (req, res) => {
      const tables = await client.listTables();

      res.status(200).type('html').send(renderHome({ database, tables, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/sales-by-project',
    requireAuth('sales-by-project'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadSalesByProjectDashboardShell(client, req.query);

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
          cache: dashboardSectionCache
        });

        res
          .status(200)
          .type('html')
          .send(renderSalesByProjectDashboardSection({ dashboard, section }));
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

      res
        .status(200)
        .type('html')
        .send(renderCityAnalysisDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
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
          .send(renderCityAnalysisDashboardSection({ dashboard, section }));
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
          .send(renderHeatmapDashboardSection({ dashboard, section }));
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

      res
        .status(200)
        .type('html')
        .send(renderWorkplaceAnalysisDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
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
          .send(renderWorkplaceAnalysisDashboardSection({ dashboard, section }));
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
    '/dashboards/workplace-analysis/point',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadWorkplacePointDashboardShell(client, req.query);

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
          .send(renderWorkplacePointDashboardSection({ dashboard, section }));
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
  const app = createAppFn({ config, client, activeGigersCache, cityAnalysisCache, dashboardSectionCache });
  const server = app.listen(config.port, () => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : config.port;

    logger.log(`ETL Analytics listening on port ${port}`);
  });

  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
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
    process.exit(1);
  }
}

module.exports = {
  activeNavForPath,
  createApp,
  sanitizeForResponse,
  start
};
