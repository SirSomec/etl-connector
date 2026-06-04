const { createPreloadScheduler } = require('./preloadScheduler');
const { SALES_PRELOAD_JOB_ID, createPreloadStore } = require('./preloadStore');
const { refreshSalesByProjectPreload } = require('./preloadSalesByProject');

function createPreloadService({ client, storePath, store = null, scheduler = null, sanitizeError }) {
  const actualStore = store || createPreloadStore({ filePath: storePath });
  const actualScheduler = scheduler || createPreloadScheduler({
    store: actualStore,
    sanitizeError,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: ({ fromDate, toDate }) =>
        refreshSalesByProjectPreload({ client, store: actualStore, fromDate, toDate })
    }
  });
  let closed = false;

  actualScheduler.reschedule();

  return {
    store: actualStore,
    scheduler: actualScheduler,
    getOverview() {
      return actualStore.getSalesByProjectOverview();
    },
    getJob(jobId = SALES_PRELOAD_JOB_ID) {
      return actualStore.getJob(jobId);
    },
    listRuns(jobId = SALES_PRELOAD_JOB_ID, limit = 20) {
      return actualStore.listRuns(jobId, limit);
    },
    saveSchedule(input) {
      const job = actualStore.saveJobSchedule(SALES_PRELOAD_JOB_ID, input);

      actualScheduler.reschedule();
      return job;
    },
    runSalesByProject(input) {
      return actualScheduler.runNow({
        jobId: SALES_PRELOAD_JOB_ID,
        trigger: 'manual',
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
    close() {
      if (closed) {
        return;
      }

      closed = true;
      actualScheduler.stop();
      actualStore.close();
    }
  };
}

module.exports = {
  createPreloadService
};
