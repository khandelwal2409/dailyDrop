# DailyDrop

DailyDrop is a small household delivery ledger. It records scheduled and on-demand receipts, builds bills from historical delivery snapshots, and gives sellers a monthly payment directory. The frontend is plain HTML, CSS, and JavaScript; the server logic lives under `src/`, while the static browser client remains in `public/`.

## Requirements

- Node.js 22.13 or later (`node:sqlite` powers local development)
- npm

## Run locally

```sh
npm install
```

Copy `.env.example` to `.env`, then run `npm start`. Local development uses SQLite at `data/dailydrop.sqlite` by default; change `DB_PATH` to use another file. `npm start` and `npm run dev` load `.env` automatically; open `http://localhost:3000`. `npm test` exercises the local SQLite API and the PostgreSQL migration path.

## Install on a phone

Deploy over HTTPS, open DailyDrop in the mobile browser, and choose **Add to Home Screen** (or **Install app**) from the browser menu. The installed app opens without browser controls. DailyDrop caches its interface shell for launch, but sign-in and ledger data still require a network connection.

## Separate user and seller links

Share `/` with regular users; it opens the blue user app. Share `/seller` with seller accounts; it opens the red seller app and has a separate home-screen name and cart icon. The seller URL is not a password or security boundary: regular accounts are redirected, and seller API routes enforce permissions on the server.

Set the initial seller username before starting the app and registering that account. For example, in PowerShell:

```powershell
$env:SELLER_USERNAMES = "household-seller"
$env:PORT = "3000"
npm start
```

In Bash:

```sh
SELLER_USERNAMES=household-seller PORT=3000 npm start
```

Register using that exact username (case-insensitive). When `SELLER_USERNAMES` is set, its comma-separated list is authoritative: existing users are synchronized at startup and new registrations receive seller access only when listed. If it is unset, accounts are regular users. Configure the value before creating the initial seller account; do not place credentials or secrets in source control.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener port; the host-provided value is respected. |
| `NODE_ENV` | unset | Set to `production` behind HTTPS to enable Secure cookies and HSTS. |
| `DB_PATH` | `data/dailydrop.sqlite` | Local SQLite database path. Ignored by Git. |
| `DATABASE_URL` | required in production | PostgreSQL connection string. Set it in Render's service environment using the database's Internal Database URL. |
| `SQLITE_MIGRATION_PATH` | unset | In production, optional path to an old SQLite database; imported once before the server begins listening. |
| `ALLOW_REGISTRATION` | `true` | Set to `false` to disable new account registration. |
| `SELLER_USERNAMES` | unset | Comma-separated seller usernames; when set, this is the source of truth. |
| `TRUST_PROXY_HOPS` | `0` | Non-negative number of trusted reverse-proxy hops used for client IP and rate limiting. |

Registration and login have per-IP limits. Forwarded client IP headers are ignored with the default proxy setting. Set `TRUST_PROXY_HOPS` only when the trusted proxy overwrites or sanitizes incoming forwarding headers; never trust client-supplied forwarding data through an untrusted proxy chain. In production, terminate HTTPS at the hosting platform or a trusted reverse proxy, set `NODE_ENV=production`, and ensure all traffic reaches the app over TLS.

## Storage and deployment

Local development stores accounts, sessions, products, delivery history, and payments in SQLite. In production (`NODE_ENV=production`), the app uses PostgreSQL instead; keep `DATABASE_URL` private. The tracked `.env.example` lists local and production settings, while `.env` is ignored by Git. Configure production values in Render's environment settings rather than committing a production `.env` file.

For Render, the repository includes a `render.yaml` Blueprint for the Node web service. It uses the existing PostgreSQL database rather than creating another one. In the web service's **Environment** settings, set `DATABASE_URL` to the rotated database's **Internal Database URL**; keep the actual URL out of Git. The supplied database host is `dpg-dauh830u01pc73f8hflg-a`, port `5432`, database `daily_drop`, and user `daily_drop_user`. During initial setup, provide the username to receive seller access. The Blueprint retains the former `/var/data` disk temporarily so the SQLite data can be imported; do not remove it until the migration is verified and backed up. When updating an existing deployment, replace `ADMIN_USERNAMES` with `SELLER_USERNAMES` in Render settings.

To test the live Render connection, open the web service's **Shell** and run:

```sh
node --input-type=module -e "import pg from 'pg'; const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); try { const result = await pool.query('SELECT current_database() AS database, current_user AS username'); console.log(result.rows[0]); } finally { await pool.end(); }"
```

It should report database `daily_drop` and user `daily_drop_user` without printing the connection URL or password. Then check the service deploy logs and open the deployed `/seller` URL to exercise the app against PostgreSQL. For local `psql` testing, use the database's External Database URL; the Internal Database URL is for Render services.

### Import existing SQLite data

On Render startup, if `SQLITE_MIGRATION_PATH` points to an existing SQLite database and the import has not already completed, the server copies its users, sessions, products, delivery snapshots, and payments into an empty PostgreSQL database before it begins listening. The Blueprint points this setting to `/var/data/dailydrop.sqlite`, so existing Render data is imported before the new version serves requests. New installations without that legacy file need no import. Local startup stays on SQLite and does not run this import.

The one-time CLI command is also available for a controlled manual import:

```sh
npm run migrate:sqlite -- /var/data/dailydrop.sqlite
```

The importer refuses to merge into a non-empty PostgreSQL database and never deletes the SQLite source. It records completion in PostgreSQL, so repeat invocations skip a completed import. Verify the accounts and historical bills in the app before removing the old Render disk.

The first deployment enables registration so the seller account can be created. After registering and confirming access, set `ALLOW_REGISTRATION` to `false` in the Render service's environment settings and redeploy. The Blueprint configures production mode and one trusted proxy hop for Render's front proxy. A GitHub Actions workflow can run `npm ci` and `npm test` on pushes before triggering the host's deployment integration. GitHub Pages alone cannot host DailyDrop because the application requires a Node server and PostgreSQL storage.

The application serves from its workspace directory and has no frontend build step. Keep `node_modules/`, database files, and environment files out of commits. The browser uses the server's same-origin API and does not receive password hashes or session tokens.

## Delivery and billing rules

Schedules support daily, alternate-day, every-N-day, weekday, monthly-day, and on-demand products. Monthly schedules that request a date beyond a month's length use the final day of that month. An entry records the product name and unit price at receipt time; editing or deleting a product does not rewrite historical bills. A missed entry has quantity zero and contributes no amount. Bills and reports are calculated from received entries. Each user/month has one seller-maintained payment amount, which may be partial.

Displayed currency uses the browser's locale with USD as the currency code. Change the `moneyFormat` currency in `public/app.js` if the deployment serves a different currency region.