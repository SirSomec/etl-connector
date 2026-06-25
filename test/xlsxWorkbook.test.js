const test = require('node:test');
const assert = require('node:assert/strict');

const { buildXlsxWorkbook } = require('../src/xlsxWorkbook');
const { parseRequestsReportWorkbook } = require('../src/requestReportMissingConfirmed');

test('generic xlsx workbook writes headers and rows', () => {
  const workbook = buildXlsxWorkbook({
    sheetName: 'Отчет',
    headers: ['client', 'shifts'],
    rows: [
      ['Brand A', 12],
      ['Brand B', 5]
    ]
  });

  assert.equal(Buffer.isBuffer(workbook), true);
  assert.equal(workbook.readUInt32LE(0), 0x04034b50);
});

test('xlsx workbook escapes formula-like text values', () => {
  const workbook = buildXlsxWorkbook({
    sheetName: 'Запросы',
    headers: ['ID ЛКК', 'Организация', 'Рабочая точка', 'Адрес', 'Сотрудник', 'Дата запроса с', 'Время запроса с'],
    rows: [
      ['1', '=cmd|A1', '+SUM(1,1)', '-10', '@handle', '2026-06-01', '09:00']
    ]
  });
  const parsed = parseRequestsReportWorkbook(workbook);

  assert.equal(parsed.rows[0].organization, "'=cmd|A1");
  assert.equal(parsed.rows[0].workplace, "'+SUM(1,1)");
  assert.equal(parsed.rows[0].address, "'-10");
  assert.equal(parsed.rows[0].employee, "'@handle");
});
