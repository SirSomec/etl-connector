const { createPreloadScheduler } = require('./preloadScheduler');
const {
  SALES_PRELOAD_JOB_ID,
  WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
  createPreloadStore
} = require('./preloadStore');
const { refreshSalesByProjectPreload } = require('./preloadSalesByProject');
const { refreshWorkplaceAnalysisPreload } = require('./preloadWorkplaceAnalysis');

function createPreloadService({
  client,
  storePath,
  store = null,
  scheduler = null,
  sanitizeError,
  activeGigersCache = null
}) {
  const actualStore = store || createPreloadStore({ filePath: storePath });
  const actualScheduler = scheduler || createPreloadScheduler({
    store: actualStore,
    sanitizeError,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: ({ fromDate, toDate }) =>
        refreshSalesByProjectPreload({ client, store: actualStore, fromDate, toDate }),
      [WORKPLACE_ANALYSIS_PRELOAD_JOB_ID]: ({ fromDate, toDate }) =>
        refreshWorkplaceAnalysisPreload({
          client,
          store: actualStore,
          fromDate,
          toDate,
          activeGigersCache
        })
    }
  });
  let closePromise = null;

  actualScheduler.reschedule();

  return {
    store: actualStore,
    scheduler: actualScheduler,
    listJobs() {
      if (typeof actualStore.listJobs === 'function') {
        return actualStore.listJobs();
      }

      return [actualStore.getJob(SALES_PRELOAD_JOB_ID)].filter(Boolean);
    },
    getOverview() {
      return actualStore.getSalesByProjectOverview();
    },
    getDiagnostics() {
      return {
        salesByProject: actualStore.getSalesByProjectDiagnostics()
      };
    },
    getJob(jobId = SALES_PRELOAD_JOB_ID) {
      return actualStore.getJob(jobId);
    },
    listRuns(jobId = SALES_PRELOAD_JOB_ID, limit = 20) {
      return actualStore.listRuns(jobId, limit);
    },
    saveSchedule(input) {
      const { jobId = SALES_PRELOAD_JOB_ID, ...schedule } = input || {};
      const job = actualStore.saveJobSchedule(jobId, schedule);

      actualScheduler.reschedule();
      return job;
    },
    runJob(input) {
      return actualScheduler.runNow({
        jobId: input.jobId || SALES_PRELOAD_JOB_ID,
        trigger: 'manual',
        fromDate: input.fromDate,
        toDate: input.toDate
      });
    },
    runSalesByProject(input) {
      return this.runJob({
        jobId: SALES_PRELOAD_JOB_ID,
        fromDate: input.fromDate,
        toDate: input.toDate
      });
    },
    runWorkplaceAnalysis(input) {
      return this.runJob({
        jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
        fromDate: input.fromDate,
        toDate: input.toDate
      });
    },
    readSalesByProjectSectionRows(input) {
      if (!actualStore.hasSalesByProjectCoverage(input.fromDate, input.toDate)) {
        return null;
      }

      return actualStore.readSalesByProjectSectionRows(input);
    },
    registerWorkplaceAnalysisRequest(input) {
      if (typeof actualStore.registerDashboardPreloadRequest !== 'function') {
        return null;
      }

      return actualStore.registerDashboardPreloadRequest({
        jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
        dashboardId: 'workplace-analysis',
        section: input.section,
        cacheKey: input.cacheKey,
        input: input.input || {}
      });
    },
    readWorkplaceAnalysisSection(input) {
      if (typeof actualStore.readDashboardPreloadResult !== 'function') {
        return null;
      }

      const result = actualStore.readDashboardPreloadResult({
        jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
        section: input.section,
        cacheKey: input.cacheKey,
        fromDate: input.fromDate,
        toDate: input.toDate
      });

      return result ? result.payload : null;
    },
    saveWorkplaceAnalysisSection(input) {
      if (typeof actualStore.saveDashboardPreloadResult !== 'function') {
        return null;
      }

      return actualStore.saveDashboardPreloadResult({
        jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
        dashboardId: 'workplace-analysis',
        section: input.section,
        cacheKey: input.cacheKey,
        fromDate: input.fromDate,
        toDate: input.toDate,
        payload: input.payload
      });
    },
    close() {
      if (closePromise) {
        return closePromise;
      }

      closePromise = (async () => {
        actualScheduler.stop();

        if (typeof actualScheduler.drain === 'function') {
          await actualScheduler.drain();
        }

        await actualStore.close();
      })();

      return closePromise;
    }
  };
}

module.exports = {
  createPreloadService
};
