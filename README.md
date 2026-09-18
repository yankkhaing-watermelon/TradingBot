# TradingBot — Bursa Research

A self-hosted, mobile-friendly Bursa Malaysia research desk. Imports the JSON reports from your scheduled research email into a persistent SQLite archive. No paid AI API or Python packages required.

This is a new research application inspired by the analyst workflow discussed for TradingAgents; it is **not a fork of TauricResearch/TradingAgents**. It does not run LLM agents, generate fresh investment opinions, fetch live prices or place orders. The separately configured ChatGPT research task searches and analyses information and sends email; this app imports those results.

## Features

- Validated JSON upload (schema 1.0, max 5 MB / 500 items).
- Read-only Gmail attachment sync, manually or every 15 minutes when configured.
- Account verification against `GMAIL_ACCOUNT` on every sync.
- Research feed, company/code search, category filter, company views, source links, coverage warnings, import history and latest-report export.
- Facts, interpretation, catalysts and risks kept distinct; optional `bull_case` / `bear_case` displayed only when supplied.
- Exact duplicate reports/items suppressed; changed items with the same ID retained as revisions. Older versions remain visible as separate research records.
- SQLite transactions prevent partial imports. Leading zeros in Bursa stock codes are preserved.
- Dark/light theme and phone layout. Imported strings are rendered as text, not HTML.

## Run locally (Python 3.10+)

Download this repository ZIP and extract it. From that folder run:

```sh
python app.py
```

Open http://127.0.0.1:8080 and paste the access token printed in the terminal. Download a `bursa-research-YYYY-MM-DD.json` attachment from your research email and click **Import JSON**. No Gmail credentials are needed for file upload. No demonstration market data is preloaded.

The server creates `data/research.sqlite3`. Keep the app running while using it. Set `APP_TOKEN` to retain the same token across restarts; otherwise a random one is printed on every start. The browser keeps it in session storage for the current tab.

Native Python reads OS environment variables; it does not automatically load `.env`.

## Docker / Synology Container Manager

1. Copy `.env.example` to `.env` and replace `APP_TOKEN` with a long random secret.
2. Start with `docker compose up -d --build`, or create a Container Manager project from this folder and `compose.yaml`.
3. Open http://127.0.0.1:8080 on the Docker host. Compose binds to loopback by default. On a NAS, configure a trusted HTTPS reverse proxy to localhost:8080 for browser access, or deliberately bind the port to the NAS LAN address for a trusted private network.
4. Enter your configured `APP_TOKEN`.

A named volume preserves the database across container restarts. Back it up before upgrades. `docker compose down -v` deletes that volume; avoid it when retaining research.

This uses Python's basic HTTP server and is intended for local/private use. Do not expose its port directly to the public internet. Remote use needs HTTPS and an authenticated reverse proxy. Credentials remain server-side; never put Google tokens into frontend code or GitHub.

## Gmail setup (optional)

Connecting Gmail in ChatGPT does **not** connect this separately hosted application. Supply your own Google OAuth credentials with the minimum `https://www.googleapis.com/auth/gmail.readonly` scope:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_ACCOUNT` (defaults to `investmalaysia2025@gmail.com`)

Google setup requires enabling the Gmail API, configuring OAuth consent and creating an OAuth client, then obtaining a refresh token through Google's consent flow. This version accepts credentials but does not yet include an OAuth sign-in wizard. Follow the official [Gmail API authentication guide](https://developers.google.com/workspace/gmail/api/auth/about-auth) and [OAuth web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server). Google consent/testing mode can affect token lifetime; consult its current documentation. Do not paste tokens into chat or commit them.

After configuring credentials, restart the app. **Sync Gmail** reads matching messages and imports JSON attachments. Automatic polling runs at startup and every `GMAIL_POLL_SECONDS` (default 900; minimum 60; 0 disables). Scheduling of the research email remains separate; polling retrieves it after arrival, not necessarily precisely at 8 PM.

Search: `subject:"Bursa Research" has:attachment filename:json`. Sync reads at most 250 matching messages per run and reports if more exist. Use manual upload for older backfills. Exact-content deduplication makes repeated sync safe. It never sends, marks read, moves or deletes mail. Attachment failures remain available to retry. Valid JSON from any matching email can be imported, so this mailbox should be dedicated to trusted research. Import validation is not verification of financial claims.

## Import contract

See `examples/report-template.json`. It is an empty structural template, **not actual research**. Required top-level fields:

- `schema_version`: `"1.0"`; `market`: `"BURSA"`
- `report_date`: `YYYY-MM-DD`
- `generated_at`, `coverage_start`, `coverage_end`: ISO timestamps including timezone
- `summary`, `coverage_gaps`: arrays of text (a single text string is also accepted)
- `items`: array of research objects

Each item requires `id`, `stock_codes` (array of 4–6 digit strings), `company_names`, `category`, `headline`, `facts`, `analysis`, `catalysts`, `risks`, `sources`, `verification_status`. Text collections accept strings, arrays, or null. Each source needs an HTTP(S) `url`, a `title`, and `published_at` (text or null). At least one source per item is required. Use `[]` for macro items with no stock code. Unknown verification should be the explicit string `unknown`. Optional `bull_case` and `bear_case` are supported. Do not invent them to fill the interface.

Reports are deduplicated by normalized content; item revisions are deduplicated by normalized item content. Different IDs or changed text can produce separate records for the same real-world event; semantic deduplication is not claimed. Latest-report ordering uses report date then timezone-aware generated timestamp. Prefer consistent `+08:00` timestamps from the research producer.

## Tests

```sh
python -m unittest discover -s tests -v
```

Tests cover atomic validation, duplicates, revisions, leading zeros, unsafe source links, timestamp validation, nested Gmail attachments and wrong-account rejection. Gmail API behaviour is mocked; a live sync still needs credentials and a test research email.

## Current boundaries

- Scheduled research email configured separately in ChatGPT, not by this code.
- No live Gmail sync has been verified without app-specific credentials.
- No brokerage connection, AI API, live market feed or automated trading.
- No hosting deployment is included; repository code is ready for local/private Docker setup.
