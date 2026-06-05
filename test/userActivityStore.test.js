const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS,
  createUserActivityStore,
  userActivityStorePathFromEnv
} = require('../src/userActivityStore');

async function withTempStore(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activity-store-'));
  const filePath = path.join(tempDir, 'activity.sqlite');

  try {
    await callback(createUserActivityStore({
      filePath,
      now: () => new Date('2026-06-05T12:00:00.000Z')
    }), filePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('user activity store records events and builds overview levels', async () => {
  await withTempStore(async (store, filePath) => {
    store.recordEvent({
      userId: 'user-1',
      email: 'Analyst@Example.Test',
      role: 'analyst',
      eventType: 'login',
      method: 'POST',
      path: '/login',
      section: 'auth',
      occurredAt: '2026-06-03T09:00:00.000Z'
    });
    store.recordEvent({
      userId: 'user-1',
      email: 'analyst@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/dashboards/sales-by-project',
      section: 'sales-by-project',
      occurredAt: '2026-06-03T09:01:00.000Z'
    });
    for (let index = 0; index < 5; index += 1) {
      store.recordEvent({
        userId: 'user-1',
        email: 'analyst@example.test',
        role: 'analyst',
        eventType: 'dashboard_filter',
        method: 'GET',
        path: '/dashboards/workplace-analysis',
        section: 'workplace-analysis',
        occurredAt: `2026-06-04T10:0${index}:00.000Z`
      });
    }
    store.recordEvent({
      userId: 'user-2',
      email: 'quiet@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-05-20T08:00:00.000Z'
    });

    const overview = store.getActivityOverview({
      from: '2026-05-18',
      to: '2026-06-05',
      users: [
        { id: 'user-1', email: 'analyst@example.test', name: 'Analyst One', role: 'analyst', source: 'managed' },
        { id: 'user-2', email: 'quiet@example.test', name: '', role: 'analyst', source: 'managed' },
        { id: 'env-admin', email: 'admin@example.test', name: 'Администратор', role: 'admin', source: 'env' }
      ]
    });

    assert.match(filePath, /activity\.sqlite$/);
    assert.equal(overview.retentionDays, DEFAULT_USER_ACTIVITY_RETENTION_DAYS);
    assert.equal(overview.users.length, 3);
    assert.equal(overview.users[0].email, 'analyst@example.test');
    assert.equal(overview.users[0].name, 'Analyst One');
    assert.equal(overview.users[0].status, 'active');
    assert.equal(overview.users[0].activeDays30, 2);
    assert.equal(overview.users[0].activeDays90, 2);
    assert.equal(overview.users[0].days.find((day) => day.date === '2026-06-03').level, 'view');
    assert.equal(overview.users[0].days.find((day) => day.date === '2026-06-04').level, 'intense');
    assert.equal(overview.users[0].recentEvents[0].eventType, 'dashboard_filter');
    assert.equal(overview.users[1].status, 'rare');
    assert.equal(overview.users[2].status, 'new');

    store.close();
  });
});

test('user activity store prunes events older than retention window', async () => {
  await withTempStore(async (store) => {
    store.recordEvent({
      userId: 'old-user',
      email: 'old@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-02-01T10:00:00.000Z'
    });
    store.recordEvent({
      userId: 'fresh-user',
      email: 'fresh@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-06-01T10:00:00.000Z'
    });

    const removed = store.pruneOldEvents(90);
    const overview = store.getActivityOverview({
      from: '2026-01-01',
      to: '2026-06-05',
      users: [
        { id: 'old-user', email: 'old@example.test', role: 'analyst' },
        { id: 'fresh-user', email: 'fresh@example.test', role: 'analyst' }
      ]
    });

    assert.equal(removed, 1);
    assert.equal(overview.users.find((user) => user.id === 'old-user').activeDays90, 0);
    assert.equal(overview.users.find((user) => user.id === 'fresh-user').activeDays90, 1);

    store.close();
  });
});

test('userActivityStorePathFromEnv supports override and data default', () => {
  assert.equal(
    userActivityStorePathFromEnv({ USER_ACTIVITY_STORE_PATH: 'C:\\activity\\store.sqlite' }),
    'C:\\activity\\store.sqlite'
  );
  assert.match(userActivityStorePathFromEnv({}), /data[\\/]user-activity\.sqlite$/);
});
