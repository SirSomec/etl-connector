# ETL Analytics Service Design

## Goal

Build the first iteration of a read-only web service that runs in Docker and displays available data from the Yandex Cloud ClickHouse database `etl`.

## Scope

The service exposes a browser UI for exploring the database contents:

- show available tables from the configured ClickHouse database;
- show the selected table's columns and ClickHouse types;
- show a preview of the first 100 rows from the selected table;
- show connection and query errors in the UI without exposing credentials;
- run as a Docker container with Yandex Cloud CA certificates installed.

This iteration does not include custom analytics builders, user accounts, dashboards, saved reports, data editing, or arbitrary SQL input.

## Recommended Approach

Use Node.js with Express and server-rendered HTML. This keeps the first iteration small, matches the provided HTTPS ClickHouse example, avoids frontend build complexity, and still leaves a clear path to add API endpoints or a richer frontend later.

## Configuration

Runtime configuration is provided through environment variables:

- `CLICKHOUSE_HOST`: ClickHouse HTTPS host.
- `CLICKHOUSE_PORT`: ClickHouse HTTPS port, default `8443`.
- `CLICKHOUSE_DATABASE`: database name, default `etl`.
- `CLICKHOUSE_USER`: read-only ClickHouse user.
- `CLICKHOUSE_PASSWORD`: read-only ClickHouse password.
- `CLICKHOUSE_CA_PATH`: CA certificate path inside the container, default `/usr/local/share/ca-certificates/Yandex/RootCA.crt`.
- `PORT`: web service port inside the container, default `3000`.

Credentials are not committed to the repository. A sample env file documents the required variables with placeholder values.

## Architecture

The app is split into focused modules:

- `src/config.js`: validates and exposes runtime configuration.
- `src/clickhouseClient.js`: owns ClickHouse HTTPS access and read-only query helpers.
- `src/render.js`: renders escaped HTML pages and reusable UI fragments.
- `src/server.js`: defines Express routes and connects HTTP requests to render functions.

The Docker image installs Node.js dependencies, downloads the Yandex Cloud root and intermediate CA certificates, runs `update-ca-certificates`, and starts the Express server.

## Data Flow

1. A browser requests `/`.
2. `server.js` asks `clickhouseClient.js` for tables in `CLICKHOUSE_DATABASE`.
3. `render.js` returns an HTML page with table links.
4. A browser requests `/tables/:tableName`.
5. The server verifies the table exists in the configured database.
6. The ClickHouse client loads column metadata from `system.columns`.
7. The ClickHouse client loads a preview query from the selected table with `LIMIT 100`.
8. The renderer escapes all displayed values and returns a table detail page.

## Query Safety

The UI never accepts arbitrary SQL. Table names are validated against ClickHouse metadata before preview queries run. Identifiers are quoted by the ClickHouse client, and user-controlled values are sent as request parameters where ClickHouse supports them.

The database user should remain read-only. The application does not expose mutation endpoints.

## Error Handling

Configuration errors prevent startup and produce clear server logs without secrets. Runtime ClickHouse errors render a readable error page with the failing operation name, HTTP status where available, and a sanitized message. Passwords and request headers are never included in responses.

## Web UI

The first UI is utilitarian:

- header with service name and configured database;
- table list on the home page;
- table detail page with metadata and preview rows;
- empty states for no tables or no preview rows;
- responsive layout that remains usable on desktop and mobile.

The UI should not include marketing content or placeholder dashboard cards. It should focus on data inspection.

## Testing

Automated tests cover:

- configuration defaults and missing required variables;
- ClickHouse request construction without real network calls;
- identifier quoting and table-name validation behavior;
- HTML escaping for table names, column names, and cell values;
- Express routes for home, table detail, not found, and sanitized error rendering.

Manual verification covers:

- Docker image builds successfully;
- container starts with env configuration;
- browser can open the service;
- ClickHouse connection succeeds against the configured `etl` database;
- credentials are not printed in logs or rendered pages.

## Delivery

The repository should contain:

- Dockerfile;
- docker-compose example;
- Node.js source files;
- automated tests;
- README with setup and run commands;
- `.env.example` with placeholders only.
