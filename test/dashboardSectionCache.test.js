const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createDashboardSectionCache,
  dashboardSectionCachePathFromEnv
} = require('../src/dashboardSectionCache');

test('dashboard section cache keeps values only until the end of the UTC day', async () => {
  let timestamp = Date.parse('2026-06-15T10:00:00.000Z');
  let loads = 0;
  const cache = createDashboardSectionCache({ now: () => timestamp });

  const first = await cache.getOrLoad('key', async () => ({ value: ++loads }));
  const second = await cache.getOrLoad('key', async () => ({ value: ++loads }));

  timestamp = Date.parse('2026-06-15T23:59:59.999Z');
  const beforeMidnight = await cache.getOrLoad('key', async () => ({ value: ++loads }));

  timestamp = Date.parse('2026-06-16T00:00:00.000Z');

  const third = await cache.getOrLoad('key', async () => ({ value: ++loads }));

  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.deepEqual(beforeMidnight, { value: 1 });
  assert.deepEqual(third, { value: 2 });
});

test('dashboard section cache persists fresh values across cache recreation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-section-cache-'));
  const filePath = path.join(tempDir, 'cache.json');
  let loads = 0;

  try {
    const firstCache = createDashboardSectionCache({
      filePath,
      now: () => Date.parse('2026-06-15T10:00:00.000Z')
    });

    await firstCache.getOrLoad('persisted', async () => ({ value: ++loads }));

    const secondCache = createDashboardSectionCache({
      filePath,
      now: () => Date.parse('2026-06-15T23:30:00.000Z')
    });
    const restored = await secondCache.getOrLoad('persisted', async () => ({ value: ++loads }));

    assert.deepEqual(restored, { value: 1 });
    assert.equal(loads, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('dashboard section cache returns loaded values when file persistence fails', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-section-cache-'));
  let loads = 0;
  const persistenceErrors = [];

  try {
    const cache = createDashboardSectionCache({
      filePath: tempDir,
      now: () => Date.parse('2026-06-15T10:00:00.000Z'),
      onPersistenceError: (error, context) => {
        persistenceErrors.push({ error, context });
      }
    });

    const rows = await cache.getOrLoad('fresh', async () => ({ value: ++loads }));
    const cachedRows = await cache.getOrLoad('fresh', async () => ({ value: ++loads }));

    assert.deepEqual(rows, { value: 1 });
    assert.deepEqual(cachedRows, { value: 1 });
    assert.equal(loads, 1);
    assert.equal(persistenceErrors.length, 1);
    assert.equal(persistenceErrors[0].context.cache, 'dashboard-section');
    assert.equal(persistenceErrors[0].context.operation, 'write-after-load');
    assert.ok(persistenceErrors[0].error instanceof Error);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('dashboard section cache ignores persisted entries from older cache versions', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-section-cache-'));
  const filePath = path.join(tempDir, 'cache.json');
  let loads = 0;

  try {
    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        version: 1,
        entries: {
          stale: {
            value: { value: 'stale' },
            expiresAt: '2026-06-16T00:00:00.000Z'
          }
        }
      })}\n`,
      'utf8'
    );

    const cache = createDashboardSectionCache({
      filePath,
      now: () => Date.parse('2026-06-15T10:00:00.000Z')
    });

    const restored = await cache.getOrLoad('stale', async () => ({ value: ++loads }));
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));

    assert.deepEqual(restored, { value: 1 });
    assert.equal(loads, 1);
    assert.equal(data.version, 2);
    assert.deepEqual(data.entries.stale.value, { value: 1 });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('dashboard section cache prunes expired persisted entries after UTC midnight', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-section-cache-'));
  const filePath = path.join(tempDir, 'cache.json');
  let loads = 0;

  try {
    const firstCache = createDashboardSectionCache({
      filePath,
      now: () => Date.parse('2026-06-15T10:00:00.000Z')
    });

    await firstCache.getOrLoad('expired-a', async () => ({ value: ++loads }));
    await firstCache.getOrLoad('expired-b', async () => ({ value: ++loads }));

    const secondCache = createDashboardSectionCache({
      filePath,
      now: () => Date.parse('2026-06-16T09:00:00.000Z')
    });

    const fresh = await secondCache.getOrLoad('fresh', async () => ({ value: ++loads }));
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));

    assert.deepEqual(fresh, { value: 3 });
    assert.deepEqual(Object.keys(data.entries).sort(), ['fresh']);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('dashboard section cache can prune expired persisted entries without loading a fresh value', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-section-cache-'));
  const filePath = path.join(tempDir, 'cache.json');

  try {
    const firstCache = createDashboardSectionCache({
      filePath,
      now: () => Date.parse('2026-06-15T10:00:00.000Z')
    });

    await firstCache.getOrLoad('expired', async () => ({ value: 1 }));

    const secondCache = createDashboardSectionCache({
      filePath,
      now: () => Date.parse('2026-06-16T00:00:00.000Z')
    });
    const pruned = await secondCache.pruneExpired();
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));

    assert.equal(pruned, true);
    assert.deepEqual(data.entries, {});
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('dashboard section cache shares pending loads and drops failed loads', async () => {
  let loads = 0;
  const cache = createDashboardSectionCache({
    now: () => Date.parse('2026-06-15T10:00:00.000Z')
  });

  const [first, second] = await Promise.all([
    cache.getOrLoad('pending', async () => ({ value: ++loads })),
    cache.getOrLoad('pending', async () => ({ value: ++loads }))
  ]);

  await assert.rejects(
    () => cache.getOrLoad('failed', async () => {
      throw new Error('load failed');
    }),
    /load failed/
  );

  const recovered = await cache.getOrLoad('failed', async () => ({ value: ++loads }));

  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.deepEqual(recovered, { value: 2 });
});

test('dashboardSectionCachePathFromEnv supports env override', () => {
  assert.equal(
    dashboardSectionCachePathFromEnv({ DASHBOARD_SECTION_CACHE_PATH: 'C:\\cache\\sections.json' }),
    'C:\\cache\\sections.json'
  );
});
