const { successfulConfirmedShiftCondition } = require('./successfulConfirmedShift');

const UNDERAGE_COMPLETED_SHIFTS_SECTIONS = new Set(['trend']);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function startOfYearUTC(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

function startOfNextDayUTC(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function normalizeUnderageCompletedShiftsFilters(now = new Date()) {
  return {
    from: formatDateUTC(startOfYearUTC(now)),
    to: formatDateUTC(now),
    fromDateTime: `${formatDateUTC(startOfYearUTC(now))} 00:00:00`,
    toExclusiveDateTime: `${formatDateUTC(startOfNextDayUTC(now))} 00:00:00`
  };
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function mapTrendRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      week: String(row.week || ''),
      completedShifts: numberValue(row.completed_shifts)
    }))
    .filter((row) => row.week !== '')
    .sort((left, right) => left.week.localeCompare(right.week));
}

function emptyDashboard(filters) {
  return {
    filters,
    trendRows: []
  };
}

function assertSection(section) {
  if (UNDERAGE_COMPLETED_SHIFTS_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown underage completed shifts section: ${section}`);

  error.status = 400;
  throw error;
}

function underageCompletedShiftsSql() {
  return `WITH workers_with_birthdays AS (
  SELECT
    w._id AS worker_id,
    toDateOrNull(nullIf(trimBoth(u.birthday), '')) AS birthday
  FROM mg_workers AS w
  INNER JOIN mg_users AS u ON u._id = w.user
  WHERE toDateOrNull(nullIf(trimBoth(u.birthday), '')) IS NOT NULL
)
SELECT
  toMonday(j.start) AS week,
  uniqExact(j._id) AS completed_shifts
FROM mg_jobs AS j
INNER JOIN workers_with_birthdays AS wb ON wb.worker_id = j.worker
WHERE ifNull(j._id, '') != ''
  AND ifNull(j.deleted, 0) = 0
  AND j.start >= {from:DateTime}
  AND j.start < {to:DateTime}
  AND wb.birthday <= toDate(j.start)
  AND addYears(wb.birthday, 18) > toDate(j.start)
  AND ${successfulConfirmedShiftCondition('j')}
GROUP BY week
ORDER BY week
FORMAT JSONEachRow`;
}

async function loadUnderageCompletedShiftsDashboardShell(client, input = {}, now = new Date()) {
  return emptyDashboard(normalizeUnderageCompletedShiftsFilters(now));
}

async function loadUnderageCompletedShiftsDashboardSection(
  client,
  input = {},
  section,
  now = new Date()
) {
  assertSection(section);

  const filters = normalizeUnderageCompletedShiftsFilters(now);
  const rows = await client.queryJSONEachRow(
    underageCompletedShiftsSql(),
    {
      param_from: filters.fromDateTime,
      param_to: filters.toExclusiveDateTime
    },
    'underage completed shifts weekly trend'
  );

  return {
    ...emptyDashboard(filters),
    trendRows: mapTrendRows(rows)
  };
}

async function loadUnderageCompletedShiftsDashboard(client, input = {}, now = new Date()) {
  return loadUnderageCompletedShiftsDashboardSection(client, input, 'trend', now);
}

module.exports = {
  UNDERAGE_COMPLETED_SHIFTS_SECTIONS,
  loadUnderageCompletedShiftsDashboard,
  loadUnderageCompletedShiftsDashboardSection,
  loadUnderageCompletedShiftsDashboardShell,
  mapTrendRows,
  normalizeUnderageCompletedShiftsFilters,
  underageCompletedShiftsSql
};
