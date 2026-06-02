const fs = require('node:fs/promises');
const path = require('node:path');

const DASHBOARD_SECTION_CACHE_VERSION = 1;
const DASHBOARD_SECTION_CACHE_TTL_MS = 10 * 60 * 60 * 1000;
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

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;

  await fs.writeFile(tempPath, `${JSON.stringify(data)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function createDashboardSectionCache({
  ttlMs = DASHBOARD_SECTION_CACHE_TTL_MS,
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

  async function persistEntries() {
    if (!filePath) {
      return;
    }

    await writeCacheFile(filePath, entries);
  }

  return {
    async getOrLoad(key, loader) {
      await loadFileEntries();

      const current = now();
      const cached = entries.get(key);

      if (cached && cached.value !== undefined && cached.expiresAt > current) {
        return cached.value;
      }

      if (cached && cached.promise) {
        return cached.promise;
      }

      const promise = Promise.resolve()
        .then(loader)
        .then(
          async (value) => {
            entries.set(key, {
              value,
              expiresAt: now() + ttlMs
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
        expiresAt: current + ttlMs
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
  DASHBOARD_SECTION_CACHE_TTL_MS,
  createDashboardSectionCache,
  dashboardSectionCachePathFromEnv
};
