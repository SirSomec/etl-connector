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
  assert.doesNotMatch(info.title, /Рџ|Рљ|СЃ/);
  assert.doesNotMatch(info.description, /Рџ|Рљ|СЃ/);
  assert.match(info.sql, /SELECT/i);
  assert.doesNotMatch(info.sql, /CLICKHOUSE_PASSWORD|AUTH_ADMIN_PASSWORD|AUTH_SESSION_SECRET/);
});

test('sqlMetricInfoFor returns null for missing ids', () => {
  assert.equal(sqlMetricInfoFor('missing.metric'), null);
});

test('getSqlMetricInfo derives child metric metadata from parent SQL info', () => {
  const info = getSqlMetricInfo('workplace-point.charts.calendar-sla');

  assert.equal(info.id, 'workplace-point.charts.calendar-sla');
  assert.match(info.title, /calendar sla/);
  assert.match(info.description, /calendar sla/);
  assert.match(info.description, /Кнопка относится к конкретному показателю/);
  assert.doesNotMatch(info.description, /Рџ|Рљ|СЃ/);
  assert.match(info.sql, /mg_orders/);
  assert.match(info.sql, /\{workplaceId:String\}/);
});

test('highlightSql escapes html and highlights SQL keywords and parameters', () => {
  const html = highlightSql("SELECT '<tag>' AS value WHERE start >= {from:DateTime}");

  assert.match(html, /<span class="sql-keyword">SELECT<\/span>/);
  assert.match(html, /&lt;tag&gt;/);
  assert.match(html, /<span class="sql-param">\{from:DateTime\}<\/span>/);
  assert.doesNotMatch(html, /<tag>/);
});
