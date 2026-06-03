const SQL_METRIC_INFO = {
  'sales-by-project.summary': {
    id: 'sales-by-project.summary',
    title: 'Продажи по проектам',
    description: 'Показывает общий спрос, выполненные смены, SLA, выручку и связанные показатели за выбранный период с учетом фильтров.',
    sql: `WITH
  filtered_orders AS (
    SELECT _id, client, workplace, amount, start
    FROM mg_orders
    WHERE start >= {from:DateTime}
      AND start < {toExclusive:DateTime}
  ),
  filtered_jobs AS (
    SELECT _id, source, status, worker, payment_per_hour, salary_per_hour
    FROM mg_jobs
    WHERE start >= {from:DateTime}
      AND start < {toExclusive:DateTime}
  )
SELECT
  sum(filtered_orders.amount) AS ordered_shifts,
  countIf(filtered_jobs.status = 'confirmed') AS worked_shifts
FROM filtered_orders
LEFT JOIN filtered_jobs ON filtered_jobs.source = filtered_orders._id`
  },
  'sales-by-project.trend': {
    id: 'sales-by-project.trend',
    title: 'Динамика продаж',
    description: 'Показывает изменение заказа, выполненных смен и связанных показателей по периодам.',
    sql: `SELECT
  toDate(start) AS period,
  sum(amount) AS ordered_shifts
FROM mg_orders
WHERE start >= {from:DateTime}
  AND start < {toExclusive:DateTime}
GROUP BY period
ORDER BY period`
  },
  'sales-by-project.brands': {
    id: 'sales-by-project.brands',
    title: 'Разбивка по брендам',
    description: 'Показывает заказ и выполнение по брендам клиентов.',
    sql: `SELECT
  ifNull(c.title, 'Без бренда') AS brand,
  sum(o.amount) AS ordered_shifts
FROM mg_orders AS o
LEFT JOIN mg_clients AS c ON o.client = c._id
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY brand
ORDER BY ordered_shifts DESC`
  },
  'sales-by-project.statuses': {
    id: 'sales-by-project.statuses',
    title: 'Статусы смен',
    description: 'Показывает распределение смен по статусам за выбранный период.',
    sql: `SELECT
  status,
  count() AS shifts
FROM mg_jobs
WHERE start >= {from:DateTime}
  AND start < {toExclusive:DateTime}
GROUP BY status
ORDER BY shifts DESC`
  },
  'workplace-analysis.points': {
    id: 'workplace-analysis.points',
    title: 'Анализ точек',
    description: 'Показывает рабочие места с плановым заказом, стабильностью заказа и активной базой исполнителей.',
    sql: `SELECT
  o.workplace,
  sum(o.amount) AS ordered_shifts,
  countDistinct(toDate(o.start)) AS active_days
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY o.workplace
ORDER BY ordered_shifts DESC`
  },
  'workplace-point.summary': {
    id: 'workplace-point.summary',
    title: 'Детализация точки',
    description: 'Показывает заказ, выполнение, SLA, уникальных исполнителей и слеты по выбранной рабочей точке.',
    sql: `SELECT
  sum(o.amount) AS ordered_shifts,
  countIf(j.status = 'confirmed') AS completed_shifts,
  uniqExactIf(j.worker, j.status = 'confirmed') AS unique_completed_workers
FROM mg_orders AS o
LEFT JOIN mg_jobs AS j ON j.source = o._id
WHERE o.workplace = {workplaceId:String}
  AND o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}`
  },
  'city-analysis.summary': {
    id: 'city-analysis.summary',
    title: 'Баланс спроса и базы',
    description: 'Сравнивает заказ в выбранном городе с базой исполнителей и их активностью в приложении.',
    sql: `WITH filtered_orders AS (
  SELECT workplace, amount, start
  FROM mg_orders
  WHERE start >= {from:DateTime}
    AND start < {toExclusive:DateTime}
),
located_users AS (
  SELECT worker._id AS worker_id, worker.user AS user_id
  FROM mg_workers AS worker
  LEFT JOIN mg_users AS u ON worker.user = u._id
)
SELECT
  sum(amount) AS ordered_shifts,
  uniqExact(user_id) AS total_located_users
FROM filtered_orders
CROSS JOIN located_users`
  },
  'city-analysis.composition': {
    id: 'city-analysis.composition',
    title: 'Состав заказа',
    description: 'Показывает, из каких брендов, специальностей и ставок состоит спрос в выбранном городе.',
    sql: `SELECT
  c.title AS brand,
  p.caption AS profession,
  sum(o.amount) AS ordered_shifts
FROM mg_orders AS o
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY brand, profession`
  },
  'city-analysis.dynamics': {
    id: 'city-analysis.dynamics',
    title: 'Динамика города',
    description: 'Показывает изменение спроса, активности, откликов и завершений по дням.',
    sql: `SELECT
  toDate(o.start) AS period,
  sum(o.amount) AS ordered_shifts
FROM mg_orders AS o
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY period
ORDER BY period`
  },
  'heatmap.map': {
    id: 'heatmap.map',
    title: 'Тепловая карта',
    description: 'Показывает точки с заказом на карте и сравнивает плановый заказ с активной базой исполнителей рядом.',
    sql: `SELECT
  workplace,
  sum(amount) AS ordered_shifts,
  sum(influence_weight) AS weighted_active_users
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY workplace`
  },
  'worker-cancellations.workers': {
    id: 'worker-cancellations.workers',
    title: 'Отмены гигерами',
    description: 'Показывает исполнителей с выполненными сменами, отменами, поздними отменами и провалами за период.',
    sql: `WITH shift_facts AS (
  SELECT _id AS job, worker, status, start
  FROM mg_jobs
  WHERE start >= {from:DateTime}
    AND start < {toExclusive:DateTime}
),
cancellation_events AS (
  SELECT job, initiator, coalesce(createdAt, updatedAt) AS event_at
  FROM mg_job_history
  WHERE status = 'cancelled'
)
SELECT
  worker,
  uniqExactIf(job, status = 'confirmed') AS confirmed_shifts,
  uniqExactIf(job, status = 'cancelled') AS worker_cancellations
FROM shift_facts
GROUP BY worker`
  }
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSqlMetricInfo(id) {
  const info = SQL_METRIC_INFO[String(id || '')];

  return info ? { ...info } : null;
}

function sqlMetricInfoFor(id) {
  return getSqlMetricInfo(id);
}

function highlightSql(sql) {
  const keywords = [
    'LEFT JOIN',
    'INNER JOIN',
    'GROUP BY',
    'ORDER BY',
    'SELECT',
    'WITH',
    'FROM',
    'WHERE',
    'JOIN',
    'COUNTIF',
    'UNIQEXACT',
    'SUM',
    'TODATE',
    'IFNULL',
    'ON',
    'AS',
    'AND',
    'OR'
  ];
  const tokenPattern = /('[^']*')|(\{[A-Za-z0-9_]+:[A-Za-z0-9_(), ]+\})/g;

  function highlightKeywords(text) {
    let result = escapeHtml(text);

    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(' ', '\\s+')}\\b`, 'gi');
      result = result.replace(pattern, (match) => `<span class="sql-keyword">${match}</span>`);
    }

    return result;
  }

  let html = '';
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(String(sql))) !== null) {
    html += highlightKeywords(String(sql).slice(lastIndex, match.index));

    if (match[1]) {
      html += `<span class="sql-string">${escapeHtml(match[1])}</span>`;
    } else {
      html += `<span class="sql-param">${escapeHtml(match[2])}</span>`;
    }

    lastIndex = tokenPattern.lastIndex;
  }

  html += highlightKeywords(String(sql).slice(lastIndex));

  return html;
}

module.exports = {
  SQL_METRIC_INFO,
  getSqlMetricInfo,
  highlightSql,
  sqlMetricInfoFor
};
