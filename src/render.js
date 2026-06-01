function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout({ title, database, content }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - ETL Analytics</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --surface: #ffffff;
      --text: #1f2937;
      --muted: #5f6b7a;
      --line: #d6dde6;
      --link: #075cab;
      --link-bg: #eef6ff;
      --error-bg: #fff4f2;
      --error-line: #f1aaa2;
      --error-text: #a22216;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
      font-size: 16px;
      line-height: 1.5;
    }

    a {
      color: var(--link);
    }

    header {
      background: var(--surface);
      border-bottom: 1px solid var(--line);
    }

    .topbar,
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
    }

    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 18px;
      min-height: 64px;
      padding: 10px 0;
    }

    .app-title {
      font-size: 18px;
      font-weight: 700;
    }

    .database,
    .muted,
    .empty {
      color: var(--muted);
    }

    main {
      padding: 28px 0 44px;
    }

    .section {
      margin-bottom: 28px;
    }

    h1,
    h2 {
      margin: 0 0 14px;
      overflow-wrap: anywhere;
    }

    h1 {
      font-size: 28px;
      line-height: 1.2;
    }

    h2 {
      font-size: 20px;
      line-height: 1.25;
    }

    p {
      margin: 0;
    }

    .table-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .table-link {
      display: block;
      min-height: 42px;
      padding: 9px 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      overflow-wrap: anywhere;
      text-decoration: none;
    }

    .table-link:hover,
    .table-link:focus {
      border-color: var(--link);
      background: var(--link-bg);
      outline: none;
    }

    .back-link {
      display: inline-block;
      margin-bottom: 12px;
    }

    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    table {
      width: 100%;
      min-width: 560px;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 14px;
      overflow-wrap: anywhere;
    }

    th {
      background: #eef2f6;
      font-weight: 700;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .error {
      border: 1px solid var(--error-line);
      border-radius: 6px;
      padding: 12px;
      background: var(--error-bg);
      color: var(--error-text);
      overflow-wrap: anywhere;
    }

    @media (max-width: 640px) {
      .topbar,
      main {
        width: min(100% - 20px, 1180px);
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      h1 {
        font-size: 23px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div class="app-title">ETL Analytics</div>
      <div class="database">Database: ${escapeHtml(database)}</div>
    </div>
  </header>
  <main>${content}</main>
</body>
</html>`;
}

function renderHome({ database, tables }) {
  const tableItems = tables
    .map((table) => {
      const tableName = String(table);
      const href = `/tables?name=${encodeURIComponent(tableName)}`;

      return `<li><a class="table-link" href="${href}">${escapeHtml(tableName)}</a></li>`;
    })
    .join('');
  const tableContent =
    tables.length > 0
      ? `<ul class="table-list">${tableItems}</ul>`
      : '<p class="empty">No tables found.</p>';
  const content = `<section class="section">
  <h1>Available Tables</h1>
  ${tableContent}
</section>`;

  return layout({ title: 'Tables', database, content });
}

function renderColumns(columns) {
  if (columns.length === 0) {
    return '<p class="empty">No columns found.</p>';
  }

  const rows = columns
    .map(
      (column) =>
        `<tr><td>${escapeHtml(column.position)}</td><td>${escapeHtml(column.name)}</td><td>${escapeHtml(column.type)}</td></tr>`
    )
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Position</th><th>Name</th><th>Type</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function renderCell(value) {
  if (value === null || value === undefined) {
    return '<span class="muted">NULL</span>';
  }

  if (typeof value === 'object') {
    return escapeHtml(JSON.stringify(value));
  }

  return escapeHtml(value);
}

function renderRows(columns, rows) {
  if (rows.length === 0) {
    return '<p class="empty">No preview rows.</p>';
  }

  const names = columns.length > 0 ? columns.map((column) => column.name) : Object.keys(rows[0]);
  const headerCells = names.map((name) => `<th>${escapeHtml(name)}</th>`).join('');
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${names
          .map((name) => {
            const value = Object.prototype.hasOwnProperty.call(row, name)
              ? row[name]
              : undefined;

            return `<td>${renderCell(value)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderTable({ database, tableName, columns, rows }) {
  const content = `<section class="section">
  <a class="back-link" href="/">Back to tables</a>
  <h1>${escapeHtml(tableName)}</h1>
</section>
<section class="section">
  <h2>Columns</h2>
  ${renderColumns(columns)}
</section>
<section class="section">
  <h2>Preview Rows</h2>
  ${renderRows(columns, rows)}
</section>`;

  return layout({ title: tableName, database, content });
}

function renderError({ database, title, message }) {
  const content = `<section class="section">
  <h1>${escapeHtml(title)}</h1>
  <div class="error">${escapeHtml(message)}</div>
</section>`;

  return layout({ title, database, content });
}

module.exports = {
  escapeHtml,
  renderError,
  renderHome,
  renderTable
};
