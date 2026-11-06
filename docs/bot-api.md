# Tech Board bot API (v1.4)

This API lets a Teams assistant (for the "delta intelligence schedule" channel) make writer-level Tech Board changes.
- It writes only to the board's own tables (D1) and never to Tekmetric.
- Every change is logged in `board_change_log` with `source = 'teams-bot'`.

## Turn it on (Devin)

The key is a Cloudflare Worker secret. It is never stored in code, `wrangler.toml` or the repo. Until it is set, every bot request gets **503 (disabled)**.

1. Make a long random key, for example `openssl rand -hex 32`.
2. Set it on the Worker `delta-auto-intelligence`, using either:
   - Cloudflare dashboard → Workers & Pages → delta-auto-intelligence → Settings → Variables and Secrets → Add → type **Secret**, name `TECH_BOARD_BOT_KEY`, then paste the key and save/deploy.
   - or the command line: `npx wrangler secret put TECH_BOARD_BOT_KEY` (paste when asked).
3. Give the same key to the Teams assistant as its bearer token. Don't post it in chat or Teams.
4. To rotate the key, set a new value. To turn the API off, delete the secret.

## Calls

Every call sends `Authorization: Bearer <key>`. A wrong or missing key gets 401. The key is checked with a constant-time compare.

Times are minutes after 8:00 AM:
- 120 = 10:00 AM
- 300 = 1:00 PM

`date` is `YYYY-MM-DD` and defaults to today (Central).

| What | Request |
|---|---|
| List a day | `GET /api/tech-board/bot?date=2026-11-03` |
| Move a block | `POST /api/tech-board/bot` `{"action":"move","ro":"18402-J2","tech":"AN","startMinute":300}` |
| Resize | `{"action":"resize","ro":"18402-J1","durationMinutes":150}` |
| Add a block | `{"action":"add-block","tech":"SW","startMinute":120,"durationMinutes":60,"title":"Road test","linkedRo":"18402"}` |
| Add time off | `{"action":"add-time-off","tech":"BC","date":"2026-11-04","allDay":true,"reason":"Vacation"}` (or `startMinute`/`endMinute`) |
| Set % | `{"action":"set-percent","ro":"18402-J1","percent":50}` (100 marks it Done) |
| List schedule requests | `POST /api/tech-board/bot` `{"action":"list-schedule-requests"}` (add `"includeDone":true` for ones marked done in the last 3 days). `GET /api/tech-board/bot` also returns open `scheduleRequests` for the day. |
| Create a schedule request | `{"action":"add-schedule-request","text":"Put Bradley 38468 on Andrew this afternoon","by":"Devin"}` |
| Ack a schedule request | `{"action":"ack-schedule-request","id":12,"by":"Kody"}` (`done-schedule-request` is the same). Does not move or add a block. |

**Fields:**
- `ro` is the board key from "List a day". For an RO with several jobs, each job has its own key, e.g. `18402-J2`.
- Add `"by":"Name"` to record who asked in Teams.

**Rules and replies:**
- The same rules as the writer screen apply. Blocks on the same RO (same car) never overlap. When a request would overlap, the block snaps to just after the conflicting job, and the reply's `notice` says why.
- Replies look like `{ "ok": true, "notice": "...", "date": "..." }`.

**Access:**
- Tech PIN sessions can't reach this API; the server gate allows them only `/tech` and `/api/tech`.
- Only the actions above exist. PINs, deletes and pool-request approvals stay in the writer screen.
- Schedule requests are a shared writer inbox (`board_schedule_requests`). Creating or acking one does not place a job and does not write to Tekmetric. Use `move` / `add-block` when the work is actually scheduled.

## Notification feed (v1.5)

No webhook. The assistant polls this feed and posts each event to the **Delta Intelligence Schedule** Teams channel from the Delta Intelligence account, then acks it. Same bearer auth (`Authorization: Bearer $TECH_BOARD_BOT_KEY`).

`GET /api/tech-board/bot/events?since=<cursor>` returns
`{ "events": [{ "id", "type": "update" | "complete", "ro", "jobKey", "message", "createdAt" }], "cursor": <last id> }`.
`message` is ready to post: `Customer · RO#38001 · Alternator · Mike Cook: Need parts`.

`POST /api/tech-board/bot/events/ack` with `{ "ids": [12, 13] }` marks them posted; they never come back.

See docs/teams-notify.md for what creates events.
