const express = require('express');
const { STATUS_CODES } = require('node:http');

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
  renderDashboardSectionError,
  renderError,
  renderCityAnalysisDashboardSection,
  renderCityAnalysisSectionError,
  renderCityAnalysisDashboard,
  renderHome,
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
  const safeMessage = text.trim() === '' ? 'Unexpected error' : text;
  const password = config && config.clickhouse && config.clickhouse.password;

  if (typeof password !== 'string' || password === '') {
    return safeMessage;
  }

  return safeMessage.split(password).join('[redacted]');
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
    '/dashboards/city-analysis': 'city-analysis',
    '/dashboards/sales-by-project': 'sales-by-project',
    '/dashboards/workplace-analysis': 'workplace-analysis'
  };

  if (normalized.startsWith('/dashboards/workplace-analysis/')) {
    return 'workplace-analysis';
  }

  if (normalized.startsWith('/dashboards/city-analysis/')) {
    return 'city-analysis';
  }

  return navByPath[normalized] || 'tables';
}

function createApp({
  config,
  client,
  activeGigersCache = null,
  cityAnalysisCache = createCityAnalysisCache(),
  dashboardSectionCache = createDashboardSectionCache()
}) {
  const app = express();
  const database = config.clickhouse.database;

  app.disable('x-powered-by');

  function sendError(res, statusCode, title, message, activeNav = 'tables') {
    res
      .status(statusCode)
      .type('html')
      .send(
        renderError({
          database,
          title,
          message: sanitizeForResponse(message, config),
          activeNav
        })
      );
  }

  function asyncRoute(handler) {
    return (req, res, next) => {
      Promise.resolve(handler(req, res, next)).catch(next);
    };
  }

  async function renderNamedTable(req, res) {
    const tableName = req.query.name;

    if (typeof tableName !== 'string' || tableName.trim() === '') {
      sendError(res, 400, 'Bad Request', 'Missing table name');
      return;
    }

    const tables = await client.listTables();

    if (!tables.includes(tableName)) {
      sendError(res, 404, 'Table not found', `Table not found: ${tableName}`);
      return;
    }

    const [columns, rows] = await Promise.all([
      client.getColumns(tableName),
      client.getPreview(tableName)
    ]);

    res
      .status(200)
      .type('html')
      .send(renderTable({ database, tableName, columns, rows }));
  }

  app.get('/healthz', (req, res) => {
    res.type('text').send('ok');
  });

  app.get(
    '/',
    asyncRoute(async (req, res) => {
      const tables = await client.listTables();

      res.status(200).type('html').send(renderHome({ database, tables }));
    })
  );

  app.get(
    '/dashboards/sales-by-project',
    asyncRoute(async (req, res) => {
      const dashboard = await loadSalesByProjectDashboardShell(client, req.query);

      res
        .status(200)
        .type('html')
        .send(renderSalesByProjectDashboard({ database, dashboard, progressive: true }));
    })
  );

  app.get(
    '/dashboards/sales-by-project/section',
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!SALES_BY_PROJECT_SECTIONS.has(section)) {
        sendError(res, 400, 'Bad Request', `Unknown sales by project section: ${section}`, 'sales-by-project');
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
    asyncRoute(async (req, res) => {
      const dashboard = await loadCityAnalysisDashboardShell(client, req.query, new Date(), {
        cache: cityAnalysisCache
      });

      res
        .status(200)
        .type('html')
        .send(renderCityAnalysisDashboard({ database, dashboard, progressive: true }));
    })
  );

  app.get(
    '/dashboards/city-analysis/section',
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!CITY_ANALYSIS_SECTIONS.has(section)) {
        sendError(res, 400, 'Bad Request', `Unknown city analysis section: ${section}`, 'city-analysis');
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
    '/dashboards/workplace-analysis',
    asyncRoute(async (req, res) => {
      const dashboard = await loadWorkplaceAnalysisDashboardShell(client, req.query, new Date());

      res
        .status(200)
        .type('html')
        .send(renderWorkplaceAnalysisDashboard({ database, dashboard, progressive: true }));
    })
  );

  app.get(
    '/dashboards/workplace-analysis/section',
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!WORKPLACE_ANALYSIS_SECTIONS.has(section)) {
        sendError(res, 400, 'Bad Request', `Unknown workplace analysis section: ${section}`, 'workplace-analysis');
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
    asyncRoute(async (req, res) => {
      const dashboard = await loadWorkplacePointDashboardShell(client, req.query);

      res
        .status(200)
        .type('html')
        .send(renderWorkplacePointDashboard({ database, dashboard, progressive: true }));
    })
  );

  app.get(
    '/dashboards/workplace-analysis/point/section',
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!WORKPLACE_POINT_SECTIONS.has(section)) {
        sendError(res, 400, 'Bad Request', `Unknown workplace point section: ${section}`, 'workplace-analysis');
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

  app.get('/tables', asyncRoute(renderNamedTable));

  app.get('/tables/:tableName', (req, res) => {
    res.redirect(302, `/tables?name=${encodeURIComponent(req.params.tableName)}`);
  });

  app.use((req, res) => {
    sendError(res, 404, 'Not Found', 'Not Found');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const statusCode = statusCodeFromError(error);
    const title = statusCode === 502 ? 'Upstream Error' : STATUS_CODES[statusCode] || 'Bad Request';

    sendError(res, statusCode, title, error && error.message, activeNavForPath(req.path));
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
      config = { clickhouse: { password: process.env.CLICKHOUSE_PASSWORD } };
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
