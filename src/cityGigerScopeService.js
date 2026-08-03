const { createCityGigerScopeStore } = require('./cityGigerScopeStore');

const CITY_GIGER_SCOPE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function scopeIsFresh(metadata, now = new Date()) {
  if (!metadata || metadata.state !== 'ready') return false;
  const refreshedAt = new Date(metadata.refreshedAt).getTime();
  return Number.isFinite(refreshedAt) && now.getTime() - refreshedAt < CITY_GIGER_SCOPE_MAX_AGE_MS;
}

function createCityGigerScopeService({ client, loadRows, storePath, now = () => new Date(), logger = console } = {}) {
  if (!client || typeof client.queryJSONEachRow !== 'function') {
    throw new Error('City giger scope service requires a ClickHouse client');
  }
  if (typeof loadRows !== 'function') {
    throw new Error('City giger scope service requires a scope loader');
  }

  const store = createCityGigerScopeStore({ filePath: storePath, now });
  const running = new Map();

  async function refresh(scopeKey, input) {
    if (running.has(scopeKey)) return running.get(scopeKey);
    store.markLoading(scopeKey, input);
    const promise = Promise.resolve().then(async () => {
      try {
        const rows = await loadRows(client, input);
        return store.saveReady(scopeKey, input, rows);
      } catch (error) {
        store.saveFailure(scopeKey, input, error && error.message);
        if (logger && typeof logger.warn === 'function') logger.warn(`City giger scope refresh failed: ${error && error.message}`);
        return null;
      } finally {
        running.delete(scopeKey);
      }
    });
    running.set(scopeKey, promise);
    return promise;
  }

  function request(scopeKey, input) {
    const meta = store.metadata(scopeKey);
    if (!scopeIsFresh(meta, now())) {
      void refresh(scopeKey, input);
      return { state: 'loading', metadata: meta };
    }
    return { state: 'ready', metadata: meta };
  }

  function readPage(scopeKey, offset, limit) {
    return store.readPage(scopeKey, offset, limit);
  }

  function refreshKnownScopes() {
    return Promise.allSettled(store.listReadyInputs().map(({ key, input }) => refresh(key, input)));
  }

  return {
    request,
    readPage,
    refreshKnownScopes,
    close: () => store.close()
  };
}

module.exports = { CITY_GIGER_SCOPE_MAX_AGE_MS, createCityGigerScopeService, scopeIsFresh };
