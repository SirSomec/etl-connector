const {
  WORKPLACE_ANALYSIS_PRELOAD_JOB_ID
} = require('./preloadStore');
const {
  cacheKeyForWorkplaceAnalysisSection,
  loadWorkplaceAnalysisDashboardSection
} = require('./workplaceAnalysisDashboard');

const WORKPLACE_ANALYSIS_DASHBOARD_ID = 'workplace-analysis';
const WORKPLACE_ANALYSIS_PRELOAD_SECTIONS = ['points', 'attention'];
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== value) {
    throw new Error(`Invalid date: ${value}`);
  }

  return date;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function inclusiveToDateFromExclusive(toDate) {
  return formatDateUTC(addDaysUTC(parseDateOnly(toDate), -1));
}

function buildWorkplaceAnalysisPreloadInput({ input = {}, fromDate, toDate }) {
  return {
    ...input,
    from: fromDate,
    to: inclusiveToDateFromExclusive(toDate)
  };
}

function defaultWorkplaceAnalysisRequests() {
  return WORKPLACE_ANALYSIS_PRELOAD_SECTIONS.map((section) => ({
    jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
    dashboardId: WORKPLACE_ANALYSIS_DASHBOARD_ID,
    section,
    cacheKey: '',
    input: {}
  }));
}

async function refreshWorkplaceAnalysisPreload({
  client,
  store,
  fromDate,
  toDate,
  now = new Date(),
  activeGigersCache = null,
  loadSection = loadWorkplaceAnalysisDashboardSection,
  cacheKeyForSection = cacheKeyForWorkplaceAnalysisSection
}) {
  if (typeof loadSection !== 'function') {
    throw new Error('Workplace analysis preload requires a section loader');
  }
  if (typeof cacheKeyForSection !== 'function') {
    throw new Error('Workplace analysis preload requires a cache key builder');
  }

  const knownRequests = typeof store.listDashboardPreloadRequests === 'function'
    ? store.listDashboardPreloadRequests(WORKPLACE_ANALYSIS_PRELOAD_JOB_ID, 200)
    : [];
  const requests = knownRequests.length > 0 ? knownRequests : defaultWorkplaceAnalysisRequests();
  let rowsWritten = 0;

  for (const request of requests) {
    const section = request.section;
    const input = buildWorkplaceAnalysisPreloadInput({
      input: request.input || {},
      fromDate,
      toDate
    });
    const dashboard = await loadSection(client, input, section, now, {
      activeGigersCache,
      cache: null
    });
    const cacheKey = cacheKeyForSection(section, dashboard.filters || input);

    if (typeof store.registerDashboardPreloadRequest === 'function') {
      store.registerDashboardPreloadRequest({
        jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
        dashboardId: WORKPLACE_ANALYSIS_DASHBOARD_ID,
        section,
        cacheKey,
        input
      });
    }

    store.saveDashboardPreloadResult({
      jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
      dashboardId: WORKPLACE_ANALYSIS_DASHBOARD_ID,
      section,
      cacheKey,
      fromDate,
      toDate,
      payload: dashboard
    });
    rowsWritten += 1;
  }

  return { rowsWritten };
}

module.exports = {
  WORKPLACE_ANALYSIS_DASHBOARD_ID,
  WORKPLACE_ANALYSIS_PRELOAD_SECTIONS,
  buildWorkplaceAnalysisPreloadInput,
  refreshWorkplaceAnalysisPreload
};
