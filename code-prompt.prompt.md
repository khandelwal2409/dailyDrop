---
name: "DailyDrop App Generator"
description: "Create the DailyDrop delivery tracker with its full UI, API, SQLite persistence, authentication, reporting, and admin payment features."
agent: agent
argument-hint: ""
---

Act as a senior full-stack engineer. Inspect the current workspace, then implement a complete, working DailyDrop application. Do not stop at a plan or scaffold, and do not replace unrelated existing user work. If the workspace already contains this application, preserve its existing behavior and improve or complete it in place.

# DailyDrop App Generator

## Product

Build a responsive web app for individuals or households to track recurring product deliveries, record daily receipts, calculate monthly bills, and review purchase reports. Users can access their own account and data from multiple devices. Administrators can review account summaries and record monthly payments.

## Technology and Project Structure

* Use Node.js 22.13 or later, ES modules, Express 5, and the built-in `node:sqlite` module.
* Keep the frontend dependency-free: serve plain HTML, CSS, and JavaScript from `public/`, with no build step.
* Use Express as the only runtime package. Define `npm start` and `npm run dev` scripts.
* Organize the project around `server.js`, `db.js`, `public/index.html`, `public/styles.css`, and `public/app.js`. Include `package.json`, a lockfile, `.gitignore`, `README.md`, and `architecture.md` when absent.
* Persist SQLite data under `data/` by default and allow `DB_PATH` to select another location. Ignore `data/` and `node_modules/` in Git.

## User Experience

* Provide login and registration, then show Daily, Bill, Report, Products, and Profile views. Show Admin only to administrators; enforce authorization on the server too.
* Make the interface mobile-first, accessible, and practical for frequent daily use. Include clear loading, empty, validation, and error states.
* Let users create, edit, and delete products with a name, unit price, default quantity, and schedule. Support daily, alternate-day, every-N-day, selected-weekday, monthly-day, and on-demand schedules. Alternate and every-N schedules require a start date; weekly requires one or more weekdays; every-N accepts 2-365; monthly day accepts 1-31 and uses the month's last day when necessary. Dates before a configured start date are not scheduled.
* In Daily, select a date, distinguish scheduled from unscheduled products, mark each received or missed, edit received quantity, and clear a mark by selecting it again. Allow unscheduled deliveries to be recorded.
* In Bill, select a month and show received quantity and amounts by product, monthly total, payment status, and a calendar indicating received, partial, missed, and unmarked scheduled days.
* In Report, show monthly spend, month-over-month change, deliveries, missed days, average spend per day, product summaries, a six-month trend, and a day-by-day purchase log. Support printing and CSV download. Neutralize spreadsheet formula prefixes in exported cells.
* In Profile, edit full name, email, phone, and address; change password; and log out.
* In Admin, show account statistics and a searchable user directory. Provide monthly bills grouped by user and product, totals for billed/collected/outstanding, payment status, and admin actions to record or undo a payment. Support partial payments and Cash, UPI, Card, Bank transfer, and Other methods. Users may read only their own payment record.

## Data and Business Rules

* Store users, sessions, products, delivery entries, and monthly payments in SQLite. Enable foreign keys and use prepared statements for all values.
* Scope all user-facing reads and writes to the authenticated user's ID. Preserve historical entry name and price snapshots so product edits or deletion never change past bills.
* Store an entry's quantity as zero for a missed delivery. A received entry contributes `qty * price`; an existing received entry keeps its original snapshot price and name when quantity is edited.
* Compute bills and reports from received entries rather than storing a duplicate bill total. A payment is one amount per user and month; derive paid, partial, pending, and no-bill status by comparing it with the current bill.
* Add schema migrations for new columns so existing databases upgrade without losing data.

## Backend API

Implement JSON endpoints with input validation and suitable status codes:

* `GET /api/config` returns whether registration is enabled.
* `POST /api/auth/register`, `POST /api/auth/login`, and authenticated `POST /api/auth/logout`.
* Authenticated `GET /api/me`, `PUT /api/me`, and `PUT /api/me/password`.
* Authenticated `GET /api/products`, `POST /api/products`, `PUT /api/products/:id`, and `DELETE /api/products/:id`.
* Authenticated `GET /api/entries?month=YYYY-MM`, `PUT /api/entries/:date/:productId`, and `DELETE /api/entries/:date/:productId`.
* Authenticated `GET /api/reports/monthly-totals?to=YYYY-MM&months=N`, where N is 1-24 and defaults to 6.
* Authenticated `GET /api/payments/:month`, scoped to the caller.
* Admin-only `GET /api/admin/overview`, `GET /api/admin/bills?month=YYYY-MM`, `PUT /api/admin/payments/:userId/:month`, and `DELETE /api/admin/payments/:userId/:month`.

## Security Requirements

* Hash passwords with `crypto.scrypt`, unique random salts, and constant-time comparison. Use a dummy hash on unknown-user login attempts to reduce username enumeration.
* Generate random session tokens, store only their SHA-256 hashes, and set the token in an `HttpOnly`, `SameSite=Lax` cookie. Use a 30-day expiry, `Secure` cookies and HSTS in production, and revoke other sessions when a password changes.
* Validate and bound usernames, passwords, profile fields, dates, quantities, prices, schedules, and payment data. Return generic login errors. Apply per-IP, per-route rate limits to registration and login.
* Ignore forwarded client IP headers by default. Support a non-negative integer `TRUST_PROXY_HOPS` setting, defaulting to zero. Document that proxy trust must only be enabled when the trusted proxy overwrites or sanitizes incoming forwarding headers.
* Add a 20 KB JSON body limit and security headers including a restrictive Content Security Policy, `X-Content-Type-Options: nosniff`, and clickjacking protection. Do not render user-supplied text as HTML; use safe DOM text APIs.
* Keep registration configurable with `ALLOW_REGISTRATION=false`. Configure administrators with comma-separated `ADMIN_USERNAMES`; when set, that list is the source of truth on startup and for subsequent registrations. Never expose password hashes or session tokens through the API.

## Configuration and Documentation

Support `PORT`, `NODE_ENV`, `DB_PATH`, `ALLOW_REGISTRATION`, `ADMIN_USERNAMES`, and `TRUST_PROXY_HOPS`. Respect the host-provided port. Document local setup, environment variables, initial admin setup, HTTPS deployment, persistent storage requirements for SQLite, and GitHub-based deployment. Do not commit database files, secrets, or credentials.

## Completion Checks

1. Install dependencies and verify the server starts on the configured port with a fresh database.
2. Check that the implemented frontend loads and all primary views have usable controls.
3. Exercise registration, login, logout, profile updates, password changes, product CRUD, received/missed/cleared entries, monthly totals, and per-user data isolation.
4. Verify schedule edge cases, historical price snapshots, admin-only access, partial payment updates, and payment undo.
5. Run available syntax, lint, type, and test commands. Fix failures caused by the implementation; report any checks that are unavailable.
6. Summarize files changed, security-relevant configuration, validation performed, and how to run the app. Do not deploy or publish the app unless explicitly requested.