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

const tempStoreDirs = [];

test.after(async () => {
  await Promise.all(tempStoreDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
});

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

async function tempStorePath() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-test-'));

  tempStoreDirs.push(tempDir);

  return path.join(tempDir, 'users.json');
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

test('scheduled report permissions are normalized for admins and analysts', async () => {
  const store = createUserStore({
    filePath: await tempStorePath(),
    adminEmail: 'admin@example.test',
    adminPassword: 'AdminPass123!',
    passwordHashOptions: { iterations: 1000, salt: '0123456789abcdef' }
  });

  const admin = await store.findByEmail('admin@example.test');
  const analyst = await store.createUser({
    email: 'reports@example.test',
    name: 'Reports Analyst',
    role: 'analyst',
    permissions: [
      'scheduled-report-author',
      'scheduled-report-delivery',
      'mail-settings-admin'
    ],
    password: 'ReportsPass123!'
  });

  assert.equal(admin.permissions.includes('scheduled-report-author'), true);
  assert.equal(admin.permissions.includes('scheduled-report-delivery'), true);
  assert.equal(admin.permissions.includes('mail-settings-admin'), true);
  assert.deepEqual(analyst.permissions, [
    'scheduled-report-author',
    'scheduled-report-delivery'
  ]);
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
    assert.equal(ALL_PERMISSION_IDS.includes('brand-analysis'), true);
    assert.equal(hasPermission(envAdmin, 'brand-analysis'), true);
    assert.equal(ALL_PERMISSION_IDS.includes('preload-admin'), true);
    assert.equal(hasPermission(envAdmin, 'preload-admin'), true);
    await assert.rejects(
      () =>
        store.createUser({
          email: 'admin@example.test',
          name: 'Duplicate',
          role: 'analyst',
          permissions: ['tables'],
          password: 'WorkerPass123!'
        }),
      /already exists/
    );

    const created = await store.createUser({
      email: 'Analyst@Example.Test',
      name: 'Analyst <One>',
      role: 'analyst',
      permissions: [
        'city-analysis',
        'brand-analysis',
        'heatmap',
        'worker-cancellations',
        'sql-inspector',
        'preload-admin',
        'users',
        'unknown'
      ],
      password: 'WorkerPass123!'
    });

    assert.equal(created.email, 'analyst@example.test');
    assert.equal(created.name, 'Analyst <One>');
    assert.equal(created.role, 'analyst');
    assert.deepEqual(created.permissions, [
      'brand-analysis',
      'city-analysis',
      'heatmap',
      'worker-cancellations',
      'sql-inspector',
      'preload-admin'
    ]);

    const fileBody = await fs.readFile(filePath, 'utf8');
    assert.doesNotMatch(fileBody, /WorkerPass123!/);
    assert.match(fileBody, /pbkdf2-sha256/);

    const analyst = await store.verifyCredentials('analyst@example.test', 'WorkerPass123!');

    assert.equal(analyst.id, created.id);
    assert.equal(hasPermission(analyst, 'city-analysis'), true);
    assert.equal(hasPermission(analyst, 'brand-analysis'), true);
    assert.equal(hasPermission(analyst, 'heatmap'), true);
    assert.equal(hasPermission(analyst, 'worker-cancellations'), true);
    assert.equal(hasPermission(analyst, 'sql-inspector'), true);
    assert.equal(hasPermission(analyst, 'preload-admin'), true);
    assert.equal(hasPermission(analyst, 'users'), false);

    const updated = await store.updateUser(created.id, {
      name: 'Senior Analyst',
      role: 'admin',
      permissions: [],
      password: 'SeniorPass123!'
    });

    assert.equal(updated.name, 'Senior Analyst');
    assert.equal(updated.role, 'admin');
    assert.equal(hasPermission(updated, 'users'), true);
    assert.equal(await store.verifyCredentials('analyst@example.test', 'WorkerPass123!'), null);
    assert.equal((await store.verifyCredentials('analyst@example.test', 'SeniorPass123!')).role, 'admin');

    await store.deleteUser(created.id);

    assert.equal(await store.verifyCredentials('analyst@example.test', 'SeniorPass123!'), null);
    assert.deepEqual(
      (await store.listUsers()).map((user) => user.email),
      ['admin@example.test']
    );
  });
});

test('user store rejects weak managed passwords', async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, 'users.json');
    const store = createStore(filePath);

    await assert.rejects(
      () =>
        store.createUser({
          email: 'weak@example.test',
          name: 'Weak',
          role: 'analyst',
          permissions: ['tables'],
          password: 'Password1!'
        }),
      /at least 12/
    );
    await assert.rejects(
      () =>
        store.createUser({
          email: 'space@example.test',
          name: 'Space',
          role: 'analyst',
          permissions: ['tables'],
          password: 'Strong Pass123!'
        }),
      /must not contain spaces/
    );
    await assert.rejects(
      () =>
        store.createUser({
          email: 'analyst@example.test',
          name: 'Email Password',
          role: 'analyst',
          permissions: ['tables'],
          password: 'analyst@example.test'
        }),
      /must not match email/
    );
  });
});

test('managed users can change their own temporary password', async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, 'users.json');
    const store = createStore(filePath);
    const created = await store.createUser({
      email: 'analyst@example.test',
      name: 'Analyst',
      role: 'analyst',
      permissions: ['tables'],
      password: 'StrongerPass123!'
    });

    assert.equal(created.mustChangePassword, true);
    assert.equal(created.passwordChangedAt, '');

    await assert.rejects(
      () =>
        store.changeOwnPassword(created.id, {
          currentPassword: 'wrong-current',
          newPassword: 'BetterPass456!',
          confirmPassword: 'BetterPass456!'
        }),
      /Current password is incorrect/
    );
    await assert.rejects(
      () =>
        store.changeOwnPassword(created.id, {
          currentPassword: 'StrongerPass123!',
          newPassword: 'StrongerPass123!',
          confirmPassword: 'StrongerPass123!'
        }),
      /must differ from current password/
    );

    const changed = await store.changeOwnPassword(created.id, {
      currentPassword: 'StrongerPass123!',
      newPassword: 'BetterPass456!',
      confirmPassword: 'BetterPass456!'
    });

    assert.equal(changed.email, 'analyst@example.test');
    assert.equal(changed.mustChangePassword, false);
    assert.match(changed.passwordChangedAt, /^2026-06-02T10:00:00\.000Z$/);
    assert.equal(await store.verifyCredentials('analyst@example.test', 'StrongerPass123!'), null);
    assert.equal(
      (await store.verifyCredentials('analyst@example.test', 'BetterPass456!')).mustChangePassword,
      false
    );
  });
});

test('admin password reset marks managed password as temporary again', async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, 'users.json');
    const store = createStore(filePath);
    const created = await store.createUser({
      email: 'analyst@example.test',
      name: 'Analyst',
      role: 'analyst',
      permissions: ['tables'],
      password: 'StrongerPass123!'
    });

    await store.changeOwnPassword(created.id, {
      currentPassword: 'StrongerPass123!',
      newPassword: 'BetterPass456!',
      confirmPassword: 'BetterPass456!'
    });

    const reset = await store.updateUser(created.id, {
      email: 'analyst@example.test',
      name: 'Analyst',
      role: 'analyst',
      permissions: ['tables'],
      password: 'ResetPass789!'
    });

    assert.equal(reset.mustChangePassword, true);
    assert.equal(reset.passwordChangedAt, '');
    assert.equal(
      (await store.verifyCredentials('analyst@example.test', 'ResetPass789!')).mustChangePassword,
      true
    );
  });
});

test('legacy managed users without password metadata require password change', async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, 'users.json');
    const legacyHash = await createPasswordHash('LegacyPass123!', {
      iterations: 1000,
      salt: '0123456789abcdef'
    });

    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        users: [
          {
            id: 'legacy-user',
            email: 'legacy@example.test',
            name: 'Legacy',
            role: 'analyst',
            permissions: ['tables'],
            passwordHash: legacyHash,
            createdAt: '2026-06-01T10:00:00.000Z',
            updatedAt: '2026-06-01T10:00:00.000Z'
          }
        ]
      }),
      'utf8'
    );

    const store = createStore(filePath);
    const legacy = await store.verifyCredentials('legacy@example.test', 'LegacyPass123!');

    assert.equal(legacy.mustChangePassword, true);
    assert.equal(legacy.passwordChangedAt, '');
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
