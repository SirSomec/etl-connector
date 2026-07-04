const {
  successfulConfirmedShiftCondition
} = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');
const {
  GIGER_DETAILS_PAGE_SIZE,
  cleanBooleanFlag: cleanGigerDetailsBooleanFlag,
  firstCleanText: firstGigerDetailsText,
  mergeGigerDetails,
  normalizeGigerDetailsPage
} = require('./gigerDetails');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 12;
const DEFAULT_ATTENTION_LIMIT = 150;
const ATTENTION_PAGE_SIZE = 15;
const ATTENTION_WORKER_BATCH_SIZE = 25;
const WORKPLACE_ATTENTION_CACHE_SCHEMA_VERSION = 4;
const DEFAULT_PAGE = 1;
const MAX_PAGE = 100000;
const DEFAULT_SORT = 'orders';
const DEFAULT_ATTENTION_SORT = 'attentionScore';
const DEFAULT_ATTENTION_DIRECTION = 'desc';
const ALLOWED_LIMITS = new Set([10, 12, 20, 50]);
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);
const ALLOWED_SORTS = new Set([DEFAULT_SORT, 'sla', 'stability']);
const ALLOWED_ATTENTION_SORTS = new Set([
  DEFAULT_ATTENTION_SORT,
  'title',
  'free7d',
  'nearestFreeDate',
  'maxDailyFree',
  'coveragePercent',
  'totalWorkers15km',
  'activeWorkers30d15km',
  'activeWorkersPerFreeShift',
  'priorityReason'
]);
const ALLOWED_DIRECTIONS = new Set(['asc', 'desc']);
const FILTER_OPTION_KEYS = ['client', 'city', 'region', 'profession', 'orderType', 'jobStatus', 'contractor'];
const WORKPLACE_ANALYSIS_SECTION_NAMES = ['points', 'attention'];
const WORKPLACE_ANALYSIS_SECTIONS = new Set(WORKPLACE_ANALYSIS_SECTION_NAMES);
const SORT_LABELS = {
  orders: 'Сначала крупнейшие по заказу',
  sla: 'Сначала высокий SLA',
  stability: 'Сначала высокая стабильность'
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== value) {
    return null;
  }

  return date;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function firstDayOfPreviousMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

function lastDayOfMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanValues(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const values = [];
  const seen = new Set();

  for (const rawValue of rawValues) {
    const text = cleanText(rawValue);

    if (text === '' || seen.has(text)) {
      continue;
    }

    seen.add(text);
    values.push(text);
  }

  return values;
}

function cleanBooleanFlag(value) {
  const rawValues = Array.isArray(value) ? value : [value];

  return rawValues.some((rawValue) => {
    const text = cleanText(rawValue).toLowerCase();

    return text === '1' || text === 'true' || text === 'on' || text === 'yes';
  });
}

function normalizeLimit(value) {
  const limit = Number(value);

  return Number.isInteger(limit) && ALLOWED_LIMITS.has(limit) ? limit : DEFAULT_LIMIT;
}

function normalizePage(value) {
  const page = Number(value);

  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : DEFAULT_PAGE;
}

function normalizeSort(value) {
  const sort = cleanText(value);

  return ALLOWED_SORTS.has(sort) ? sort : DEFAULT_SORT;
}

function normalizeDirection(value, defaultDirection = 'desc') {
  const direction = cleanText(value).toLowerCase();

  return ALLOWED_DIRECTIONS.has(direction) ? direction : defaultDirection;
}

function normalizeAttentionSort(value) {
  const sort = cleanText(value);

  return ALLOWED_ATTENTION_SORTS.has(sort) ? sort : DEFAULT_ATTENTION_SORT;
}

function firstNonEmptyText(value) {
  const values = Array.isArray(value) ? value : [value];

  for (const rawValue of values) {
    const text = cleanText(rawValue);

    if (text !== '') {
      return text;
    }
  }

  return '';
}

function normalizeNumberRangeValue(value, { min = null, max = null } = {}) {
  const text = firstNonEmptyText(value).replace(',', '.');

  if (text === '') {
    return null;
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  let normalized = number;

  if (min !== null) {
    normalized = Math.max(min, normalized);
  }
  if (max !== null) {
    normalized = Math.min(max, normalized);
  }

  return normalized;
}

function normalizePercentRangeValue(value) {
  return normalizeNumberRangeValue(value, { min: 0, max: 100 });
}

function normalizePositiveRangeValue(value) {
  return normalizeNumberRangeValue(value, { min: 0 });
}

function normalizeWorkplaceAnalysisFilters(input = {}, now = new Date()) {
  const today = parseDateOnly(formatDateUTC(now));
  const defaultFromDate = firstDayOfPreviousMonthUTC(today);
  const defaultToDate = lastDayOfMonthUTC(today);
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  let fromDate = requestedFrom || defaultFromDate;
  let toDate = requestedTo || defaultToDate;

  if (fromDate.getTime() > toDate.getTime()) {
    fromDate = defaultFromDate;
    toDate = defaultToDate;
  }

  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(addDaysUTC(toDate, 1));

  const limit = normalizeLimit(input.limit);
  const page = normalizePage(input.page);

  return {
    from,
    to,
    currentDate: formatDateUTC(today),
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    rangeDays: buildDateKeys(from, to).length,
    pinnedWorkplaceIds: cleanValues(input.pinnedWorkplaceId),
    client: cleanValues(input.client),
    city: cleanValues(input.city),
    region: cleanValues(input.region),
    profession: cleanValues(input.profession),
    orderType: cleanValues(input.orderType).filter((value) => ALLOWED_ORDER_TYPES.has(value)),
    jobStatus: cleanValues(input.jobStatus),
    contractor: cleanValues(input.contractor),
    search: cleanText(input.search),
    includeDeletedOrders: cleanBooleanFlag(input.includeDeletedOrders),
    includeHiddenOrders: cleanBooleanFlag(input.includeHiddenOrders),
    sort: normalizeSort(input.sort),
    slaFrom: normalizePercentRangeValue(input.slaFrom),
    slaTo: normalizePercentRangeValue(input.slaTo),
    ordersFrom: normalizePositiveRangeValue(input.ordersFrom),
    ordersTo: normalizePositiveRangeValue(input.ordersTo),
    stabilityFrom: normalizePercentRangeValue(input.stabilityFrom),
    stabilityTo: normalizePercentRangeValue(input.stabilityTo),
    limit,
    page,
    offset: (page - 1) * limit
  };
}

function normalizeWorkplaceAttentionLimit(value) {
  const limit = Number(value);

  return Number.isInteger(limit) && ALLOWED_LIMITS.has(limit) ? limit : DEFAULT_ATTENTION_LIMIT;
}

function normalizeWorkplaceAttentionFilters(input = {}, now = new Date()) {
  const shared = normalizeWorkplaceAnalysisFilters(input, now);
  const today = parseDateOnly(formatDateUTC(now));
  const attentionToDate = addDaysUTC(today, 7);
  const attentionFrom = formatDateUTC(today);
  const attentionTo = formatDateUTC(attentionToDate);
  const attentionToExclusive = formatDateUTC(addDaysUTC(attentionToDate, 1));

  return {
    ...shared,
    attentionFrom,
    attentionTo,
    attentionFromDateTime: toDateTimeParam(attentionFrom),
    attentionToExclusiveDateTime: toDateTimeParam(attentionToExclusive),
    attentionDays: buildDateKeys(attentionFrom, attentionTo).length,
    attentionLimit: normalizeWorkplaceAttentionLimit(input.attentionLimit),
    attentionPage: normalizePage(input.attentionPage),
    attentionPageSize: ATTENTION_PAGE_SIZE,
    attentionSort: normalizeAttentionSort(input.attentionSort),
    attentionDirection: normalizeDirection(input.attentionDirection, DEFAULT_ATTENTION_DIRECTION)
  };
}

function buildDateKeys(from, to) {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  const dates = [];

  for (let current = start; current.getTime() <= end.getTime(); current = addDaysUTC(current, 1)) {
    dates.push(formatDateUTC(current));
  }

  return dates;
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function percent(numerator, denominator) {
  const bottom = numberValue(denominator);

  if (bottom <= 0) {
    return 0;
  }

  return (numberValue(numerator) / bottom) * 100;
}

function statusBreakdown(row, prefix) {
  return {
    ready: numberValue(row[`${prefix}_status_ready`]),
    booked: numberValue(row[`${prefix}_status_booked`]),
    worked: numberValue(row[`${prefix}_status_worked`]),
    other: numberValue(row[`${prefix}_status_other`])
  };
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function attentionProfessionBreakdown(row) {
  const professions = arrayValue(row.free_professions_7d);
  const counts = arrayValue(row.free_profession_counts_7d);

  return professions
    .map((profession, index) => ({
      profession: String(profession || '').trim(),
      free7d: numberValue(counts[index])
    }))
    .filter((item) => item.profession && item.free7d > 0);
}

function daysUntil(filters, dateKey) {
  const start = parseDateOnly(filters.attentionFrom);
  const date = parseDateOnly(String(dateKey || ''));

  if (!start || !date) {
    return null;
  }

  return Math.round((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function startsSoonBoost(filters, nearestFreeDate) {
  const days = daysUntil(filters, nearestFreeDate);

  if (days === null) {
    return 0;
  }

  if (days <= 0) {
    return 50;
  }

  if (days === 1) {
    return 30;
  }

  if (days <= 3) {
    return 10;
  }

  return 0;
}

function lowActiveBaseBoost(activeWorkersPerFreeShift) {
  if (activeWorkersPerFreeShift < 1) {
    return 40;
  }

  if (activeWorkersPerFreeShift < 2) {
    return 20;
  }

  return 0;
}

function attentionPriorityReason(point) {
  if (point.maxDailyFree >= 5 && daysUntil(point.filters, point.nearestFreeDate) !== null && daysUntil(point.filters, point.nearestFreeDate) <= 3) {
    return 'пик в ближайшие дни';
  }

  if (point.activeWorkersPerFreeShift < 1) {
    return 'мало активной базы';
  }

  if (point.coveragePercent < 50) {
    return 'низкое покрытие';
  }

  return 'много свободного заказа';
}

function formatRiskNumber(value, digits = 0) {
  const number = Number(value) || 0;

  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(number).replace(/\u00a0/g, ' ');
}

function attentionRiskReasons(row) {
  const free7d = Number(row.free_7d) || 0;
  const ordered7d = Number(row.ordered_7d) || 0;
  const covered7d = Number(row.covered_7d) || 0;
  const maxDailyFree = Number(row.max_daily_free) || 0;
  const activeWorkers30d15km = Number(row.active_workers_30d_15km) || 0;
  const activePerFree = free7d > 0 ? activeWorkers30d15km / free7d : 0;
  const coveragePercent = ordered7d > 0 ? covered7d / ordered7d * 100 : 0;
  const reasons = [];

  if (free7d > 0) {
    reasons.push({ kind: 'free-order', label: `Свободный заказ ${formatRiskNumber(free7d)} за 7 дней` });
  }

  if (ordered7d > 0 && coveragePercent < 70) {
    reasons.push({ kind: 'coverage', label: `Покрытие ${formatRiskNumber(coveragePercent)}%` });
  }

  if (free7d > 0 && activePerFree < 1) {
    reasons.push({ kind: 'active-base', label: `Актив ${formatRiskNumber(activePerFree, 1)} на свободную смену` });
  }

  if (maxDailyFree >= 3) {
    reasons.push({ kind: 'peak-day', label: `Пик ${formatRiskNumber(maxDailyFree)} свободных смен в день` });
  }

  return reasons;
}

function attentionRiskScore(row, reasons) {
  const free7d = Number(row.free_7d) || 0;
  const maxDailyFree = Number(row.max_daily_free) || 0;
  const activeWorkers30d15km = Number(row.active_workers_30d_15km) || 0;
  const activePerFree = free7d > 0 ? activeWorkers30d15km / free7d : 0;
  let score = 0;

  score += Math.min(45, free7d * 10);
  score += Math.min(25, maxDailyFree * 4);

  if (free7d > 0 && activePerFree < 0.5) {
    score += 25;
  } else if (free7d > 0 && activePerFree < 1) {
    score += 15;
  }

  if (reasons.some((reason) => reason.kind === 'coverage')) {
    score += 15;
  }

  return Math.min(100, score);
}

function attentionRiskSeverity(score) {
  if (score >= 70) {
    return 'high';
  }

  if (score >= 25) {
    return 'medium';
  }

  return 'low';
}

function compareAttentionValues(leftValue, rightValue) {
  const leftNumber = Number(leftValue);
  const rightNumber = Number(rightValue);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return String(leftValue || '').localeCompare(String(rightValue || ''));
}

function sortAttentionPoints(points, filters) {
  const sort = normalizeAttentionSort(filters.attentionSort);
  const direction = normalizeDirection(filters.attentionDirection, DEFAULT_ATTENTION_DIRECTION);
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...points].sort((left, right) => {
    const result = compareAttentionValues(left[sort], right[sort]);

    if (result !== 0) {
      return result * multiplier;
    }

    return left.title.localeCompare(right.title);
  });
}

function paginateAttentionPoints(points, filters) {
  const pageSize = ATTENTION_PAGE_SIZE;
  const totalWorkplaces = points.length;
  const totalPages = Math.max(1, Math.ceil(totalWorkplaces / pageSize));
  const page = Math.min(normalizePage(filters.attentionPage), totalPages);
  const offset = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    totalWorkplaces,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
    points: points.slice(offset, offset + pageSize)
  };
}

function mergeWorkplaceAttentionRows(filters, rows = []) {
  const allAttentionPoints = rows
    .map((row) => {
      const free7d = numberValue(row.free_7d);
      const activeWorkers30d15km = numberValue(row.active_workers_30d_15km);
      const activeWorkersPerFreeShift = free7d > 0 ? activeWorkers30d15km / free7d : 0;
      const riskReasons = attentionRiskReasons(row);
      const riskScore = attentionRiskScore(row, riskReasons);
      const point = {
        filters,
        workplaceId: String(row.workplace_id || ''),
        title: titleForPoint(row),
        clientTitle: String(row.client_title || 'Без бренда'),
        city: String(row.city || ''),
        region: String(row.region || ''),
        address: compactAddress(row),
        ordered7d: numberValue(row.ordered_7d),
        covered7d: numberValue(row.covered_7d),
        free7d,
        freeProfessions7d: attentionProfessionBreakdown(row),
        coveragePercent: percent(numberValue(row.covered_7d), numberValue(row.ordered_7d)),
        maxDailyFree: numberValue(row.max_daily_free),
        daysWithFree: numberValue(row.days_with_free),
        nearestFreeDate: String(row.nearest_free_date || ''),
        totalWorkers15km: numberValue(row.total_workers_15km),
        activeWorkers30d15km,
        totalWorkersByStatus15km: statusBreakdown(row, 'total'),
        activeWorkers30dByStatus15km: statusBreakdown(row, 'active'),
        activeWorkersPerFreeShift,
        riskReasons,
        riskScore,
        riskSeverity: attentionRiskSeverity(riskScore),
        attentionDetailDate: String(row.nearest_free_date || '')
      };

      point.attentionScore =
        point.free7d * 100 +
        point.maxDailyFree * 30 +
        point.daysWithFree * 10 +
        startsSoonBoost(filters, point.nearestFreeDate) +
        lowActiveBaseBoost(point.activeWorkersPerFreeShift);
      point.priorityReason = attentionPriorityReason(point);
      delete point.filters;

      return point;
    });
  const sortedAttentionPoints = sortAttentionPoints(allAttentionPoints, filters);
  const pagination = paginateAttentionPoints(sortedAttentionPoints, filters);

  return {
    filters,
    attentionPoints: pagination.points,
    attentionPagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalWorkplaces: pagination.totalWorkplaces,
      totalPages: pagination.totalPages,
      hasPrevious: pagination.hasPrevious,
      hasNext: pagination.hasNext
    }
  };
}

function sortLabel(sort) {
  return SORT_LABELS[sort] || SORT_LABELS[DEFAULT_SORT];
}

function heatmapLevel(amount, maxAmount) {
  const value = numberValue(amount);
  const max = numberValue(maxAmount);

  if (value <= 0 || max <= 0) {
    return 0;
  }

  const ratio = value / max;

  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }

  return 4;
}

function titleForPoint(row) {
  return String(row.workplace_title || row.technical_name || row.workplace_id || 'Без названия');
}

function compactAddress(row) {
  return [row.city, row.street].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

function emptyFilterOptions() {
  return FILTER_OPTION_KEYS.reduce((options, key) => {
    options[key] = [];
    return options;
  }, {});
}

function filterOptionsFromRows(rows) {
  const options = emptyFilterOptions();
  const seenByKey = FILTER_OPTION_KEYS.reduce((seen, key) => {
    seen[key] = new Set();
    return seen;
  }, {});

  for (const row of rows) {
    const key = String(row.filter || '');
    const value = cleanText(row.value);

    if (!Object.prototype.hasOwnProperty.call(options, key) || value === '') {
      continue;
    }

    if (key === 'orderType' && !ALLOWED_ORDER_TYPES.has(value)) {
      continue;
    }

    if (seenByKey[key].has(value)) {
      continue;
    }

    seenByKey[key].add(value);
    options[key].push(value);
  }

  return options;
}

function restrictFiltersToOptions(filters, filterOptions) {
  const restricted = { ...filters };

  for (const key of FILTER_OPTION_KEYS) {
    const allowed = new Set(filterOptions[key] || []);

    restricted[key] = filters[key].filter((value) => allowed.has(value));
  }

  return restricted;
}

function mergeWorkplaceAnalysisRows(filters, workplaceRows, dailyRows) {
  return mergeWorkplaceAnalysisRowsWithActiveGigers(filters, workplaceRows, dailyRows, new Map());
}

function mergeWorkplaceAnalysisRowsWithActiveGigers(
  filters,
  workplaceRows,
  dailyRows,
  activeGigersByWorkplace
) {
  const dateKeys = buildDateKeys(filters.from, filters.to);
  const pinnedWorkplaceIds = Array.isArray(filters.pinnedWorkplaceIds)
    ? filters.pinnedWorkplaceIds
    : [];
  const dailyByWorkplace = new Map();
  const totalsByWorkplace = new Map();
  let maxDailyAmount = 0;

  for (const row of dailyRows) {
    const workplaceId = String(row.workplace_id || '');
    const date = String(row.order_date || '');
    const amount = numberValue(row.ordered_shifts);
    const completedShifts = numberValue(row.completed_shifts);
    const slaOrderedShifts = numberValue(row.sla_ordered_shifts);
    const slaCompletedShifts = numberValue(row.sla_completed_shifts);

    if (!dailyByWorkplace.has(workplaceId)) {
      dailyByWorkplace.set(workplaceId, new Map());
    }
    if (!totalsByWorkplace.has(workplaceId)) {
      totalsByWorkplace.set(workplaceId, {
        slaOrderedShifts: 0,
        slaCompletedShifts: 0,
        slaForecastOrderedShifts: 0,
        slaForecastActiveShifts: 0
      });
    }

    dailyByWorkplace.get(workplaceId).set(date, {
      amount,
      completedShifts
    });
    const totals = totalsByWorkplace.get(workplaceId);

    if (date >= filters.currentDate) {
      totals.slaForecastOrderedShifts += slaOrderedShifts;
      totals.slaForecastActiveShifts += numberValue(row.forecast_sla_active_shifts);
    } else {
      totals.slaOrderedShifts += slaOrderedShifts;
      totals.slaCompletedShifts += slaCompletedShifts;
    }
    maxDailyAmount = Math.max(maxDailyAmount, amount);
  }

  const points = workplaceRows.map((row) => {
    const workplaceId = String(row.workplace_id || '');
    const activeDays = numberValue(row.active_days);
    const totalOrderedShifts = numberValue(row.total_ordered_shifts);
    const dailyValues = dailyByWorkplace.get(workplaceId) || new Map();
    const totals = totalsByWorkplace.get(workplaceId) || {
      slaOrderedShifts: 0,
      slaCompletedShifts: 0,
      slaForecastOrderedShifts: 0,
      slaForecastActiveShifts: 0
    };
    const heatmapDays = dateKeys.map((date) => {
      const dailyValue = dailyValues.get(date) || {};
      const amount = numberValue(dailyValue.amount);
      const completedShifts = numberValue(dailyValue.completedShifts);

      return {
        date,
        amount,
        completedShifts,
        level: heatmapLevel(amount, maxDailyAmount)
      };
    });

    return {
      workplaceId,
      title: titleForPoint(row),
      clientTitle: String(row.client_title || 'Без бренда'),
      city: String(row.city || ''),
      region: String(row.region || ''),
      address: compactAddress(row),
      totalOrderedShifts,
      activeDays,
      rangeDays: filters.rangeDays,
      pinned: pinnedWorkplaceIds.includes(workplaceId),
      stabilityPercent: percent(activeDays, filters.rangeDays),
      slaPercent: percent(totals.slaCompletedShifts, totals.slaOrderedShifts),
      slaPastPercent: percent(totals.slaCompletedShifts, totals.slaOrderedShifts),
      slaForecastPercent: percent(totals.slaForecastActiveShifts, totals.slaForecastOrderedShifts),
      slaOrderedShifts: totals.slaOrderedShifts,
      slaCompletedShifts: totals.slaCompletedShifts,
      slaForecastOrderedShifts: totals.slaForecastOrderedShifts,
      slaForecastActiveShifts: totals.slaForecastActiveShifts,
      activeGigers5km: numberValue(activeGigersByWorkplace.get(workplaceId)),
      avgDailyOrder: activeDays > 0 ? totalOrderedShifts / activeDays : 0,
      heatmapDays
    };
  });

  return {
    filters,
    context: {
      sortLabel: sortLabel(filters.sort),
      maxDailyAmount
    },
    points
  };
}

function activeGigers5kmQuery() {
  return `WITH selected_workplaces AS (
    SELECT
      _id AS workplace_id,
      location__coordinates AS workplace_coordinates,
      location__coordinates[1] AS lon,
      location__coordinates[2] AS lat
    FROM mg_workplaces
    WHERE _id IN {workplace_ids:Array(String)}
      AND length(location__coordinates) >= 2
      AND location__coordinates[1] BETWEEN -180 AND 180
      AND location__coordinates[2] BETWEEN -90 AND 90
  ),
  point_bounds AS (
    SELECT
      count() AS points,
      min(lon) AS min_lon,
      max(lon) AS max_lon,
      min(lat) AS min_lat,
      max(lat) AS max_lat,
      5000 / 111000 AS lat_margin,
      5000 / (111320 * greatest(abs(cos(((min(lat) + max(lat)) / 2) * pi() / 180)), 0.2)) AS lon_margin
    FROM selected_workplaces
  ),
  workplace_search_cells AS (
    SELECT
      sw.workplace_id AS workplace_id,
      sw.lon AS lon,
      sw.lat AS lat,
      toInt32(floor(sw.lon / 0.1)) + toInt32(lon_offsets.number) - 3 AS lon_cell,
      toInt32(floor(sw.lat / 0.1)) + toInt32(lat_offsets.number) - 3 AS lat_cell
    FROM selected_workplaces AS sw
    CROSS JOIN numbers(7) AS lon_offsets
    CROSS JOIN numbers(7) AS lat_offsets
  ),
  worker_candidates AS (
    SELECT
      worker._id AS worker_id,
      ifNull(worker.user, '') AS user_id,
      worker.location__coordinates AS worker_coordinates,
      toInt32(floor(worker.location__coordinates[1] / 0.1)) AS lon_cell,
      toInt32(floor(worker.location__coordinates[2] / 0.1)) AS lat_cell
    FROM mg_workers AS worker
    CROSS JOIN point_bounds AS bounds
    WHERE bounds.points > 0
      AND length(worker.location__coordinates) >= 2
      AND ifNull(worker.user, '') != ''
      AND ifNull(worker.deleted, 0) = 0
      AND ifNull(worker.status, '') IN ('ready', 'worked', 'booked')
      AND worker.location__coordinates[1] BETWEEN -180 AND 180
      AND worker.location__coordinates[2] BETWEEN -90 AND 90
      AND worker.location__coordinates[1] BETWEEN bounds.min_lon - bounds.lon_margin AND bounds.max_lon + bounds.lon_margin
      AND worker.location__coordinates[2] BETWEEN bounds.min_lat - bounds.lat_margin AND bounds.max_lat + bounds.lat_margin
  ),
  point_worker_pairs AS (
    SELECT
      wsc.workplace_id AS workplace_id,
      wc.worker_id AS worker_id,
      wc.user_id AS user_id
    FROM workplace_search_cells AS wsc
    INNER JOIN worker_candidates AS wc
      ON wc.lon_cell = wsc.lon_cell
      AND wc.lat_cell = wsc.lat_cell
    WHERE wc.worker_coordinates[1] BETWEEN wsc.lon - (5000 / (111320 * greatest(abs(cos(wsc.lat * pi() / 180)), 0.2))) AND wsc.lon + (5000 / (111320 * greatest(abs(cos(wsc.lat * pi() / 180)), 0.2)))
      AND wc.worker_coordinates[2] BETWEEN wsc.lat - (5000 / 111000) AND wsc.lat + (5000 / 111000)
      AND greatCircleDistance(wsc.lon, wsc.lat, wc.worker_coordinates[1], wc.worker_coordinates[2]) <= 5000
  ),
  candidate_users AS (
    SELECT DISTINCT user_id
    FROM point_worker_pairs
  ),
  active_session_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    INNER JOIN candidate_users AS cu
      ON cu.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= now() - INTERVAL 30 DAY
  )
  SELECT
    pwp.workplace_id AS workplace_id,
    uniqExact(pwp.worker_id) AS active_gigers_5km
  FROM point_worker_pairs AS pwp
  INNER JOIN active_session_users AS au ON au.user_id = pwp.user_id
  GROUP BY pwp.workplace_id
  FORMAT JSONEachRow`;
}

function uniqueWorkplaceIds(rows) {
  const ids = [];
  const seen = new Set();

  for (const row of rows) {
    const workplaceId = String(row.workplace_id || '');

    if (workplaceId === '' || seen.has(workplaceId)) {
      continue;
    }

    seen.add(workplaceId);
    ids.push(workplaceId);
  }

  return ids;
}

async function loadActiveGigers5kmByWorkplace(client, workplaceIds, activeGigersCache) {
  if (workplaceIds.length === 0) {
    return new Map();
  }

  let values = new Map();
  let staleWorkplaceIds = workplaceIds;

  if (activeGigersCache && typeof activeGigersCache.readFresh === 'function') {
    try {
      const cached = await activeGigersCache.readFresh(workplaceIds);

      values = new Map(cached.values || []);
      staleWorkplaceIds = (cached.staleWorkplaceIds || []).filter((workplaceId) =>
        workplaceIds.includes(workplaceId)
      );
    } catch (_) {
      values = new Map();
      staleWorkplaceIds = workplaceIds;
    }
  }

  if (staleWorkplaceIds.length === 0) {
    return values;
  }

  const params = {
    param_workplace_ids: serializeStringArray(staleWorkplaceIds)
  };
  const rows = await client.queryJSONEachRow(
    activeGigers5kmQuery(),
    params,
    'workplace analysis active gigers 5km'
  );
  const refreshedValues = new Map(staleWorkplaceIds.map((workplaceId) => [workplaceId, 0]));

  for (const row of rows) {
    refreshedValues.set(String(row.workplace_id || ''), numberValue(row.active_gigers_5km));
  }

  for (const [workplaceId, value] of refreshedValues) {
    values.set(workplaceId, value);
  }

  if (activeGigersCache && typeof activeGigersCache.writeValues === 'function') {
    try {
      await activeGigersCache.writeValues(refreshedValues);
    } catch (_) {
      // The dashboard can still render the freshly calculated value if local cache write fails.
    }
  }

  return values;
}

function addOptionalWhere(filters, where, params) {
  if (filters.client.length > 0) {
    where.push('c.title IN {clients:Array(String)}');
    params.param_clients = serializeStringArray(filters.client);
  }
  if (filters.city.length > 0) {
    where.push('w.address__city IN {cities:Array(String)}');
    params.param_cities = serializeStringArray(filters.city);
  }
  if (filters.region.length > 0) {
    where.push('w.address__region IN {regions:Array(String)}');
    params.param_regions = serializeStringArray(filters.region);
  }
  if (filters.profession.length > 0) {
    where.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) IN {professions:Array(String)}");
    params.param_professions = serializeStringArray(filters.profession);
  }
  if (filters.orderType.length > 0) {
    where.push('o.type IN {order_types:Array(String)}');
    params.param_order_types = serializeStringArray(filters.orderType);
  }
  if (filters.jobStatus.length > 0) {
    where.push(`o._id IN (
      SELECT DISTINCT j.source
      FROM mg_jobs AS j
      WHERE j.deleted = 0
        AND ifNull(j.source, '') != ''
        AND ifNull(j.status, '') IN {job_statuses:Array(String)}
    )`);
    params.param_job_statuses = serializeStringArray(filters.jobStatus);
  }
  if (filters.contractor.length > 0) {
    where.push("ifNull(ct.legal_name, '') IN {contractors:Array(String)}");
    params.param_contractors = serializeStringArray(filters.contractor);
  }
  if (filters.search) {
    where.push(`(
      positionCaseInsensitive(ifNull(o.workplace, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w._id, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.title, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.technical_name, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__city, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__region, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__street, ''), {search:String}) > 0
      OR positionCaseInsensitive(concat(ifNull(w.address__region, ''), ' ', ifNull(w.address__city, ''), ' ', ifNull(w.address__street, '')), {search:String}) > 0
    )`);
    params.param_search = filters.search;
  }
}

function addMetricRangeWhere(filters, where, params) {
  if (filters.slaFrom !== null) {
    where.push('metrics.sla_percent >= {sla_from:Float64}');
    params.param_sla_from = filters.slaFrom;
  }
  if (filters.slaTo !== null) {
    where.push('metrics.sla_percent <= {sla_to:Float64}');
    params.param_sla_to = filters.slaTo;
  }
  if (filters.ordersFrom !== null) {
    where.push('metrics.total_ordered_shifts >= {orders_from:Float64}');
    params.param_orders_from = filters.ordersFrom;
  }
  if (filters.ordersTo !== null) {
    where.push('metrics.total_ordered_shifts <= {orders_to:Float64}');
    params.param_orders_to = filters.ordersTo;
  }
  if (filters.stabilityFrom !== null) {
    where.push('metrics.stability_percent >= {stability_from:Float64}');
    params.param_stability_from = filters.stabilityFrom;
  }
  if (filters.stabilityTo !== null) {
    where.push('metrics.stability_percent <= {stability_to:Float64}');
    params.param_stability_to = filters.stabilityTo;
  }
}

function addPinnedWorkplaceExclusionWhere(filters, where, params) {
  if (filters.pinnedWorkplaceIds.length === 0) {
    return;
  }

  where.push('o.workplace NOT IN {pinned_workplace_ids:Array(String)}');
  params.param_pinned_workplace_ids = serializeStringArray(filters.pinnedWorkplaceIds);
}

function addPinnedWorkplaceWhere(filters, where, params) {
  if (filters.pinnedWorkplaceIds.length === 0) {
    return;
  }

  where.push('o.workplace IN {pinned_workplace_ids:Array(String)}');
  params.param_pinned_workplace_ids = serializeStringArray(filters.pinnedWorkplaceIds);
}

function addPinnedFiltersWhere(filters, where, params) {
  if (filters.profession.length > 0) {
    where.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) IN {professions:Array(String)}");
    params.param_professions = serializeStringArray(filters.profession);
  }

  addPinnedWorkplaceWhere(filters, where, params);
}

function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function serializeNumberArray(values) {
  return `[${values.map((value) => String(Number(value))).join(',')}]`;
}

function baseParamsForFilters(filters) {
  const params = {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_current_date: filters.currentDate
  };
  const where = [
    actualOrderDomainCondition('o', 'c', 'ct'),
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    "ifNull(o.workplace, '') != ''",
    'ifNull(o.amount, 0) > 0'
  ];

  if (!filters.includeDeletedOrders) {
    where.unshift('ifNull(o.deleted, 0) = 0');
  }

  if (!filters.includeHiddenOrders) {
    where.unshift('ifNull(o.is_hidden, 0) = 0');
  }

  return {
    params,
    whereSql: where.join('\n    AND ')
  };
}

function orderDimensionJoinsSql() {
  return `${actualOrderJoinsSql('o', { workplaceAlias: 'w' })}
  LEFT JOIN mg_professions AS p ON o.spec = p.spec`;
}

function jobSourceJoinSql(jobAlias, orderAlias = 'o') {
  return `INNER JOIN mg_jobs AS ${jobAlias} ON ${jobAlias}.source = ${orderAlias}._id`;
}

function successfulConfirmedJobWhereSql(jobAlias, orderAlias = 'o') {
  return `ifNull(${jobAlias}.deleted, 0) = 0
        AND (${successfulConfirmedShiftCondition(jobAlias, { pieceworkExpression: `${orderAlias}.pieceworks` })})`;
}

function forecastSlaActiveJobWhereSql(jobAlias) {
  return `ifNull(${jobAlias}.deleted, 0) = 0
        AND ifNull(${jobAlias}.status, '') IN ('booked', 'going', 'delayed', 'waiting', 'checkingin', 'inprogress', 'checkingout', 'completed', 'confirmed')`;
}

function closingJobStatusCondition(alias = 'j', options = {}) {
  return `(
        ifNull(${alias}.status, '') IN ('booked', 'going', 'inprogress', 'checkingin', 'checkingout', 'completed', 'delayed', 'waiting')
        OR (${successfulConfirmedShiftCondition(alias, options)})
      )`;
}

function attentionParamsForFilters(filters) {
  const attentionFilters = {
    ...filters,
    fromDateTime: filters.attentionFromDateTime,
    toExclusiveDateTime: filters.attentionToExclusiveDateTime,
    limit: filters.attentionLimit,
    offset: 0
  };
  const { params, whereSql } = paramsForFilters(attentionFilters);
  const activeToDate = parseDateOnly(filters.attentionFrom);
  const activeFromDate = addDaysUTC(activeToDate, -30);
  const activeToExclusive = addDaysUTC(activeToDate, 1);

  return {
    params: {
      ...params,
      param_active_from: toDateTimeParam(formatDateUTC(activeFromDate)),
      param_active_to: toDateTimeParam(formatDateUTC(activeToExclusive))
    },
    whereSql
  };
}

function paramsForFilters(filters, { excludePinned = false } = {}) {
  const base = baseParamsForFilters(filters);
  const params = {
    ...base.params,
    param_range_days: filters.rangeDays,
    param_limit: filters.limit,
    param_offset: filters.offset
  };
  const where = [base.whereSql];
  const metricWhere = [];

  addOptionalWhere(filters, where, params);
  if (excludePinned) {
    addPinnedWorkplaceExclusionWhere(filters, where, params);
  }
  addMetricRangeWhere(filters, metricWhere, params);

  return {
    params,
    whereSql: where.join('\n    AND '),
    metricWhereSql: metricWhere.length > 0 ? metricWhere.join('\n    AND ') : '1 = 1',
    hasMetricFilters: metricWhere.length > 0
  };
}

function paramsForPinnedWorkplaces(filters) {
  const base = baseParamsForFilters(filters);
  const params = {
    ...base.params,
    param_range_days: filters.rangeDays
  };
  const where = [base.whereSql];

  addPinnedFiltersWhere(filters, where, params);

  return {
    params,
    whereSql: where.join('\n    AND ')
  };
}

function filterOptionsQuery(whereSql) {
  return `WITH order_dimensions AS (
    SELECT
      ifNull(c.title, '') AS client_value,
      ifNull(w.address__city, '') AS city_value,
      ifNull(w.address__region, '') AS region_value,
      if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession_value,
      ifNull(o.type, '') AS order_type_value,
      ifNull(ct.legal_name, '') AS contractor_value
    FROM mg_orders AS o
    ${orderDimensionJoinsSql()}
    WHERE ${whereSql}
  ),
  order_filter_options AS (
    SELECT
      tupleElement(option, 1) AS filter,
      tupleElement(option, 2) AS value
    FROM order_dimensions
    ARRAY JOIN [
      tuple('client', client_value),
      tuple('city', city_value),
      tuple('region', region_value),
      tuple('profession', profession_value),
      tuple('orderType', order_type_value),
      tuple('contractor', contractor_value)
    ] AS option
    WHERE value != ''
    GROUP BY filter, value
  ),
  job_status_options AS (
    SELECT
      'jobStatus' AS filter,
      ifNull(j.status, '') AS value
    FROM mg_orders AS o
    INNER JOIN mg_jobs AS j ON j.source = o._id
    ${orderDimensionJoinsSql()}
    WHERE ${whereSql}
      AND j.deleted = 0
    GROUP BY value
    HAVING value != ''
  )
  SELECT filter, value FROM order_filter_options
  UNION ALL
  SELECT filter, value FROM job_status_options
  ORDER BY filter, value
  FORMAT JSONEachRow`;
}

function orderByForSort(sort) {
  switch (sort) {
    case 'sla':
      return 'sla_sort DESC, total_ordered_shifts DESC, workplace_id ASC';
    case 'stability':
      return 'active_days DESC, total_ordered_shifts DESC, workplace_id ASC';
    default:
      return 'total_ordered_shifts DESC, workplace_id ASC';
  }
}

function workplaceMetricsSelect(whereSql, metricWhereSql = '1 = 1') {
  return `SELECT
    metrics.workplace_id AS workplace_id,
    metrics.workplace_title AS workplace_title,
    metrics.technical_name AS technical_name,
    metrics.client_title AS client_title,
    metrics.city AS city,
    metrics.region AS region,
    metrics.street AS street,
    metrics.total_ordered_shifts AS total_ordered_shifts,
    metrics.active_days AS active_days,
    metrics.sla_ordered_shifts AS sla_ordered_shifts,
    metrics.sla_completed_shifts AS sla_completed_shifts,
    metrics.forecast_sla_ordered_shifts AS forecast_sla_ordered_shifts,
    metrics.forecast_sla_active_shifts AS forecast_sla_active_shifts,
    metrics.forecast_sla_percent AS forecast_sla_percent,
    metrics.sla_sort AS sla_sort,
    metrics.sla_percent AS sla_percent,
    metrics.stability_sort AS stability_sort,
    metrics.stability_percent AS stability_percent
  FROM (
    SELECT
      os.workplace_id AS workplace_id,
      os.workplace_title AS workplace_title,
      os.technical_name AS technical_name,
      os.client_title AS client_title,
      os.city AS city,
      os.region AS region,
      os.street AS street,
      os.total_ordered_shifts AS total_ordered_shifts,
      os.active_days AS active_days,
      os.sla_ordered_shifts AS sla_ordered_shifts,
      ifNull(sc.sla_completed_shifts, 0) AS sla_completed_shifts,
      os.forecast_sla_ordered_shifts AS forecast_sla_ordered_shifts,
      ifNull(fa.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts,
      if(os.forecast_sla_ordered_shifts > 0, ifNull(fa.forecast_sla_active_shifts, 0) / os.forecast_sla_ordered_shifts * 100, 0) AS forecast_sla_percent,
      if(os.sla_ordered_shifts > 0, ifNull(sc.sla_completed_shifts, 0) / os.sla_ordered_shifts, 0) AS sla_sort,
      if(os.sla_ordered_shifts > 0, ifNull(sc.sla_completed_shifts, 0) / os.sla_ordered_shifts * 100, 0) AS sla_percent,
      if({range_days:Float64} > 0, os.active_days / {range_days:Float64}, 0) AS stability_sort,
      if({range_days:Float64} > 0, os.active_days / {range_days:Float64} * 100, 0) AS stability_percent
    FROM (
      SELECT
        o.workplace AS workplace_id,
        ifNull(any(w.title), '') AS workplace_title,
        ifNull(any(w.technical_name), '') AS technical_name,
        ifNull(any(c.title), 'Без бренда') AS client_title,
        ifNull(any(w.address__city), '') AS city,
        ifNull(any(w.address__region), '') AS region,
        ifNull(any(w.address__street), '') AS street,
        sum(ifNull(o.amount, 0)) AS total_ordered_shifts,
        sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0 AND toDate(o.start) < {current_date:Date}) AS sla_ordered_shifts,
        sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0 AND toDate(o.start) >= {current_date:Date}) AS forecast_sla_ordered_shifts,
        countDistinct(toDate(o.start)) AS active_days
      FROM mg_orders AS o
      ${orderDimensionJoinsSql()}
      WHERE ${whereSql}
      GROUP BY workplace_id
    ) AS os
    LEFT JOIN (
      SELECT
        o.workplace AS workplace_id,
        countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_completed_shifts
      FROM mg_orders AS o
      ${orderDimensionJoinsSql()}
    ${jobSourceJoinSql('completed_job')}
    WHERE ${whereSql}
        AND toDate(o.start) < {current_date:Date}
        AND ${successfulConfirmedJobWhereSql('completed_job')}
      GROUP BY workplace_id
    ) AS sc ON os.workplace_id = sc.workplace_id
    LEFT JOIN (
      SELECT
        o.workplace AS workplace_id,
        countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS forecast_sla_active_shifts
      FROM mg_orders AS o
      ${orderDimensionJoinsSql()}
    ${jobSourceJoinSql('forecast_job')}
    WHERE ${whereSql}
        AND toDate(o.start) >= {current_date:Date}
        AND ${forecastSlaActiveJobWhereSql('forecast_job')}
      GROUP BY workplace_id
    ) AS fa ON os.workplace_id = fa.workplace_id
  ) AS metrics
  WHERE ${metricWhereSql}`;
}

function topWorkplacesSelect(whereSql, metricWhereSql = '1 = 1', sort = DEFAULT_SORT) {
  return `${workplaceMetricsSelect(whereSql, metricWhereSql)}
  ORDER BY ${orderByForSort(sort)}
  LIMIT {limit:UInt64} OFFSET {offset:UInt64}`;
}

function topWorkplacesQuery(whereSql, metricWhereSql, sort) {
  return `${topWorkplacesSelect(whereSql, metricWhereSql, sort)}
  FORMAT JSONEachRow`;
}

function pinnedWorkplacesQuery(whereSql) {
  return `${workplaceMetricsSelect(whereSql)}
  FORMAT JSONEachRow`;
}

function totalWorkplacesQuery(whereSql, metricWhereSql, hasMetricFilters) {
  if (hasMetricFilters) {
    return `SELECT
    count() AS total_workplaces
  FROM (
    ${workplaceMetricsSelect(whereSql, metricWhereSql)}
  ) AS filtered_workplaces
  FORMAT JSONEachRow`;
  }

  return `SELECT
    countDistinct(o.workplace) AS total_workplaces
  FROM mg_orders AS o
  ${orderDimensionJoinsSql()}
  WHERE ${whereSql}
  FORMAT JSONEachRow`;
}

function dailyOrdersForWorkplacesQuery(whereSql) {
  return `WITH daily_orders AS (
    SELECT
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS order_date,
      sum(ifNull(o.amount, 0)) AS ordered_shifts,
      sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_ordered_shifts
    FROM mg_orders AS o
    ${orderDimensionJoinsSql()}
    WHERE ${whereSql}
      AND o.workplace IN {workplace_ids:Array(String)}
    GROUP BY workplace_id, order_date
  ),
  daily_completed AS (
    SELECT
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS order_date,
      count() AS completed_shifts,
      countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_completed_shifts
    FROM mg_orders AS o
    ${orderDimensionJoinsSql()}
    ${jobSourceJoinSql('completed_job')}
    WHERE ${whereSql}
      AND o.workplace IN {workplace_ids:Array(String)}
      AND ${successfulConfirmedJobWhereSql('completed_job')}
    GROUP BY workplace_id, order_date
  ),
  daily_forecast_active AS (
    SELECT
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS order_date,
      count() AS forecast_active_shifts,
      countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS forecast_sla_active_shifts
    FROM mg_orders AS o
    ${orderDimensionJoinsSql()}
    ${jobSourceJoinSql('forecast_job')}
    WHERE ${whereSql}
      AND o.workplace IN {workplace_ids:Array(String)}
      AND toDate(o.start) >= {current_date:Date}
      AND ${forecastSlaActiveJobWhereSql('forecast_job')}
    GROUP BY workplace_id, order_date
  )
  SELECT
    d.workplace_id AS workplace_id,
    d.order_date AS order_date,
    d.ordered_shifts AS ordered_shifts,
    ifNull(c.completed_shifts, 0) AS completed_shifts,
    d.sla_ordered_shifts AS sla_ordered_shifts,
    ifNull(c.sla_completed_shifts, 0) AS sla_completed_shifts,
    ifNull(f.forecast_active_shifts, 0) AS forecast_active_shifts,
    ifNull(f.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts
  FROM daily_orders AS d
  LEFT JOIN daily_completed AS c
    ON d.workplace_id = c.workplace_id
    AND d.order_date = c.order_date
  LEFT JOIN daily_forecast_active AS f
    ON d.workplace_id = f.workplace_id
    AND d.order_date = f.order_date
  ORDER BY workplace_id, order_date
  FORMAT JSONEachRow`;
}

function attentionPointsQuery(whereSql) {
  return `WITH filtered_orders AS (
    SELECT
      o._id AS order_id,
      o.workplace AS workplace_id,
      toDate(o.start) AS order_date,
      ifNull(any(w.title), '') AS workplace_title,
      ifNull(any(w.technical_name), '') AS technical_name,
      ifNull(any(c.title), 'Без бренда') AS client_title,
      ifNull(any(w.address__city), '') AS city,
      ifNull(any(w.address__region), '') AS region,
      ifNull(any(w.address__street), '') AS street,
      any(w.location__coordinates) AS workplace_coordinates,
      any(o.pieceworks) AS pieceworks,
      if(
        ifNull(any(p.caption), '') = '',
        if(ifNull(any(o.spec), '') = '', 'Без специальности', any(o.spec)),
        any(p.caption)
      ) AS profession,
      sum(ifNull(o.amount, 0)) AS amount
    FROM mg_orders AS o
    ${orderDimensionJoinsSql()}
    WHERE ${whereSql}
    GROUP BY order_id, workplace_id, order_date
  ),
  covered_jobs AS (
    SELECT
      j.source AS order_id,
      count() AS covered
    FROM mg_jobs AS j
    INNER JOIN filtered_orders AS fo ON j.source = fo.order_id
    WHERE ifNull(j.deleted, 0) = 0
      AND ${closingJobStatusCondition('j', { pieceworkExpression: 'fo.pieceworks' })}
    GROUP BY order_id
  ),
  daily_point AS (
    SELECT
      fo.workplace_id AS workplace_id,
      fo.order_date AS order_date,
      any(fo.workplace_title) AS workplace_title,
      any(fo.technical_name) AS technical_name,
      any(fo.client_title) AS client_title,
      any(fo.city) AS city,
      any(fo.region) AS region,
      any(fo.street) AS street,
      any(fo.workplace_coordinates) AS workplace_coordinates,
      sum(fo.amount) AS ordered,
      sum(ifNull(cj.covered, 0)) AS covered,
      greatest(sum(fo.amount) - sum(ifNull(cj.covered, 0)), 0) AS free
    FROM filtered_orders AS fo
    LEFT JOIN covered_jobs AS cj ON fo.order_id = cj.order_id
    GROUP BY workplace_id, order_date
  ),
  profession_free_rows AS (
    SELECT
      fo.workplace_id AS workplace_id,
      fo.profession AS profession,
      sum(greatest(fo.amount - ifNull(cj.covered, 0), 0)) AS free
    FROM filtered_orders AS fo
    LEFT JOIN covered_jobs AS cj ON fo.order_id = cj.order_id
    GROUP BY fo.workplace_id, fo.profession
    HAVING free > 0
  ),
  attention_points AS (
    SELECT
      workplace_id,
      any(workplace_title) AS workplace_title,
      any(technical_name) AS technical_name,
      any(client_title) AS client_title,
      any(city) AS city,
      any(region) AS region,
      any(street) AS street,
      any(workplace_coordinates[1]) AS lon,
      any(workplace_coordinates[2]) AS lat,
      sum(ordered) AS ordered_7d,
      sum(covered) AS covered_7d,
      sum(free) AS free_7d,
      max(free) AS max_daily_free,
      countIf(free > 0) AS days_with_free,
      minIf(order_date, free > 0) AS nearest_free_date
    FROM daily_point
    WHERE workplace_id != ''
      AND length(workplace_coordinates) >= 2
      AND workplace_coordinates[1] BETWEEN -180 AND 180
      AND workplace_coordinates[2] BETWEEN -90 AND 90
    GROUP BY workplace_id
    HAVING free_7d > 0
    ORDER BY free_7d DESC, max_daily_free DESC, workplace_id ASC
    LIMIT {limit:UInt64}
  ),
  point_professions AS (
    SELECT
      workplace_id,
      groupArray(profession) AS free_professions_7d,
      groupArray(free) AS free_profession_counts_7d
    FROM (
      SELECT
        pfr.workplace_id AS workplace_id,
        pfr.profession AS profession,
        pfr.free AS free
      FROM profession_free_rows AS pfr
      INNER JOIN attention_points AS ap ON pfr.workplace_id = ap.workplace_id
      ORDER BY pfr.workplace_id ASC, pfr.free DESC, pfr.profession ASC
    )
    GROUP BY workplace_id
  )
  SELECT
    ap.workplace_id AS workplace_id,
    ap.workplace_title AS workplace_title,
    ap.technical_name AS technical_name,
    ap.client_title AS client_title,
    ap.city AS city,
    ap.region AS region,
    ap.street AS street,
    ap.lon AS lon,
    ap.lat AS lat,
    ap.ordered_7d AS ordered_7d,
    ap.covered_7d AS covered_7d,
    ap.free_7d AS free_7d,
    pp.free_professions_7d AS free_professions_7d,
    pp.free_profession_counts_7d AS free_profession_counts_7d,
    ap.max_daily_free AS max_daily_free,
    ap.days_with_free AS days_with_free,
    toString(ap.nearest_free_date) AS nearest_free_date
  FROM attention_points AS ap
  LEFT JOIN point_professions AS pp ON ap.workplace_id = pp.workplace_id
  ORDER BY free_7d DESC, max_daily_free DESC, workplace_id ASC
  FORMAT JSONEachRow`;
}

function attentionWorkerMetricsQuery() {
  return `WITH selected_points AS (
    SELECT
      tupleElement(point, 1) AS workplace_id,
      tupleElement(point, 2) AS lon,
      tupleElement(point, 3) AS lat
    FROM (
      SELECT arrayJoin(arrayZip({workplace_ids:Array(String)}, {point_lons:Array(Float64)}, {point_lats:Array(Float64)})) AS point
    )
  ),
  point_bounds AS (
    SELECT
      count() AS points,
      min(lon) AS min_lon,
      max(lon) AS max_lon,
      min(lat) AS min_lat,
      max(lat) AS max_lat,
      15000 / 111000 AS lat_margin,
      15000 / (111320 * greatest(abs(cos(((min(lat) + max(lat)) / 2) * pi() / 180)), 0.2)) AS lon_margin
    FROM selected_points
  ),
  point_search_cells AS (
    SELECT
      ap.workplace_id AS workplace_id,
      ap.lon AS lon,
      ap.lat AS lat,
      toInt32(floor(ap.lon / 0.1)) + toInt32(lon_offsets.number) - 8 AS lon_cell,
      toInt32(floor(ap.lat / 0.1)) + toInt32(lat_offsets.number) - 8 AS lat_cell
    FROM selected_points AS ap
    CROSS JOIN numbers(17) AS lon_offsets
    CROSS JOIN numbers(17) AS lat_offsets
  ),
  worker_candidates AS (
    SELECT
      ifNull(worker.user, '') AS user_id,
      ifNull(worker.status, '') AS status,
      worker.location__coordinates AS worker_coordinates,
      toInt32(floor(worker.location__coordinates[1] / 0.1)) AS lon_cell,
      toInt32(floor(worker.location__coordinates[2] / 0.1)) AS lat_cell
    FROM mg_workers AS worker
    CROSS JOIN point_bounds AS bounds
    LEFT JOIN mg_users AS u ON worker.user = u._id
    WHERE bounds.points > 0
      AND ifNull(worker.user, '') != ''
      AND ifNull(worker.deleted, 0) = 0
      AND ifNull(u.deleted, 0) = 0
      AND length(worker.location__coordinates) >= 2
      AND worker.location__coordinates[1] BETWEEN -180 AND 180
      AND worker.location__coordinates[2] BETWEEN -90 AND 90
      AND worker.location__coordinates[1] BETWEEN bounds.min_lon - bounds.lon_margin AND bounds.max_lon + bounds.lon_margin
      AND worker.location__coordinates[2] BETWEEN bounds.min_lat - bounds.lat_margin AND bounds.max_lat + bounds.lat_margin
  ),
  point_worker_pairs AS (
    SELECT
      workplace_id,
      user_id,
      status
    FROM point_search_cells AS psc
    INNER JOIN worker_candidates AS wc
      ON wc.lon_cell = psc.lon_cell
      AND wc.lat_cell = psc.lat_cell
    WHERE wc.worker_coordinates[1] BETWEEN psc.lon - (15000 / (111320 * greatest(abs(cos(psc.lat * pi() / 180)), 0.2))) AND psc.lon + (15000 / (111320 * greatest(abs(cos(psc.lat * pi() / 180)), 0.2)))
      AND wc.worker_coordinates[2] BETWEEN psc.lat - (15000 / 111000) AND psc.lat + (15000 / 111000)
      AND greatCircleDistance(psc.lon, psc.lat, wc.worker_coordinates[1], wc.worker_coordinates[2]) <= 15000
  ),
  point_worker_users AS (
    SELECT
      workplace_id,
      user_id,
      any(status) AS status
    FROM point_worker_pairs
    GROUP BY workplace_id, user_id
  ),
  candidate_users AS (
    SELECT DISTINCT user_id
    FROM point_worker_users
  ),
  active_session_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    INNER JOIN candidate_users AS cu
      ON cu.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_to:DateTime}
  ),
  point_workers AS (
    SELECT
      pwu.workplace_id AS workplace_id,
      count() AS total_workers_15km,
      countIf(au.user_id != '') AS active_workers_30d_15km,
      countIf(pwu.status = 'ready') AS total_status_ready,
      countIf(pwu.status = 'booked') AS total_status_booked,
      countIf(pwu.status = 'worked') AS total_status_worked,
      countIf(pwu.status NOT IN ('ready', 'booked', 'worked')) AS total_status_other,
      countIf(au.user_id != '' AND pwu.status = 'ready') AS active_status_ready,
      countIf(au.user_id != '' AND pwu.status = 'booked') AS active_status_booked,
      countIf(au.user_id != '' AND pwu.status = 'worked') AS active_status_worked,
      countIf(au.user_id != '' AND pwu.status NOT IN ('ready', 'booked', 'worked')) AS active_status_other
    FROM point_worker_users AS pwu
    LEFT JOIN active_session_users AS au ON au.user_id = pwu.user_id
    GROUP BY pwu.workplace_id
  )
  SELECT
    pw.workplace_id AS workplace_id,
    pw.total_workers_15km AS total_workers_15km,
    pw.active_workers_30d_15km AS active_workers_30d_15km,
    pw.total_status_ready AS total_status_ready,
    pw.total_status_booked AS total_status_booked,
    pw.total_status_worked AS total_status_worked,
    pw.total_status_other AS total_status_other,
    pw.active_status_ready AS active_status_ready,
    pw.active_status_booked AS active_status_booked,
    pw.active_status_worked AS active_status_worked,
    pw.active_status_other AS active_status_other
  FROM point_workers AS pw
  ORDER BY workplace_id ASC
  FORMAT JSONEachRow`;
}

const WORKPLACE_GIGER_METRICS = {
  'points-active-gigers-5km': {
    label: 'Гигеры 5 км',
    kind: 'points'
  },
  'attention-total-workers-15km': {
    label: 'База 15км',
    kind: 'attention',
    activeOnly: false
  },
  'attention-active-workers-30d-15km': {
    label: 'Актив 30д',
    kind: 'attention',
    activeOnly: true
  }
};
const WORKPLACE_GIGER_STATUSES = new Set(['ready', 'booked', 'worked', 'other']);

function httpError(status, message) {
  const error = new Error(message);

  error.status = status;
  return error;
}

function normalizeWorkplaceGigerDetailsInput(input = {}, now = new Date()) {
  const metric = firstGigerDetailsText(input.metric);
  const metricConfig = WORKPLACE_GIGER_METRICS[metric];

  if (!metricConfig) {
    throw httpError(400, `Unknown workplace giger metric: ${metric}`);
  }

  const workplaceId = firstGigerDetailsText(input.workplaceId);

  if (workplaceId === '') {
    throw httpError(400, 'workplaceId is required');
  }

  const page = normalizeGigerDetailsPage(input.page);
  const status = firstGigerDetailsText(input.status);
  const filters =
    metricConfig.kind === 'attention'
      ? normalizeWorkplaceAttentionFilters(input, now)
      : normalizeWorkplaceAnalysisFilters(input, now);

  return {
    source: 'workplace-analysis',
    metric,
    metricLabel: metricConfig.label,
    workplaceId,
    status: WORKPLACE_GIGER_STATUSES.has(status) ? status : '',
    page,
    pageSize: GIGER_DETAILS_PAGE_SIZE,
    offset: (page - 1) * GIGER_DETAILS_PAGE_SIZE,
    export: cleanGigerDetailsBooleanFlag(input.export),
    filters
  };
}

function gigerFullNameExpression(workerAlias = 'worker', userAlias = 'u') {
  return `coalesce(
      nullIf(trim(concat(ifNull(${userAlias}.lastname, ''), ' ', ifNull(${userAlias}.firstname, ''), ' ', ifNull(${userAlias}.middlename, ''))), ''),
      nullIf(trim(ifNull(${workerAlias}.full_name, '')), ''),
      ''
    )`;
}

function workplacePointGigerDetailsCtes() {
  return `selected_workplace AS (
    SELECT
      _id AS workplace_id,
      location__coordinates AS workplace_coordinates,
      location__coordinates[1] AS lon,
      location__coordinates[2] AS lat
    FROM mg_workplaces
    WHERE _id = {workplace_id:String}
      AND length(location__coordinates) >= 2
      AND location__coordinates[1] BETWEEN -180 AND 180
      AND location__coordinates[2] BETWEEN -90 AND 90
    LIMIT 1
  ),
  candidate_gigers AS (
    SELECT
      worker.user AS user_id,
      worker._id AS worker_id,
      ${gigerFullNameExpression('worker', 'u')} AS full_name,
      ifNull(u.phone, '') AS phone,
      ifNull(worker.status, '') AS status,
      greatCircleDistance(
        sw.lon,
        sw.lat,
        worker.location__coordinates[1],
        worker.location__coordinates[2]
      ) AS distance_m
    FROM mg_workers AS worker
    INNER JOIN selected_workplace AS sw ON 1 = 1
    LEFT JOIN mg_users AS u ON worker.user = u._id
    WHERE ifNull(worker.user, '') != ''
      AND ifNull(worker.deleted, 0) = 0
      AND ifNull(worker.status, '') IN ('ready', 'worked', 'booked')
      AND length(worker.location__coordinates) >= 2
      AND worker.location__coordinates[1] BETWEEN -180 AND 180
      AND worker.location__coordinates[2] BETWEEN -90 AND 90
      AND worker.location__coordinates[1] BETWEEN sw.lon - (5000 / (111320 * greatest(abs(cos(sw.lat * pi() / 180)), 0.2))) AND sw.lon + (5000 / (111320 * greatest(abs(cos(sw.lat * pi() / 180)), 0.2)))
      AND worker.location__coordinates[2] BETWEEN sw.lat - (5000 / 111000) AND sw.lat + (5000 / 111000)
      AND greatCircleDistance(sw.lon, sw.lat, worker.location__coordinates[1], worker.location__coordinates[2]) <= 5000
  ),
  candidate_users AS (
    SELECT DISTINCT user_id
    FROM candidate_gigers
  ),
  active_session_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    INNER JOIN candidate_users AS cu
      ON cu.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= now() - INTERVAL 30 DAY
  ),
  eligible_gigers AS (
    SELECT
      cg.user_id AS user_id,
      cg.worker_id AS worker_id,
      cg.full_name AS full_name,
      cg.phone AS phone,
      cg.status AS status
    FROM candidate_gigers AS cg
    INNER JOIN active_session_users AS au ON au.user_id = cg.user_id
  )`;
}

function workplaceAttentionGigerDetailsCtes(input) {
  const eligibleWhere = [];

  if (input.status === 'other') {
    eligibleWhere.push("cg.status NOT IN ('ready', 'booked', 'worked')");
  } else if (input.status !== '') {
    eligibleWhere.push('cg.status = {status:String}');
  }

  if (WORKPLACE_GIGER_METRICS[input.metric].activeOnly) {
    eligibleWhere.push("au.user_id != ''");
  }
  const eligibleWhereSql = eligibleWhere.length > 0
    ? `\n    WHERE ${eligibleWhere.join('\n      AND ')}`
    : '';

  return `selected_workplace AS (
    SELECT
      _id AS workplace_id,
      location__coordinates AS workplace_coordinates,
      location__coordinates[1] AS lon,
      location__coordinates[2] AS lat
    FROM mg_workplaces
    WHERE _id = {workplace_id:String}
      AND length(location__coordinates) >= 2
      AND location__coordinates[1] BETWEEN -180 AND 180
      AND location__coordinates[2] BETWEEN -90 AND 90
    LIMIT 1
  ),
  worker_rows AS (
    SELECT
      worker.user AS user_id,
      worker._id AS worker_id,
      ifNull(worker.status, '') AS status,
      worker.location__coordinates AS worker_coordinates,
      ${gigerFullNameExpression('worker', 'u')} AS full_name,
      ifNull(u.phone, '') AS phone,
      ifNull(worker.updatedAt, ifNull(worker.createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS updated_at
    FROM mg_workers AS worker
    LEFT JOIN mg_users AS u ON worker.user = u._id
    WHERE ifNull(worker.user, '') != ''
      AND ifNull(worker.deleted, 0) = 0
      AND length(worker.location__coordinates) >= 2
  ),
  latest_workers AS (
    SELECT
      user_id,
      argMax(worker_id, updated_at) AS worker_id,
      argMax(status, updated_at) AS status,
      argMax(worker_coordinates, updated_at) AS worker_coordinates,
      argMax(full_name, updated_at) AS full_name,
      argMax(phone, updated_at) AS phone
    FROM worker_rows
    GROUP BY user_id
  ),
  worker_candidates AS (
    SELECT
      lw.user_id AS user_id,
      lw.worker_id AS worker_id,
      lw.full_name AS full_name,
      lw.phone AS phone,
      lw.status AS status,
      lw.worker_coordinates AS worker_coordinates,
      sw.lon AS lon,
      sw.lat AS lat
    FROM latest_workers AS lw
    INNER JOIN selected_workplace AS sw ON 1 = 1
    WHERE length(lw.worker_coordinates) >= 2
      AND lw.worker_coordinates[1] BETWEEN -180 AND 180
      AND lw.worker_coordinates[2] BETWEEN -90 AND 90
      AND lw.worker_coordinates[1] BETWEEN sw.lon - (15000 / (111320 * greatest(abs(cos(sw.lat * pi() / 180)), 0.2))) AND sw.lon + (15000 / (111320 * greatest(abs(cos(sw.lat * pi() / 180)), 0.2)))
      AND lw.worker_coordinates[2] BETWEEN sw.lat - (15000 / 111000) AND sw.lat + (15000 / 111000)
  ),
  candidate_gigers AS (
    SELECT
      user_id,
      worker_id,
      full_name,
      phone,
      status
    FROM worker_candidates
    WHERE greatCircleDistance(lon, lat, worker_coordinates[1], worker_coordinates[2]) <= 15000
  ),
  candidate_users AS (
    SELECT DISTINCT user_id
    FROM candidate_gigers
  ),
  active_session_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    INNER JOIN candidate_users AS cu
      ON cu.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_to:DateTime}
  ),
  eligible_gigers AS (
    SELECT
      cg.user_id AS user_id,
      cg.worker_id AS worker_id,
      cg.full_name AS full_name,
      cg.phone AS phone,
      cg.status AS status
    FROM candidate_gigers AS cg
    LEFT JOIN active_session_users AS au ON au.user_id = cg.user_id${eligibleWhereSql}
  )`;
}

function workplaceGigerDetailsCtes(input) {
  if (input.metric === 'points-active-gigers-5km') {
    return workplacePointGigerDetailsCtes();
  }

  return workplaceAttentionGigerDetailsCtes(input);
}

function workplaceGigerDetailsLimitClause(input) {
  return input.export ? '' : '\n  LIMIT {limit:UInt64} OFFSET {offset:UInt64}';
}

function workplaceGigerDetailsTotalQuery(input) {
  return `WITH ${workplaceGigerDetailsCtes(input)}
  SELECT count() AS total_gigers
  FROM eligible_gigers
  FORMAT JSONEachRow`;
}

function workplaceGigerDetailsQuery(input) {
  return `WITH ${workplaceGigerDetailsCtes(input)}
  SELECT
    user_id,
    worker_id,
    full_name,
    phone,
    status
  FROM eligible_gigers
  ORDER BY full_name ASC, user_id ASC, worker_id ASC${workplaceGigerDetailsLimitClause(input)}
  FORMAT JSONEachRow`;
}

function workplaceGigerDetailsParams(input) {
  const params = {
    param_workplace_id: input.workplaceId,
    param_limit: input.pageSize,
    param_offset: input.offset
  };

  if (input.metric !== 'points-active-gigers-5km') {
    params.param_active_from = input.filters.attentionFromDateTime;
    params.param_active_to = input.filters.attentionToExclusiveDateTime;
  }

  if (input.status !== '' && input.status !== 'other') {
    params.param_status = input.status;
  }

  return params;
}

async function loadWorkplaceAnalysisGigerDetails(client, input = {}, now = new Date()) {
  const detailInput = normalizeWorkplaceGigerDetailsInput(input, now);
  const params = workplaceGigerDetailsParams(detailInput);
  const totalRows = await client.queryJSONEachRow(
    workplaceGigerDetailsTotalQuery(detailInput),
    params,
    'workplace analysis giger details total'
  );
  const gigerRows = await client.queryJSONEachRow(
    workplaceGigerDetailsQuery(detailInput),
    params,
    'workplace analysis giger details'
  );

  return mergeGigerDetails(detailInput, totalRows, gigerRows);
}

async function loadDailyRowsForWorkplaces(client, whereSql, params, workplaceIds, operation) {
  if (workplaceIds.length === 0) {
    return [];
  }

  return client.queryJSONEachRow(
    dailyOrdersForWorkplacesQuery(whereSql),
    {
      ...params,
      param_workplace_ids: serializeStringArray(workplaceIds)
    },
    operation
  );
}

function paginationFromTotal(filters, totalWorkplaces) {
  const safeTotal = numberValue(totalWorkplaces);
  const totalPages = Math.max(1, Math.ceil(safeTotal / filters.limit));
  const page = Math.min(filters.page, totalPages);

  return {
    page,
    limit: filters.limit,
    totalWorkplaces: safeTotal,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages
  };
}

function emptyPagination(filters) {
  return {
    page: filters.page,
    limit: filters.limit,
    totalWorkplaces: 0,
    totalPages: 1,
    hasPrevious: false,
    hasNext: false
  };
}

function emptyWorkplaceAnalysisDashboard(filters, filterOptions = emptyFilterOptions()) {
  return {
    ...mergeWorkplaceAnalysisRowsWithActiveGigers(filters, [], [], new Map()),
    filterOptions,
    pagination: emptyPagination(filters)
  };
}

function assertWorkplaceAnalysisSection(section) {
  if (WORKPLACE_ANALYSIS_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown workplace analysis section: ${section}`);

  error.status = 400;
  throw error;
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForWorkplaceAnalysisSection(section, filters) {
  const cacheFilters =
    section === 'attention'
      ? {
          currentDate: filters.currentDate,
          client: filters.client,
          city: filters.city,
          region: filters.region,
          profession: filters.profession,
          orderType: filters.orderType,
          jobStatus: filters.jobStatus,
          contractor: filters.contractor,
          search: filters.search,
          includeDeletedOrders: filters.includeDeletedOrders,
          includeHiddenOrders: filters.includeHiddenOrders,
          attentionFrom: filters.attentionFrom,
          attentionTo: filters.attentionTo,
          attentionPage: filters.attentionPage,
          attentionPageSize: filters.attentionPageSize,
          attentionSort: filters.attentionSort,
          attentionDirection: filters.attentionDirection,
          attentionLimit: filters.attentionLimit
        }
      : {
          from: filters.from,
          to: filters.to,
          currentDate: filters.currentDate,
          pinnedWorkplaceIds: filters.pinnedWorkplaceIds,
          client: filters.client,
          city: filters.city,
          region: filters.region,
          profession: filters.profession,
          orderType: filters.orderType,
          jobStatus: filters.jobStatus,
          contractor: filters.contractor,
          search: filters.search,
          includeDeletedOrders: filters.includeDeletedOrders,
          includeHiddenOrders: filters.includeHiddenOrders,
          sort: filters.sort,
          slaFrom: filters.slaFrom,
          slaTo: filters.slaTo,
          ordersFrom: filters.ordersFrom,
          ordersTo: filters.ordersTo,
          stabilityFrom: filters.stabilityFrom,
          stabilityTo: filters.stabilityTo,
          limit: filters.limit,
          page: filters.page
        };

  return JSON.stringify({
    board: 'workplace-analysis',
    section,
    ...(section === 'attention' ? { schemaVersion: WORKPLACE_ATTENTION_CACHE_SCHEMA_VERSION } : {}),
    filters: cacheFilters
  });
}

function datePartFromDateTime(value) {
  return String(value || '').slice(0, 10);
}

function preloadRangeForWorkplaceAnalysisSection(section, filters) {
  if (section === 'attention') {
    return {
      fromDate: filters.attentionFrom,
      toDate: datePartFromDateTime(filters.attentionToExclusiveDateTime)
    };
  }

  return {
    fromDate: filters.from,
    toDate: datePartFromDateTime(filters.toExclusiveDateTime)
  };
}

function withDataSource(dashboard, dataSource) {
  return {
    ...dashboard,
    dataSource
  };
}

function registerWorkplaceAnalysisPreloadRequest(preloadService, { section, cacheKey, filters, input, range }) {
  if (!preloadService || typeof preloadService.registerWorkplaceAnalysisRequest !== 'function') {
    return;
  }

  try {
    preloadService.registerWorkplaceAnalysisRequest({
      section,
      cacheKey,
      input: {
        ...input,
        from: filters.from,
        to: filters.to
      },
      fromDate: range.fromDate,
      toDate: range.toDate
    });
  } catch (_) {
    // Preload registration is opportunistic; the dashboard must keep the ClickHouse fallback.
  }
}

function readWorkplaceAnalysisPreload(preloadService, { section, cacheKey, range }) {
  if (!preloadService || typeof preloadService.readWorkplaceAnalysisSection !== 'function') {
    return null;
  }

  try {
    const result = preloadService.readWorkplaceAnalysisSection({
      section,
      cacheKey,
      fromDate: range.fromDate,
      toDate: range.toDate
    });

    if (!result) {
      return null;
    }

    return result.payload || result;
  } catch (_) {
    return null;
  }
}

function saveWorkplaceAnalysisPreload(preloadService, { section, cacheKey, range, payload }) {
  if (!preloadService || typeof preloadService.saveWorkplaceAnalysisSection !== 'function') {
    return;
  }

  try {
    preloadService.saveWorkplaceAnalysisSection({
      section,
      cacheKey,
      fromDate: range.fromDate,
      toDate: range.toDate,
      payload
    });
  } catch (_) {
    // Preload writes are opportunistic; the dashboard must keep serving fresh ClickHouse data.
  }
}

function orderRowsByWorkplaceIds(rows, workplaceIds) {
  const rowsByWorkplace = new Map();

  for (const row of rows) {
    const workplaceId = String(row.workplace_id || '');

    if (workplaceId !== '' && !rowsByWorkplace.has(workplaceId)) {
      rowsByWorkplace.set(workplaceId, row);
    }
  }

  return workplaceIds.map((workplaceId) => rowsByWorkplace.get(workplaceId)).filter(Boolean);
}

async function loadWorkplaceAnalysisDashboardShell(client, input = {}, now = new Date()) {
  let filters = normalizeWorkplaceAnalysisFilters(input, now);
  const base = baseParamsForFilters(filters);
  const filterOptionRows = await client.queryJSONEachRow(
    filterOptionsQuery(base.whereSql),
    base.params,
    'workplace analysis filter options'
  );
  const filterOptions = filterOptionsFromRows(filterOptionRows);

  filters = restrictFiltersToOptions(filters, filterOptions);

  return emptyWorkplaceAnalysisDashboard(filters, filterOptions);
}

async function loadWorkplaceAnalysisPointsDashboard(client, filters, options = {}) {
  const hasPinnedWorkplaces = filters.pinnedWorkplaceIds.length > 0;
  let { params, whereSql, metricWhereSql, hasMetricFilters } = paramsForFilters(filters, {
    excludePinned: hasPinnedWorkplaces
  });
  const totalRows = await client.queryJSONEachRow(
    totalWorkplacesQuery(whereSql, metricWhereSql, hasMetricFilters),
    params,
    'workplace analysis total workplaces'
  );
  const pagination = paginationFromTotal(filters, totalRows[0] && totalRows[0].total_workplaces);

  if (pagination.page !== filters.page) {
    filters = {
      ...filters,
      page: pagination.page,
      offset: (pagination.page - 1) * filters.limit
    };
    ({ params, whereSql, metricWhereSql, hasMetricFilters } = paramsForFilters(filters, {
      excludePinned: hasPinnedWorkplaces
    }));
  }

  let workplaceRows;
  let dailyRows;

  if (!hasPinnedWorkplaces) {
    workplaceRows = await client.queryJSONEachRow(
      topWorkplacesQuery(whereSql, metricWhereSql, filters.sort),
      params,
      'workplace analysis top workplaces'
    );
    dailyRows = await loadDailyRowsForWorkplaces(
      client,
      whereSql,
      params,
      uniqueWorkplaceIds(workplaceRows),
      'workplace analysis daily orders'
    );
  } else {
    const pinnedParams = paramsForPinnedWorkplaces(filters);
    const [regularRows, rawPinnedRows] = await Promise.all([
      client.queryJSONEachRow(
        topWorkplacesQuery(whereSql, metricWhereSql, filters.sort),
        params,
        'workplace analysis top workplaces'
      ),
      client.queryJSONEachRow(
        pinnedWorkplacesQuery(pinnedParams.whereSql),
        pinnedParams.params,
        'workplace analysis pinned workplaces'
      )
    ]);
    const pinnedRows = orderRowsByWorkplaceIds(rawPinnedRows, filters.pinnedWorkplaceIds);
    const pinnedRowIds = new Set(uniqueWorkplaceIds(pinnedRows));
    const regularRowsWithoutPinned = regularRows.filter(
      (row) => !pinnedRowIds.has(String(row.workplace_id || ''))
    );
    const [pinnedDailyRows, regularDailyRows] = await Promise.all([
      loadDailyRowsForWorkplaces(
        client,
        pinnedParams.whereSql,
        pinnedParams.params,
        uniqueWorkplaceIds(pinnedRows),
        'workplace analysis pinned daily orders'
      ),
      loadDailyRowsForWorkplaces(
        client,
        whereSql,
        params,
        uniqueWorkplaceIds(regularRowsWithoutPinned),
        'workplace analysis daily orders'
      )
    ]);

    workplaceRows = [...pinnedRows, ...regularRowsWithoutPinned];
    dailyRows = [...pinnedDailyRows, ...regularDailyRows];
  }

  const activeGigersByWorkplace = await loadActiveGigers5kmByWorkplace(
    client,
    uniqueWorkplaceIds(workplaceRows),
    options.activeGigersCache
  );
  const dashboard = mergeWorkplaceAnalysisRowsWithActiveGigers(
    filters,
    workplaceRows,
    dailyRows,
    activeGigersByWorkplace
  );

  return {
    ...dashboard,
    pagination
  };
}

function validAttentionCoordinate(value, min, max) {
  const number = Number(value);

  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function attentionWorkerMetricBatches(rows, batchSize = ATTENTION_WORKER_BATCH_SIZE) {
  const groups = new Map();

  for (const row of rows) {
    const workplaceId = String(row.workplace_id || '');
    const lon = validAttentionCoordinate(row.lon, -180, 180);
    const lat = validAttentionCoordinate(row.lat, -90, 90);

    if (workplaceId === '' || lon === null || lat === null) {
      continue;
    }

    const key = `${Math.floor(lon)}:${Math.floor(lat)}`;
    const group = groups.get(key) || [];

    group.push({ workplaceId, lon, lat });
    groups.set(key, group);
  }

  const batches = [];

  for (const group of groups.values()) {
    for (let index = 0; index < group.length; index += batchSize) {
      batches.push(group.slice(index, index + batchSize));
    }
  }

  return batches;
}

function mergeAttentionWorkerMetrics(rows, workerRows) {
  const workerMetricsByWorkplace = new Map(
    workerRows.map((row) => [String(row.workplace_id || ''), row])
  );

  return rows.map((row) => {
    const metrics = workerMetricsByWorkplace.get(String(row.workplace_id || '')) || {};

    return {
      ...row,
      total_workers_15km: metrics.total_workers_15km || 0,
      active_workers_30d_15km: metrics.active_workers_30d_15km || 0,
      total_status_ready: metrics.total_status_ready || 0,
      total_status_booked: metrics.total_status_booked || 0,
      total_status_worked: metrics.total_status_worked || 0,
      total_status_other: metrics.total_status_other || 0,
      active_status_ready: metrics.active_status_ready || 0,
      active_status_booked: metrics.active_status_booked || 0,
      active_status_worked: metrics.active_status_worked || 0,
      active_status_other: metrics.active_status_other || 0
    };
  });
}

async function loadAttentionWorkerMetrics(client, filters, rows) {
  const batches = attentionWorkerMetricBatches(rows);
  const workerRows = [];

  if (batches.length === 0) {
    return workerRows;
  }

  const activeToDate = parseDateOnly(filters.attentionFrom);
  const activeFromDate = addDaysUTC(activeToDate, -30);
  const activeToExclusive = addDaysUTC(activeToDate, 1);

  for (const batch of batches) {
    const rowsForBatch = await client.queryJSONEachRow(
      attentionWorkerMetricsQuery(),
      {
        param_workplace_ids: serializeStringArray(batch.map((point) => point.workplaceId)),
        param_point_lons: serializeNumberArray(batch.map((point) => point.lon)),
        param_point_lats: serializeNumberArray(batch.map((point) => point.lat)),
        param_active_from: toDateTimeParam(formatDateUTC(activeFromDate)),
        param_active_to: toDateTimeParam(formatDateUTC(activeToExclusive))
      },
      'workplace analysis attention worker metrics'
    );

    workerRows.push(...rowsForBatch);
  }

  return workerRows;
}

async function loadWorkplaceAttentionDashboard(client, filters) {
  const { params, whereSql } = attentionParamsForFilters(filters);
  const rows = await client.queryJSONEachRow(
    attentionPointsQuery(whereSql),
    params,
    'workplace analysis attention points'
  );
  const workerRows = await loadAttentionWorkerMetrics(client, filters, rows);

  return mergeWorkplaceAttentionRows(filters, mergeAttentionWorkerMetrics(rows, workerRows));
}

async function loadWorkplaceAnalysisDashboardSection(
  client,
  input = {},
  section,
  now = new Date(),
  options = {}
) {
  assertWorkplaceAnalysisSection(section);

  if (section === 'attention') {
    const filters = normalizeWorkplaceAttentionFilters(input, now);
    const cacheKey = cacheKeyForWorkplaceAnalysisSection(section, filters);
    const range = preloadRangeForWorkplaceAnalysisSection(section, filters);

    registerWorkplaceAnalysisPreloadRequest(options.preloadService, {
      section,
      cacheKey,
      filters,
      input,
      range
    });

    const preloaded = readWorkplaceAnalysisPreload(options.preloadService, { section, cacheKey, range });

    if (preloaded) {
      return withDataSource(preloaded, 'preload');
    }

    const dashboard = await readThroughCache(
      options.cache,
      cacheKey,
      () => loadWorkplaceAttentionDashboard(client, filters)
    );

    saveWorkplaceAnalysisPreload(options.preloadService, {
      section,
      cacheKey,
      range,
      payload: dashboard
    });

    return withDataSource(dashboard, 'clickhouse');
  }

  const filters = normalizeWorkplaceAnalysisFilters(input, now);
  const cacheKey = cacheKeyForWorkplaceAnalysisSection(section, filters);
  const range = preloadRangeForWorkplaceAnalysisSection(section, filters);

  registerWorkplaceAnalysisPreloadRequest(options.preloadService, {
    section,
    cacheKey,
    filters,
    input,
    range
  });

  const preloaded = readWorkplaceAnalysisPreload(options.preloadService, { section, cacheKey, range });

  if (preloaded) {
    return withDataSource(preloaded, 'preload');
  }

  const dashboard = await readThroughCache(
    options.cache,
    cacheKey,
    () => loadWorkplaceAnalysisPointsDashboard(client, filters, options)
  );

  saveWorkplaceAnalysisPreload(options.preloadService, {
    section,
    cacheKey,
    range,
    payload: dashboard
  });

  return withDataSource(dashboard, 'clickhouse');
}

async function loadWorkplaceAnalysisDashboard(client, input = {}, now = new Date(), options = {}) {
  const shell = await loadWorkplaceAnalysisDashboardShell(client, input, now);
  const pointsDashboard = await loadWorkplaceAnalysisPointsDashboard(client, shell.filters, options);

  return {
    ...pointsDashboard,
    filterOptions: shell.filterOptions
  };
}

module.exports = {
  WORKPLACE_ANALYSIS_SECTIONS,
  buildDateKeys,
  cacheKeyForWorkplaceAnalysisSection,
  heatmapLevel,
  loadActiveGigers5kmByWorkplace,
  loadWorkplaceAnalysisGigerDetails,
  loadWorkplaceAnalysisDashboard,
  loadWorkplaceAnalysisDashboardSection,
  loadWorkplaceAnalysisDashboardShell,
  mergeWorkplaceAttentionRows,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceGigerDetailsInput,
  normalizeWorkplaceAttentionFilters,
  normalizeWorkplaceAnalysisFilters
};
