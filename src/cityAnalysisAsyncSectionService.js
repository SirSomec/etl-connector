function createCityAnalysisAsyncSectionService({ client = null, logger = console, maxConcurrentRefreshes = 1 } = {}) {
  const entries = new Map();
  const queue = [];
  let active = 0;
  const limit = Math.max(1, Number(maxConcurrentRefreshes) || 1);

  function runNext() {
    while (active < limit && queue.length > 0) {
      const task = queue.shift();
      active += 1;

      Promise.resolve().then(task.load)
        .then((value) => entries.set(task.key, { state: 'ready', value }))
        .catch((error) => {
          entries.set(task.key, { state: 'failed', error });
          if (logger && typeof logger.warn === 'function') {
            logger.warn(`City analysis background section failed: ${error && error.message}`);
          }
        })
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  }

  function request(key, load) {
    const current = entries.get(key);

    if (current && (current.state === 'ready' || current.state === 'loading')) {
      return current;
    }

    const loading = { state: 'loading' };
    entries.set(key, loading);
    queue.push({ key, load });
    runNext();
    return loading;
  }

  return { client, request };
}

module.exports = { createCityAnalysisAsyncSectionService };
