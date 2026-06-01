# ETL Analytics Service

Read-only web explorer for ClickHouse ETL data.

## Features

- Lists tables in the configured ClickHouse database.
- Shows column names and ClickHouse types for a selected table.
- Shows the first 100 rows from a selected table.
- Runs in Docker with Yandex Cloud CA certificates installed.
- Reads ClickHouse credentials from environment variables.

## Configuration

Create a local `.env` file from `.env.example`:

```dotenv
CLICKHOUSE_HOST=rc1a-1kv5jd0taf1ef4ah.mdb.yandexcloud.net
CLICKHOUSE_PORT=8443
CLICKHOUSE_DATABASE=etl
CLICKHOUSE_USER=rouser
CLICKHOUSE_PASSWORD=change-me
CLICKHOUSE_CA_PATH=/usr/local/share/ca-certificates/Yandex/RootCA.crt
PORT=3000
```

Set `CLICKHOUSE_PASSWORD` to the real password only in your local `.env` or
deployment environment. Do not commit `.env`.

## Local Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run the app locally:

```bash
npm start
```

Local `npm start` requires the Yandex Cloud CA certificates installed on the
host, or `CLICKHOUSE_CA_PATH` set to a readable CA certificate path. Open
`http://localhost:3000`.

## Docker

Build the image:

```bash
docker build -t etl-analytics-service .
```

Run with compose:

```bash
docker compose up --build
```

Open `http://localhost:3000`. Compose reads configuration from a local `.env`
file, so create one before starting the service.

## Security Notes

- The web UI does not accept arbitrary SQL.
- Use a read-only ClickHouse user.
- The configured password is redacted from errors rendered in the browser.
- `.env` is ignored by git.
