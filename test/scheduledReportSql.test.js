const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSafeReportSql,
  normalizeReportLimits,
  wrapReportSql
} = require('../src/scheduledReportSql');

test('scheduled report SQL allows select and with select', () => {
  assert.equal(assertSafeReportSql('SELECT * FROM mg_jobs'), true);
  assert.equal(assertSafeReportSql('WITH x AS (SELECT 1) SELECT * FROM x'), true);
});

test('scheduled report SQL rejects mutations and multiple statements', () => {
  assert.throws(() => assertSafeReportSql('DELETE FROM mg_jobs'), /Only SELECT queries are allowed/);
  assert.throws(() => assertSafeReportSql('SELECT 1; SELECT 2'), /Multiple SQL statements are not allowed/);
  assert.throws(() => assertSafeReportSql('SELECT * FROM mg_jobs FORMAT JSONEachRow'), /FORMAT clause is managed by the application/);
});

test('wrapReportSql applies external limit without changing readonly setting', () => {
  const wrapped = wrapReportSql('SELECT _id, status FROM mg_jobs', { rowLimit: 100 });

  assert.match(wrapped.query, /SELECT \* FROM \(/);
  assert.match(wrapped.query, /LIMIT 100/);
  assert.deepEqual(wrapped.params, {});
  assert.deepEqual(wrapped.settings, { max_result_rows: 100 });
  assert.equal(Object.hasOwn(wrapped.settings, 'readonly'), false);
});

test('wrapReportSql normalizes unsafe row limits', () => {
  const cases = [
    { rowLimit: -1, expected: 1 },
    { rowLimit: 1.5, expected: 1 },
    { rowLimit: 0, expected: 10000 },
    { rowLimit: Infinity, expected: 10000 },
    { rowLimit: NaN, expected: 10000 },
    { rowLimit: Number.MAX_SAFE_INTEGER + 1, expected: 10000 }
  ];

  for (const { rowLimit, expected } of cases) {
    const wrapped = wrapReportSql('SELECT _id FROM mg_jobs', { rowLimit });

    assert.match(wrapped.query, new RegExp(`LIMIT ${expected}$`));
    assert.equal(wrapped.settings.max_result_rows, expected);
  }
});

test('wrapReportSql preserves pre-normalized safe row limits above default max', () => {
  const wrapped = wrapReportSql('SELECT 1', { rowLimit: 200000 });

  assert.match(wrapped.query, /LIMIT 200000$/);
  assert.equal(wrapped.settings.max_result_rows, 200000);
});

test('normalizeReportLimits clamps unsafe values', () => {
  assert.deepEqual(
    normalizeReportLimits({ rowLimit: 200000, timeoutMs: 999999 }, {
      defaultRowLimit: 10000,
      maxRowLimit: 100000,
      queryTimeoutMs: 120000
    }),
    { rowLimit: 100000, timeoutMs: 120000 }
  );
});
