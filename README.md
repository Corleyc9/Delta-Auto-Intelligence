# Delta Auto Intelligence

Internal management dashboard for **Delta Auto & Towing** (Canton, MS). A shop-floor Windows PC stays signed into Tekmetric, Steer, and NAPA. A visible Python/Playwright reader copies report and Job Board data into this Cloudflare Worker dashboard.

This rebuild keeps the existing business behavior (Wednesday–Tuesday `America/Chicago` week, targets, payroll tables, API payloads) while hardening the reader and splitting the dashboard UI into shop / front / office views.

This repository does **not** publish to `deltaintelligence.cc`. Domain cutover is a later, explicit step owned by the shop.

## Architecture

- **Dashboard:** Vinext `0.0.50` (Next-compatible React 19 / TypeScript / Vite) running as a Cloudflare Worker
- **Database:** Cloudflare D1 through logical binding `DB`
- **Object storage:** Cloudflare R2 through logical binding `BUCKET` (lot-walk videos and schedule screenshots). Runtime also accepts a legacy `delta_auto_lot_walks` binding name if an older Worker still uses it.
- **Shop reader:** Python 3 + Playwright Chromium, persistent visible Chrome profile under `%LOCALAPPDATA%\DeltaAutoReader`
- **Tekmetric webhooks:** authenticated `POST /api/webhooks/tekmetric` (optional unguessable path token) for Custom Integration live events
- **Auth:** shared dashboard user `delta`; separate payroll password cookie; reader posts with `x-reader-key`

Tekmetric shop URLs are shop **4326**. Do not invent new shop IDs, pay tables, or target numbers.

## Ask GM backup (Grok Bot)

While signed in, the dashboard header includes **Ask GM backup** next to Sign out. That control is a deep link into the **Grok Bot desktop app** (`grokbot://…`) for Devin’s shop GM backup chat. The Grok Bot app must be installed on the machine; the dashboard does not host that conversation itself.

## Local development

Requires Node.js `>=22.13.0` and Linux helpers (`flock`, GNU `timeout`) for the Sites-oriented scripts. Python 3 is only needed to run the Windows-reader parser fixtures (`reader/tests`); Cloudflare Workers Git builds pack the downloadable ZIP with Node and do not need `python3`.

```bash
npm run install:ci          # locked Sites install; uses scripts/sites-env.sh
# If install:ci cannot run outside the Sites image:
npm ci

npm run pack:reader         # rebuilds public/downloads/delta-auto-reader.zip (Node, no python3)
npm run build               # packs the reader, then vinext build + artifact check
npm test                    # pack, build, Node tests; Python parser fixtures when python3 exists
npm run validate:artifact   # checks dist/server/index.js after a build
npm run dev                 # local Vite/Wrangler preview
```

`npm run pack:reader` is also invoked by `npm run build`, so changing any file under `reader/` and building refreshes the downloadable ZIP, `reader/build-hash.json`, and `public/reader-version.json`. Those three must always share the same 12-character hash.

Worker name and bindings for `npx wrangler deploy` are in `wrangler.toml`: Worker `delta-auto-intelligence`, D1 `DB`, R2 `BUCKET` (runtime also accepts a legacy R2 binding named `delta_auto_lot_walks`).

## Secrets (names only)

Configure these on the Worker. Never commit values.

| Name | Used for |
| --- | --- |
| `DASHBOARD_PASSWORD` | Shared login for user `delta` |
| `DASHBOARD_SESSION_SECRET` | Signs `delta_dashboard_session` (falls back to the dashboard password if unset) |
| `PAYROLL_PASSWORD` | Second password for the payroll calculator |
| `PAYROLL_SESSION_SECRET` | Signs `delta_payroll_session` |
| `READER_API_KEY` | Windows reader `x-reader-key` |
| `SITES_MACHINE_TOKEN` | Optional Sites dispatch header; local/Cloudflare deploys can use a placeholder |
| `AI_ENCRYPTION_KEY` | Encrypts the optional stored OpenAI key for Delta AI |
| `TEKMETRIC_WEBHOOK_PATH_TOKEN` | Unguessable path segment for the Custom Integration URL (`/api/webhooks/tekmetric/<token>`). Generate with `openssl rand -hex 32`. |
| `TEKMETRIC_WEBHOOK_SECRET` | Optional shared secret. Put it in the webhook URL as `?secret=...` (Tekmetric’s Custom Integration UI is name + URL + event checkboxes; it does not document HMAC). Also accepted as `X-Tekmetric-Webhook-Secret`, `Authorization: Bearer`, or HMAC-SHA256 if a signature header is ever sent. |
| `TEKMETRIC_SHOP_ID` | Optional. Defaults to `4326`. Events with a different shop id are stored but do not change shop signals. |

Logical bindings in `wrangler.toml` and `.openai/hosting.json`: `d1` = `DB`, `r2` = `BUCKET`. This rebuild does not reuse the previous Sites `project_id`.

## Windows reader install

1. Download `public/downloads/delta-auto-reader.zip` from the dashboard **Download Windows reader** button (the hash next to Download must match **Reader build** on the dashboard).
2. Unzip on the shop PC.
3. Run `install-reader.ps1` in PowerShell. It copies the full package (`reader.py`, parsers, `version.py`, `build-hash.json`, scripts) into `%LOCALAPPDATA%\DeltaAutoReader`, creates a venv, and installs Playwright Chromium.
4. Paste the dashboard URL, reader key, and machine token when prompted (`--configure` is interactive on purpose).
5. Sign into Tekmetric, Steer, and NAPA **yourself** in the visible Chrome window. The reader never stores those passwords and will not type credentials.
6. Optionally run `register-scheduled-task.ps1` while logged in as the same Windows user. The task must be interactive (visible desktop). Do not install it as a Windows service.

The reader logs `Delta Auto reader {version}+{hash} starting`. If the shop PC hash does not match the dashboard Download hash, reinstall from the ZIP.

When Tekmetric, Steer, or NAPA needs a human sign-in, the loop reports **Needs Attention** and continues. It never blocks on `input()` during sync. Empty Job Board, shop, Steer, or Goal Miss scrapes are refused so the last valid snapshot stays in D1.

## Tekmetric Custom Integration (webhooks)

The shop does not have a full Tekmetric API. Use Custom Integration webhooks for live events, and keep the Windows reader for reports and Job Board detail.

Tekmetric’s Custom Integration / Webhooks UI (admin: **Settings → Integrations → Webhooks → Add Webhook**) exposes a name, a destination URL, and event checkboxes. Public partner docs do not show a signature secret field. This receiver therefore uses **URL secrecy** plus an optional shared secret you can paste into that URL.

### Worker secrets

```bash
openssl rand -hex 32   # TEKMETRIC_WEBHOOK_PATH_TOKEN
openssl rand -hex 32   # TEKMETRIC_WEBHOOK_SECRET (optional but recommended)
npx wrangler secret put TEKMETRIC_WEBHOOK_PATH_TOKEN
npx wrangler secret put TEKMETRIC_WEBHOOK_SECRET
```

Never commit the values. If neither secret is set, the endpoint returns 401 (fail closed).

### URL to paste into Tekmetric

Replace the host with the Worker that actually serves the dashboard (do not assume `deltaintelligence.cc` was updated by this repo):

```
https://<dashboard-host>/api/webhooks/tekmetric/<TEKMETRIC_WEBHOOK_PATH_TOKEN>?secret=<TEKMETRIC_WEBHOOK_SECRET>
```

Path-only also works if only `TEKMETRIC_WEBHOOK_PATH_TOKEN` is configured:

```
https://<dashboard-host>/api/webhooks/tekmetric/<TEKMETRIC_WEBHOOK_PATH_TOKEN>
```

If you only set `TEKMETRIC_WEBHOOK_SECRET`, use:

```
https://<dashboard-host>/api/webhooks/tekmetric?secret=<TEKMETRIC_WEBHOOK_SECRET>
```

If both secrets are set, both must match. If Tekmetric later sends `X-Tekmetric-Signature` / `X-Hub-Signature-256`, HMAC-SHA256 of the raw body is verified with `TEKMETRIC_WEBHOOK_SECRET`.

### Create the integration

1. Sign into Tekmetric as an admin.
2. Open **Settings → Integrations**.
3. Scroll to **Webhooks** (Custom Integration) and click **Add Webhook**.
4. **Name:** `Delta Auto Intelligence`
5. **URL:** the URL above.
6. Enable these events:

**Repair Orders:** Create; Customer Viewed Estimate; Work Approved/Declined; Complete; Post; Send to A/R; Unpost; Status or Label Change; Save for Later; Open; Delete

**Appointments:** Create; Update; Delete

**Orders:** Order Received

**Inspections:** Inspection Complete; Customer Viewed Inspection

**Payments:** Payment Received

7. Save. Tekmetric should POST JSON to the Worker. Raw payloads (and normalized fields) are stored in D1 (`tekmetric_webhook_events`). Delivery is idempotent on `X-Tekmetric-Delivery-Id` / similar headers when present, otherwise on a SHA-256 of the raw body.

### What webhooks cover vs the shop PC reader

Webhooks **do** cover live event notifications: RO created/posted/completed/unposted/sent to A/R, work approved or declined, status/label changes, appointments, inspection viewed/complete, parts order received, and payment received.

Safe side effects (only from fields actually present in the payload — hours, labels, and names are never invented):

- Work Approved/Declined → approval-timing rows; sold-hours deltas only when the payload includes hours
- Status or Label Change → Needs Diag / Verify enrollment and warranty-label watches
- Post / Complete / A/R / Payment → overview freshness signals
- Appointment create/update/delete → schedule recapture request for the existing reader

The Windows reader is **still required** for:

- Sales / GP / labor / ARO / car count / technician billed hours reports (Today, this week, last week)
- Job Board card detail (customer, vehicle, writer, complaints, sold hours on the board, WIP aging)
- Ticket auditor, Goal Miss, Delta AI review
- Steer Opportunity Hub
- NAPA warranty invoice matching
- Hourly schedule screenshots and lot-walk video
- Anything Tekmetric does not put in the webhook body

Do not turn off the shop PC reader after enabling webhooks.

## What changed versus the previous system

- Shop-floor UI uses auto-shop blue and steel instead of the old red-on-black single page.
- `app/page.tsx` is orchestration only; views live under `app/components/`.
- Reader sources are split into `config.py`, `numeric.py`, `version.py`, and `parsers/`.
- Reader version/build hash is visible on the dashboard, in `reader.log`, inside the ZIP, and beside Download.
- Empty critical snapshots are rejected (HTTP 422) instead of wiping last-known state.
- Sign-in needs are reported per system (`tekmetric_signin_required`, `steer_signin_required`, `napa_signin_required`) without freezing the loop.
- Lazy `CREATE TABLE IF NOT EXISTS` statements from API routes are centralized in `db/ensure-schema.ts` and `drizzle/0001_consolidate_tables.sql`.
- Tekmetric Custom Integration webhooks persist to D1 (`drizzle/0002_tekmetric_webhooks.sql`) without replacing the reader path.
- Sanitized parser fixtures live in `reader/tests/fixtures/`.

Payroll tables, technician targets, GP formulas, and API payload shapes are unchanged from the companion source.

## Production cutover for `deltaintelligence.cc` (not done in this repo)

The shop owns `deltaintelligence.cc`. Merging this PR does not change DNS or the live Worker.



1. Keep the existing D1 database and R2 bucket. Bind them as `DB` and `BUCKET`. Do not drop live tables; `ensureSchema` only adds missing tables/columns.
2. Set Worker secrets by name (values stay in Cloudflare, never in git):
   `DASHBOARD_PASSWORD`, `DASHBOARD_SESSION_SECRET`, `PAYROLL_PASSWORD`, `PAYROLL_SESSION_SECRET`, `READER_API_KEY`, `SITES_MACHINE_TOKEN`, `AI_ENCRYPTION_KEY`, `TEKMETRIC_WEBHOOK_PATH_TOKEN`, `TEKMETRIC_WEBHOOK_SECRET`.
   Example: `npx wrangler secret put DASHBOARD_PASSWORD` (repeat for each name).
3. Deploy this build to the Worker that already serves `deltaintelligence.cc` (or attach the custom domain after deploy). Confirm the dashboard login still uses user `delta`.
4. On the shop PC, download the new reader ZIP from the live dashboard. The hash next to Download must match **Reader build**. Run `install-reader.ps1`, then `register-scheduled-task.ps1` as the interactive Windows user.
5. Sign into Tekmetric, Steer, and NAPA yourself in the visible Chrome profile. Confirm one Today, current Wednesday–Tuesday week, and last week cycle, and that Job Board does not go empty.

Do not claim this repository has already updated production.
