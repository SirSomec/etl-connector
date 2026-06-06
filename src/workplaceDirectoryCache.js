const fs = require('node:fs/promises');
const path = require('node:path');

const { writeFileAtomically } = require('./atomicFile');

const WORKPLACE_DIRECTORY_CACHE_VERSION = 1;
const WORKPLACE_DIRECTORY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WORKPLACE_DIRECTORY_CACHE_PATH = path.join(
  process.cwd(),
  'data',
  'workplace-directory-cache.json'
);
const DEFAULT_SUGGESTION_LIMIT = 20;
const MIN_SUGGESTION_QUERY_LENGTH = 5;

function workplaceDirectoryCachePathFromEnv(env = process.env) {
  return env.WORKPLACE_DIRECTORY_CACHE_PATH || DEFAULT_WORKPLACE_DIRECTORY_CACHE_PATH;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function normalizeSearchText(value) {
  return cleanText(value).toLocaleLowerCase('ru-RU');
}

function compactAddress(parts) {
  return parts.map(cleanText).filter(Boolean).join(', ');
}

function workplaceDirectoryQuery() {
  return `SELECT
    w._id AS workplace_id,
    ifNull(w.title, '') AS workplace_title,
    ifNull(w.technical_name, '') AS technical_name,
    ifNull(c.title, '') AS client_title,
    ifNull(w.address__region, '') AS region,
    ifNull(w.address__city, '') AS city,
    ifNull(w.address__street, '') AS street
  FROM mg_workplaces AS w
  LEFT JOIN mg_clients AS c ON w.client = c._id
  WHERE ifNull(w._id, '') != ''
  ORDER BY workplace_title ASC, city ASC, street ASC, workplace_id ASC
  FORMAT JSONEachRow`;
}

function publicSuggestion(entry) {
  return {
    workplaceId: entry.workplaceId,
    title: entry.title,
    technicalName: entry.technicalName,
    clientTitle: entry.clientTitle,
    region: entry.region,
    city: entry.city,
    street: entry.street,
    address: entry.address
  };
}

function normalizeWorkplaceDirectoryRows(rows) {
  const entries = [];
  const seen = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const workplaceId = cleanText(row.workplace_id || row.workplaceId || row._id);

    if (workplaceId === '' || seen.has(workplaceId)) {
      continue;
    }

    seen.add(workplaceId);

    const title = cleanText(row.workplace_title || row.title);
    const technicalName = cleanText(row.technical_name || row.technicalName);
    const clientTitle = cleanText(row.client_title || row.clientTitle);
    const region = cleanText(row.region || row.address__region);
    const city = cleanText(row.city || row.address__city);
    const street = cleanText(row.street || row.address__street);
    const address = compactAddress([region, city, street]);
    const searchText = normalizeSearchText([
      workplaceId,
      title,
      technicalName,
      clientTitle,
      region,
      city,
      street,
      address
    ].join(' '));

    entries.push({
      workplaceId,
      title,
      technicalName,
      clientTitle,
      region,
      city,
      street,
      address,
      searchText
    });
  }

  return entries;
}

function rankSuggestion(entry, needle) {
  const id = normalizeSearchText(entry.workplaceId);
  const title = normalizeSearchText(entry.title);
  const technicalName = normalizeSearchText(entry.technicalName);
  const address = normalizeSearchText(entry.address);

  if (id === needle) {
    return 0;
  }
  if (id.startsWith(needle)) {
    return 1;
  }
  if (title.startsWith(needle)) {
    return 2;
  }
  if (technicalName.startsWith(needle)) {
    return 3;
  }
  if (address.includes(needle)) {
    return 4;
  }

  return 5;
}

function filterWorkplaceDirectorySuggestions(entries, query, limit = DEFAULT_SUGGESTION_LIMIT) {
  const needle = normalizeSearchText(query);

  if (needle.length < MIN_SUGGESTION_QUERY_LENGTH) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(50, Number(limit) || DEFAULT_SUGGESTION_LIMIT));

  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => normalizeSearchText(entry.searchText).includes(needle))
    .map((entry, index) => ({
      entry,
      index,
      rank: rankSuggestion(entry, needle)
    }))
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }

      return left.index - right.index;
    })
    .slice(0, safeLimit)
    .map((item) => publicSuggestion(item.entry));
}

function normalizeCache(data) {
  if (!data || data.version !== WORKPLACE_DIRECTORY_CACHE_VERSION || !Array.isArray(data.entries)) {
    return {
      version: WORKPLACE_DIRECTORY_CACHE_VERSION,
      updatedAt: '',
      entries: []
    };
  }

  return data;
}

async function readCacheFile(filePath) {
  if (!filePath) {
    return normalizeCache();
  }

  try {
    const body = await fs.readFile(filePath, 'utf8');

    return normalizeCache(JSON.parse(body));
  } catch (_) {
    return normalizeCache();
  }
}

async function writeCacheFile(filePath, entries, updatedAt) {
  if (!filePath) {
    return;
  }

  const data = {
    version: WORKPLACE_DIRECTORY_CACHE_VERSION,
    updatedAt: updatedAt.toISOString(),
    entries: entries.map(publicSuggestion)
  };

  await writeFileAtomically(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function timestampFromNowFn(now) {
  const value = now();

  return value instanceof Date ? value.getTime() : Number(value);
}

function createWorkplaceDirectoryCache(options = {}) {
  const filePath = Object.prototype.hasOwnProperty.call(options, 'filePath')
    ? options.filePath
    : workplaceDirectoryCachePathFromEnv(options.env);
  const now = options.now || (() => Date.now());
  const ttlMs = options.ttlMs || WORKPLACE_DIRECTORY_CACHE_TTL_MS;
  let loaded = false;
  let loadPromise = null;
  let refreshPromise = null;
  let state = {
    entries: [],
    updatedAtMs: 0
  };

  function currentMs() {
    const value = timestampFromNowFn(now);

    return Number.isFinite(value) ? value : Date.now();
  }

  function currentDate() {
    return new Date(currentMs());
  }

  function isFresh() {
    return state.entries.length > 0 && currentMs() - state.updatedAtMs < ttlMs;
  }

  async function loadFromFile() {
    if (loaded) {
      return;
    }

    if (loadPromise) {
      await loadPromise;
      return;
    }

    loadPromise = (async () => {
      const data = await readCacheFile(filePath);
      const updatedAtMs = Date.parse(data.updatedAt);

      state = {
        entries: normalizeWorkplaceDirectoryRows(data.entries),
        updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0
      };
      loaded = true;
    })();

    await loadPromise;
  }

  async function refresh(client) {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      const rows = await client.queryJSONEachRow(
        workplaceDirectoryQuery(),
        {},
        'workplace directory refresh'
      );
      const entries = normalizeWorkplaceDirectoryRows(rows);
      const updatedAt = currentDate();

      state = {
        entries,
        updatedAtMs: updatedAt.getTime()
      };
      loaded = true;
      await writeCacheFile(filePath, entries, updatedAt);

      return entries;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  function refreshInBackground(client) {
    refresh(client).catch(() => {});
  }

  return {
    async refreshIfStale(client) {
      await loadFromFile();

      if (isFresh()) {
        return state.entries;
      }

      return refresh(client);
    },

    async suggest(client, query, limit = DEFAULT_SUGGESTION_LIMIT) {
      if (normalizeSearchText(query).length < MIN_SUGGESTION_QUERY_LENGTH) {
        return [];
      }

      await loadFromFile();

      if (!isFresh()) {
        if (state.entries.length > 0) {
          refreshInBackground(client);
        } else {
          await refresh(client);
        }
      }

      return filterWorkplaceDirectorySuggestions(state.entries, query, limit);
    },

    async getById(client, workplaceId) {
      const id = cleanText(workplaceId);

      if (id === '') {
        return null;
      }

      await loadFromFile();

      if (!isFresh()) {
        if (state.entries.length > 0) {
          refreshInBackground(client);
        } else {
          await refresh(client);
        }
      }

      const entry = state.entries.find((item) => item.workplaceId === id);

      return entry ? publicSuggestion(entry) : null;
    },

    scheduleRefresh(client, { intervalMs = WORKPLACE_DIRECTORY_CACHE_TTL_MS } = {}) {
      const run = () => {
        this.refreshIfStale(client).catch(() => {});
      };
      const initialTimer = setTimeout(run, 0);
      const intervalTimer = setInterval(run, intervalMs);

      if (typeof initialTimer.unref === 'function') {
        initialTimer.unref();
      }
      if (typeof intervalTimer.unref === 'function') {
        intervalTimer.unref();
      }

      return {
        stop() {
          clearTimeout(initialTimer);
          clearInterval(intervalTimer);
        }
      };
    }
  };
}

module.exports = {
  DEFAULT_WORKPLACE_DIRECTORY_CACHE_PATH,
  WORKPLACE_DIRECTORY_CACHE_TTL_MS,
  createWorkplaceDirectoryCache,
  filterWorkplaceDirectorySuggestions,
  normalizeWorkplaceDirectoryRows,
  workplaceDirectoryCachePathFromEnv
};
