const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DASHBOARD_SECTION_CACHE_TTL_MS,
  createDashboardSectionCache,
  dashboardSectionCachePathFromEnv
} = require('../src/dashboardSectionCache');

test('dashboard section cache reuses fresh values for 10 hours and reloads stale values', async () => {
  let timestamp = Date.parse('2026-06-15T10:00:00.000Z');
  let loads = 0;
  const cache = createDashboardSectionCache({ now: () => timestamp });

  const first = await cache.getOrLoad('key', async () => ({ value: ++loads }));
  const second = await cache.getOrLoad('key', async () => ({ value: ++loads }));

  timestamp += DASHBOARD_SECTION_CACHE_TTL_MS + 1;

  const third = await cache.getOrLoad('key', async () => ({ value: ++loads }));

  assert.equal(DASHBOARD_SECTION_CACHE_TTL_MS, 10 * 60 * 60 * 1000);
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
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
      now: () => Date.parse('2026-06-15T11:00:00.000Z')
    });
    const restored = await secondCache.getOrLoad('persisted', async () => ({ value: ++loads }));

    assert.deepEqual(restored, { value: 1 });
    assert.equal(loads, 1);
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
