const path = require('node:path');
const zlib = require('node:zlib');

const DEFAULT_BATCH_SIZE = 500;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const CRM_COORDINATION_URL = 'https://crm.mygig.ru/coordination';

const REPORT_HEADERS = {
  idLkk: ['ID ЛКК'],
  organization: ['Организация'],
  workplace: ['Рабочая точка'],
  address: ['Адрес'],
  employee: ['Сотрудник'],
  dateFrom: ['Дата запроса "с"', 'Дата запроса с'],
  timeFrom: ['Время запроса "с"', 'Время запроса с'],
  actualDuration: ['Продолжительность запроса (факт) (в часах)']
};

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

function xmlDecode(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/g, '&');
}

function attributeValue(tag, name) {
  const pattern = new RegExp(`\\b${name.replace(/:/g, ':')}=(["'])(.*?)\\1`);
  const match = String(tag || '').match(pattern);

  return match ? xmlDecode(match[2]) : '';
}

function columnIndexFromCellRef(cellRef) {
  const letters = String(cellRef || '').match(/^[A-Z]+/i);

  if (!letters) {
    return -1;
  }

  let index = 0;

  for (const char of letters[0].toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }

  return index - 1;
}

function extractTextNodes(xml) {
  const values = [];
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match;

  while ((match = textPattern.exec(String(xml || ''))) !== null) {
    values.push(xmlDecode(match[1]));
  }

  return values.join('');
}

function parseSharedStrings(xml) {
  const strings = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;

  while ((match = itemPattern.exec(String(xml || ''))) !== null) {
    strings.push(extractTextNodes(match[1]));
  }

  return strings;
}

function parseCellValue(cellTag, cellBody, sharedStrings) {
  const type = attributeValue(cellTag, 't');

  if (type === 'inlineStr') {
    return extractTextNodes(cellBody);
  }

  const valueMatch = String(cellBody || '').match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  const rawValue = valueMatch ? xmlDecode(valueMatch[1]) : '';

  if (type === 's') {
    const index = Number.parseInt(rawValue, 10);

    return Number.isInteger(index) ? sharedStrings[index] || '' : '';
  }

  if (type === 'b') {
    return rawValue === '1' ? 'TRUE' : 'FALSE';
  }

  if (type === 'str') {
    return rawValue;
  }

  return rawValue;
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(String(xml || ''))) !== null) {
    const cells = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;

    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      const cellTag = cellMatch[1];
      const index = columnIndexFromCellRef(attributeValue(cellTag, 'r'));

      if (index >= 0) {
        cells[index] = parseCellValue(cellTag, cellMatch[2], sharedStrings);
      }
    }

    rows.push(cells);
  }

  return rows;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 65535);

  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error('Не удалось прочитать XLSX: не найден каталог ZIP.');
}

function readZipEntries(buffer) {
  const entries = new Map();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error('Не удалось прочитать XLSX: поврежден центральный каталог ZIP.');
    }

    const flags = buffer.readUInt16LE(centralOffset + 8);
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileNameStart = centralOffset + 46;
    const fileName = buffer.toString('utf8', fileNameStart, fileNameStart + fileNameLength);

    if ((flags & 0x1) !== 0) {
      throw new Error('Не удалось прочитать XLSX: файл внутри архива зашифрован.');
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Не удалось прочитать XLSX: поврежден локальный заголовок ZIP.');
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;

    if (method === 0) {
      data = compressedData;
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Не удалось прочитать XLSX: неподдерживаемый метод сжатия ZIP ${method}.`);
    }

    entries.set(fileName.replace(/\\/g, '/'), data);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function entryText(entries, name) {
  const value = entries.get(name);

  return value ? value.toString('utf8') : '';
}

function resolveWorkbookSheetPath(entries) {
  const workbookXml = entryText(entries, 'xl/workbook.xml');
  const relationshipsXml = entryText(entries, 'xl/_rels/workbook.xml.rels');

  if (!workbookXml || !relationshipsXml) {
    throw new Error('Не удалось прочитать XLSX: не найдена рабочая книга.');
  }

  const relationships = new Map();
  const relationshipPattern = /<Relationship\b([^>]*)\/?>/g;
  let relationshipMatch;

  while ((relationshipMatch = relationshipPattern.exec(relationshipsXml)) !== null) {
    relationships.set(
      attributeValue(relationshipMatch[1], 'Id'),
      attributeValue(relationshipMatch[1], 'Target')
    );
  }

  const sheets = [];
  const sheetPattern = /<sheet\b([^>]*)\/?>/g;
  let sheetMatch;

  while ((sheetMatch = sheetPattern.exec(workbookXml)) !== null) {
    sheets.push({
      name: attributeValue(sheetMatch[1], 'name'),
      relationshipId: attributeValue(sheetMatch[1], 'r:id')
    });
  }

  const sheet = sheets.find((item) => item.name === 'Запросы') || sheets[0];

  if (!sheet) {
    throw new Error('Не удалось прочитать XLSX: в файле нет листов.');
  }

  const target = relationships.get(sheet.relationshipId);

  if (!target) {
    throw new Error(`Не удалось прочитать XLSX: не найдена связь листа ${sheet.name || sheet.relationshipId}.`);
  }

  const normalizedTarget = target.startsWith('/')
    ? target.replace(/^\/+/, '')
    : path.posix.normalize(path.posix.join('xl', target));

  return normalizedTarget;
}

function parseRequestsReportWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Загруженный файл пустой.');
  }

  const entries = readZipEntries(buffer);
  const sheetPath = resolveWorkbookSheetPath(entries);
  const sheetXml = entryText(entries, sheetPath);

  if (!sheetXml) {
    throw new Error(`Не удалось прочитать XLSX: не найден лист ${sheetPath}.`);
  }

  const sharedStrings = parseSharedStrings(entryText(entries, 'xl/sharedStrings.xml'));
  const sheetRows = parseWorksheetRows(sheetXml, sharedStrings);

  return extractRequestsReportRowsFromSheetRows(sheetRows);
}

function normalizedHeaderMap(row) {
  const values = new Map();

  for (let index = 0; index < row.length; index += 1) {
    const header = normalizeCellText(row[index]);

    if (header) {
      values.set(header, index);
    }
  }

  return values;
}

function indexForAliases(headers, aliases) {
  for (const alias of aliases) {
    const index = headers.get(alias);

    if (index !== undefined) {
      return index;
    }
  }

  return -1;
}

function findHeaderRow(sheetRows) {
  for (let index = 0; index < sheetRows.length; index += 1) {
    const headers = normalizedHeaderMap(sheetRows[index] || []);

    if (
      indexForAliases(headers, REPORT_HEADERS.idLkk) >= 0 &&
      indexForAliases(headers, REPORT_HEADERS.organization) >= 0 &&
      indexForAliases(headers, REPORT_HEADERS.workplace) >= 0
    ) {
      return { rowIndex: index, headers };
    }
  }

  return null;
}

function formatExcelDateValue(value) {
  const text = normalizeCellText(value);
  const number = Number(text);

  if (text !== '' && Number.isFinite(number) && number > 0) {
    const date = new Date(EXCEL_EPOCH_UTC + Math.floor(number) * DAY_MS);

    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0')
    ].join('-');
  }

  const russianDate = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (russianDate) {
    return [
      russianDate[3],
      russianDate[2].padStart(2, '0'),
      russianDate[1].padStart(2, '0')
    ].join('-');
  }

  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (isoDate) {
    return [
      isoDate[1],
      isoDate[2].padStart(2, '0'),
      isoDate[3].padStart(2, '0')
    ].join('-');
  }

  return text;
}

function formatExcelTimeValue(value) {
  const text = normalizeCellText(value);
  const number = Number(text);

  if (text !== '' && Number.isFinite(number)) {
    const fraction = ((number % 1) + 1) % 1;
    let totalMinutes = Math.round(fraction * 24 * 60);

    if (totalMinutes >= 24 * 60) {
      totalMinutes -= 24 * 60;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  return text;
}

function formatDurationValue(value) {
  const text = normalizeCellText(value);
  const number = Number(text.replace(',', '.'));

  if (text !== '' && Number.isFinite(number)) {
    return String(number);
  }

  return text;
}

function reportRowValue(row, columnIndex) {
  return columnIndex >= 0 ? row[columnIndex] : '';
}

function extractRequestsReportRowsFromSheetRows(sheetRows) {
  const header = findHeaderRow(Array.isArray(sheetRows) ? sheetRows : []);

  if (!header) {
    throw new Error('Не найдены обязательные колонки отчета: ID ЛКК, Организация, Рабочая точка.');
  }

  const columnIndexes = {};
  const missing = [];

  for (const [key, aliases] of Object.entries(REPORT_HEADERS)) {
    const index = indexForAliases(header.headers, aliases);

    columnIndexes[key] = index;

    if (index < 0) {
      missing.push(aliases[0]);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Не найдены обязательные колонки отчета: ${missing.join(', ')}.`);
  }

  const rows = [];
  const warnings = [];

  for (let index = header.rowIndex + 1; index < sheetRows.length; index += 1) {
    const source = sheetRows[index] || [];

    if (source.every((cell) => normalizeCellText(cell) === '')) {
      continue;
    }

    const dateFrom = formatExcelDateValue(reportRowValue(source, columnIndexes.dateFrom));
    const timeFrom = formatExcelTimeValue(reportRowValue(source, columnIndexes.timeFrom));
    const startText = [dateFrom, timeFrom].filter(Boolean).join(' ');

    rows.push({
      sourceRowNumber: index + 1,
      idLkk: normalizeExternalId(reportRowValue(source, columnIndexes.idLkk)),
      organization: normalizeCellText(reportRowValue(source, columnIndexes.organization)),
      workplace: normalizeCellText(reportRowValue(source, columnIndexes.workplace)),
      address: normalizeCellText(reportRowValue(source, columnIndexes.address)),
      employee: normalizeCellText(reportRowValue(source, columnIndexes.employee)),
      dateFrom,
      timeFrom,
      startText,
      actualDuration: formatDurationValue(reportRowValue(source, columnIndexes.actualDuration))
    });
  }

  if (rows.length === 0) {
    warnings.push('В отчете не найдено строк с запросами после строки заголовков.');
  }

  return { rows, warnings };
}

function uniqueExternalIds(rows) {
  return [...new Set(rows.map((row) => normalizeExternalId(row && row.idLkk)).filter(Boolean))];
}

function quoteClickHouseString(value) {
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}'`;
}

function chunkValues(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function loadJobsForExternalIds(client, externalIds, batchSize = DEFAULT_BATCH_SIZE) {
  const jobs = [];

  for (const batch of chunkValues(externalIds, batchSize)) {
    const idsSql = batch.map(quoteClickHouseString).join(', ');
    const query = [
      'SELECT',
      '  toString(o.external_id) AS external_id,',
      '  toString(j._id) AS job_id,',
      '  toString(j.status) AS status,',
      '  toString(j.workplace) AS workplace_id',
      'FROM mg_orders AS o',
      'INNER JOIN mg_jobs AS j ON toString(j.source) = toString(o._id)',
      `WHERE toString(o.external_id) IN (${idsSql})`,
      'FORMAT JSONEachRow'
    ].join('\n');
    const rows = await client.queryJSONEachRow(query, {}, 'request report confirmed shift lookup');

    jobs.push(...rows);
  }

  return jobs;
}

function buildConfirmedExternalIdSet(jobs) {
  const confirmed = new Set();

  for (const job of jobs) {
    if (String(job && job.status).toLowerCase() === 'confirmed') {
      confirmed.add(normalizeExternalId(job.external_id));
    }
  }

  return confirmed;
}

function groupJobsByExternalId(jobs) {
  const grouped = new Map();

  for (const job of Array.isArray(jobs) ? jobs : []) {
    const externalId = normalizeExternalId(job && job.external_id);

    if (!externalId) {
      continue;
    }

    const existing = grouped.get(externalId) || [];

    existing.push(job);
    grouped.set(externalId, existing);
  }

  return grouped;
}

function uniqueWorkplaceIdFromJobs(jobs) {
  const workplaceIds = [...new Set((Array.isArray(jobs) ? jobs : [])
    .map((job) => normalizeCellText(job && job.workplace_id))
    .filter(Boolean))];

  return workplaceIds.length === 1 ? workplaceIds[0] : '';
}

function buildDirectExternalIdSet(jobs) {
  return new Set((Array.isArray(jobs) ? jobs : [])
    .map((job) => normalizeExternalId(job && job.external_id))
    .filter(Boolean));
}

function normalizeCompositeDate(value) {
  return formatExcelDateValue(value);
}

function normalizeCompositeTime(value) {
  const text = formatExcelTimeValue(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);

  if (!match) {
    return text;
  }

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function compositeKey(date, time, technicalName) {
  if (!date || !time || !technicalName) {
    return '';
  }

  return [date, time, technicalName].join('\u001f');
}

function compositeCandidateForRow(row) {
  const date = normalizeCompositeDate(row && row.dateFrom);
  const time = normalizeCompositeTime(row && row.timeFrom);
  const technicalName = normalizeCellText(row && row.workplace);
  const key = compositeKey(date, time, technicalName);

  if (!key) {
    return null;
  }

  return { date, time, technicalName, key };
}

function uniqueCompositeCandidates(rows) {
  const candidates = new Map();

  for (const row of rows) {
    const candidate = compositeCandidateForRow(row);

    if (candidate) {
      candidates.set(candidate.key, candidate);
    }
  }

  return [...candidates.values()];
}

function uniqueTechnicalNames(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map((row) => normalizeCellText(row && row.workplace))
    .filter(Boolean))];
}

async function loadUniqueConfirmedCompositeKeys(client, candidates, batchSize = DEFAULT_BATCH_SIZE) {
  const keys = new Set();

  for (const batch of chunkValues(candidates, batchSize)) {
    const tuplesSql = batch
      .map((candidate) => `(${quoteClickHouseString(candidate.date)}, ${quoteClickHouseString(candidate.time)}, ${quoteClickHouseString(candidate.technicalName)})`)
      .join(', ');
    const query = [
      'SELECT',
      '  start_date,',
      '  start_time,',
      '  technical_name,',
      '  count() AS confirmed_jobs',
      'FROM (',
      '  SELECT',
      '    toString(toDate(j.start)) AS start_date,',
      '    left(toString(j.start_time), 5) AS start_time,',
      '    toString(w.technical_name) AS technical_name',
      '  FROM mg_jobs AS j',
      '  INNER JOIN mg_workplaces AS w ON toString(j.workplace) = toString(w._id)',
      "  WHERE toString(j.status) = 'confirmed'",
      `    AND tuple(toString(toDate(j.start)), left(toString(j.start_time), 5), toString(w.technical_name)) IN (${tuplesSql})`,
      ')',
      'GROUP BY start_date, start_time, technical_name',
      'FORMAT JSONEachRow'
    ].join('\n');
    const rows = await client.queryJSONEachRow(query, {}, 'request report confirmed composite lookup');

    for (const row of rows) {
      if (Number(row && row.confirmed_jobs) === 1) {
        keys.add(compositeKey(
          normalizeCompositeDate(row.start_date),
          normalizeCompositeTime(row.start_time),
          normalizeCellText(row.technical_name)
        ));
      }
    }
  }

  return keys;
}

async function loadUniqueWorkplaceIdsByTechnicalName(client, technicalNames, batchSize = DEFAULT_BATCH_SIZE) {
  const workplaceIds = new Map();

  for (const batch of chunkValues(technicalNames, batchSize)) {
    const namesSql = batch.map(quoteClickHouseString).join(', ');
    const query = [
      'SELECT',
      '  technical_name,',
      '  any(workplace_id) AS resolved_workplace_id,',
      '  uniqExact(workplace_id) AS workplace_count',
      'FROM (',
      '  SELECT',
      '    toString(technical_name) AS technical_name,',
      '    toString(_id) AS workplace_id',
      '  FROM mg_workplaces',
      `  WHERE toString(technical_name) IN (${namesSql})`,
      ')',
      'GROUP BY technical_name',
      'HAVING workplace_count = 1',
      'FORMAT JSONEachRow'
    ].join('\n');
    const rows = await client.queryJSONEachRow(query, {}, 'request report workplace lookup');

    for (const row of rows) {
      const technicalName = normalizeCellText(row && row.technical_name);
      const workplaceId = normalizeCellText((row && row.resolved_workplace_id) || (row && row.workplace_id));

      if (technicalName && workplaceId) {
        workplaceIds.set(technicalName, workplaceId);
      }
    }
  }

  return workplaceIds;
}

function crmCoordinationUrl(dateFrom, workplaceId) {
  const date = normalizeCompositeDate(dateFrom);
  const id = normalizeCellText(workplaceId);

  if (!date || !id) {
    return '';
  }

  return [
    CRM_COORDINATION_URL,
    `?searchDate[]=${encodeURIComponent(date)}`,
    `&searchDate[]=${encodeURIComponent(date)}`,
    `&workplaceIds[]=${encodeURIComponent(id)}`
  ].join('');
}

function addCrmUrl(row, workplaceId) {
  const crmUrl = crmCoordinationUrl(row && row.startText, workplaceId);

  if (!crmUrl) {
    return row;
  }

  return {
    ...row,
    crmUrl
  };
}

async function findRequestReportRowsWithoutConfirmedShift(client, rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const externalIds = uniqueExternalIds(safeRows);
  const batchSize = Number.isInteger(options.batchSize) && options.batchSize > 0
    ? options.batchSize
    : DEFAULT_BATCH_SIZE;
  const jobs = externalIds.length > 0
    ? await loadJobsForExternalIds(client, externalIds, batchSize)
    : [];
  const confirmedExternalIds = buildConfirmedExternalIdSet(jobs);
  const directExternalIds = buildDirectExternalIdSet(jobs);
  const jobsByExternalId = groupJobsByExternalId(jobs);
  const rowsForCompositeFallback = safeRows.filter((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);

    return !externalId || !directExternalIds.has(externalId);
  });
  const compositeCandidates = uniqueCompositeCandidates(rowsForCompositeFallback);
  const uniqueConfirmedCompositeKeys = compositeCandidates.length > 0
    ? await loadUniqueConfirmedCompositeKeys(client, compositeCandidates, batchSize)
    : new Set();
  const missingRows = safeRows.filter((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);

    if (confirmedExternalIds.has(externalId)) {
      return false;
    }

    if (externalId && directExternalIds.has(externalId)) {
      return true;
    }

    const candidate = compositeCandidateForRow(row);

    return !candidate || !uniqueConfirmedCompositeKeys.has(candidate.key);
  });
  const rowsNeedingWorkplaceLookup = missingRows.filter((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);
    const directWorkplaceId = uniqueWorkplaceIdFromJobs(jobsByExternalId.get(externalId));

    return !directWorkplaceId && normalizeCompositeDate(row && row.startText) && normalizeCellText(row && row.workplace);
  });
  const technicalNames = uniqueTechnicalNames(rowsNeedingWorkplaceLookup);
  const workplaceIdsByTechnicalName = technicalNames.length > 0
    ? await loadUniqueWorkplaceIdsByTechnicalName(client, technicalNames, batchSize)
    : new Map();
  const enrichedMissingRows = missingRows.map((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);
    const directWorkplaceId = uniqueWorkplaceIdFromJobs(jobsByExternalId.get(externalId));
    const fallbackWorkplaceId = workplaceIdsByTechnicalName.get(normalizeCellText(row && row.workplace)) || '';

    return addCrmUrl(row, directWorkplaceId || fallbackWorkplaceId);
  });
  const confirmedRows = safeRows.length - missingRows.length;

  return {
    rows: enrichedMissingRows,
    summary: {
      totalRows: safeRows.length,
      rowsWithId: safeRows.filter((row) => normalizeExternalId(row && row.idLkk)).length,
      checkedExternalIds: externalIds.length,
      confirmedRows,
      missingConfirmedRows: missingRows.length
    }
  };
}

module.exports = {
  extractRequestsReportRowsFromSheetRows,
  findRequestReportRowsWithoutConfirmedShift,
  parseRequestsReportWorkbook
};
