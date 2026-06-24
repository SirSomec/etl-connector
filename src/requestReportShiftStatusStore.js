const fs = require('node:fs/promises');
const path = require('node:path');

const { writeFileAtomically } = require('./atomicFile');

const STORE_VERSION = 1;
const DEFAULT_REQUEST_REPORT_STATUS_STORE_PATH = path.join(
  process.cwd(),
  'data',
  'request-report-shift-statuses.json'
);
const REQUEST_REPORT_SHIFT_STATUS_OPTIONS = [
  { id: 'verified', label: 'Проверена' },
  { id: 'return-later', label: 'Вернуться позже' }
];

const STATUS_LABELS = new Map(
  REQUEST_REPORT_SHIFT_STATUS_OPTIONS.map((option) => [option.id, option.label])
);

function normalizeCellText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeExternalId(value) {
  const text = normalizeCellText(value);

  if (/^-?\d+\.0+$/.test(text)) {
    return text.replace(/\.0+$/, '');
  }

  return text;
}

function normalizeKeyPart(value) {
  return normalizeCellText(value).toLocaleLowerCase('ru-RU');
}

function requestReportShiftStatusKey(row) {
  const externalId = normalizeExternalId(row && row.idLkk);

  if (externalId) {
    return `lkk:${externalId}`;
  }

  const parts = [
    row && row.organization,
    row && row.workplace,
    row && row.address,
    row && row.employee,
    row && row.startText
  ].map(normalizeKeyPart);

  if (parts.every((part) => part === '')) {
    return '';
  }

  return `row:${parts.join('\u001f')}`;
}

function normalizeUserId(userId) {
  const text = normalizeCellText(userId);

  return text || 'anonymous';
}

function normalizeStatus(status) {
  const text = normalizeCellText(status);

  if (text === '') {
    return '';
  }

  if (!STATUS_LABELS.has(text)) {
    throw new Error('Unknown request report shift status');
  }

  return text;
}

function normalizeStore(data) {
  const users = {};

  if (!data || data.version !== STORE_VERSION || !data.users || typeof data.users !== 'object') {
    return {
      version: STORE_VERSION,
      users
    };
  }

  for (const [userId, records] of Object.entries(data.users)) {
    if (!records || typeof records !== 'object') {
      continue;
    }

    const normalizedUserId = normalizeUserId(userId);
    const normalizedRecords = {};

    for (const [rowKey, rawRecord] of Object.entries(records)) {
      const key = normalizeCellText(rowKey);
      const rawStatus = typeof rawRecord === 'string'
        ? rawRecord
        : rawRecord && rawRecord.status;
      let status;

      try {
        status = normalizeStatus(rawStatus);
      } catch (_) {
        continue;
      }

      if (key && status) {
        normalizedRecords[key] = {
          status,
          updatedAt: normalizeCellText(rawRecord && rawRecord.updatedAt)
        };
      }
    }

    if (Object.keys(normalizedRecords).length > 0) {
      users[normalizedUserId] = normalizedRecords;
    }
  }

  return {
    version: STORE_VERSION,
    users
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

async function writeStoreFile(filePath, store) {
  await writeFileAtomically(filePath, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, 'utf8');
}

function statusLabel(status) {
  return STATUS_LABELS.get(status) || '';
}

function createRequestReportShiftStatusStore(options = {}) {
  const filePath = options.filePath || DEFAULT_REQUEST_REPORT_STATUS_STORE_PATH;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  let writeQueue = Promise.resolve();

  async function readStoreAfterWrites() {
    await writeQueue.catch(() => {});

    return readStoreFile(filePath);
  }

  async function mutate(mutator) {
    const result = writeQueue.then(async () => {
      const store = await readStoreFile(filePath);
      const mutationResult = mutator(store);

      await writeStoreFile(filePath, store);

      return mutationResult;
    });

    writeQueue = result.catch(() => {});

    return result;
  }

  return {
    async setStatus({ userId, rowKey, status }) {
      const normalizedUserId = normalizeUserId(userId);
      const key = normalizeCellText(rowKey);
      const normalizedStatus = normalizeStatus(status);

      if (!key) {
        throw new Error('Request report shift status key is required');
      }

      return mutate((store) => {
        const userRecords = store.users[normalizedUserId] || {};

        if (normalizedStatus) {
          userRecords[key] = {
            status: normalizedStatus,
            updatedAt: now().toISOString()
          };
          store.users[normalizedUserId] = userRecords;
        } else {
          delete userRecords[key];

          if (Object.keys(userRecords).length === 0) {
            delete store.users[normalizedUserId];
          } else {
            store.users[normalizedUserId] = userRecords;
          }
        }

        return {
          status: normalizedStatus,
          label: statusLabel(normalizedStatus)
        };
      });
    },

    async attachStatuses(userId, rows) {
      const normalizedUserId = normalizeUserId(userId);
      const safeRows = Array.isArray(rows) ? rows : [];
      const store = await readStoreAfterWrites();
      const userRecords = store.users[normalizedUserId] || {};

      return safeRows.map((row) => {
        const key = requestReportShiftStatusKey(row);
        const record = key ? userRecords[key] : null;
        const status = record ? normalizeStatus(record.status) : '';

        return {
          ...row,
          reviewStatusKey: key,
          reviewStatus: status,
          reviewStatusLabel: statusLabel(status)
        };
      });
    }
  };
}

module.exports = {
  DEFAULT_REQUEST_REPORT_STATUS_STORE_PATH,
  REQUEST_REPORT_SHIFT_STATUS_OPTIONS,
  createRequestReportShiftStatusStore,
  requestReportShiftStatusKey
};
