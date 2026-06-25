function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function createScheduledReportService({ store, scheduler }) {
  let closePromise = null;

  scheduler.reschedule();

  return {
    listReports(...args) {
      return store.listReports(...args);
    },
    getReport(...args) {
      return store.getReport(...args);
    },
    createReport(input) {
      return store.createReport(input);
    },
    updateReport(id, input) {
      const saved = store.updateReport(id, input);

      if (hasOwn(input, 'enabled')) {
        scheduler.reschedule();
      }

      return saved;
    },
    listSchedules(...args) {
      return store.listSchedules(...args);
    },
    getSchedule(...args) {
      return store.getSchedule(...args);
    },
    createSchedule(input) {
      const saved = store.createSchedule(input);

      scheduler.reschedule();
      return saved;
    },
    updateSchedule(id, input) {
      const saved = store.updateSchedule(id, input);

      scheduler.reschedule();
      return saved;
    },
    listRuns(...args) {
      return store.listRuns(...args);
    },
    getRun(...args) {
      return store.getRun(...args);
    },
    getMailSettings(...args) {
      return store.getMailSettings(...args);
    },
    saveMailSettings(input) {
      return store.saveMailSettings(input);
    },
    pruneOldRuns(days) {
      return store.pruneOldRuns(days);
    },
    runSchedule(input) {
      return scheduler.runNow(input);
    },
    close() {
      if (!closePromise) {
        closePromise = Promise.resolve()
          .then(() => scheduler.stop())
          .then(() => scheduler.drain())
          .then(() => store.close());
      }

      return closePromise;
    }
  };
}

module.exports = { createScheduledReportService };
