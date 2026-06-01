const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 12;
const ALLOWED_LIMITS = new Set([10, 12, 20, 50]);
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);

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

function firstDayOfMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLimit(value) {
  const limit = Number(value);

  return Number.isInteger(limit) && ALLOWED_LIMITS.has(limit) ? limit : DEFAULT_LIMIT;
}

function normalizeWorkplaceAnalysisFilters(input = {}, now = new Date()) {
  const today = parseDateOnly(formatDateUTC(now));
  const defaultFromDate = firstDayOfMonthUTC(today);
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  let fromDate = requestedFrom || defaultFromDate;
  let toDate = requestedTo || today;

  if (fromDate.getTime() > toDate.getTime()) {
    fromDate = defaultFromDate;
    toDate = today;
  }

  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(addDaysUTC(toDate, 1));
  const orderType = cleanText(input.orderType);

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    rangeDays: buildDateKeys(from, to).length,
    client: cleanText(input.client),
    city: cleanText(input.city),
    region: cleanText(input.region),
    profession: cleanText(input.profession),
    orderType: ALLOWED_ORDER_TYPES.has(orderType) ? orderType : '',
    contractor: cleanText(input.contractor),
    search: cleanText(input.search),
    limit: normalizeLimit(input.limit)
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

function mergeWorkplaceAnalysisRows(filters, workplaceRows, dailyRows) {
  const dateKeys = buildDateKeys(filters.from, filters.to);
  const dailyByWorkplace = new Map();
  let maxDailyAmount = 0;

  for (const row of dailyRows) {
    const workplaceId = String(row.workplace_id || '');
    const date = String(row.order_date || '');
    const amount = numberValue(row.ordered_shifts);

    if (!dailyByWorkplace.has(workplaceId)) {
      dailyByWorkplace.set(workplaceId, new Map());
    }

    dailyByWorkplace.get(workplaceId).set(date, amount);
    maxDailyAmount = Math.max(maxDailyAmount, amount);
  }

  const points = workplaceRows.map((row) => {
    const workplaceId = String(row.workplace_id || '');
    const activeDays = numberValue(row.active_days);
    const totalOrderedShifts = numberValue(row.total_ordered_shifts);
    const dailyAmounts = dailyByWorkplace.get(workplaceId) || new Map();
    const heatmapDays = dateKeys.map((date) => {
      const amount = numberValue(dailyAmounts.get(date));

      return {
        date,
        amount,
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
      stabilityPercent: percent(activeDays, filters.rangeDays),
      avgDailyOrder: activeDays > 0 ? totalOrderedShifts / activeDays : 0,
      heatmapDays
    };
  });

  return {
    filters,
    context: {
      sortLabel: 'Сначала крупнейшие по заказу',
      maxDailyAmount
    },
    points
  };
}

async function loadWorkplaceAnalysisDashboard() {
  throw new Error('loadWorkplaceAnalysisDashboard is not implemented yet');
}

module.exports = {
  buildDateKeys,
  heatmapLevel,
  loadWorkplaceAnalysisDashboard,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceAnalysisFilters
};
