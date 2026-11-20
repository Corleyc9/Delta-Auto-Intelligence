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
| `TEKMETRIC_VERIFY_LABEL` | Optional. Exact Tekmetric Job Board label applied after dashboard **Verified**. Defaults to `Verified/Send Estimate` (slash, no spaces — confirmed on Devin’s teach demo). Set this only if the live chip text ever changes. |
| `BAYSCAN_DEVICE_KEY` | Bay Scan devices. `POST /api/bayscan/scan`, `POST /api/bayscan/photo-request`, `POST /api/bayscan/scan-request/claim`, and `POST /api/bayscan/scan-request/status`. One shared secret, or per-bay `bay1:<secret>,bay2:<secret>`. Never a Tekmetric credential. |

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

## Windows reader cadence (D1 / CPU)

Defaults are slower than the original ~1 minute Job Board loop so the shop PC and Cloudflare D1 free-tier row reads last through a Canton workday. Existing `reader-config.json` files that still have `sync_minutes: 1` are upgraded on the next start.

| Work | Default | Notes |
| --- | --- | --- |
| Main loop / Job Board | **8 minutes** | `sync_minutes`. Needs Attention still posts every cycle. |
| Full End of Day / technician / writer reports (Today, this week, last week) | **20 minutes** | `full_report_minutes`. Not every 5 minutes. |
| WIP ticket audit + Goal Miss scrape | **60 minutes** | `wip_audit_minutes`. Was ~20 minutes. |
| Schedule screenshots | **Hourly, 7am–7pm Central** | Unchanged on purpose; still not more than once per hour. |
| Steer hot list | **6 hours** | Unchanged. |
| Vehicle-history customer crawl | **Overnight only, 10pm–6am Central** | `vehicle_history_mode` default `overnight`. Set `off` to pause entirely, or `always` only if you accept daytime D1/CPU. Batches of 2 customers, 20 minutes apart, during that window. |

Reinstall the reader ZIP from the dashboard after this build so the shop PC actually runs the new loop. Editing `reader-config.json` by hand is optional.

## GM dashboard

Overview is an **action board**: Needs Attention, Verify, Problems (aged WIP / critical GP findings), GP flags, then pace (hours, cars, ARO, sales, recovery). Extra Overview widgets (labor, A/R, technician bars, sales trend, Ask Delta AI, webhook event grid) sit under **More metrics**.

The left rail keeps **Overview**, **Verify**, and **Board** in sight. Lot Walk, Goal Miss ticket detail, Ticket Auditor, Warranty, AI Review, Leads, Writers, Schedule, Payroll, Reader, and Settings are under **More**. Nothing was deleted.

**This month** is hidden until the reader captures a real monthly range. The picker is Today / this week / last week only. Sample monthly numbers are not shown as if they were live.

**Ask GM backup** stays in the header. Tekmetric Custom Integration webhook paths are unchanged. Do not invent a Tekmetric API. Webhooks and the shop PC reader remain the only live data paths.

## Verify → Tekmetric label

Dashboard **Verified** still saves immediately (including when the shop PC is offline). It also enqueues a durable job keyed by RO# so the Windows reader can change that RO’s Tekmetric Job Board label on the next loop.

- **Default label string:** `Verified/Send Estimate` (slash, no spaces — confirmed on Devin’s Job Board dropdown teach demo; orange/red chip). Incoming tags `Verify`, `Verify Parts&Labor`, and `Verify Parts/Labor` still mean *needs review* and are not written back.
- **Override:** Worker env/secret `TEKMETRIC_VERIFY_LABEL` (no code change). Leave unset unless the live chip text ever changes.
- **UI:** Verify history shows Tekmetric label **waiting for shop reader** / **applying** / the applied name / **failed** plus the reader error.
- **Behavior:** the shop reader uses the signed-in Chrome profile on **Job Board ACTIVE column view** (`shop 4326`). It opens the status/label dropdown **on the RO card** and selects `Verified/Send Estimate`, replacing e.g. In-Progress. RO deep links look like `/admin/shop/4326/repair-orders/{internalId}` and are a fallback only; a session-expired redirect becomes Needs Attention, not a burned job. No Tekmetric password is stored on the Worker.

After deploy, reinstall the reader ZIP from the dashboard so the shop PC loop actually claims these jobs.

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
- Applying the **Verified/Send Estimate** label after a dashboard Verify click (no Tekmetric write API)
- Anything Tekmetric does not put in the webhook body

Do not turn off the shop PC reader after enabling webhooks.

## What changed versus the previous system

- Shop-floor UI uses auto-shop blue and steel instead of the old red-on-black single page.
- `app/page.tsx` is orchestration only; views live under `app/components/`.
- Reader sources are split into `config.py`, `numeric.py`, `version.py`, and `parsers/`.
- Reader version/build hash is visible on the dashboard, in `reader.log`, inside the ZIP, and beside Download.
- Empty critical snapshots are rejected (HTTP 422) instead of wiping last-known state.
- Sign-in needs are reported per system (`tekmetric_signin_required`, `steer_signin_required`, `napa_signin_required`) without freezing the loop.
- Default reader cadence is 8 / 20 / 60 minutes (Job Board / full reports / WIP audit). Vehicle-history crawl is overnight Central only.
- Overview is a GM action board; lower-daily-use screens live under **More**. This month sample is hidden.
- Lazy `CREATE TABLE IF NOT EXISTS` statements from API routes are centralized in `db/ensure-schema.ts` and `drizzle/0001_consolidate_tables.sql`.
- Tekmetric Custom Integration webhooks persist to D1 (`drizzle/0002_tekmetric_webhooks.sql`) without replacing the reader path.
- Sanitized parser fixtures live in `reader/tests/fixtures/`.

Payroll tables, technician targets, GP formulas, and API payload shapes are unchanged from the companion source.

## Bay Scan check-in uploads

Handhelds (the bay Raspberry Pi) POST a scan to `POST /api/bayscan/scan`. The route stores the scan in D1 and matches the VIN to the latest synced Job Board snapshot. It never creates a Tekmetric ticket. v1.6.23 also lets the Tech Board ask the shop Mac to run that scan; see below.

Device auth (the same headers on every Bay Scan device route):

- Header `Authorization: Bearer <secret>`
- Header `x-bayscan-device: bay1` (the device id; the body `deviceId` is the fallback)
- Worker secret `BAYSCAN_DEVICE_KEY`: one shared secret, or per bay `bay1:<secret>,bay2:<secret>` (or the same map as JSON)
- Routes: `POST /api/bayscan/scan`, `POST /api/bayscan/photo-request` (and its GET), `POST /api/bayscan/scan-request/claim`, `POST /api/bayscan/scan-request/status`

A missing or wrong key returns **401** `Invalid device key`. If `BAYSCAN_DEVICE_KEY` is unset, the route returns **503** and does not crash. A single open-RO VIN match returns `matchedBy: "vin"`. If no full VIN matches, the last 6 characters match only when exactly one open RO fits (`matchedBy: "last6"`). `openRosWithoutVin` counts open job-board ROs that still have no VIN. Anything else stays on the Tech Board **Unmatched scans** list.

```bash
npx wrangler secret put BAYSCAN_DEVICE_KEY
```

Do not put the secret value in git, logs, or the dashboard.

## Bay Scan from the Tech Board (v1.6.23)

Anyone signed in to the Tech Board, including the shared Lobby TV login, can press **Bay Scan** on an RO. v1.6.24 puts that button on each RO card on the board, so the ticket does not have to be open. v1.6.25 moves it off the top of the card and onto the requested-job row at the bottom, next to the job name, on tech lanes, the Unassigned column, and the front-office rows. The card button is a small touch target. Tapping it does not open the drawer. The card shows **Requested…**, **Scanning…**, **Done**, or **Failed** with the reason. The board still polls every 4 seconds only while a request is active, and every 60 seconds otherwise. The same button stays in the ticket drawer.

Pressing it stores one scan request. Pressing again while that request is still active (`pending`, `claimed`, or `scanning`) returns the same row. The shop Mac listens in the background, claims the oldest pending request, runs the Bay Scan dongle, then posts the scan. On success it calls `POST /api/bayscan/photo-request` the same way the handheld did, and that photo lands on the same RO.

The Mac uses the device auth above. It does not use the Tech Board bot key.

A pending request expires after 5 minutes unclaimed. A claimed or scanning request expires 10 minutes after it was claimed if it is still not `done` or `failed`. Expiry runs on claim, on each board read, and before a `scanRequestId` scan is accepted. Only one request is claimed or scanning at a time.

### `POST /api/bayscan/scan-request/claim`

`200 { "request": { "id", "ro", "roId", "vin" } }` for the oldest pending request, which is then `claimed`. `roId` and `vin` are JSON `null` when the board does not know them. `200 { "request": null }` when nothing is waiting, or while another request is still `claimed` or `scanning`.

### `POST /api/bayscan/scan-request/status`

JSON `{ "id", "status": "scanning" | "failed" | "done", "reason"?, "message"? }` → `200 { "ok": true }`.

Shop wording for reason codes: `no_dongle` (Dongle not found), `no_car_power`, `no_ecu`, `upload_failed`, `vin_mismatch`. A request that is already `done` or `failed` stays that way. `scanning` does not revive an `expired` request. `done` or `failed` on an expired request is still recorded.

An unknown id is **404**. A missing id, or a status outside that set, is **400**.

### `POST /api/bayscan/scan`

The existing body takes an optional `scanRequestId`. When that id is an open request, the scan is saved on **that** RO (a VIN is still required). If the VIN matches a different open RO, the clicked RO still gets the scan, and the saved scan plus the check-in notes say the VIN does not match. The request is marked `done`. Notes, the PDF, the attach queue, and photo handling then run exactly as they do for a VIN-matched scan.

The success body keeps the usual fields (`matched`, `ro`, `customer`, `vehicle`, `scanId`, `display`, `openRosWithoutVin`) and adds `matchedBy: "request"`, `vinMismatch` (boolean), and `scanRequestId`.

Without `scanRequestId`, matching stays full VIN, then unique last-6, and the response is unchanged.

A `scanRequestId` that is present but not a positive integer is **400** `scanRequestId is invalid` (it does not fall through to VIN matching). An unknown id is **404**. A request that is already `done`, `failed`, or `expired` is **409** `Scan request is not open`.

Reports still go only on that RO's own Bay Scan check-in report concern, through the existing attach queue. This does not create an RO and does not approve, authorize, send, or pay.

## Production cutover for `deltaintelligence.cc` (not done in this repo)

The shop owns `deltaintelligence.cc`. Merging this PR does not change DNS or the live Worker.



1. Keep the existing D1 database and R2 bucket. Bind them as `DB` and `BUCKET`. Do not drop live tables; `ensureSchema` only adds missing tables/columns.
2. Set Worker secrets by name (values stay in Cloudflare, never in git):
   `DASHBOARD_PASSWORD`, `DASHBOARD_SESSION_SECRET`, `PAYROLL_PASSWORD`, `PAYROLL_SESSION_SECRET`, `READER_API_KEY`, `SITES_MACHINE_TOKEN`, `AI_ENCRYPTION_KEY`, `TEKMETRIC_WEBHOOK_PATH_TOKEN`, `TEKMETRIC_WEBHOOK_SECRET`, `BAYSCAN_DEVICE_KEY`.
   Example: `npx wrangler secret put DASHBOARD_PASSWORD` (repeat for each name).
3. Deploy this build to the Worker that already serves `deltaintelligence.cc` (or attach the custom domain after deploy). Confirm the dashboard login still uses user `delta`.
4. On the shop PC, download the new reader ZIP from the live dashboard. The hash next to Download must match **Reader build**. Run `install-reader.ps1`, then `register-scheduled-task.ps1` as the interactive Windows user.
5. Sign into Tekmetric, Steer, and NAPA yourself in the visible Chrome profile. Confirm one Today, current Wednesday–Tuesday week, and last week cycle, and that Job Board does not go empty.

Do not claim this repository has already updated production.
