const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const { writeFileAtomically } = require('./atomicFile');

const pbkdf2 = promisify(crypto.pbkdf2);

const USER_STORE_VERSION = 1;
const DEFAULT_USER_STORE_PATH = path.join(process.cwd(), 'data', 'users.json');
const DEFAULT_PASSWORD_HASH_ITERATIONS = 210000;
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_HASH_ALGORITHM = 'pbkdf2-sha256';

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
    id: 'users',
    label: 'Учетные записи',
    description: 'Создание, редактирование и удаление пользователей сервиса.'
  }
];

const ALL_PERMISSION_IDS = PERMISSION_DEFINITIONS.map((permission) => permission.id);
const ANALYST_PERMISSION_IDS = ALL_PERMISSION_IDS.filter((permission) => permission !== 'users');

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
  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    role: user.role,
    permissions: normalizePermissions(user.role, user.permissions),
    source: user.source || 'managed',
    createdAt: user.createdAt || '',
    updatedAt: user.updatedAt || ''
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

function assertPassword(password) {
  const text = String(password || '');

  if (text.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters`);
  }

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
    permissions: [...ALL_PERMISSION_IDS],
    source: 'env',
    createdAt: timestamp,
    updatedAt: timestamp
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
      const password = assertPassword(input && input.password);
      const timestamp = now().toISOString();
      const store = await readStore();
      const record = {
        id: crypto.randomUUID(),
        email,
        name: String((input && input.name) || '').trim(),
        role,
        permissions: normalizePermissions(role, input && input.permissions),
        passwordHash: await createPasswordHash(password, passwordHashOptions),
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
        updated.passwordHash = await createPasswordHash(assertPassword(password), passwordHashOptions);
      }

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
    ttlMs = 12 * 60 * 60 * 1000,
    secret = crypto.randomBytes(32).toString('base64url'),
    now = () => Date.now()
  } = options;
  const sessions = new Map();

  function tokenKey(token) {
    return crypto
      .createHmac('sha256', String(secret))
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
      return null;
    }

    return session;
  }

  return {
    createSession(user) {
      const token = crypto.randomBytes(32).toString('base64url');
      const csrfToken = crypto.randomBytes(24).toString('base64url');
      const session = {
        userId: user.id,
        email: user.email,
        expiresAt: now() + ttlMs,
        csrfToken
      };

      sessions.set(tokenKey(token), session);

      return {
        ...session,
        token,
        cookieHeader: sessionCookie(token)
      };
    },

    getSession,

    destroySession(req) {
      const token = getToken(req);

      if (token) {
        sessions.delete(tokenKey(token));
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
  createPasswordHash,
  createSessionManager,
  createUserStore,
  hasPermission,
  normalizeEmail,
  normalizePermissions,
  verifyPassword
};
