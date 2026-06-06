const fs = require('node:fs/promises');
const path = require('node:path');

const { writeFileAtomically } = require('./atomicFile');

const DASHBOARD_SECTION_CACHE_VERSION = 1;
const DEFAULT_DASHBOARD_SECTION_CACHE_PATH = path.join(
  process.cwd(),
  'data',
  'dashboard-section-cache.json'
);

function dashboardSectionCachePathFromEnv(env = process.env) {
  return env.DASHBOARD_SECTION_CACHE_PATH || DEFAULT_DASHBOARD_SECTION_CACHE_PATH;
}

function normalizeCache(data) {
  if (!data || data.version !== DASHBOARD_SECTION_CACHE_VERSION || typeof data.entries !== 'object') {
    return {
      version: DASHBOARD_SECTION_CACHE_VERSION,
      entries: {}
    };
  }

  return data;
}

async function readCacheFile(filePath) {
  try {
    const body = await fs.readFile(filePath, 'utf8');

    return normalizeCache(JSON.parse(body));
  } catch (_) {
    return normalizeCache();
  }
}

async function writeCacheFile(filePath, entries) {
  const data = {
    version: DASHBOARD_SECTION_CACHE_VERSION,
    entries: {}
  };

  for (const [key, entry] of entries) {
    if (!entry || entry.value === undefined || !Number.isFinite(entry.expiresAt)) {
      continue;
    }

    data.entries[key] = {
      value: entry.value,
      expiresAt: new Date(entry.expiresAt).toISOString()
    };
  }

  await writeFileAtomically(filePath, `${JSON.stringify(data)}\n`, 'utf8');
}

function timeMs(value) {
  const number = value instanceof Date ? value.getTime() : Number(value);

  return Number.isFinite(number) ? number : Date.now();
}

function endOfUtcDayMs(timestamp) {
  const date = new Date(timeMs(timestamp));

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function createDashboardSectionCache({
  now = () => Date.now(),
  filePath = null
} = {}) {
  const entries = new Map();
  let fileLoaded = false;
  let fileLoadPromise = null;

  async function loadFileEntries() {
    if (!filePath || fileLoaded) {
      return;
    }

    if (fileLoadPromise) {
      await fileLoadPromise;
      return;
    }

    fileLoadPromise = (async () => {
      const data = await readCacheFile(filePath);

      for (const [key, entry] of Object.entries(data.entries)) {
        const expiresAt = Date.parse(entry && entry.expiresAt);

        if (Number.isFinite(expiresAt)) {
          entries.set(key, {
            value: entry.value,
            expiresAt
          });
        }
      }

      fileLoaded = true;
    })();

    await fileLoadPromise;
  }

  function pruneExpiredEntries(current) {
    let changed = false;

    for (const [key, entry] of entries) {
      if (entry && entry.value !== undefined && Number.isFinite(entry.expiresAt) && entry.expiresAt <= current) {
        entries.delete(key);
        changed = true;
      }
    }

    return changed;
  }

  async function persistEntries() {
    if (!filePath) {
      return;
    }

    await writeCacheFile(filePath, entries);
  }

  return {
    async pruneExpired(currentValue = now()) {
      await loadFileEntries();

      const pruned = pruneExpiredEntries(timeMs(currentValue));

      if (pruned) {
        await persistEntries();
      }

      return pruned;
    },

    async getOrLoad(key, loader) {
      await loadFileEntries();

      const current = timeMs(now());
      const pruned = pruneExpiredEntries(current);
      const cached = entries.get(key);

      if (cached && cached.value !== undefined && cached.expiresAt > current) {
        if (pruned) {
          await persistEntries();
        }

        return cached.value;
      }

      if (cached && cached.promise) {
        if (pruned) {
          await persistEntries();
        }

        return cached.promise;
      }

      if (pruned) {
        await persistEntries();
      }

      const promise = Promise.resolve()
        .then(loader)
        .then(
          async (value) => {
            entries.set(key, {
              value,
              expiresAt: endOfUtcDayMs(now())
            });

            await persistEntries();

            return value;
          },
          (error) => {
            entries.delete(key);
            throw error;
          }
        );

      entries.set(key, {
        promise,
        expiresAt: endOfUtcDayMs(current)
      });

      return promise;
    },

    clear() {
      entries.clear();
      fileLoaded = false;
      fileLoadPromise = null;
    }
  };
}

module.exports = {
  endOfUtcDayMs,
  createDashboardSectionCache,
  dashboardSectionCachePathFromEnv
};
