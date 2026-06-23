const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractRequestsReportRowsFromSheetRows,
  findRequestReportRowsWithoutConfirmedShift
} = require('../src/requestReportMissingConfirmed');

test('extractRequestsReportRowsFromSheetRows maps request report columns', () => {
  const result = extractRequestsReportRowsFromSheetRows([
    ['Служебная строка'],
    [
      'ID ЛКК',
      'Организация',
      'Рабочая точка',
      'Адрес',
      'Сотрудник',
      'Дата запроса "с"',
      'Время запроса "с"',
      'Продолжительность запроса (факт) (в часах)'
    ],
    [
      101,
      'АО "Тандер"',
      'Екатеринбург-1',
      'ул. Ленина, 1',
      'Иванов Иван',
      46174,
      0.375,
      7.5
    ]
  ]);

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.rows, [
    {
      sourceRowNumber: 3,
      idLkk: '101',
      organization: 'АО "Тандер"',
      workplace: 'Екатеринбург-1',
      address: 'ул. Ленина, 1',
      employee: 'Иванов Иван',
      dateFrom: '2026-06-01',
      timeFrom: '09:00',
      startText: '2026-06-01 09:00',
      actualDuration: '7.5'
    }
  ]);
});

test('findRequestReportRowsWithoutConfirmedShift returns rows without confirmed jobs by LKK id', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      return [
        { external_id: 'confirmed-id', status: 'confirmed', workplace_id: 'wp-confirmed' },
        { external_id: 'cancelled-id', status: 'cancelled', workplace_id: 'wp-cancelled' },
        { external_id: 'booked-id', status: 'booked', workplace_id: 'wp-booked' }
      ];
    }
  };
  const rows = [
    { idLkk: 'confirmed-id', organization: 'А', workplace: 'Т1' },
    {
      idLkk: 'cancelled-id',
      organization: 'Б',
      workplace: 'Т2',
      dateFrom: '2026-06-08',
      startText: '2026-06-09 09:00',
      actualDuration: '7.5'
    },
    { idLkk: 'missing-id', organization: 'В', workplace: 'Т3' },
    { idLkk: '', organization: 'Г', workplace: 'Т4' }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'request report confirmed shift lookup');
  assert.match(calls[0].query, /mg_orders AS o/);
  assert.match(calls[0].query, /mg_jobs AS j/);
  assert.deepEqual(result.rows.map((row) => row.idLkk), ['cancelled-id', 'missing-id', '']);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-09&searchDate[]=2026-06-09&workplaceIds[]=wp-cancelled'
  );
  assert.deepEqual(result.summary, {
    totalRows: 4,
    rowsWithId: 3,
    checkedExternalIds: 3,
    confirmedRows: 1,
    missingConfirmedRows: 3
  });
});

test('findRequestReportRowsWithoutConfirmedShift does not query ClickHouse when report has no LKK ids', async () => {
  const client = {
    async queryJSONEachRow() {
      throw new Error('query should not be called');
    }
  };
  const rows = [
    { idLkk: '', organization: 'А', workplace: 'Т1' }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows);

  assert.deepEqual(result.rows, rows);
  assert.deepEqual(result.summary, {
    totalRows: 1,
    rowsWithId: 0,
    checkedExternalIds: 0,
    confirmedRows: 0,
    missingConfirmedRows: 1
  });
});

test('findRequestReportRowsWithoutConfirmedShift uses unique confirmed composite fallback only without direct job', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report confirmed shift lookup') {
        return [
          { external_id: 'cancelled-id', status: 'cancelled' }
        ];
      }

      if (operation === 'request report confirmed composite lookup') {
        return [
          {
            start_date: '2026-06-01',
            start_time: '09:00',
            technical_name: 'Точка А',
            confirmed_jobs: 1
          },
          {
            start_date: '2026-06-01',
            start_time: '10:00',
            technical_name: 'Точка Б',
            confirmed_jobs: 2
          }
        ];
      }

      if (operation === 'request report workplace lookup') {
        return [
          {
            technical_name: 'Точка Б',
            workplace_id: 'wp-b'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: 'missing-id',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 09:00',
      timeFrom: '09:00',
      workplace: 'Точка А'
    },
    {
      idLkk: 'cancelled-id',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 09:00',
      timeFrom: '09:00',
      workplace: 'Точка А'
    },
    {
      idLkk: 'ambiguous-id',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 10:00',
      timeFrom: '10:00',
      workplace: 'Точка Б'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report confirmed composite lookup',
    'request report workplace lookup'
  ]);
  assert.match(calls[2].query, /any\(workplace_id\) AS resolved_workplace_id/);
  assert.doesNotMatch(calls[2].query, /any\(workplace_id\) AS workplace_id/);
  assert.deepEqual(result.rows.map((row) => row.idLkk), ['cancelled-id', 'ambiguous-id']);
  assert.equal(
    result.rows[1].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-01&searchDate[]=2026-06-01&workplaceIds[]=wp-b'
  );
  assert.deepEqual(result.summary, {
    totalRows: 3,
    rowsWithId: 3,
    checkedExternalIds: 3,
    confirmedRows: 1,
    missingConfirmedRows: 2
  });
});

test('findRequestReportRowsWithoutConfirmedShift builds crm date from startText even without dateFrom', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report workplace lookup') {
        return [
          {
            technical_name: 'Точка C',
            resolved_workplace_id: 'wp-c'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: 'no-job-id',
      dateFrom: '',
      startText: '2026-06-10 11:00',
      timeFrom: '11:00',
      workplace: 'Точка C'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report workplace lookup'
  ]);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-10&searchDate[]=2026-06-10&workplaceIds[]=wp-c'
  );
});
