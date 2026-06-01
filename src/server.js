const express = require('express');

const { ClickHouseClient } = require('./clickhouseClient');
const { loadConfig } = require('./config');
const { renderError, renderHome, renderTable } = require('./render');

function sanitizeForResponse(message, config) {
  const text = String(message || '');
  const safeMessage = text.trim() === '' ? 'Unexpected error' : text;
  const password = config && config.clickhouse && config.clickhouse.password;

  if (typeof password !== 'string' || password === '') {
    return safeMessage;
  }

  return safeMessage.split(password).join('[redacted]');
}

function createApp({ config, client }) {
  const app = express();
  const database = config.clickhouse.database;

  app.disable('x-powered-by');

  function sendError(res, statusCode, title, message) {
    res
      .status(statusCode)
      .type('html')
      .send(
        renderError({
          database,
          title,
          message: sanitizeForResponse(message, config)
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

    sendError(res, 502, 'Upstream Error', error && error.message);
  });

  return app;
}

function start() {
  const config = loadConfig();
  const client = new ClickHouseClient(config.clickhouse);
  const app = createApp({ config, client });
  const server = app.listen(config.port, () => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : config.port;

    console.log(`ETL Analytics listening on port ${port}`);
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
  createApp,
  sanitizeForResponse,
  start
};
