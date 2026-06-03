const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSqlMetricInfo,
  highlightSql,
  sqlMetricInfoFor
} = require('../src/sqlMetricInfo');

test('getSqlMetricInfo returns stable metadata without secrets', () => {
  const info = getSqlMetricInfo('sales-by-project.summary');

  assert.equal(info.id, 'sales-by-project.summary');
  assert.match(info.title, /Продажи/);
  assert.match(info.description, /Показывает/);
  assert.match(info.sql, /SELECT/i);
  assert.doesNotMatch(info.sql, /CLICKHOUSE_PASSWORD|AUTH_ADMIN_PASSWORD|AUTH_SESSION_SECRET/);
});

test('sqlMetricInfoFor returns null for missing ids', () => {
  assert.equal(sqlMetricInfoFor('missing.metric'), null);
});

test('highlightSql escapes html and highlights SQL keywords and parameters', () => {
  const html = highlightSql("SELECT '<tag>' AS value WHERE start >= {from:DateTime}");

  assert.match(html, /<span class="sql-keyword">SELECT<\/span>/);
  assert.match(html, /&lt;tag&gt;/);
  assert.match(html, /<span class="sql-param">\{from:DateTime\}<\/span>/);
  assert.doesNotMatch(html, /<tag>/);
});
