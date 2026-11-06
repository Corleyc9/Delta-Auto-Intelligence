# Teams notifications (v1.6)

Every board event is posted **instantly** to the Teams channel **Delta Intelligence Schedule** through a Teams
Workflow webhook. The polling feed (`GET /api/tech-board/bot/events` + `POST …/events/ack`, docs/bot-api.md)
stays as a backup: the assistant polls it every 5 minutes and posts anything the instant send couldn't.

## Set it up

1. In Teams, open the **Delta Intelligence Schedule** channel → **…** → **Workflows** → template
   **"Send webhook alerts to a channel"** → pick the team/channel → **Save**. Copy the webhook URL it shows.
2. In the site settings (ChatGPT Sites → this site → **Settings → Secrets / Environment variables**), add a secret
   named **`TEAMS_SCHEDULE_WEBHOOK_URL`** with that URL as its value, then save/redeploy.
   (With Wrangler instead: `npx wrangler secret put TEAMS_SCHEDULE_WEBHOOK_URL`.)
3. No secret → nothing is posted instantly; events still wait in the backup feed.

Treat the URL like a password (anyone with it can post to the channel). Never paste it in chat.

## What posts

| type | prefix | created by |
|---|---|---|
| `update` | `🔧 Update: ` | status buttons (Need parts, Wrong part, Need help, Waiting approval, Found more work, Diag Done), % changes, comments — writers, techs on /tech, or the bot; reader-detected Tekmetric changes (job reopened, tech changed). Also writer schedule-inbox notes: `Schedule request #12 from Devin: …` and `… marked done by Kody`. |
| `complete` | `✅ Complete: ` | Done button, 100%, or the reader seeing the job **Completed** in Tekmetric |

Text: `Customer · RO# · Job · Tech: what changed`. Never includes PINs.

Body (Adaptive Card for the Workflow template):
`{type:'message', attachments:[{contentType:'application/vnd.microsoft.card.adaptive', content:{type:'AdaptiveCard', version:'1.4', body:[{type:'TextBlock', text, wrap:true}]}}]}`

## Rules

- Sent with `waitUntil` after the response, so clicks aren't slowed.
- Success (2xx) marks the event posted; the feed skips it. Failure leaves it unposted for the backup poll.
- Dedupe: the same change on the same job within the same minute is one event; one `complete` per job.
- % debounce: %-only changes on one job within 20 s fold into one event, sent 20 s after the first with the latest %.
- The backup feed skips events younger than 45 s so it never races the instant send.

## v1.6.1 — no floods

- Reader events only for real transitions: a job turning **Completed**, or a reassignment between two different **known** techs.
  An employee id resolving to a name (`#72853` → `Mike Cook`), a first-ever sighting, a tech appearing/disappearing, case changes
  and reopens never post. An id never overwrites a known name in the saved job status.
- Board events: the status buttons (Need parts, Wrong part, Need help, Waiting approval, Found more work, Diag Done, Done), comments,
  and % *changes* (the same % again doesn't post).
- Events older than **10 minutes** are never posted, instantly or through the poll feed; they are marked posted silently.

## v1.6.4 — diagnosing a failed post

- Every instant send is retried twice (after 4 s and 15 s). Each attempt's HTTP status and error body are logged in
  `board_notify_log` (the URL and its `sig` are never stored or returned).
- `GET /api/tech-board/bot/teams` (bot key) → `{ secretSet, urlLooksLikeWorkflow, lastSuccess, recentFailures: [{ status, error, at }] }`.
- `POST /api/tech-board/bot/teams` (bot key) → sends one test card and returns `{ ok, status, error }`.
- Common answers: `secretSet:false` → add the secret and redeploy; `401/403` → the Workflow URL was regenerated or the
  flow is off — copy the new URL; `400` → the flow isn't the "Send webhook alerts to a channel" template; `429` → throttled
  (retries / backup poll cover it); `202` but nothing in Teams → open the flow's run history in Teams Workflows (the
  post step failed, e.g. the channel or "Flow bot" permission).
