const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  ALL_PERMISSION_IDS,
  authUserStorePathFromEnv,
  createPasswordHash,
  createSessionManager,
  createUserStore,
  hasPermission,
  verifyPassword
} = require('../src/auth');

async function withTempDir(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-test-'));

  try {
    await callback(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function createStore(filePath) {
  return createUserStore({
    filePath,
    adminEmail: 'Admin@Example.Test',
    adminPassword: 'EnvAdminPass123',
    now: () => new Date('2026-06-02T10:00:00.000Z'),
    passwordHashOptions: {
      iterations: 1000,
      salt: '0123456789abcdef'
    }
  });
}

test('password hashing verifies correct passwords without storing plaintext', async () => {
  const hash = await createPasswordHash('StrongPass123', {
    iterations: 1000,
    salt: '0123456789abcdef'
  });

  assert.match(hash, /^pbkdf2-sha256\$1000\$/);
  assert.doesNotMatch(hash, /StrongPass123/);
  assert.equal(await verifyPassword('StrongPass123', hash), true);
  assert.equal(await verifyPassword('WrongPass123', hash), false);
});

test('user store exposes env admin and persists managed accounts', async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, 'users.json');
    const store = createStore(filePath);

    const envAdmin = await store.verifyCredentials('admin@example.test', 'EnvAdminPass123');

    assert.equal(envAdmin.email, 'admin@example.test');
    assert.equal(envAdmin.role, 'admin');
    assert.deepEqual(envAdmin.permissions, ALL_PERMISSION_IDS);
    assert.equal(hasPermission(envAdmin, 'users'), true);
    assert.equal(ALL_PERMISSION_IDS.includes('sql-inspector'), true);
    assert.equal(hasPermission(envAdmin, 'sql-inspector'), true);
    await assert.rejects(
      () =>
        store.createUser({
          email: 'admin@example.test',
          name: 'Duplicate',
          role: 'analyst',
          permissions: ['tables'],
          password: 'AnalystPass123'
        }),
      /already exists/
    );

    const created = await store.createUser({
      email: 'Analyst@Example.Test',
      name: 'Analyst <One>',
      role: 'analyst',
      permissions: ['city-analysis', 'heatmap', 'worker-cancellations', 'sql-inspector', 'users', 'unknown'],
      password: 'AnalystPass123'
    });

    assert.equal(created.email, 'analyst@example.test');
    assert.equal(created.name, 'Analyst <One>');
    assert.equal(created.role, 'analyst');
    assert.deepEqual(created.permissions, ['city-analysis', 'heatmap', 'worker-cancellations', 'sql-inspector']);

    const fileBody = await fs.readFile(filePath, 'utf8');
    assert.doesNotMatch(fileBody, /AnalystPass123/);
    assert.match(fileBody, /pbkdf2-sha256/);

    const analyst = await store.verifyCredentials('analyst@example.test', 'AnalystPass123');

    assert.equal(analyst.id, created.id);
    assert.equal(hasPermission(analyst, 'city-analysis'), true);
    assert.equal(hasPermission(analyst, 'heatmap'), true);
    assert.equal(hasPermission(analyst, 'worker-cancellations'), true);
    assert.equal(hasPermission(analyst, 'sql-inspector'), true);
    assert.equal(hasPermission(analyst, 'users'), false);

    const updated = await store.updateUser(created.id, {
      name: 'Senior Analyst',
      role: 'admin',
      permissions: [],
      password: 'NewAdminPass123'
    });

    assert.equal(updated.name, 'Senior Analyst');
    assert.equal(updated.role, 'admin');
    assert.equal(hasPermission(updated, 'users'), true);
    assert.equal(await store.verifyCredentials('analyst@example.test', 'AnalystPass123'), null);
    assert.equal((await store.verifyCredentials('analyst@example.test', 'NewAdminPass123')).role, 'admin');

    await store.deleteUser(created.id);

    assert.equal(await store.verifyCredentials('analyst@example.test', 'NewAdminPass123'), null);
    assert.deepEqual(
      (await store.listUsers()).map((user) => user.email),
      ['admin@example.test']
    );
  });
});

test('session manager signs cookies, verifies csrf tokens, and expires sessions', () => {
  let now = Date.parse('2026-06-02T10:00:00.000Z');
  const sessions = createSessionManager({
    cookieName: 'test_session',
    ttlMs: 1000,
    secret: 'session-secret',
    now: () => now
  });
  const session = sessions.createSession({ id: 'user-1', email: 'user@example.test' });
  const req = {
    headers: {
      cookie: session.cookieHeader.split(';')[0]
    }
  };

  assert.match(session.cookieHeader, /^test_session=/);
  assert.match(session.cookieHeader, /HttpOnly/);
  assert.equal(sessions.getSession(req).email, 'user@example.test');
  assert.equal(sessions.verifyCsrf(req, session.csrfToken), true);
  assert.equal(sessions.verifyCsrf(req, 'wrong-token'), false);

  now += 1001;

  assert.equal(sessions.getSession(req), null);
});

test('authUserStorePathFromEnv supports env override and data default', () => {
  assert.equal(
    authUserStorePathFromEnv({ AUTH_USER_STORE_PATH: 'C:\\auth\\users.json' }),
    'C:\\auth\\users.json'
  );
  assert.match(authUserStorePathFromEnv({}), /data[\\/]users\.json$/);
});
