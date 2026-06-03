const fs = require('node:fs/promises');
const path = require('node:path');

const { writeFileAtomically } = require('./atomicFile');

const ACTIVE_GIGERS_CACHE_VERSION = 1;
const ACTIVE_GIGERS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ACTIVE_GIGERS_CACHE_PATH = path.join(
  process.cwd(),
  'data',
  'workplace-active-gigers-cache.json'
);

function cachePathFromEnv(env = process.env) {
  return env.WORKPLACE_ACTIVE_GIGERS_CACHE_PATH || DEFAULT_ACTIVE_GIGERS_CACHE_PATH;
}

function normalizeCache(data) {
  if (!data || data.version !== ACTIVE_GIGERS_CACHE_VERSION || typeof data.entries !== 'object') {
    return {
      version: ACTIVE_GIGERS_CACHE_VERSION,
      entries: {}
    };
  }

  return data;
}

async function readCacheFile(filePath) {
  try {
    const body = await fs.readFile(filePath, 'utf8');

    return normalizeCache(JSON.parse(body));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return normalizeCache();
    }

    return normalizeCache();
  }
}

async function writeCacheFile(filePath, data) {
  await writeFileAtomically(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function createWorkplaceActiveGigersCache(options = {}) {
  const filePath = options.filePath || cachePathFromEnv(options.env);
  const nowFn = options.nowFn || (() => new Date());

  return {
    async readFresh(workplaceIds) {
      const cache = await readCacheFile(filePath);
      const nowMs = nowFn().getTime();
      const values = new Map();
      const staleWorkplaceIds = [];

      for (const workplaceId of workplaceIds) {
        const key = String(workplaceId || '');
        const entry = cache.entries[key];
        const updatedAtMs = entry ? Date.parse(entry.updatedAt) : Number.NaN;
        const activeGigers5km = entry ? Number(entry.activeGigers5km) : Number.NaN;

        if (
          entry &&
          Number.isFinite(updatedAtMs) &&
          nowMs - updatedAtMs < ACTIVE_GIGERS_CACHE_TTL_MS &&
          Number.isFinite(activeGigers5km)
        ) {
          values.set(key, activeGigers5km);
        } else {
          staleWorkplaceIds.push(key);
        }
      }

      return {
        values,
        staleWorkplaceIds
      };
    },

    async writeValues(valuesByWorkplace, updatedAt = nowFn()) {
      const cache = await readCacheFile(filePath);
      const updatedAtIso = updatedAt.toISOString();

      for (const [workplaceId, value] of valuesByWorkplace) {
        cache.entries[String(workplaceId)] = {
          activeGigers5km: Math.max(0, Number(value) || 0),
          updatedAt: updatedAtIso
        };
      }

      await writeCacheFile(filePath, cache);
    }
  };
}

module.exports = {
  ACTIVE_GIGERS_CACHE_TTL_MS,
  createWorkplaceActiveGigersCache
};
