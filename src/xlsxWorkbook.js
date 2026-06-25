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

function buildXlsxRows(rows, sheetName = 'Отчет') {
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

function sanitizeExcelCell(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const text = value instanceof Date ? value.toISOString() : String(value);

  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function buildXlsxWorkbook({ headers = [], rows = [], sheetName = 'Отчет' } = {}) {
  const workbookRows = [
    headers.map(sanitizeExcelCell),
    ...rows.map((row) => (Array.isArray(row) ? row : headers.map((header) => row && row[header])).map(sanitizeExcelCell))
  ];

  return buildXlsxRows(workbookRows, sheetName);
}

module.exports = {
  buildXlsxWorkbook,
  sanitizeExcelCell
};
