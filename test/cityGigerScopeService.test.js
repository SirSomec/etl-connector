const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCityGigerScopeService } = require('../src/cityGigerScopeService');

test('city giger scope service shares a background refresh and serves paged SQLite rows', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'city-giger-scope-'));
  const filePath = path.join(directory, 'scopes.sqlite');
  let calls = 0;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const service = createCityGigerScopeService({
    client: { async queryJSONEachRow() { return []; } },
    storePath: filePath,
    loadRows: async () => {
      calls += 1;
      await waiting;
      return [
        { user_id: 'u-1', worker_id: 'w-1', full_name: 'А', phone: '+7001', status: 'ready' },
        { user_id: 'u-2', worker_id: 'w-2', full_name: 'Б', phone: '+7002', status: 'booked' }
      ];
    },
    logger: { warn() {} }
  });

  assert.equal(service.request('scope-1', { city: 'Москва' }).state, 'loading');
  assert.equal(service.request('scope-1', { city: 'Москва' }).state, 'loading');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  release();
  for (let attempt = 0; attempt < 20 && service.request('scope-1', { city: 'Москва' }).state !== 'ready'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(service.request('scope-1', { city: 'Москва' }).state, 'ready');
  const page = service.readPage('scope-1', 1, 1);
  assert.equal(page.metadata.rowCount, 2);
  assert.deepEqual(service.summarize('scope-1'), {
    total: 2,
    readyBase: 2,
    ready: 1,
    booked: 1,
    worked: 0
  });
  assert.deepEqual(page.rows, [{
    user_id: 'u-2', worker_id: 'w-2', full_name: 'Б', phone: '+7002', status: 'booked'
  }]);

  service.close();
  await fs.rm(directory, { recursive: true, force: true });
});
