const MUTATION_RE = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|RENAME|OPTIMIZE|SYSTEM|KILL|ATTACH|DETACH|GRANT|REVOKE)\b/i;

function normalizeSql(sql) {
  return String(sql || '').trim().replace(/;+\s*$/, '');
}

function hasMultipleStatements(sql) {
  return /;\s*\S/.test(String(sql || ''));
}

function assertSafeReportSql(sql) {
  const normalized = normalizeSql(sql);

  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new Error('Only SELECT queries are allowed');
  }
  if (hasMultipleStatements(sql)) {
    throw new Error('Multiple SQL statements are not allowed');
  }
  if (MUTATION_RE.test(normalized)) {
    throw new Error('Only read-only SELECT queries are allowed');
  }
  if (/\bFORMAT\b/i.test(normalized)) {
    throw new Error('FORMAT clause is managed by the application');
  }

  return true;
}

function normalizeReportLimits(input = {}, config = {}) {
  const defaultRowLimit = Number(config.defaultRowLimit) || 10000;
  const maxRowLimit = Number(config.maxRowLimit) || 100000;
  const defaultTimeoutMs = Number(config.queryTimeoutMs) || 120000;
  const requestedRowLimit = Number(input.rowLimit);
  const normalizedRowLimit = Number.isFinite(requestedRowLimit)
    ? Math.floor(requestedRowLimit)
    : requestedRowLimit === Infinity
      ? maxRowLimit
      : defaultRowLimit;
  const rowLimit = Math.max(1, Math.min(maxRowLimit, normalizedRowLimit || defaultRowLimit));
  const timeoutMs = Math.max(1, Math.min(defaultTimeoutMs, Number(input.timeoutMs) || defaultTimeoutMs));

  return { rowLimit, timeoutMs };
}

function sanitizeWrappedRowLimit(rowLimit) {
  const defaultRowLimit = 10000;
  const requestedRowLimit = Number(rowLimit);

  if (!Number.isFinite(requestedRowLimit)) {
    return defaultRowLimit;
  }

  const integerRowLimit = Math.floor(requestedRowLimit);
  if (!Number.isSafeInteger(integerRowLimit) || integerRowLimit === 0) {
    return defaultRowLimit;
  }

  return Math.max(1, integerRowLimit);
}

function wrapReportSql(sql, { rowLimit }) {
  assertSafeReportSql(sql);
  const safeRowLimit = sanitizeWrappedRowLimit(rowLimit);

  return {
    query: `SELECT * FROM (\n${normalizeSql(sql)}\n) AS scheduled_report_result\nLIMIT ${safeRowLimit}`,
    params: {},
    settings: {
      readonly: 1,
      max_result_rows: safeRowLimit
    }
  };
}

module.exports = {
  assertSafeReportSql,
  normalizeReportLimits,
  wrapReportSql
};
