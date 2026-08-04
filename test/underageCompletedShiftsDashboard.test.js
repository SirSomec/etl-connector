const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadUnderageCompletedShiftsDashboard,
  normalizeUnderageCompletedShiftsFilters,
  underageCompletedShiftsSql
} = require('../src/underageCompletedShiftsDashboard');

test('normalizes the current calendar year as the dashboard range', () => {
  assert.deepEqual(
    normalizeUnderageCompletedShiftsFilters(new Date('2026-07-20T12:00:00.000Z')),
    {
      from: '2026-01-01',
      to: '2026-07-20',
      fromDateTime: '2026-01-01 00:00:00',
      toExclusiveDateTime: '2026-07-21 00:00:00'
    }
  );
});

test('loads weekly completed shifts using age on the shift date', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });
      return [
        { week: '2026-01-05', completed_shifts: '4' },
        { week: '2025-12-29', completed_shifts: '2' }
      ];
    }
  };

  const dashboard = await loadUnderageCompletedShiftsDashboard(
    client,
    {},
    new Date('2026-07-20T12:00:00.000Z')
  );

  assert.deepEqual(dashboard.trendRows, [
    { week: '2025-12-29', completedShifts: 2 },
    { week: '2026-01-05', completedShifts: 4 }
  ]);
  assert.deepEqual(calls[0].params, {
    param_from: '2026-01-01 00:00:00',
    param_to: '2026-07-21 00:00:00'
  });
  assert.equal(calls[0].operation, 'underage completed shifts weekly trend');
  assert.match(calls[0].query, /FROM mg_jobs AS j/);
  assert.match(calls[0].query, /FROM mg_workers AS w/);
  assert.match(calls[0].query, /INNER JOIN mg_users AS u/);
  assert.match(calls[0].query, /toMonday\(j\.start\)/);
  assert.match(calls[0].query, /addYears\(wb\.birthday, 18\) > toDate\(j\.start\)/);
  assert.match(calls[0].query, /ifNull\(j\.status, ''\) = 'confirmed'/);
});

test('SQL template includes the age boundary and successful completion condition', () => {
  const sql = underageCompletedShiftsSql();

  assert.match(sql, /wb\.birthday <= toDate\(j\.start\)/);
  assert.match(sql, /addYears\(wb\.birthday, 18\) > toDate\(j\.start\)/);
  assert.match(sql, /uniqExact\(j\._id\) AS completed_shifts/);
});
