# Cloudflare setup — no NAS or always-on computer

The Worker serves the app and API; D1 stores the research. The scheduled ChatGPT task sends research emails separately. Cloudflare imports them after Gmail OAuth is configured. No AI API is used by this app.

## 1. Create the database

In the Cloudflare dashboard, open **Storage & databases → D1 → Create database**. Name it `tradingbot-research`. Copy its **Database ID** (this ID is not a password).

In GitHub, edit `wrangler.jsonc`: replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with that ID and commit. Keep binding name `DB`.

Open the D1 database's **Console**. Paste the complete SQL from [migrations/0001_research.sql](migrations/0001_research.sql) and execute it. The statements create tables without deleting existing data.

## 2. Connect the repository

In **Workers & Pages**, create a Worker connected to GitHub and select `yankkhaing-watermelon/TradingBot`, branch `main`.

- Worker name: `tradingbot`
- Root: repository root
- Build command: `npm test`
- Deploy command: `npx wrangler deploy`
- Node version: 24 (tests use Node's built-in SQLite)

Cloudflare installs package.json dependencies. This project uses Wrangler 4.x; there is no frontend bundle step. Do not choose a Pages-only static deployment or Python build. Deploy after the database ID is committed and the SQL is executed.

## 3. Set the access token

Worker **Settings → Variables and Secrets**: add a **Secret** named `APP_TOKEN`, with a four-digit PIN (leading zeros are supported) or a random value of at least 24 characters. Save/deploy the change. Keep it private; don't commit it to GitHub. Open the Worker URL and enter this same value to unlock the research API.

The page shell is public; research and import APIs require the token. Missing or invalid APP_TOKEN fails closed. A four-digit PIN has only 10,000 possibilities and offers limited protection on a public website; a longer token is recommended. Anyone given the token can read and import research. Use Cloudflare Access as an additional layer if needed.

## 4. Test JSON upload

Download the JSON attachment from the research email and use **Import JSON**. Alternatively, the empty example template tests the format but contains no real research. Check company/source display and import the same file again to verify the duplicate response.

The Cloudflare report limit is **900 KB**, lower than the Python version, to keep each report within one D1 row. Each report is stored atomically. Split larger research collections into separately identified reports. Different reports may share items; duplicate item content is collapsed within the displayed page. Import-history counts describe items in newly stored reports, not globally unique items.

The UI displays 20 reports at a time, with Older/Newer controls. Counts and company/search views cover the displayed page. Older reports remain stored. No retention deletion runs automatically.

## 5. Optional automatic Gmail import

Add these Worker secrets:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

Use a Google OAuth client and a refresh token for `gmail.readonly`, authorised as `investmalaysia2025@gmail.com`. `GMAIL_ACCOUNT` is already set in wrangler.jsonc. ChatGPT's Gmail connection cannot be reused as credentials for your Worker. This version does not include an OAuth sign-in wizard.

Official setup: [Gmail authentication](https://developers.google.com/workspace/gmail/api/auth/about-auth), [OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server). Configure consent and token lifetime appropriately; testing-mode tokens may expire. Never paste secrets into chat.

The Cron Trigger checks every 15 minutes, all day, including after the 8 PM Malaysia research email. No Gmail requests occur when secrets are absent. Each run checks the newest 10 matching messages within 30 days, handles at most two JSON attachments per message, and skips previously successful messages. Failed imports remain eligible for retry. Use file upload to backfill older messages beyond this bounded window. Mail is never deleted, moved, marked read or sent by this Worker.

## Verification status

Local Node tests validate the Worker API, import validation and SQL using SQLite with a D1-compatible test adapter. They do not replace a live Cloudflare deployment test. Live D1 bindings, Cron execution, Gmail consent and browser layout must be checked after deployment. Cloudflare account usage limits and pricing apply; no claim of unlimited free hosting is made.
