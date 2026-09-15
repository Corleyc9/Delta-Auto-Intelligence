# Delta Auto Intelligence

Internal management dashboard for **Delta Auto & Towing** (Canton, MS). A shop-floor Windows PC stays signed into Tekmetric, Steer, and NAPA. A visible Python/Playwright reader copies report and Job Board data into this Cloudflare Worker dashboard.

This rebuild keeps the existing business behavior (Wednesday–Tuesday `America/Chicago` week, targets, payroll tables, API payloads) while hardening the reader and splitting the dashboard UI into shop / front / office views.

This repository does **not** publish to `deltaintelligence.cc`. Domain cutover is a later, explicit step owned by the shop.

## Architecture

- **Dashboard:** Vinext `0.0.50` (Next-compatible React 19 / TypeScript / Vite) running as a Cloudflare Worker
- **Database:** Cloudflare D1 through logical binding `DB`
- **Object storage:** Cloudflare R2 through logical binding `BUCKET` (lot-walk videos and schedule screenshots). Runtime also accepts a legacy `delta_auto_lot_walks` binding name if an older Worker still uses it.
- **Shop reader:** Python 3 + Playwright Chromium, persistent visible Chrome profile under `%LOCALAPPDATA%\DeltaAutoReader`
- **Auth:** shared dashboard user `delta`; separate payroll password cookie; reader posts with `x-reader-key`

Tekmetric shop URLs are shop **4326**. Do not invent new shop IDs, pay tables, or target numbers.

## Local development

Requires Node.js `>=22.13.0`, Python 3, and Linux helpers (`flock`, GNU `timeout`) for the Sites-oriented scripts.

```bash
npm run install:ci          # locked Sites install; uses scripts/sites-env.sh
# If install:ci cannot run outside the Sites image:
npm ci

npm run pack:reader         # rebuilds public/downloads/delta-auto-reader.zip
npm run build               # packs the reader, then vinext build + artifact check
npm test                    # pack, build, Node tests, Python parser fixtures
npm run validate:artifact   # checks dist/server/index.js after a build
npm run dev                 # local Vite/Wrangler preview
```

`npm run pack:reader` is also invoked by `npm run build`, so changing any file under `reader/` and building refreshes the downloadable ZIP, `reader/build-hash.json`, and `public/reader-version.json`. Those three must always share the same 12-character hash.

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

Logical bindings in `.openai/hosting.json`: `d1` = `DB`, `r2` = `BUCKET`. This rebuild does not reuse the previous Sites `project_id`.

## Windows reader install

1. Download `public/downloads/delta-auto-reader.zip` from the dashboard **Download Windows reader** button (the hash next to Download must match **Reader build** on the dashboard).
2. Unzip on the shop PC.
3. Run `install-reader.ps1` in PowerShell. It copies the full package (`reader.py`, parsers, `version.py`, `build-hash.json`, scripts) into `%LOCALAPPDATA%\DeltaAutoReader`, creates a venv, and installs Playwright Chromium.
4. Paste the dashboard URL, reader key, and machine token when prompted (`--configure` is interactive on purpose).
5. Sign into Tekmetric, Steer, and NAPA **yourself** in the visible Chrome window. The reader never stores those passwords and will not type credentials.
6. Optionally run `register-scheduled-task.ps1` while logged in as the same Windows user. The task must be interactive (visible desktop). Do not install it as a Windows service.

The reader logs `Delta Auto reader {version}+{hash} starting`. If the shop PC hash does not match the dashboard Download hash, reinstall from the ZIP.

When Tekmetric, Steer, or NAPA needs a human sign-in, the loop reports **Needs Attention** and continues. It never blocks on `input()` during sync. Empty Job Board, shop, Steer, or Goal Miss scrapes are refused so the last valid snapshot stays in D1.

## What changed versus the previous system

- Shop-floor UI uses auto-shop blue and steel instead of the old red-on-black single page.
- `app/page.tsx` is orchestration only; views live under `app/components/`.
- Reader sources are split into `config.py`, `numeric.py`, `version.py`, and `parsers/`.
- Reader version/build hash is visible on the dashboard, in `reader.log`, inside the ZIP, and beside Download.
- Empty critical snapshots are rejected (HTTP 422) instead of wiping last-known state.
- Sign-in needs are reported per system (`tekmetric_signin_required`, `steer_signin_required`, `napa_signin_required`) without freezing the loop.
- Lazy `CREATE TABLE IF NOT EXISTS` statements from API routes are centralized in `db/ensure-schema.ts` and `drizzle/0001_consolidate_tables.sql`.
- Sanitized parser fixtures live in `reader/tests/fixtures/`.

Payroll tables, technician targets, GP formulas, and API payload shapes are unchanged from the companion source.

## Production cutover (not done here)

Pointing `deltaintelligence.cc` and the shop PC at this build is a separate, explicit step:

1. Create or attach a Cloudflare Worker with D1 `DB` and R2 `BUCKET` (migrate existing data; do not drop live tables).
2. Set the secret names above on that Worker.
3. Deploy this build when the owner approves.
4. Install the new reader ZIP on the shop PC and confirm the hash matches the dashboard.
5. Sign into Tekmetric/Steer/NAPA manually in the persistent profile and watch one Today / this week / last week cycle.

Do not claim this repository has already updated production.
