const assert = require('node:assert/strict');
const test = require('node:test');

const { mergeGigerDetails } = require('../src/gigerDetails');

test('mergeGigerDetails strips ClickHouse decimal suffix from phone numbers', () => {
  const details = mergeGigerDetails(
    {
      source: 'test',
      metric: 'metric',
      metricLabel: 'Гигеры',
      filters: {},
      page: 1,
      pageSize: 20
    },
    [{ total_gigers: 2 }],
    [
      {
        user_id: 'user-1',
        worker_id: 'worker-1',
        full_name: 'Иван Иванов',
        phone: '+79990000000.0',
        status: 'ready'
      },
      {
        user_id: 'user-2',
        worker_id: 'worker-2',
        full_name: 'Анна Иванова',
        phone: 79990000001,
        status: 'worked'
      }
    ]
  );

  assert.equal(details.gigers[0].phone, '+79990000000');
  assert.equal(details.gigers[1].phone, '79990000001');
});
