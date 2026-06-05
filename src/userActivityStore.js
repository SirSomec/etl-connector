const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_USER_ACTIVITY_RETENTION_DAYS = 90;
const DEFAULT_USER_ACTIVITY_STORE_PATH = path.join(process.cwd(), 'data', 'user-activity.sqlite');
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const INTENSE_WORK_EVENT_THRESHOLD = 5;
const VIEW_EVENT_TYPES = new Set(['login', 'logout', 'page_view']);
const WORK_EVENT_TYPES = new Set(['dashboard_filter', 'detail_open', 'export', 'admin_action']);

function userActivityStorePathFromEnv(env = process.env) {
  return env.USER_ACTIVITY_STORE_PATH || DEFAULT_USER_ACTIVITY_STORE_PATH;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePath(value) {
  const text = normalizeText(value);

  if (!text) {
    return '';
  }

  try {
    return new URL(text, 'http://activity.local').pathname || '/';
  } catch {
    const pathname = text.split('#')[0].split('?')[0];

    if (!pathname) {
      return '/';
    }

    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  }
}

function formatDateUTC(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== value) {
    throw new Error(`Invalid date: ${value}`);
  }

  return date;
}

function parseDateTime(value, fieldName) {
  const text = normalizeText(value);
  const date = new Date(text);

  if (!text || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }

  return date;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function assertValidDateRange(from, to) {
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);

  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error(`Invalid activity range: ${from}..${to}`);
  }

  return { fromDate, toDate };
}

function enumerateDateRange(from, to) {
  const { fromDate, toDate } = assertValidDateRange(from, to);
  const dates = [];

  for (let date = fromDate; date.getTime() <= toDate.getTime(); date = addDaysUTC(date, 1)) {
    dates.push(formatDateUTC(date));
  }

  return dates;
}

function startOfDateUTC(date) {
  return `${formatDateUTC(date)}T00:00:00.000Z`;
}

function startOfNextDateUTC(date) {
  return startOfDateUTC(addDaysUTC(date, 1));
}

function normalizeEvent(input) {
  return {
    userId: normalizeText(input && input.userId),
    email: normalizeEmail(input && input.email),
    role: normalizeText(input && input.role) || 'analyst',
    eventType: normalizeText(input && input.eventType),
    method: normalizeText(input && input.method).toUpperCase(),
    path: normalizePath(input && input.path),
    section: normalizeText(input && input.section),
    occurredAt: normalizeText(input && input.occurredAt)
  };
}

function assertEvent(event) {
  for (const key of ['userId', 'email', 'eventType', 'method', 'path', 'section', 'occurredAt']) {
    if (!event[key]) {
      throw new Error(`Activity event requires ${key}`);
    }
  }
}

function initializeSchema(db) {
  db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS user_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  section TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_activity_events_occurred_at
  ON user_activity_events (occurred_at);

CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_time
  ON user_activity_events (user_id, occurred_at);
`);
}

function normalizeDbEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    eventType: row.event_type,
    method: row.method,
    path: row.path,
    section: row.section,
    occurredAt: row.occurred_at,
    occurredDate: row.occurred_at.slice(0, 10)
  };
}

function createEmptyDay(date) {
  return {
    date,
    viewEvents: 0,
    workEvents: 0,
    sections: new Set()
  };
}

function classifyDay(day) {
  if (day.workEvents >= INTENSE_WORK_EVENT_THRESHOLD) return 'intense';
  if (day.workEvents > 0) return 'work';
  if (day.viewEvents > 0) return 'view';
  return 'none';
}

function isViewEvent(eventType) {
  return VIEW_EVENT_TYPES.has(eventType);
}

function isWorkEvent(eventType) {
  return WORK_EVENT_TYPES.has(eventType);
}

function activityStatus({ lastEventAt, workDays14, activeDays30 }) {
  if (!lastEventAt) return 'new';
  if (workDays14 > 0) return 'active';
  if (activeDays30 === 0) return 'silent';
  return 'rare';
}

function createUserActivityStore({
  filePath = DEFAULT_USER_ACTIVITY_STORE_PATH,
  retentionDays = DEFAULT_USER_ACTIVITY_RETENTION_DAYS,
  now = () => new Date()
} = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new DatabaseSync(filePath);
  initializeSchema(db);

  function cutoffIso(days) {
    const cutoff = new Date(now().getTime());

    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    return cutoff.toISOString();
  }

  function pruneEventsBefore(cutoff) {
    const result = db
      .prepare('DELETE FROM user_activity_events WHERE occurred_at < ?')
      .run(cutoff);

    return Number(result.changes || 0);
  }

  function pruneOldEvents(days = retentionDays) {
    return pruneEventsBefore(cutoffIso(days));
  }

  function recordEvent(input) {
    const event = normalizeEvent(input);
    assertEvent(event);
    event.occurredAt = parseDateTime(event.occurredAt, 'occurredAt').toISOString();
    const cutoff = cutoffIso(retentionDays);

    pruneEventsBefore(cutoff);

    if (event.occurredAt < cutoff) {
      return;
    }

    db.prepare(`
INSERT INTO user_activity_events (
  user_id, email, role, event_type, method, path, section, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      event.userId,
      event.email,
      event.role,
      event.eventType,
      event.method,
      event.path,
      event.section,
      event.occurredAt
    );
  }

  function listEventsBetween(fromDate, toDate) {
    return db.prepare(`
SELECT *
FROM user_activity_events
WHERE occurred_at >= ? AND occurred_at < ?
ORDER BY occurred_at DESC, id DESC
`).all(startOfDateUTC(fromDate), startOfNextDateUTC(toDate)).map(normalizeDbEvent);
  }

  function getActivityOverview({ from, to, users = [] }) {
    const { fromDate, toDate } = assertValidDateRange(from, to);
    const dates = enumerateDateRange(from, to);
    const day14Start = formatDateUTC(addDaysUTC(toDate, -13));
    const day30StartDate = addDaysUTC(toDate, -29);
    const day30Start = formatDateUTC(day30StartDate);
    const day90Start = formatDateUTC(addDaysUTC(toDate, -89));
    const retentionStartDate = addDaysUTC(toDate, -(retentionDays - 1));
    const eventWindowStart = retentionStartDate;
    const events = listEventsBetween(eventWindowStart, toDate);
    const userRows = [];
    const userById = new Map();
    const eventsByUserId = new Map();

    for (const user of users) {
      const id = normalizeText(user && user.id);

      if (!id) continue;

      const row = {
        id,
        email: normalizeEmail(user.email),
        name: normalizeText(user.name),
        role: normalizeText(user.role),
        source: normalizeText(user.source),
        createdAt: normalizeText(user.createdAt)
      };

      userRows.push(row);
      userById.set(id, row);
    }

    for (const event of events) {
      if (!eventsByUserId.has(event.userId)) {
        eventsByUserId.set(event.userId, []);
      }

      eventsByUserId.get(event.userId).push(event);

      if (!userById.has(event.userId)) {
        const row = {
          id: event.userId,
          email: event.email,
          name: '',
          role: event.role,
          source: 'event',
          createdAt: ''
        };

        userRows.push(row);
        userById.set(event.userId, row);
      }
    }

    return {
      from,
      to,
      retentionDays,
      users: userRows.map((user) => {
        const userEvents = eventsByUserId.get(user.id) || [];
        const requestedEvents = userEvents.filter((event) => event.occurredDate >= from && event.occurredDate <= to);
        const daysByDate = new Map();

        for (const event of userEvents) {
          if (!daysByDate.has(event.occurredDate)) {
            daysByDate.set(event.occurredDate, createEmptyDay(event.occurredDate));
          }

          const day = daysByDate.get(event.occurredDate);

          if (isWorkEvent(event.eventType)) {
            day.workEvents += 1;
          } else if (isViewEvent(event.eventType)) {
            day.viewEvents += 1;
          }

          if (event.section) {
            day.sections.add(event.section);
          }
        }

        const days = dates.map((date) => {
          const day = daysByDate.get(date) || createEmptyDay(date);

          return {
            date,
            level: classifyDay(day),
            viewEvents: day.viewEvents,
            workEvents: day.workEvents,
            sections: [...day.sections].sort()
          };
        });
        const activeDays30 = [...daysByDate.values()]
          .filter((day) => day.date >= day30Start && day.date <= to && classifyDay(day) !== 'none')
          .length;
        const activeDays90 = [...daysByDate.values()]
          .filter((day) => day.date >= day90Start && day.date <= to && classifyDay(day) !== 'none')
          .length;
        const workDays14 = [...daysByDate.values()]
          .filter((day) => day.date >= day14Start && day.date <= to && ['work', 'intense'].includes(classifyDay(day)))
          .length;
        const recentEvents = requestedEvents.slice(0, 8);
        const lastEventAt = userEvents.length > 0 ? userEvents[0].occurredAt : '';

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          source: user.source,
          createdAt: user.createdAt,
          status: activityStatus({ lastEventAt, workDays14, activeDays30 }),
          lastEventAt,
          activeDays30,
          activeDays90,
          days,
          recentEvents
        };
      })
    };
  }

  function close() {
    db.close();
  }

  return {
    recordEvent,
    pruneOldEvents,
    getActivityOverview,
    close
  };
}

module.exports = {
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS,
  DEFAULT_USER_ACTIVITY_STORE_PATH,
  createUserActivityStore,
  userActivityStorePathFromEnv
};
