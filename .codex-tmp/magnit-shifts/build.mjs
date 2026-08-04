import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const require = createRequire(import.meta.url);
const { loadConfig } = require("../../src/config");
const { ClickHouseClient } = require("../../src/clickhouseClient");

const workDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(workDir, "../..");
const outputDir = path.join(projectDir, "outputs", "2026-07-27-magnit-operator-cancellations");
const reportPath = path.join(outputDir, "magnit-operator-cancellations-2026-07.xlsx");
const periodStart = "2026-07-01 00:00:00";
const periodEnd = "2026-08-01 00:00:00";
const magnitToken = "\u043c\u0430\u0433\u043d\u0438\u0442";

function parseEnv(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^['\"]|['\"]$/g, "");
  }
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`).join(",")}]`;
}

function parseMoscowDateTime(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    throw new Error(`Unexpected ClickHouse datetime: ${value}`);
  }

  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  ));
}

async function loadRows() {
  parseEnv(await fs.readFile(path.join(projectDir, ".env"), "utf8"));
  process.env.AUTH_ENABLED = "false";

  const ca = Buffer.concat([
    await fs.readFile(path.join(workDir, "RootCA.pem")),
    await fs.readFile(path.join(workDir, "IntermediateCA.pem"))
  ]);
  const client = new ClickHouseClient(loadConfig(process.env).clickhouse, { ca });
  const clients = await client.queryJSONEachRow(
    "SELECT _id, title FROM mg_clients FORMAT JSONEachRow",
    {},
    "load Magnit clients"
  );
  const clientIds = clients
    .filter((clientRow) => String(clientRow.title || "").toLowerCase().includes(magnitToken))
    .map((clientRow) => clientRow._id);

  if (clientIds.length === 0) {
    throw new Error("Magnit clients were not found");
  }

  const query = `WITH filtered_jobs AS (
    SELECT _id AS job_id, workplace, start
    FROM mg_jobs
    WHERE status = 'cancelled'
      AND start >= toDateTime({period_start:String}, 'Europe/Moscow')
      AND start < toDateTime({period_end:String}, 'Europe/Moscow')
      AND client IN {client_ids:Array(String)}
  ),
  operator_cancellations AS (
    SELECT
      h.job AS job_id,
      max(coalesce(h.createdAt, h.updatedAt)) AS cancelled_at,
      argMax(ifNull(h.initiatorSource, ''), coalesce(h.createdAt, h.updatedAt)) AS operator_id
    FROM mg_job_history AS h
    INNER JOIN filtered_jobs AS fj ON fj.job_id = h.job
    WHERE h.status = 'cancelled'
      AND h.initiator = 'operator'
    GROUP BY h.job
  ),
  booking_events AS (
    SELECT
      h.job AS job_id,
      min(coalesce(h.createdAt, h.updatedAt)) AS booked_at
    FROM mg_job_history AS h
    INNER JOIN filtered_jobs AS fj ON fj.job_id = h.job
    WHERE h.status = 'booked'
    GROUP BY h.job
  )
  SELECT
    fj.job_id AS shift_id,
    ifNull(wp.title, '') AS workplace_name,
    arrayStringConcat(arrayFilter(value -> value != '', [
      ifNull(wp.address__region, ''),
      ifNull(wp.address__city, ''),
      ifNull(wp.address__street, ''),
      ifNull(wp.address__house, '')
    ]), ', ') AS workplace_address,
    formatDateTime(toTimeZone(fj.start, 'Europe/Moscow'), '%F %T') AS shift_start,
    if(isNull(be.booked_at), '', formatDateTime(toTimeZone(be.booked_at, 'Europe/Moscow'), '%F %T')) AS booked_at,
    formatDateTime(toTimeZone(oc.cancelled_at, 'Europe/Moscow'), '%F %T') AS cancelled_at,
    coalesce(
      nullIf(trim(concat(ifNull(op.lastname, ''), ' ', ifNull(op.firstname, ''))), ''),
      nullIf(oc.operator_id, ''),
      'Не указан'
    ) AS cancelled_by
  FROM filtered_jobs AS fj
  INNER JOIN operator_cancellations AS oc ON oc.job_id = fj.job_id
  LEFT JOIN booking_events AS be ON be.job_id = fj.job_id
  LEFT JOIN mg_workplaces AS wp ON wp._id = fj.workplace
  LEFT JOIN mg_operators AS op ON op._id = oc.operator_id
  ORDER BY fj.start ASC, workplace_name ASC
  FORMAT JSONEachRow`;
  const rows = await client.queryJSONEachRow(
    query,
    {
      param_period_start: periodStart,
      param_period_end: periodEnd,
      param_client_ids: serializeStringArray(clientIds)
    },
    "load Magnit operator cancellations"
  );

  return rows.map((row) => ({
    shiftId: String(row.shift_id || ""),
    workplaceName: String(row.workplace_name || ""),
    workplaceAddress: String(row.workplace_address || ""),
    shiftStart: parseMoscowDateTime(row.shift_start),
    bookedAt: row.booked_at ? parseMoscowDateTime(row.booked_at) : null,
    cancelledAt: parseMoscowDateTime(row.cancelled_at),
    cancelledBy: String(row.cancelled_by || "")
  }));
}

async function buildWorkbook(rows) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("Отмены оператором");
  sheet.showGridLines = false;

  sheet.getRange("A1:H1").merge();
  sheet.getRange("A1").values = [["Отмены смен Магнита оператором"]];
  sheet.getRange("A2").values = [["Период начала смены"]];
  sheet.getRange("B2").values = [["01.07.2026 — 31.07.2026, МСК"]];
  sheet.getRange("F2").values = [["Количество смен"]];
  sheet.getRange("G2").formulas = [[rows.length > 0 ? `=COUNTA(A5:A${rows.length + 4})` : "=0"]];

  const headers = [[
    "Название точки",
    "Адрес",
    "Дата-время начала смены",
    "Дата-время отмены смены",
    "Кто отменил",
    "Разница, ч"
  ]];
  sheet.getRange("A4:H4").values = [[
    "ID смены",
    "Название точки",
    "Адрес",
    "Дата-время начала смены",
    "Дата-время отклика",
    "Дата-время отмены смены",
    "Кто отменил",
    "Разница, ч"
  ]];

  if (rows.length > 0) {
    sheet.getRange(`A5:G${rows.length + 4}`).values = rows.map((row) => [
      row.shiftId,
      row.workplaceName,
      row.workplaceAddress,
      row.shiftStart,
      row.bookedAt,
      row.cancelledAt,
      row.cancelledBy
    ]);
    sheet.getRange("H5").formulas = [["=(D5-F5)*24"]];
    sheet.getRange(`H5:H${rows.length + 4}`).fillDown();
    const table = sheet.tables.add(`A4:H${rows.length + 4}`, true, "OperatorCancellations");
    table.style = "TableStyleMedium2";
  }

  sheet.getRange("A1:H1").format = {
    fill: "#1F4E78",
    font: { bold: true, color: "#FFFFFF", size: 15 },
    horizontalAlignment: "left",
    verticalAlignment: "center"
  };
  sheet.getRange("A1:H1").format.rowHeight = 28;
  sheet.getRange("A2:G2").format = {
    fill: "#EAF2F8",
    font: { color: "#1F1F1F" },
    verticalAlignment: "center"
  };
  sheet.getRange("A2").format.font = { bold: true, color: "#1F1F1F" };
  sheet.getRange("F2").format.font = { bold: true, color: "#1F1F1F" };
  sheet.getRange("G2").format = {
    fill: "#D9EAD3",
    font: { bold: true, color: "#274E13" },
    horizontalAlignment: "center"
  };
  sheet.getRange("A4:H4").format = {
    fill: "#5B9BD5",
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true
  };
  sheet.getRange("A4:H4").format.rowHeight = 34;
  sheet.getRange(`D5:F${Math.max(rows.length + 4, 5)}`).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
  sheet.getRange(`H5:H${Math.max(rows.length + 4, 5)}`).format.numberFormat = "0.00";
  sheet.getRange(`B5:C${Math.max(rows.length + 4, 5)}`).format.wrapText = true;
  sheet.getRange(`D5:H${Math.max(rows.length + 4, 5)}`).format.verticalAlignment = "center";
  sheet.getRange("A:A").format.columnWidth = 26;
  sheet.getRange("B:B").format.columnWidth = 28;
  sheet.getRange("C:C").format.columnWidth = 46;
  sheet.getRange("D:F").format.columnWidth = 22;
  sheet.getRange("G:G").format.columnWidth = 24;
  sheet.getRange("H:H").format.columnWidth = 14;
  sheet.freezePanes.freezeRows(4);

  return workbook;
}

const rows = await loadRows();
const workbook = await buildWorkbook(rows);
await fs.mkdir(outputDir, { recursive: true });

const inspection = await workbook.inspect({
  kind: "table",
  range: `Отмены оператором!A1:H${Math.min(rows.length + 4, 12)}`,
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 8
});
console.log(inspection.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 20 },
  summary: "formula error scan"
});
console.log(errors.ndjson);

const preview = await workbook.render({
  sheetName: "Отмены оператором",
  range: `A1:H${Math.min(rows.length + 4, 35)}`,
  scale: 1.25,
  format: "png"
});
await fs.writeFile(path.join(outputDir, "preview.png"), new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(reportPath);
console.log(JSON.stringify({ reportPath, rowCount: rows.length }));
