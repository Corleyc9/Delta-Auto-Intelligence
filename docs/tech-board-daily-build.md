# How the Tech Board builds each day (v1.3)

The board is rebuilt from the latest synced Tekmetric job board, along with the synced appointment schedule, every time the reader syncs and whenever someone presses Recompute. It plans ten shop days (Mon–Fri) and fills them one day at a time. Nothing is ever written back to Tekmetric.

**The day's shape:** 8–10 AM is diag only. Regular work runs 10–12 and 1–5. Lunch is 12–1 and is never booked.

**How long a block is:** a writer's manual resize wins. Next comes the tech's own estimate, then the RO's labor hours from the synced board (the "worked / sold" hours on the card, e.g. "0 / 2.4" = 2.4h). If the card shows 0, it uses the highest hours we have seen for that RO from webhooks or earlier syncs. If there is still nothing, it uses 1h. The card shows the length, e.g. "2.4h".

**What happens first:**
1. **Time off and staff appointments** block the tech's time first (shown in blue). Writer custom blocks also stay where they were put.
2. **Pre-Set appointments** (amber) go at their set time with their set tech. These are the only fixed blocks. If a writer drags one, the new time holds.
3. **Needs Diag** tickets go only into a tech's 8–10 block, oldest first. A diag fills at most that 2-hour block. When every block is full, the extra diags go to the next day's 8–10. They never go into regular time, and nothing else ever goes in 8–10.
4. **Carry-over:** at day rollover, any job from an earlier day that isn't marked Done (or 100%) moves to today. It keeps its tech, goes first in line, and is flagged "Carried over". It keeps only the remaining time: labor hours × (1 − % complete). For example, 4h at 50% carries 2h.
5. **Part Arrived** jobs come next, oldest first, from 10 AM on.
6. **Everything else that's ready** comes last (work-in-progress with labor hours and no hold label), ordered by promised time and then by age.

**Who gets the work:** a job goes to its Tekmetric tech when it has one. Otherwise it goes to the tech with the most open time that day. If it doesn't fit, it rolls to the next shop day. Anything beyond ten days waits in Unassigned.

**Dragging:** dragging a normal job changes its tech, day and order. That placement is kept as a preference on the next rebuild, but it is not locked: if something fixed (like a Pre-Set) now needs that time, the job moves to the next open spot. A job dragged to Unassigned stays in the open pool. Techs can request it from /tech, and approving the request puts it on that tech's column.

**Done:** a job marked Done or Diag Done (or at 100%) leaves the board.

**Multi-job ROs (v1.3):** each Tekmetric job is its own block on its own tech's column ("Customer · RO# · Job name"), sized by that job's labor hours. Jobs on the same RO never overlap in time on any techs, because it's the same car. They run in Tekmetric job order: the next job starts after the earlier one ends, and each tech fills the gap with other work. A writer can still move one; the others work around it. Dragging a job into an overlap snaps it to just after the conflicting job, with a short notice. Resizing a job into its sibling pushes the sibling later. %, status and the drawer all work per job.

## v1.5 — job status, logged time, open pool

- Reader reads Tekmetric's **Tech Board** (`/admin/shop/<id>/tech-board`, its `GET /api/shop/<id>/tech-board` JSON) every Job Board sync: every WIP RO's jobs with tech lane, labor hours, completed, plus the **Unassigned** lane ("No Tech Assigned"). It also reads each WIP RO's Work-In-Progress tab (≤30 per sync, each RO at most every 15 min) for the job clock (logged time). Read-only, navigation only.
- Open pool = exactly Tekmetric's Unassigned jobs: a job with no tech stays in the pool (never auto-given to a tech, never inherits the RO card's initials, which include the service writer). A writer drag or approved request still places it.
- Completed jobs drop off; an RO whose jobs are all Completed leaves the board. Cards and the drawer show "logged X h".
- A job running through lunch is one card from start to the adjusted end with lunch shaded inside; card time, expected end and "Running long" use the adjusted end.
- Teams events feed: docs/teams-notify.md.

## v1.6.17 — Identifix lookups run by the assistant
- **Request:** on an RO (writer/admin drawer), "Look up in Identifix" now queues a lookup (RO, customer, year/make/model/engine/VIN,
  codes, optional symptom) in `board_identifix_requests` instead of opening Direct-Hit. Status: queued → in-progress → done/failed;
  the card shows "Identifix lookup requested… (queued / in progress)", then "Identifix ✓". Tech view's DTC box is unchanged and
  still gated by `IDENTIFIX_FOR_TECHS`.
- **Bot API** (`POST /api/tech-board/bot`, bearer key): `list-identifix-requests`, `claim-identifix-request {id}`,
  `post-identifix-result {id, ro, confirmedFixes:[{fix,count,note}], testSteps:[...], tsbs:[{id,title}], source, notes}`,
  `fail-identifix-request {id, reason}`. Claim only from queued (409 otherwise); post/fail refuse finished requests (409).
- **Results panel:** "Check-in scan — Identifix known fixes (triage, not a diagnosis)": confirmed fixes (by count), suggested
  testing, TSBs. Writers/admin only unless Worker var `IDENTIFIX_RESULTS_FOR_TECHS=1` (default hidden from techs).
- **Notify:** if Worker var `IDENTIFIX_REQUEST_WEBHOOK_URL` is set, a new request POSTs `{id, ro, codes, vehicle}` there
  (background; unset or failing never blocks the request).

## v1.6.16 — auto-place approved jobs, ripple on move/resize
- **Auto-place:** on every reader sync / board refresh, an approved Tekmetric job with remaining labor that isn't on a schedule
  goes on its Tekmetric tech (or, with no tech, a skill-chart tech: HVAC/electrical/drivability → Devin/Stacy/Andrew; brakes,
  cooling, gaskets, light R&R and visual/pressure diags → Mike/Beau first; lube/tires/battery/filters/check-ins → Mario first;
  hybrid/EV → Devin only) in the first open slot **today** (diags in 8–10). It never overlaps yellow appointments. Cards show
  "Auto-placed"; each placement is logged (board_change_log, source auto-place) and queued as a Teams event. If no tech fits
  or the day is full, the job sits in Unassigned and in the writers' **Needs placing** list with the reason. A writer's
  hand-made block for the same RO (+ job) stands in for it — no duplicates. Skill chart: `app/tech-board/skills.ts`.
- **Ripple:** when a writer or the bot moves/resizes a block, later blocks on that tech's day that now overlap are pushed
  later in order, hopping over yellow appointments and time off (they never move). Push only — nothing is pulled earlier.
  Anything past 5 PM shows a "Past 5 PM" badge (and the next sync continues it on the next day). A tech's own %/estimate
  change ripples only their own day.
