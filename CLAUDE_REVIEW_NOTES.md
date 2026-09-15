# Claude review — Delta Auto Intelligence (revision 53)

Reviewed against the request in `AI_REVIEW_HANDOFF.md`: calculation errors, stale-data risks, Playwright reliability, data-model problems, security weaknesses, and range-mixing. This file documents what was found and what was changed. All changes are source-only — nothing has been deployed or tested against live Tekmetric/Steer/Cloudflare, since I don't have access to your accounts or the live worker.

## 1. Why the reader kept needing you to log in

`reader/reader.py` already did the right thing architecturally — a persistent, signed-in browser profile so it shouldn't need to log in every run. The actual bug: when Tekmetric or Steer forced a session expiry or re-auth, the script called Python's `input()` and froze the **entire sync loop** (Tekmetric, Steer, job board, ticket audits — all of it) waiting for someone to type into a terminal window nobody was watching. No error, no alert, just silence until someone happened to notice the dashboard was stale.

**Fixed:** replaced both blocking `input()` calls with a `NeedsSignInError` that gets caught by the sync loop, logged, and reported to a new `/api/reader-status` endpoint — then the loop retries on its normal 2-minute cycle instead of hanging. The dashboard now shows a red banner ("TEKMETRIC SIGN-IN NEEDED" / "STEER SIGN-IN NEEDED") the moment this happens, so you can see it needs attention without walking over to the shop computer. The browser window itself is still left open on the real login page, same as before — a human still has to type the password, no automation can or should bypass that.

## 2. Reader no longer requires someone to manually restart it

The reader only ran if someone double-clicked it; a reboot or crash meant stale data until noticed. Added `reader/register-scheduled-task.ps1`, which registers it as a Windows Task Scheduler task that starts automatically at logon and restarts itself (up to 999 times, 1-minute backoff) if it ever crashes. It deliberately runs as a normal logged-on-user task, not a Windows Service — the reader opens a *visible* browser window on purpose (Tekmetric/Steer sessions are tied to that real browser), and services run in a desktop-less session where that would silently fail every time.

Run once from the shop computer after `install-reader.ps1`:
```
powershell -ExecutionPolicy Bypass -File .\register-scheduled-task.ps1
```

## 3. Security: every API route was open to the internet, no sign-in required

`app/chatgpt-auth.ts` already had a `requireChatGPTUser()` helper for gating pages behind ChatGPT sign-in, but it was never called anywhere — not in `layout.tsx`, not in any API route, no `middleware.ts` either. The project's own `README.md` confirms this is opt-in: *"Routes that do not import and call the helper remain anonymous-compatible."*

Practical effect: anyone with the dashboard URL could read live sales, gross profit, technician hours, and customer names/phones/vehicles (the Steer leads list) with zero authentication. Worse, `GET /api/reader-credentials` handed back the **write credential** (`READER_API_KEY` + `SITES_MACHINE_TOKEN`) to anyone who requested it — with that, an outsider could post fabricated sales/audit data into your live dashboard.

**Fixed:** added `requireApiUser()` to `chatgpt-auth.ts` and wired it into every read endpoint (`snapshot`, `opportunities`, `job-board`, `ticket-audits`, `service-writers`, `ai-key`, `ask`, `reader-credentials`) and the interactive write endpoints (marking a lead done/skipped, saving the OpenAI key). The reader's own machine-key POSTs are untouched — they still authenticate with `x-reader-key`, not a ChatGPT session.

One nuance worth knowing: signing in with ChatGPT only proves *some* ChatGPT account is behind the request, not that it's you or your staff — the platform's own docs say SIWC "does not prove workspace membership." So I added an optional allowlist: set a `DASHBOARD_ALLOWED_EMAILS` environment variable (comma-separated emails) in your Cloudflare/Sites config and only those accounts will be let in. Without it, the routes are protected from anonymous access but still open to any ChatGPT account that finds the URL — better than before, but you should set that variable for real access control.

## 4. Numbers that were wrong or misleading

- **Gross Profit and Labor Sales cards showed a fabricated trend percentage.** The "↑ 9.7%" / "↑ 8.3%" badges next to those two KPI cards were always pulled from the hardcoded demo dataset, never from real data — even while the dollar figure right next to them was live. So a real live Gross Profit number always sat next to a fake "up" arrow, regardless of whether GP was actually up, down, or flat. Fixed: for "This week," it now computes a real week-over-week percentage from the live weekly snapshot vs. the live last-week snapshot (data you're already capturing). For "Today" and "Last week," where no honest baseline exists, it now says "no prior-week data yet" instead of showing a made-up number.
- **"This month" always showed hardcoded sample data from a fixed past date** ("Jul 1 – Jul 28, 2026") with fake technician names ("Technician 2," "Technician 3") — and the "LIVE TEKMETRIC" banner at the top stayed on even while viewing this fully fake tab, because it only checked the weekly snapshot, not whichever range was selected. Fixed the banner to reflect the actual selected range. Note: making "This month" genuinely live would require the reader and API to capture a monthly period, which neither does today — that's a larger addition, not a bug fix, and I didn't build it without checking with you first.

## 5. Lower-priority things I noticed but didn't change

- The "Reports" and "Technicians" sidebar buttons don't have their own views — clicking them just shows the Overview page with no indication anything happened.
- The dashboard refreshes by reloading the whole page every 20 minutes rather than silently re-fetching data.

## Before you redeploy

- I couldn't build, deploy, or test any of this against your live Tekmetric/Steer accounts or Cloudflare Worker — verify a normal deploy/build cycle before relying on it.
- Set `DASHBOARD_ALLOWED_EMAILS` in your environment config to actually restrict who can view the dashboard.
- Run `register-scheduled-task.ps1` once on the shop computer.
- It's worth a call to your Tekmetric rep about API/partner access — Tekmetric does offer one to approved integrations, and it would remove the login/scraping fragility entirely instead of managing around it.
