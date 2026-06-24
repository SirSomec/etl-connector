const path = require('node:path');
const zlib = require('node:zlib');

const DEFAULT_BATCH_SIZE = 500;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const CRM_COORDINATION_URL = 'https://crm.mygig.ru/coordination';
const REQUEST_REPORT_EXPORT_HEADERS = [
  'Результат проверки',
  'ID смены если найдена',
  'Ссылка на смену',
  'Статус проверки'
];
const CHECK_RESULT_FOUND = 'confirmed-found';
const CHECK_RESULT_MISSING = 'confirmed-missing';
const CHECK_RESULT_LABELS = {
  [CHECK_RESULT_FOUND]: 'Найдена confirmed-смена',
  [CHECK_RESULT_MISSING]: 'Confirmed-смена не найдена'
};

const PROGRESS_POINTS = Object.freeze({
  'reading-file': Object.freeze({ start: 0, end: 5, detail: 'Читаем файл отчета' }),
  'extracting-rows': Object.freeze({ start: 5, end: 15, detail: 'Извлекаем строки отчета' }),
  'external-id-lookup': Object.freeze({ start: 15, end: 30, detail: 'Проверяем ID ЛКК в заказах' }),
  'composite-lookup': Object.freeze({ start: 30, end: 45, detail: 'Проверяем дату, время и рабочую точку' }),
  'employee-lookup': Object.freeze({ start: 45, end: 60, detail: 'Уточняем совпадения по исполнителю' }),
  'employee-date-lookup': Object.freeze({ start: 60, end: 72, detail: 'Проверяем исполнителя по дате смены' }),
  'workplace-lookup': Object.freeze({ start: 72, end: 84, detail: 'Подбираем рабочую точку для ссылки CRM' }),
  'workplace-date-lookup': Object.freeze({ start: 84, end: 94, detail: 'Уточняем рабочую точку по дате' }),
  'render-result': Object.freeze({ start: 95, end: 100, detail: 'Формируем результат проверки' })
});

const REPORT_HEADERS = {
  idLkk: ['ID ЛКК'],
  organization: ['Организация'],
  workplace: ['Рабочая точка'],
  address: ['Адрес'],
  employee: ['Сотрудник'],
  dateFrom: ['Дата запроса "с"', 'Дата запроса с'],
  timeFrom: ['Время запроса "с"', 'Время запроса с'],
  actualDuration: [
    'Фактическая продолжительность запроса за вычетом перерыва',
    'Продолжительность запроса (факт) (в часах)'
  ]
};

function clampProgress(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function progressForStage(stage, processed, total) {
  const point = PROGRESS_POINTS[stage] || { start: 0, end: 100 };

  if (!Number.isFinite(total) || total <= 0) {
    return point.end;
  }

  const ratio = Math.max(0, Math.min(1, processed / total));

  return point.start + ((point.end - point.start) * ratio);
}

function emitProgress(options, stage, input = {}) {
  const onProgress = options && options.onProgress;

  if (typeof onProgress !== 'function') {
    return;
  }

  const point = PROGRESS_POINTS[stage] || { start: 0, end: 100, detail: stage };
  const progress = input.progress !== undefined
    ? input.progress
    : point.end;

  try {
    onProgress({
      stage,
      progress: clampProgress(progress),
      detail: input.detail || point.detail || stage,
      counts: input.counts ? { ...input.counts } : {}
    });
  } catch {
    // Progress reporting is a best-effort side channel and must not change analysis results.
  }
}

function emitLookupProgress(options, stage, input = {}) {
  const total = Number(input.total) || 0;
  const processed = Number(input.processed) || 0;

  emitProgress(options, stage, {
    detail: input.detail,
    progress: input.progress !== undefined ? input.progress : progressForStage(stage, processed, total),
    counts: {
      total,
      processed,
      ...(input.counts || {})
    }
  });
}

function normalizeLookupOptions(value = DEFAULT_BATCH_SIZE) {
  if (typeof value === 'number') {
    return {
      batchSize: Number.isInteger(value) && value > 0 ? value : DEFAULT_BATCH_SIZE,
      onProgress: undefined
    };
  }

  if (value && typeof value === 'object') {
    return {
      batchSize: Number.isInteger(value.batchSize) && value.batchSize > 0 ? value.batchSize : DEFAULT_BATCH_SIZE,
      onProgress: value.onProgress
    };
  }

  return {
    batchSize: DEFAULT_BATCH_SIZE,
    onProgress: undefined
  };
}

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

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { dosDate, dosTime };
}

function zipLocalHeader(nameBuffer, data, crc, dateTime) {
  const header = Buffer.alloc(30);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(dateTime.dosTime, 10);
  header.writeUInt16LE(dateTime.dosDate, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, nameBuffer, data]);
}

function zipCentralHeader(nameBuffer, data, crc, offset, dateTime) {
  const header = Buffer.alloc(46);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(dateTime.dosTime, 12);
  header.writeUInt16LE(dateTime.dosDate, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);

  return Buffer.concat([header, nameBuffer]);
}

function zipEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const footer = Buffer.alloc(22);

  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(centralSize, 12);
  footer.writeUInt32LE(centralOffset, 16);
  footer.writeUInt16LE(0, 20);

  return footer;
}

function buildZip(entries) {
  const dateTime = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(data);
    const localHeader = zipLocalHeader(nameBuffer, data, crc, dateTime);
    const centralHeader = zipCentralHeader(nameBuffer, data, crc, offset, dateTime);

    localParts.push(localHeader);
    centralParts.push(centralHeader);
    offset += localHeader.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const footer = zipEndOfCentralDirectory(entries.length, centralDirectory.length, centralOffset);

  return Buffer.concat([...localParts, centralDirectory, footer]);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index) {
  let value = index + 1;
  let name = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;

    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name || 'A';
}

function worksheetCellXml(value, rowNumber, columnIndex) {
  const ref = `${columnName(columnIndex)}${rowNumber}`;
  const text = escapeXml(value);

  return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
}

function worksheetRowXml(cells, rowNumber) {
  return `<row r="${rowNumber}">${cells.map((cell, index) => worksheetCellXml(cell, rowNumber, index)).join('')}</row>`;
}

function workbookXmlRows(rows) {
  return rows.map((cells, index) => worksheetRowXml(cells, index + 1)).join('');
}

function buildXlsxWorkbook(rows, sheetName = 'Запросы') {
  const safeRows = Array.isArray(rows) ? rows : [];
  const columnCount = safeRows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 1);
  const rowCount = Math.max(safeRows.length, 1);
  const dimension = `A1:${columnName(columnCount - 1)}${rowCount}`;
  const sheetRows = safeRows.length > 0 ? workbookXmlRows(safeRows) : worksheetRowXml([''], 1);
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  return buildZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: workbookXml
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: worksheetXml
    },
    {
      name: 'docProps/core.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>ETL Analytics</dc:creator>
  <cp:lastModifiedBy>ETL Analytics</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      name: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>ETL Analytics</Application>
</Properties>`
    }
  ]);
}

function parseRequestsReportWorkbook(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Загруженный файл пустой.');
  }

  emitProgress(options, 'reading-file', {
    progress: PROGRESS_POINTS['reading-file'].start,
    counts: { total: 1, processed: 0 }
  });

  const entries = readZipEntries(buffer);
  const sheetPath = resolveWorkbookSheetPath(entries);
  const sheetXml = entryText(entries, sheetPath);

  if (!sheetXml) {
    throw new Error(`Не удалось прочитать XLSX: не найден лист ${sheetPath}.`);
  }

  const sharedStrings = parseSharedStrings(entryText(entries, 'xl/sharedStrings.xml'));
  const sheetRows = parseWorksheetRows(sheetXml, sharedStrings);

  emitProgress(options, 'reading-file', {
    progress: PROGRESS_POINTS['reading-file'].end,
    counts: { total: 1, processed: 1 }
  });

  return extractRequestsReportRowsFromSheetRows(sheetRows, options);
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

function sourceCellValue(row, index, columnIndexes) {
  const value = reportRowValue(row, index);

  if (index === columnIndexes.dateFrom) {
    return formatExcelDateValue(value);
  }

  if (index === columnIndexes.timeFrom) {
    return formatExcelTimeValue(value);
  }

  if (index === columnIndexes.actualDuration) {
    return formatDurationValue(value);
  }

  return normalizeCellText(value);
}

function sourceCellsForRow(row, columnIndexes, columnCount) {
  const cells = [];

  for (let index = 0; index < columnCount; index += 1) {
    cells.push(sourceCellValue(row, index, columnIndexes));
  }

  return cells;
}

function extractRequestsReportRowsFromSheetRows(sheetRows, options = {}) {
  const safeSheetRows = Array.isArray(sheetRows) ? sheetRows : [];

  emitProgress(options, 'extracting-rows', {
    progress: PROGRESS_POINTS['extracting-rows'].start,
    counts: { total: safeSheetRows.length, processed: 0 }
  });

  const header = findHeaderRow(safeSheetRows);

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
  const sourceRows = [];
  const warnings = [];
  const sourceHeaders = sourceCellsForRow(safeSheetRows[header.rowIndex] || [], columnIndexes, (safeSheetRows[header.rowIndex] || []).length);
  const sourceColumnCount = sourceHeaders.length;

  for (let index = header.rowIndex + 1; index < safeSheetRows.length; index += 1) {
    const source = safeSheetRows[index] || [];

    if (source.every((cell) => normalizeCellText(cell) === '')) {
      continue;
    }

    const dateFrom = formatExcelDateValue(reportRowValue(source, columnIndexes.dateFrom));
    const timeFrom = formatExcelTimeValue(reportRowValue(source, columnIndexes.timeFrom));
    const startText = [dateFrom, timeFrom].filter(Boolean).join(' ');
    const sourceRowNumber = index + 1;

    rows.push({
      sourceRowNumber,
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
    sourceRows.push({
      sourceRowNumber,
      cells: sourceCellsForRow(source, columnIndexes, sourceColumnCount)
    });
  }

  if (rows.length === 0) {
    warnings.push('В отчете не найдено строк с запросами после строки заголовков.');
  }

  emitProgress(options, 'extracting-rows', {
    progress: PROGRESS_POINTS['extracting-rows'].end,
    counts: { total: safeSheetRows.length, processed: safeSheetRows.length, matched: rows.length }
  });

  return {
    rows,
    warnings,
    sourceSheet: {
      headers: sourceHeaders,
      rows: sourceRows
    }
  };
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

async function loadJobsForExternalIds(client, externalIds, batchSizeOrOptions = DEFAULT_BATCH_SIZE) {
  const { batchSize, onProgress } = normalizeLookupOptions(batchSizeOrOptions);
  const safeExternalIds = Array.isArray(externalIds) ? externalIds : [];
  const progressOptions = { onProgress };
  const jobs = [];
  let processed = 0;
  const matchedExternalIds = new Set();

  if (safeExternalIds.length === 0) {
    emitLookupProgress(progressOptions, 'external-id-lookup', {
      total: 0,
      processed: 0,
      counts: { matched: 0 }
    });

    return jobs;
  }

  emitLookupProgress(progressOptions, 'external-id-lookup', {
    total: safeExternalIds.length,
    processed: 0,
    progress: PROGRESS_POINTS['external-id-lookup'].start,
    counts: { matched: matchedExternalIds.size }
  });

  for (const batch of chunkValues(safeExternalIds, batchSize)) {
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
    for (const row of rows) {
      if (String(row && row.status).toLowerCase() === 'confirmed') {
        const externalId = normalizeExternalId(row && row.external_id);

        if (externalId) {
          matchedExternalIds.add(externalId);
        }
      }
    }
    processed += batch.length;
    emitLookupProgress(progressOptions, 'external-id-lookup', {
      total: safeExternalIds.length,
      processed,
      counts: {
        matched: matchedExternalIds.size,
        missing: Math.max(0, safeExternalIds.length - matchedExternalIds.size)
      }
    });
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

function buildConfirmedJobByExternalId(jobs) {
  const confirmed = new Map();

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (String(job && job.status).toLowerCase() !== 'confirmed') {
      continue;
    }

    const externalId = normalizeExternalId(job && job.external_id);

    if (!externalId || confirmed.has(externalId)) {
      continue;
    }

    confirmed.set(externalId, {
      jobId: normalizeCellText(job && job.job_id),
      workplaceId: normalizeCellText(job && job.workplace_id)
    });
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

function normalizeTechnicalName(value) {
  return normalizeCellText(value)
    .toLowerCase()
    .replace(/^(?:(?:мк|мм)\s+)+/u, '')
    .trim();
}

function compositeKey(date, time, technicalName) {
  if (!date || !time || !technicalName) {
    return '';
  }

  return [date, time, technicalName].join('\u001f');
}

function normalizeCompositeEmployee(value) {
  return normalizeCellText(value).toLowerCase();
}

function compositeEmployeeKey(date, time, technicalName, employeeName) {
  if (!date || !time || !technicalName || !employeeName) {
    return '';
  }

  return [date, time, technicalName, employeeName].join('\u001f');
}

function compositeEmployeeDateKey(date, technicalName, employeeName) {
  if (!date || !technicalName || !employeeName) {
    return '';
  }

  return [date, technicalName, employeeName].join('\u001f');
}

function compositeCandidateForRow(row) {
  const date = normalizeCompositeDate(row && row.dateFrom);
  const time = normalizeCompositeTime(row && row.timeFrom);
  const technicalName = normalizeTechnicalName(row && row.workplace);
  const key = compositeKey(date, time, technicalName);

  if (!key) {
    return null;
  }

  return { date, time, technicalName, key };
}

function compositeEmployeeCandidateForRow(row) {
  const candidate = compositeCandidateForRow(row);
  const employeeName = normalizeCompositeEmployee(row && row.employee);
  const key = candidate
    ? compositeEmployeeKey(candidate.date, candidate.time, candidate.technicalName, employeeName)
    : '';

  if (!key) {
    return null;
  }

  return {
    ...candidate,
    employeeName,
    key
  };
}

function compositeEmployeeDateCandidateForRow(row) {
  const date = normalizeCompositeDate(row && row.dateFrom);
  const technicalName = normalizeTechnicalName(row && row.workplace);
  const employeeName = normalizeCompositeEmployee(row && row.employee);
  const key = compositeEmployeeDateKey(date, technicalName, employeeName);

  if (!key) {
    return null;
  }

  return {
    date,
    technicalName,
    employeeName,
    key
  };
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

function uniqueCompositeEmployeeCandidates(rows) {
  const candidates = new Map();

  for (const row of rows) {
    const candidate = compositeEmployeeCandidateForRow(row);

    if (candidate) {
      candidates.set(candidate.key, candidate);
    }
  }

  return [...candidates.values()];
}

function uniqueCompositeEmployeeDateCandidates(rows) {
  const candidates = new Map();

  for (const row of rows) {
    const candidate = compositeEmployeeDateCandidateForRow(row);

    if (candidate) {
      candidates.set(candidate.key, candidate);
    }
  }

  return [...candidates.values()];
}

function uniqueTechnicalNames(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map((row) => normalizeTechnicalName(row && row.workplace))
    .filter(Boolean))];
}

function workplaceDateKey(date, technicalName) {
  if (!date || !technicalName) {
    return '';
  }

  return [date, technicalName].join('\u001f');
}

function workplaceDateCandidateForRow(row) {
  const date = normalizeCompositeDate(row && row.startText);
  const technicalName = normalizeTechnicalName(row && row.workplace);
  const key = workplaceDateKey(date, technicalName);

  if (!key) {
    return null;
  }

  return { date, technicalName, key };
}

function uniqueWorkplaceDateCandidates(rows) {
  const candidates = new Map();

  for (const row of rows) {
    const candidate = workplaceDateCandidateForRow(row);

    if (candidate) {
      candidates.set(candidate.key, candidate);
    }
  }

  return [...candidates.values()];
}

async function loadConfirmedCompositeKeys(client, candidates, batchSizeOrOptions = DEFAULT_BATCH_SIZE) {
  const { batchSize, onProgress } = normalizeLookupOptions(batchSizeOrOptions);
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const progressOptions = { onProgress };
  const uniqueKeys = new Set();
  const uniqueMatches = new Map();
  let processed = 0;

  if (safeCandidates.length === 0) {
    emitLookupProgress(progressOptions, 'composite-lookup', {
      total: 0,
      processed: 0,
      counts: { matched: 0 }
    });

    return { uniqueKeys, uniqueMatches };
  }

  emitLookupProgress(progressOptions, 'composite-lookup', {
    total: safeCandidates.length,
    processed: 0,
    progress: PROGRESS_POINTS['composite-lookup'].start,
    counts: { matched: 0 }
  });

  for (const batch of chunkValues(safeCandidates, batchSize)) {
    const tuplesSql = batch
      .map((candidate) => `(${quoteClickHouseString(candidate.date)}, ${quoteClickHouseString(candidate.time)}, ${quoteClickHouseString(candidate.technicalName)})`)
      .join(', ');
    const technicalNameExpression = normalizedClickHouseTechnicalNameExpression('w.technical_name');
    const query = [
      'SELECT',
      '  start_date,',
      '  start_time,',
      '  technical_name,',
      '  any(job_id) AS job_id,',
      '  any(workplace_id) AS workplace_id,',
      '  count() AS confirmed_jobs',
      'FROM (',
      '  SELECT',
      '    toString(j._id) AS job_id,',
      '    toString(j.workplace) AS workplace_id,',
      '    toString(toDate(j.start)) AS start_date,',
      '    left(toString(j.start_time), 5) AS start_time,',
      `    ${technicalNameExpression} AS technical_name`,
      '  FROM mg_jobs AS j',
      '  INNER JOIN mg_workplaces AS w ON toString(j.workplace) = toString(w._id)',
      "  WHERE toString(j.status) = 'confirmed'",
      `    AND tuple(toString(toDate(j.start)), left(toString(j.start_time), 5), ${technicalNameExpression}) IN (${tuplesSql})`,
      ')',
      'GROUP BY start_date, start_time, technical_name',
      'FORMAT JSONEachRow'
    ].join('\n');
    const rows = await client.queryJSONEachRow(query, {}, 'request report confirmed composite lookup');

    for (const row of rows) {
      const key = compositeKey(
        normalizeCompositeDate(row.start_date),
        normalizeCompositeTime(row.start_time),
        normalizeTechnicalName(row.technical_name)
      );

      if (Number(row && row.confirmed_jobs) === 1) {
        uniqueKeys.add(key);
        uniqueMatches.set(key, {
          jobId: normalizeCellText(row && row.job_id),
          workplaceId: normalizeCellText(row && row.workplace_id)
        });
      }
    }

    processed += batch.length;
    emitLookupProgress(progressOptions, 'composite-lookup', {
      total: safeCandidates.length,
      processed,
      counts: { matched: uniqueKeys.size }
    });
  }

  return { uniqueKeys, uniqueMatches };
}

function normalizedClickHouseTextExpression(expression) {
  return `lowerUTF8(replaceRegexpAll(trimBoth(ifNull(toString(${expression}), '')), '\\\\s+', ' '))`;
}

function normalizedClickHouseTechnicalNameExpression(expression) {
  return `replaceRegexpAll(${normalizedClickHouseTextExpression(expression)}, '^(мк|мм)\\\\s+', '')`;
}

async function loadUniqueConfirmedCompositeEmployeeKeys(client, candidates, batchSizeOrOptions = DEFAULT_BATCH_SIZE) {
  const { batchSize, onProgress } = normalizeLookupOptions(batchSizeOrOptions);
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const progressOptions = { onProgress };
  const keys = new Map();
  let processed = 0;

  if (safeCandidates.length === 0) {
    emitLookupProgress(progressOptions, 'employee-lookup', {
      total: 0,
      processed: 0,
      counts: { matched: 0 }
    });

    return keys;
  }

  emitLookupProgress(progressOptions, 'employee-lookup', {
    total: safeCandidates.length,
    processed: 0,
    progress: PROGRESS_POINTS['employee-lookup'].start,
    counts: { matched: 0 }
  });

  for (const batch of chunkValues(safeCandidates, batchSize)) {
    const tuplesSql = batch
      .map((candidate) => [
        quoteClickHouseString(candidate.date),
        quoteClickHouseString(candidate.time),
        quoteClickHouseString(candidate.technicalName),
        quoteClickHouseString(candidate.employeeName)
      ])
      .map((parts) => `(${parts.join(', ')})`)
      .join(', ');
    const workerNameExpression = normalizedClickHouseTextExpression('wr.full_name');
    const userNameExpression = normalizedClickHouseTextExpression("concat(toString(u.lastname), ' ', toString(u.firstname), ' ', toString(u.middlename))");
    const technicalNameExpression = normalizedClickHouseTechnicalNameExpression('w.technical_name');
    const query = [
      'SELECT',
      '  start_date,',
      '  start_time,',
      '  technical_name,',
      '  employee_name,',
      '  any(job_id) AS resolved_job_id,',
      '  any(workplace_id) AS resolved_workplace_id,',
      '  uniqExact(job_id) AS confirmed_jobs',
      'FROM (',
      '  SELECT',
      '    toString(j._id) AS job_id,',
      '    toString(j.workplace) AS workplace_id,',
      '    toString(toDate(j.start)) AS start_date,',
      '    left(toString(j.start_time), 5) AS start_time,',
      `    ${technicalNameExpression} AS technical_name,`,
      `    arrayJoin([${workerNameExpression}, ${userNameExpression}]) AS employee_name`,
      '  FROM mg_jobs AS j',
      '  INNER JOIN mg_workplaces AS w ON toString(j.workplace) = toString(w._id)',
      '  LEFT JOIN mg_workers AS wr ON toString(j.worker) = toString(wr._id)',
      '  LEFT JOIN mg_users AS u ON toString(wr.user) = toString(u._id)',
      "  WHERE toString(j.status) = 'confirmed'",
      ')',
      "WHERE employee_name != ''",
      `  AND tuple(start_date, start_time, technical_name, employee_name) IN (${tuplesSql})`,
      'GROUP BY start_date, start_time, technical_name, employee_name',
      'FORMAT JSONEachRow'
    ].join('\n');
    const rows = await client.queryJSONEachRow(query, {}, 'request report confirmed employee composite lookup');

    for (const row of rows) {
      if (Number(row && row.confirmed_jobs) === 1) {
        const key = compositeEmployeeKey(
          normalizeCompositeDate(row.start_date),
          normalizeCompositeTime(row.start_time),
          normalizeTechnicalName(row.technical_name),
          normalizeCompositeEmployee(row.employee_name)
        );

        keys.set(key, {
          jobId: normalizeCellText(row && row.resolved_job_id),
          workplaceId: normalizeCellText(row && row.resolved_workplace_id)
        });
      }
    }

    processed += batch.length;
    emitLookupProgress(progressOptions, 'employee-lookup', {
      total: safeCandidates.length,
      processed,
      counts: { matched: keys.size }
    });
  }

  return keys;
}

async function loadUniqueConfirmedCompositeEmployeeDateKeys(client, candidates, batchSizeOrOptions = DEFAULT_BATCH_SIZE) {
  const { batchSize, onProgress } = normalizeLookupOptions(batchSizeOrOptions);
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const progressOptions = { onProgress };
  const keys = new Map();
  let processed = 0;

  if (safeCandidates.length === 0) {
    emitLookupProgress(progressOptions, 'employee-date-lookup', {
      total: 0,
      processed: 0,
      counts: { matched: 0 }
    });

    return keys;
  }

  emitLookupProgress(progressOptions, 'employee-date-lookup', {
    total: safeCandidates.length,
    processed: 0,
    progress: PROGRESS_POINTS['employee-date-lookup'].start,
    counts: { matched: 0 }
  });

  for (const batch of chunkValues(safeCandidates, batchSize)) {
    const tuplesSql = batch
      .map((candidate) => [
        quoteClickHouseString(candidate.date),
        quoteClickHouseString(candidate.technicalName),
        quoteClickHouseString(candidate.employeeName)
      ])
      .map((parts) => `(${parts.join(', ')})`)
      .join(', ');
    const workerNameExpression = normalizedClickHouseTextExpression('wr.full_name');
    const userNameExpression = normalizedClickHouseTextExpression("concat(toString(u.lastname), ' ', toString(u.firstname), ' ', toString(u.middlename))");
    const technicalNameExpression = normalizedClickHouseTechnicalNameExpression('w.technical_name');
    const query = [
      'SELECT',
      '  start_date,',
      '  technical_name,',
      '  employee_name,',
      '  any(job_id) AS resolved_job_id,',
      '  any(workplace_id) AS resolved_workplace_id,',
      '  uniqExact(job_id) AS confirmed_jobs',
      'FROM (',
      '  SELECT',
      '    toString(j._id) AS job_id,',
      '    toString(j.workplace) AS workplace_id,',
      '    toString(toDate(j.start)) AS start_date,',
      `    ${technicalNameExpression} AS technical_name,`,
      `    arrayJoin([${workerNameExpression}, ${userNameExpression}]) AS employee_name`,
      '  FROM mg_jobs AS j',
      '  INNER JOIN mg_workplaces AS w ON toString(j.workplace) = toString(w._id)',
      '  LEFT JOIN mg_workers AS wr ON toString(j.worker) = toString(wr._id)',
      '  LEFT JOIN mg_users AS u ON toString(wr.user) = toString(u._id)',
      "  WHERE toString(j.status) = 'confirmed'",
      ')',
      "WHERE employee_name != ''",
      `  AND tuple(start_date, technical_name, employee_name) IN (${tuplesSql})`,
      'GROUP BY start_date, technical_name, employee_name',
      'FORMAT JSONEachRow'
    ].join('\n');
    const rows = await client.queryJSONEachRow(query, {}, 'request report confirmed employee date lookup');

    for (const row of rows) {
      if (Number(row && row.confirmed_jobs) === 1) {
        const key = compositeEmployeeDateKey(
          normalizeCompositeDate(row.start_date),
          normalizeTechnicalName(row.technical_name),
          normalizeCompositeEmployee(row.employee_name)
        );

        keys.set(key, {
          jobId: normalizeCellText(row && row.resolved_job_id),
          workplaceId: normalizeCellText(row && row.resolved_workplace_id)
        });
      }
    }

    processed += batch.length;
    emitLookupProgress(progressOptions, 'employee-date-lookup', {
      total: safeCandidates.length,
      processed,
      counts: { matched: keys.size }
    });
  }

  return keys;
}

async function loadUniqueWorkplaceIdsByTechnicalName(client, technicalNames, batchSizeOrOptions = DEFAULT_BATCH_SIZE) {
  const { batchSize, onProgress } = normalizeLookupOptions(batchSizeOrOptions);
  const safeTechnicalNames = Array.isArray(technicalNames) ? technicalNames : [];
  const progressOptions = { onProgress };
  const workplaceIds = new Map();
  let processed = 0;

  if (safeTechnicalNames.length === 0) {
    emitLookupProgress(progressOptions, 'workplace-lookup', {
      total: 0,
      processed: 0,
      counts: { matched: 0 }
    });

    return workplaceIds;
  }

  emitLookupProgress(progressOptions, 'workplace-lookup', {
    total: safeTechnicalNames.length,
    processed: 0,
    progress: PROGRESS_POINTS['workplace-lookup'].start,
    counts: { matched: 0 }
  });

  for (const batch of chunkValues(safeTechnicalNames, batchSize)) {
    const namesSql = batch.map(quoteClickHouseString).join(', ');
    const technicalNameExpression = normalizedClickHouseTechnicalNameExpression('technical_name');
    const query = [
      'SELECT',
      '  technical_name,',
      '  any(workplace_id) AS resolved_workplace_id,',
      '  uniqExact(workplace_id) AS workplace_count',
      'FROM (',
      '  SELECT',
      `    ${technicalNameExpression} AS technical_name,`,
      '    toString(_id) AS workplace_id',
      '  FROM mg_workplaces',
      `  WHERE ${technicalNameExpression} IN (${namesSql})`,
      ')',
      'GROUP BY technical_name',
      'HAVING workplace_count = 1',
      'FORMAT JSONEachRow'
    ].join('\n');
    const rows = await client.queryJSONEachRow(query, {}, 'request report workplace lookup');

    for (const row of rows) {
      const technicalName = normalizeTechnicalName(row && row.technical_name);
      const workplaceId = normalizeCellText((row && row.resolved_workplace_id) || (row && row.workplace_id));

      if (technicalName && workplaceId) {
        workplaceIds.set(technicalName, workplaceId);
      }
    }

    processed += batch.length;
    emitLookupProgress(progressOptions, 'workplace-lookup', {
      total: safeTechnicalNames.length,
      processed,
      counts: { matched: workplaceIds.size }
    });
  }

  return workplaceIds;
}

async function loadUniqueWorkplaceIdsByTechnicalNameAndDate(client, candidates, batchSizeOrOptions = DEFAULT_BATCH_SIZE) {
  const { batchSize, onProgress } = normalizeLookupOptions(batchSizeOrOptions);
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const progressOptions = { onProgress };
  const workplaceIds = new Map();
  let processed = 0;

  if (safeCandidates.length === 0) {
    emitLookupProgress(progressOptions, 'workplace-date-lookup', {
      total: 0,
      processed: 0,
      counts: { matched: 0 }
    });

    return workplaceIds;
  }

  emitLookupProgress(progressOptions, 'workplace-date-lookup', {
    total: safeCandidates.length,
    processed: 0,
    progress: PROGRESS_POINTS['workplace-date-lookup'].start,
    counts: { matched: 0 }
  });

  for (const batch of chunkValues(safeCandidates, batchSize)) {
    const tuplesSql = batch
      .map((candidate) => `(${quoteClickHouseString(candidate.date)}, ${quoteClickHouseString(candidate.technicalName)})`)
      .join(', ');
    const technicalNameExpression = normalizedClickHouseTechnicalNameExpression('w.technical_name');
    const query = [
      'SELECT',
      '  start_date,',
      '  technical_name,',
      '  any(workplace_id) AS resolved_workplace_id,',
      '  uniqExact(workplace_id) AS workplace_count',
      'FROM (',
      '  SELECT',
      '    toString(toDate(j.start)) AS start_date,',
      `    ${technicalNameExpression} AS technical_name,`,
      '    toString(j.workplace) AS workplace_id',
      '  FROM mg_jobs AS j',
      '  INNER JOIN mg_workplaces AS w ON toString(j.workplace) = toString(w._id)',
      `  WHERE tuple(toString(toDate(j.start)), ${technicalNameExpression}) IN (${tuplesSql})`,
      ')',
      'GROUP BY start_date, technical_name',
      'HAVING workplace_count = 1',
      'FORMAT JSONEachRow'
    ].join('\n');
    const rows = await client.queryJSONEachRow(query, {}, 'request report workplace date lookup');

    for (const row of rows) {
      const key = workplaceDateKey(
        normalizeCompositeDate(row && row.start_date),
        normalizeTechnicalName(row && row.technical_name)
      );
      const workplaceId = normalizeCellText((row && row.resolved_workplace_id) || (row && row.workplace_id));

      if (key && workplaceId) {
        workplaceIds.set(key, workplaceId);
      }
    }

    processed += batch.length;
    emitLookupProgress(progressOptions, 'workplace-date-lookup', {
      total: safeCandidates.length,
      processed,
      counts: { matched: workplaceIds.size }
    });
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
  const progressOptions = { batchSize, onProgress: options.onProgress };
  const jobs = await loadJobsForExternalIds(client, externalIds, progressOptions);
  const confirmedExternalIds = buildConfirmedExternalIdSet(jobs);
  const confirmedJobByExternalId = buildConfirmedJobByExternalId(jobs);
  const jobsByExternalId = groupJobsByExternalId(jobs);
  const rowsForCompositeFallback = safeRows.filter((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);

    return !externalId || !confirmedExternalIds.has(externalId);
  });
  const compositeCandidates = uniqueCompositeCandidates(rowsForCompositeFallback);
  const confirmedCompositeKeys = await loadConfirmedCompositeKeys(client, compositeCandidates, progressOptions);
  const uniqueConfirmedCompositeKeys = confirmedCompositeKeys.uniqueKeys;
  const uniqueConfirmedCompositeMatches = confirmedCompositeKeys.uniqueMatches || new Map();
  const compositeEmployeeCandidates = uniqueCompositeEmployeeCandidates(rowsForCompositeFallback);
  const uniqueConfirmedCompositeEmployeeKeys = await loadUniqueConfirmedCompositeEmployeeKeys(client, compositeEmployeeCandidates, progressOptions);
  const rowsForCompositeEmployeeDateFallback = rowsForCompositeFallback.filter((row) => {
    const candidate = compositeCandidateForRow(row);

    if (candidate && uniqueConfirmedCompositeKeys.has(candidate.key)) {
      return false;
    }

    const employeeCandidate = compositeEmployeeCandidateForRow(row);

    if (employeeCandidate && uniqueConfirmedCompositeEmployeeKeys.has(employeeCandidate.key)) {
      return false;
    }

    return compositeEmployeeDateCandidateForRow(row) !== null;
  });
  const compositeEmployeeDateCandidates = uniqueCompositeEmployeeDateCandidates(rowsForCompositeEmployeeDateFallback);
  const uniqueConfirmedCompositeEmployeeDateKeys = await loadUniqueConfirmedCompositeEmployeeDateKeys(client, compositeEmployeeDateCandidates, progressOptions);
  const missingRows = safeRows.filter((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);

    if (confirmedExternalIds.has(externalId)) {
      return false;
    }

    const candidate = compositeCandidateForRow(row);
    const employeeCandidate = compositeEmployeeCandidateForRow(row);

    if (candidate && uniqueConfirmedCompositeKeys.has(candidate.key)) {
      return false;
    }

    if (employeeCandidate && uniqueConfirmedCompositeEmployeeKeys.has(employeeCandidate.key)) {
      return false;
    }

    const employeeDateCandidate = compositeEmployeeDateCandidateForRow(row);

    return !employeeDateCandidate || !uniqueConfirmedCompositeEmployeeDateKeys.has(employeeDateCandidate.key);
  });
  const rowsNeedingWorkplaceLookup = missingRows.filter((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);
    const directWorkplaceId = uniqueWorkplaceIdFromJobs(jobsByExternalId.get(externalId));

    return !directWorkplaceId && normalizeCompositeDate(row && row.startText) && normalizeCellText(row && row.workplace);
  });
  const technicalNames = uniqueTechnicalNames(rowsNeedingWorkplaceLookup);
  const workplaceIdsByTechnicalName = await loadUniqueWorkplaceIdsByTechnicalName(client, technicalNames, progressOptions);
  const rowsNeedingWorkplaceDateLookup = rowsNeedingWorkplaceLookup.filter((row) => {
    const technicalName = normalizeTechnicalName(row && row.workplace);

    return technicalName && !workplaceIdsByTechnicalName.has(technicalName);
  });
  const workplaceDateCandidates = uniqueWorkplaceDateCandidates(rowsNeedingWorkplaceDateLookup);
  const workplaceIdsByTechnicalNameAndDate = await loadUniqueWorkplaceIdsByTechnicalNameAndDate(client, workplaceDateCandidates, progressOptions);
  const enrichedMissingRows = missingRows.map((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);
    const directWorkplaceId = uniqueWorkplaceIdFromJobs(jobsByExternalId.get(externalId));
    const technicalName = normalizeTechnicalName(row && row.workplace);
    const fallbackWorkplaceId = workplaceIdsByTechnicalName.get(technicalName) || '';
    const fallbackWorkplaceIdByDate = workplaceIdsByTechnicalNameAndDate.get(workplaceDateKey(
      normalizeCompositeDate(row && row.startText),
      technicalName
    )) || '';

    return addCrmUrl(row, directWorkplaceId || fallbackWorkplaceId || fallbackWorkplaceIdByDate);
  });
  const checkedRows = safeRows.map((row) => {
    const externalId = normalizeExternalId(row && row.idLkk);
    const candidate = compositeCandidateForRow(row);
    const employeeCandidate = compositeEmployeeCandidateForRow(row);
    const employeeDateCandidate = compositeEmployeeDateCandidateForRow(row);
    const match = confirmedJobByExternalId.get(externalId)
      || (candidate && uniqueConfirmedCompositeMatches.get(candidate.key))
      || (employeeCandidate && uniqueConfirmedCompositeEmployeeKeys.get(employeeCandidate.key))
      || (employeeDateCandidate && uniqueConfirmedCompositeEmployeeDateKeys.get(employeeDateCandidate.key))
      || null;
    const checkResult = match ? CHECK_RESULT_FOUND : CHECK_RESULT_MISSING;
    const shiftUrl = match ? crmCoordinationUrl(row && row.startText, match.workplaceId) : '';

    return {
      ...row,
      checkResult,
      checkResultLabel: CHECK_RESULT_LABELS[checkResult],
      matchedShiftId: match ? normalizeCellText(match.jobId) : '',
      shiftUrl
    };
  });
  const confirmedRows = safeRows.length - missingRows.length;
  emitProgress(progressOptions, 'render-result', {
    progress: PROGRESS_POINTS['render-result'].end,
    counts: {
      total: safeRows.length,
      processed: safeRows.length,
      matched: confirmedRows,
      missing: missingRows.length
    }
  });

  return {
    rows: enrichedMissingRows,
    checkedRows,
    summary: {
      totalRows: safeRows.length,
      rowsWithId: safeRows.filter((row) => normalizeExternalId(row && row.idLkk)).length,
      checkedExternalIds: externalIds.length,
      confirmedRows,
      missingConfirmedRows: missingRows.length
    }
  };
}

function buildRequestReportCheckWorkbook(input = {}) {
  const sourceSheet = input.sourceSheet || {};
  const sourceHeaders = Array.isArray(sourceSheet.headers) ? sourceSheet.headers : [];
  const sourceRows = Array.isArray(sourceSheet.rows) ? sourceSheet.rows : [];
  const checkedRows = new Map(
    (Array.isArray(input.rows) ? input.rows : [])
      .map((row) => [Number(row && row.sourceRowNumber), row])
      .filter(([sourceRowNumber]) => Number.isFinite(sourceRowNumber))
  );
  const workbookRows = [
    [...sourceHeaders.map(normalizeCellText), ...REQUEST_REPORT_EXPORT_HEADERS]
  ];

  for (const sourceRow of sourceRows) {
    const row = checkedRows.get(Number(sourceRow && sourceRow.sourceRowNumber)) || {};
    const checkResult = normalizeCellText(row.checkResult);
    const checkResultLabel = normalizeCellText(row.checkResultLabel)
      || CHECK_RESULT_LABELS[checkResult]
      || '';

    workbookRows.push([
      ...(Array.isArray(sourceRow && sourceRow.cells) ? sourceRow.cells.map(normalizeCellText) : []),
      checkResultLabel,
      normalizeCellText(row.matchedShiftId),
      normalizeCellText(row.shiftUrl),
      normalizeCellText(row.reviewStatusLabel || row.reviewStatus)
    ]);
  }

  return buildXlsxWorkbook(workbookRows);
}

module.exports = {
  buildRequestReportCheckWorkbook,
  extractRequestsReportRowsFromSheetRows,
  findRequestReportRowsWithoutConfirmedShift,
  parseRequestsReportWorkbook,
  PROGRESS_POINTS
};
