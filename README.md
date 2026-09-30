# DailyDrop

DailyDrop is a small household delivery ledger. It records scheduled and on-demand receipts, builds bills from historical delivery snapshots, and gives administrators a monthly payment directory. The frontend is plain HTML, CSS, and JavaScript; the server logic lives under `src/`, while the static browser client remains in `public/`.

## Requirements

- Node.js 22.13 or later (the built-in `node:sqlite` module is used)
- npm

## Run locally

```sh
npm install
npm start
```

Open `http://localhost:3000`. `npm run dev` starts Node's watch mode for local development, and `npm test` runs the API integration test against an isolated temporary database. The first SQLite connection may print Node's experimental-module warning; SQLite is included with the supported Node runtime and needs no native package installation.

## Install on a phone

Deploy over HTTPS, open DailyDrop in the mobile browser, and choose **Add to Home Screen** (or **Install app**) from the browser menu. The installed app opens without browser controls. DailyDrop caches its interface shell for launch, but sign-in and ledger data still require a network connection.

Set the initial administrator username before starting the app and registering that account. For example, in PowerShell:

```powershell
$env:ADMIN_USERNAMES = "household-admin"
$env:PORT = "3000"
npm start
```

In Bash:

```sh
ADMIN_USERNAMES=household-admin PORT=3000 npm start
```

Register using that exact username (case-insensitive). When `ADMIN_USERNAMES` is set, its comma-separated list is authoritative: existing users are synchronized at startup and new registrations receive administrator status only when listed. If it is unset, accounts are not administrators. Configure the value before creating the initial account; do not place credentials or secrets in source control.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener port; the host-provided value is respected. |
| `NODE_ENV` | unset | Set to `production` behind HTTPS to enable Secure cookies and HSTS. |
| `DB_PATH` | `data/dailydrop.sqlite` | SQLite database file path. Relative paths resolve from the application working directory. |
| `ALLOW_REGISTRATION` | `true` | Set to `false` to disable new account registration. |
| `ADMIN_USERNAMES` | unset | Comma-separated administrator usernames; when set, this is the source of truth. |
| `TRUST_PROXY_HOPS` | `0` | Non-negative number of trusted reverse-proxy hops used for client IP and rate limiting. |

Registration and login have per-IP limits. Forwarded client IP headers are ignored with the default proxy setting. Set `TRUST_PROXY_HOPS` only when the trusted proxy overwrites or sanitizes incoming forwarding headers; never trust client-supplied forwarding data through an untrusted proxy chain. In production, terminate HTTPS at the hosting platform or a trusted reverse proxy, set `NODE_ENV=production`, and ensure all traffic reaches the app over TLS.

## Storage and deployment

The SQLite file, WAL, and shared-memory files live under `data/` by default. That directory is ignored by Git. Production deployments need a persistent, writable disk mounted at the database path; ephemeral container filesystems will lose user data on restart or redeploy. Back up the database using a SQLite-aware backup method, and avoid running multiple independent app instances against a local SQLite file on separate disks.

For Render, the repository includes a `render.yaml` Blueprint that defines the Node web service, a persistent disk mounted at `/var/data`, and `DB_PATH=/var/data/dailydrop.sqlite`. Push the repository to GitHub, then in Render choose **New + > Blueprint** and connect that repository. During initial setup, provide the username to receive administrator access. The Blueprint uses a paid web-service plan because Render requires a paid service for persistent disks. Keep the service at one instance; the SQLite file is local to its attached disk.

The first deployment enables registration so the administrator account can be created. After registering and confirming access, set `ALLOW_REGISTRATION` to `false` in the Render service's environment settings and redeploy. The Blueprint configures production mode and one trusted proxy hop for Render's front proxy. A GitHub Actions workflow can run `npm ci` and `npm test` on pushes before triggering the host's deployment integration. GitHub Pages alone cannot host DailyDrop because the application requires a Node server and persistent SQLite storage.

The application serves from its workspace directory and has no frontend build step. Keep `node_modules/`, database files, and environment files out of commits. The browser uses the server's same-origin API and does not receive password hashes or session tokens.

## Delivery and billing rules

Schedules support daily, alternate-day, every-N-day, weekday, monthly-day, and on-demand products. Monthly schedules that request a date beyond a month's length use the final day of that month. An entry records the product name and unit price at receipt time; editing or deleting a product does not rewrite historical bills. A missed entry has quantity zero and contributes no amount. Bills and reports are calculated from received entries. Each user/month has one administrator-maintained payment amount, which may be partial.

Displayed currency uses the browser's locale with USD as the currency code. Change the `moneyFormat` currency in `public/app.js` if the deployment serves a different currency region.