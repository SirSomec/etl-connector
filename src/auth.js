const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const { writeFileAtomically, writeFileAtomicallySync } = require('./atomicFile');

const pbkdf2 = promisify(crypto.pbkdf2);

const USER_STORE_VERSION = 1;
const DEFAULT_USER_STORE_PATH = path.join(process.cwd(), 'data', 'users.json');
const DEFAULT_SESSION_STORE_PATH = path.join(process.cwd(), 'data', 'sessions.json');
const DEFAULT_PASSWORD_HASH_ITERATIONS = 210000;
const MIN_PASSWORD_LENGTH = 12;
const PASSWORD_HASH_ALGORITHM = 'pbkdf2-sha256';
const WEAK_PASSWORD_WORDS = [
  'password',
  'qwerty',
  '123456',
  'change-me',
  'changeme',
  'admin',
  'analyst'
];

const PERMISSION_DEFINITIONS = [
  {
    id: 'tables',
    label: 'Таблицы',
    description: 'Просмотр списка таблиц, схемы колонок и preview строк.'
  },
  {
    id: 'sales-by-project',
    label: 'Продажи по проектам',
    description: 'Дашборд продаж и выполнения смен по проектам.'
  },
  {
    id: 'brand-analysis',
    label: 'Анализ брендов',
    description: 'Дашборд анализа выбранного бренда, его точек, специальностей и выполнения смен.'
  },
  {
    id: 'workplace-analysis',
    label: 'Анализ точек',
    description: 'Дашборды стабильности заказа и детализации рабочих мест.'
  },
  {
    id: 'city-analysis',
    label: 'Анализ городов',
    description: 'Дашборд баланса спроса и базы исполнителей по городам.'
  },
  {
    id: 'heatmap',
    label: 'Тепловая карта',
    description: 'Дашборд регионального баланса активной базы и объема заказа.'
  },
  {
    id: 'worker-cancellations',
    label: 'Отмены гигерами',
    description: 'Таблица исполнителей с отменами, поздними отменами и провалами смен.'
  },
  {
    id: 'request-report-matching',
    label: 'Проверка отчетов',
    description: 'Загрузка отчетов запросов и поиск строк без confirmed-смен в etl.'
  },
  {
    id: 'sql-inspector',
    label: 'SQL метрик',
    description: 'Просмотр SQL-запросов и простых описаний расчетных метрик.'
  },
  {
    id: 'preload-admin',
    label: 'Предзагрузка витрин',
    description: 'Управление расписанием и ручным обновлением предрасчитанных витрин.'
  },
  {
    id: 'scheduled-report-author',
    label: 'SQL отчеты',
    description: 'Создание, редактирование и проверка SQL-отчетов для регулярной рассылки.'
  },
  {
    id: 'scheduled-report-delivery',
    label: 'Рассылки отчетов',
    description: 'Расписания, получатели, история отправки и скачивание отправленных Excel-файлов.'
  },
  {
    id: 'mail-settings-admin',
    label: 'SMTP настройки',
    description: 'Администраторская настройка SMTP и тестовая отправка.'
  },
  {
    id: 'users',
    label: 'Учетные записи',
    description: 'Создание, редактирование и удаление пользователей сервиса.'
  }
];

const ALL_PERMISSION_IDS = PERMISSION_DEFINITIONS.map((permission) => permission.id);
const ANALYST_PERMISSION_IDS = ALL_PERMISSION_IDS.filter((permission) => ![
  'users',
  'mail-settings-admin'
].includes(permission));

function authUserStorePathFromEnv(env = process.env) {
  return env.AUTH_USER_STORE_PATH || DEFAULT_USER_STORE_PATH;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Email must be valid');
  }

  return normalized;
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'analyst';
}

function authSessionStorePathFromEnv(env = process.env) {
  return env.AUTH_SESSION_STORE_PATH || DEFAULT_SESSION_STORE_PATH;
}

function normalizeOperatorStatus(status) {
  const value = String(status || '').trim();

  if (value === '' || ['online', 'онлайн'].includes(value.toLowerCase())) {
    return 'online';
  }

  return value;
}

function valuesAsArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    return [];
  }

  return [value];
}

function normalizePermissions(role, permissions) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === 'admin') {
    return [...ALL_PERMISSION_IDS];
  }

  const selected = new Set(valuesAsArray(permissions).map((permission) => String(permission)));

  return ANALYST_PERMISSION_IDS.filter((permission) => selected.has(permission));
}

function toPublicUser(user) {
  const source = user.source || 'managed';
  const hasPasswordMetadata = Object.prototype.hasOwnProperty.call(user, 'mustChangePassword') ||
    Object.prototype.hasOwnProperty.call(user, 'passwordChangedAt');

  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    role: user.role,
    operatorStatus: normalizeOperatorStatus(user.operatorStatus),
    permissions: normalizePermissions(user.role, user.permissions),
    source,
    createdAt: user.createdAt || '',
    updatedAt: user.updatedAt || '',
    mustChangePassword: source === 'env' ? false : (
      hasPasswordMetadata ? user.mustChangePassword === true : true
    ),
    passwordChangedAt: source === 'env' ? '' : String(user.passwordChangedAt || '')
  };
}

function normalizeStore(data) {
  if (!data || data.version !== USER_STORE_VERSION || !Array.isArray(data.users)) {
    return {
      version: USER_STORE_VERSION,
      users: []
    };
  }

  return {
    version: USER_STORE_VERSION,
    users: data.users.filter((user) => user && typeof user === 'object')
  };
}

async function readStoreFile(filePath) {
  try {
    const body = await fs.readFile(filePath, 'utf8');

    return normalizeStore(JSON.parse(body));
  } catch (_) {
    return normalizeStore();
  }
}

async function writeStoreFile(filePath, data) {
  await writeFileAtomically(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function validatePasswordQuality(password, context = {}) {
  const text = String(password || '');
  const normalizedEmail = normalizeEmail(context.email);
  const emailLocalPart = normalizedEmail.split('@')[0] || '';
  const normalizedPassword = text.toLowerCase();

  if (text.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if (/\s/.test(text)) {
    throw new Error('Password must not contain spaces');
  }

  if (
    normalizedEmail &&
    (normalizedPassword === normalizedEmail || normalizedPassword === emailLocalPart)
  ) {
    throw new Error('Password must not match email');
  }

  if (WEAK_PASSWORD_WORDS.some((word) => normalizedPassword === word || normalizedPassword.includes(word))) {
    throw new Error('Password is too common');
  }

  if (!/[a-z]/.test(text)) {
    throw new Error('Password must contain a lowercase letter');
  }

  if (!/[A-Z]/.test(text)) {
    throw new Error('Password must contain an uppercase letter');
  }

  if (!/\d/.test(text)) {
    throw new Error('Password must contain a number');
  }

  if (!/[^A-Za-z0-9]/.test(text)) {
    throw new Error('Password must contain a special character');
  }

  return text;
}

function assertPassword(password, context = {}) {
  const text = validatePasswordQuality(password, context);

  return text;
}

async function createPasswordHash(password, options = {}) {
  const iterations = Number.isInteger(options.iterations)
    ? options.iterations
    : DEFAULT_PASSWORD_HASH_ITERATIONS;
  const salt = options.salt
    ? Buffer.from(String(options.salt), 'utf8')
    : crypto.randomBytes(16);
  const hash = await pbkdf2(String(password), salt, iterations, 32, 'sha256');

  return [
    PASSWORD_HASH_ALGORITHM,
    String(iterations),
    salt.toString('base64url'),
    hash.toString('base64url')
  ].join('$');
}

function timingSafeEqualBuffers(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function timingSafeEqualText(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();

  return crypto.timingSafeEqual(leftHash, rightHash);
}

async function verifyPassword(password, encodedHash) {
  const parts = String(encodedHash || '').split('$');

  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_ALGORITHM) {
    return false;
  }

  const iterations = Number.parseInt(parts[1], 10);

  if (!Number.isInteger(iterations) || iterations < 1) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[2], 'base64url');
    const expected = Buffer.from(parts[3], 'base64url');
    const actual = await pbkdf2(String(password), salt, iterations, expected.length, 'sha256');

    return timingSafeEqualBuffers(actual, expected);
  } catch (_) {
    return false;
  }
}

function envAdminUser({ adminEmail, now = () => new Date() }) {
  const timestamp = now().toISOString();

  return {
    id: 'env-admin',
    email: normalizeEmail(adminEmail),
    name: 'Администратор из ENV',
    role: 'admin',
    operatorStatus: 'online',
    permissions: [...ALL_PERMISSION_IDS],
    source: 'env',
    createdAt: timestamp,
    updatedAt: timestamp,
    mustChangePassword: false,
    passwordChangedAt: ''
  };
}

function hasPermission(user, permission) {
  if (!user || !permission) {
    return false;
  }

  if (user.role === 'admin') {
    return true;
  }

  return valuesAsArray(user.permissions).includes(permission);
}

function createUserStore(options = {}) {
  const {
    filePath = DEFAULT_USER_STORE_PATH,
    adminEmail = '',
    adminPassword = '',
    now = () => new Date(),
    passwordHashOptions = {}
  } = options;
  const normalizedAdminEmail = normalizeEmail(adminEmail);

  async function readStore() {
    return readStoreFile(filePath);
  }

  async function writeStore(data) {
    await writeStoreFile(filePath, normalizeStore(data));
  }

  async function findManagedByEmail(email) {
    const normalized = normalizeEmail(email);
    const store = await readStore();

    return store.users.find((user) => normalizeEmail(user.email) === normalized) || null;
  }

  function publicEnvAdmin() {
    return envAdminUser({ adminEmail: normalizedAdminEmail, now });
  }

  async function ensureEmailAvailable(email, currentId = '') {
    const normalized = validateEmail(email);

    if (normalized === normalizedAdminEmail && currentId !== 'env-admin') {
      throw new Error('User already exists');
    }

    const store = await readStore();
    const duplicate = store.users.find(
      (user) => normalizeEmail(user.email) === normalized && user.id !== currentId
    );

    if (duplicate) {
      throw new Error('User already exists');
    }

    return normalized;
  }

  return {
    async listUsers() {
      const store = await readStore();
      const users = store.users
        .filter((user) => user.id && user.email && user.passwordHash)
        .map((user) => toPublicUser({ ...user, source: 'managed' }));

      return [publicEnvAdmin(), ...users];
    },

    async findByEmail(email) {
      const normalized = normalizeEmail(email);

      if (normalizedAdminEmail && normalized === normalizedAdminEmail) {
        return publicEnvAdmin();
      }

      const managed = await findManagedByEmail(normalized);

      return managed ? toPublicUser({ ...managed, source: 'managed' }) : null;
    },

    async verifyCredentials(email, password) {
      const normalized = normalizeEmail(email);

      if (
        normalizedAdminEmail &&
        normalized === normalizedAdminEmail &&
        timingSafeEqualText(password, adminPassword)
      ) {
        return publicEnvAdmin();
      }

      const managed = await findManagedByEmail(normalized);

      if (!managed || !(await verifyPassword(password, managed.passwordHash))) {
        return null;
      }

      return toPublicUser({ ...managed, source: 'managed' });
    },

    async createUser(input) {
      const email = await ensureEmailAvailable(input && input.email);
      const role = normalizeRole(input && input.role);
      const password = assertPassword(input && input.password, { email });
      const timestamp = now().toISOString();
      const store = await readStore();
      const record = {
        id: crypto.randomUUID(),
        email,
        name: String((input && input.name) || '').trim(),
        role,
        operatorStatus: normalizeOperatorStatus(input && input.operatorStatus),
        permissions: normalizePermissions(role, input && input.permissions),
        passwordHash: await createPasswordHash(password, passwordHashOptions),
        mustChangePassword: true,
        passwordChangedAt: '',
        createdAt: timestamp,
        updatedAt: timestamp
      };

      store.users.push(record);
      await writeStore(store);

      return toPublicUser({ ...record, source: 'managed' });
    },

    async updateUser(id, input) {
      if (id === 'env-admin') {
        throw new Error('Environment administrator cannot be edited');
      }

      const store = await readStore();
      const index = store.users.findIndex((user) => user.id === id);

      if (index === -1) {
        throw new Error('User not found');
      }

      const current = store.users[index];
      const email = await ensureEmailAvailable((input && input.email) || current.email, id);
      const role = normalizeRole((input && input.role) || current.role);
      const password = String((input && input.password) || '');
      const updated = {
        ...current,
        email,
        name: String((input && input.name) || '').trim(),
        role,
        permissions: normalizePermissions(role, input && input.permissions),
        updatedAt: now().toISOString()
      };

      if (password !== '') {
        updated.passwordHash = await createPasswordHash(
          assertPassword(password, { email }),
          passwordHashOptions
        );
        updated.mustChangePassword = true;
        updated.passwordChangedAt = '';
      }

      store.users[index] = updated;
      await writeStore(store);

      return toPublicUser({ ...updated, source: 'managed' });
    },

    async changeOwnPassword(id, input) {
      if (id === 'env-admin') {
        throw new Error('Environment administrator password is managed through environment variables');
      }

      const store = await readStore();
      const index = store.users.findIndex((user) => user.id === id);

      if (index === -1) {
        throw new Error('User not found');
      }

      const current = store.users[index];
      const currentPassword = String((input && input.currentPassword) || '');
      const newPassword = String((input && input.newPassword) || '');
      const confirmPassword = String((input && input.confirmPassword) || '');

      if (!(await verifyPassword(currentPassword, current.passwordHash))) {
        throw new Error('Current password is incorrect');
      }

      if (newPassword !== confirmPassword) {
        throw new Error('Password confirmation must match');
      }

      if (await verifyPassword(newPassword, current.passwordHash)) {
        throw new Error('Password must differ from current password');
      }

      const timestamp = now().toISOString();
      const updated = {
        ...current,
        passwordHash: await createPasswordHash(
          assertPassword(newPassword, { email: current.email }),
          passwordHashOptions
        ),
        mustChangePassword: false,
        passwordChangedAt: timestamp,
        updatedAt: timestamp
      };

      store.users[index] = updated;
      await writeStore(store);

      return toPublicUser({ ...updated, source: 'managed' });
    },

    async deleteUser(id) {
      if (id === 'env-admin') {
        throw new Error('Environment administrator cannot be deleted');
      }

      const store = await readStore();
      const nextUsers = store.users.filter((user) => user.id !== id);

      if (nextUsers.length === store.users.length) {
        throw new Error('User not found');
      }

      await writeStore({
        version: USER_STORE_VERSION,
        users: nextUsers
      });
    }
  };
}

function parseCookies(cookieHeader) {
  const cookies = {};

  for (const part of String(cookieHeader || '').split(';')) {
    const [rawName, ...rawValue] = part.split('=');
    const name = rawName && rawName.trim();

    if (!name) {
      continue;
    }

    cookies[name] = decodeURIComponent(rawValue.join('=').trim());
  }

  return cookies;
}

function createSessionManager(options = {}) {
  const {
    cookieName = 'etl_analytics_session',
    ttlMs = 48 * 60 * 60 * 1000,
    presenceTtlMs = 45 * 1000,
    secret = '',
    storePath = null,
    now = () => Date.now()
  } = options;
  const sessionSecretPath = storePath ? `${storePath}.secret` : '';
  let resolvedSecret = String(secret || '').trim();

  if (!resolvedSecret && sessionSecretPath) {
    try {
      resolvedSecret = fsSync.readFileSync(sessionSecretPath, 'utf8').trim();
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (!resolvedSecret) {
      resolvedSecret = crypto.randomBytes(32).toString('base64url');
      writeFileAtomicallySync(sessionSecretPath, `${resolvedSecret}\n`);
    }
  }

  if (!resolvedSecret) {
    resolvedSecret = crypto.randomBytes(32).toString('base64url');
  }
  const sessions = new Map();

  function validStoredSession(value) {
    return value &&
      typeof value === 'object' &&
      typeof value.key === 'string' && value.key !== '' &&
      typeof value.userId === 'string' && value.userId !== '' &&
      typeof value.email === 'string' && value.email !== '' &&
      typeof value.csrfToken === 'string' && value.csrfToken !== '' &&
      Number.isFinite(value.expiresAt);
  }

  function persistSessions() {
    if (!storePath) {
      return;
    }

    const storedSessions = [];

    for (const [key, session] of sessions) {
      if (session.expiresAt > now()) {
        storedSessions.push({
          key,
          userId: session.userId,
          email: session.email,
          expiresAt: session.expiresAt,
          csrfToken: session.csrfToken
        });
      }
    }

    writeFileAtomicallySync(storePath, `${JSON.stringify({ version: 1, sessions: storedSessions }, null, 2)}\n`);
  }

  function restoreSessions() {
    if (!storePath) {
      return;
    }

    try {
      const stored = JSON.parse(fsSync.readFileSync(storePath, 'utf8'));
      const entries = stored && stored.version === 1 && Array.isArray(stored.sessions)
        ? stored.sessions
        : [];

      for (const entry of entries) {
        if (validStoredSession(entry) && entry.expiresAt > now()) {
          sessions.set(entry.key, {
            userId: entry.userId,
            email: entry.email,
            expiresAt: entry.expiresAt,
            csrfToken: entry.csrfToken,
            tabs: new Map()
          });
        }
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        // A damaged runtime cache must never prevent the service from starting.
      }
    }
  }

  restoreSessions();

  function pruneStaleTabs(session) {
    if (!session || !(session.tabs instanceof Map)) {
      return;
    }

    const staleBefore = now() - presenceTtlMs;

    for (const [tabId, lastSeenAt] of session.tabs) {
      if (lastSeenAt <= staleBefore) {
        session.tabs.delete(tabId);
      }
    }
  }

  function pruneExpiredSessions() {
    let changed = false;

    for (const [key, session] of sessions) {
      if (session.expiresAt <= now()) {
        sessions.delete(key);
        changed = true;
        continue;
      }

      pruneStaleTabs(session);
    }

    if (changed) {
      persistSessions();
    }
  }

  function tokenKey(token) {
    return crypto
      .createHmac('sha256', resolvedSecret)
      .update(String(token || ''))
      .digest('base64url');
  }

  function sessionCookie(token) {
    return [
      `${cookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(ttlMs / 1000)}`
    ].join('; ');
  }

  function clearCookie() {
    return [`${cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'].join('; ');
  }

  function getToken(req) {
    const cookies = parseCookies(req && req.headers && req.headers.cookie);

    return cookies[cookieName] || '';
  }

  function getSession(req) {
    const token = getToken(req);

    if (!token) {
      return null;
    }

    const key = tokenKey(token);
    const session = sessions.get(key);

    if (!session) {
      return null;
    }

    if (session.expiresAt <= now()) {
      sessions.delete(key);
      persistSessions();
      return null;
    }

    pruneStaleTabs(session);

    return session;
  }

  function validTabId(tabId) {
    return typeof tabId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(tabId);
  }

  return {
    createSession(user) {
      const token = crypto.randomBytes(32).toString('base64url');
      const csrfToken = crypto.randomBytes(24).toString('base64url');
      const session = {
        userId: user.id,
        email: user.email,
        expiresAt: now() + ttlMs,
        csrfToken,
        tabs: new Map()
      };

      sessions.set(tokenKey(token), session);
      persistSessions();

      return {
        ...session,
        token,
        cookieHeader: sessionCookie(token)
      };
    },

    getSession,

    heartbeat(req, tabId) {
      if (!validTabId(tabId)) {
        return false;
      }

      const session = getSession(req);

      if (!session) {
        return false;
      }

      session.tabs.set(tabId, now());
      return true;
    },

    releaseTab(req, tabId) {
      if (!validTabId(tabId)) {
        return false;
      }

      const session = getSession(req);

      if (!session) {
        return false;
      }

      return session.tabs.delete(tabId);
    },

    operatorStatusByUserId(users) {
      pruneExpiredSessions();
      const usersById = new Map(
        (Array.isArray(users) ? users : [])
          .filter((user) => user && user.id)
          .map((user) => [
            user.id,
            normalizeOperatorStatus(user.operatorStatus)
          ])
      );
      const activeUserIds = new Set();

      for (const session of sessions.values()) {
        if (usersById.has(session.userId) && session.tabs.size > 0) {
          activeUserIds.add(session.userId);
        }
      }

      return new Map([...usersById].map(([userId, currentStatus]) => {
        if (currentStatus !== 'online') {
          return [userId, currentStatus];
        }

        return [userId, activeUserIds.has(userId) ? 'online' : 'unavailable'];
      }));
    },

    destroySession(req) {
      const token = getToken(req);

      if (token) {
        sessions.delete(tokenKey(token));
        persistSessions();
      }

      return clearCookie();
    },

    clearCookieHeader() {
      return clearCookie();
    },

    verifyCsrf(req, token) {
      const session = getSession(req);

      if (!session || typeof token !== 'string' || token === '') {
        return false;
      }

      return timingSafeEqualText(session.csrfToken, token);
    }
  };
}

module.exports = {
  ALL_PERMISSION_IDS,
  ANALYST_PERMISSION_IDS,
  DEFAULT_PASSWORD_HASH_ITERATIONS,
  PERMISSION_DEFINITIONS,
  authUserStorePathFromEnv,
  authSessionStorePathFromEnv,
  createPasswordHash,
  createSessionManager,
  createUserStore,
  hasPermission,
  normalizeEmail,
  normalizePermissions,
  verifyPassword
};
