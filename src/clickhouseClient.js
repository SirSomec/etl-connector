const fs = require('node:fs');
const https = require('node:https');
const querystring = require('node:querystring');

class ClickHouseError extends Error {
  constructor(operation, message, statusCode) {
    const status = statusCode ? ` with HTTP ${statusCode}` : '';
    super(`${operation} failed${status}: ${message}`);
    this.name = 'ClickHouseError';
    this.operation = operation;
    this.statusCode = statusCode;
  }
}

function parseJSONEachRow(body) {
  const text = String(body || '');

  if (text.trim() === '') {
    return [];
  }

  return text
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error('Identifier must be a non-empty string');
  }

  return `\`${identifier.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
}

class ClickHouseClient {
  constructor(config, deps = {}) {
    this.config = config;
    this.request = deps.request || https.request;
    this.requestTimeoutMs = config.requestTimeoutMs || 10000;
    this.ca = Object.prototype.hasOwnProperty.call(deps, 'ca')
      ? deps.ca
      : (deps.readFileSync || fs.readFileSync)(config.caPath);
  }

  redact(value) {
    const message = String(value || '');

    if (!this.config.password) {
      return message;
    }

    return message.split(this.config.password).join('[redacted]');
  }

  execute(query, params = {}, operation = 'ClickHouse query') {
    const requestParams = {
      ...params,
      database: this.config.database,
      query
    };
    const options = {
      method: 'GET',
      hostname: this.config.host,
      port: this.config.port,
      path: `/?${querystring.stringify(requestParams)}`,
      ca: this.ca,
      headers: {
        'X-ClickHouse-User': this.config.user,
        'X-ClickHouse-Key': this.config.password
      }
    };

    return new Promise((resolve, reject) => {
      let settled = false;

      const resolveOnce = (value) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      };
      const rejectClickHouseError = (message, statusCode) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(new ClickHouseError(operation, this.redact(message), statusCode));
      };

      let req;

      try {
        req = this.request(options, (res) => {
          const chunks = [];

          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            chunks.push(chunk);
          });
          res.on('error', (error) => {
            rejectClickHouseError(error.message);
          });
          res.on('aborted', () => {
            rejectClickHouseError('Response aborted');
          });
          res.on('end', () => {
            const body = chunks.join('');

            if (res.statusCode < 200 || res.statusCode >= 300) {
              rejectClickHouseError(body || 'Request failed', res.statusCode);
              return;
            }

            resolveOnce(body);
          });
        });
      } catch (error) {
        rejectClickHouseError(error.message);
        return;
      }

      req.on('error', (error) => {
        rejectClickHouseError(error.message);
      });
      req.setTimeout(this.requestTimeoutMs, () => {
        const error = new Error(`Request timed out after ${this.requestTimeoutMs} ms`);

        if (typeof req.destroy === 'function') {
          req.destroy(error);
        }

        rejectClickHouseError(error.message);
      });
      req.end();
    });
  }

  async listTables() {
    const body = await this.execute(
      [
        'SELECT name',
        'FROM system.tables',
        'WHERE database = {database:String}',
        'ORDER BY name',
        'FORMAT JSONEachRow'
      ].join(' '),
      { param_database: this.config.database },
      'list tables'
    );

    return parseJSONEachRow(body).map((row) => row.name);
  }

  async getColumns(tableName) {
    const body = await this.execute(
      [
        'SELECT name, type, position',
        'FROM system.columns',
        'WHERE database = {database:String} AND table = {table:String}',
        'ORDER BY position',
        'FORMAT JSONEachRow'
      ].join(' '),
      {
        param_database: this.config.database,
        param_table: tableName
      },
      `load columns for ${tableName}`
    );

    return parseJSONEachRow(body);
  }

  async getPreview(tableName, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Limit must be between 1 and 1000');
    }

    const query = [
      'SELECT *',
      'FROM {database:Identifier}.{table:Identifier}',
      'LIMIT {limit:UInt64}',
      'FORMAT JSONEachRow'
    ].join(' ');
    const body = await this.execute(
      query,
      {
        param_database: this.config.database,
        param_table: tableName,
        param_limit: limit
      },
      `load preview for ${tableName}`
    );

    return parseJSONEachRow(body);
  }
}

module.exports = {
  ClickHouseClient,
  ClickHouseError,
  parseJSONEachRow,
  quoteIdentifier
};
