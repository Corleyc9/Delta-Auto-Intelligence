// Teams notifications. v1.6: each new event is POSTed instantly to the Teams Workflow webhook in the Worker secret
// TEAMS_SCHEDULE_WEBHOOK_URL (see deliverEvent); GET /api/tech-board/bot/events stays as the backup poll for any
// event that failed to send. Self-contained (testable).
// Events never include PINs. Board D1 tables only — never Tekmetric.

type Db = {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
    run(): Promise<unknown>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
  batch(statements: unknown[]): Promise<unknown>;
};

export const EVENTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS board_events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, ro TEXT NOT NULL,
    job_key TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '', percent INTEGER, message TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, posted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS board_events_unposted ON board_events (posted_at, id)`,
  `CREATE TABLE IF NOT EXISTS board_notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER, ok INTEGER NOT NULL,
    status INTEGER, error TEXT NOT NULL DEFAULT '', at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS board_job_status (ro TEXT NOT NULL, job_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    technician TEXT NOT NULL DEFAULT '', completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (ro, job_id))`,
];

/** %-only changes on one job within 20 s fold into one event, sent once the 20 s debounce ends. */
export const DEBOUNCE_MS = 20_000;
/** The backup poll skips events younger than this, so it never races the instant send. */
export const POLL_GRACE_MS = 45_000;
/** Events older than this are never posted (instant or poll); they are marked posted silently. */
export const STALE_MS = 10 * 60_000;
export const isStale = (createdAt: string, nowIso: string) => Date.parse(nowIso) - Date.parse(createdAt) > STALE_MS;
/** A real, known tech name — not empty and not an unresolved Tekmetric employee id like "#12345". */
export const knownTech = (name: string | null | undefined) => Boolean(name && name.trim() && !/^#\d*$/.test(name.trim()));
export const STATUS_KINDS = ["Need parts", "Wrong part", "Need help", "Waiting approval", "Found more work", "Diag Done"];

export type EventJob = { ro: string; roNumber?: string; customer?: string; jobName?: string; label?: string; title?: string; custom?: boolean; tech?: string };

/** 'complete' for the Done button, 100%, or Tekmetric showing the job completed; everything else is 'update'. */
export function eventType(kind: string, percent: number | null | undefined): "update" | "complete" {
  return kind === "Done" || kind === "tekmetric-complete" || (percent ?? 0) >= 100 ? "complete" : "update";
}

/** 'Customer · RO# · Job · Tech: what changed' */
export function eventMessage(job: EventJob, techName: string, what: string) {
  const ro = job.roNumber || job.ro;
  const name = (job.custom ? job.title : job.jobName) || job.label || "Job";
  return [job.customer || "Customer", `RO#${ro}`, name, techName || "Unassigned"].join(" · ") + `: ${what}`;
}

/** What changed, in shop words. Never includes PINs (callers never pass them; comments are trimmed). */
export function describeUpdate(kind: string, percent: number | null | undefined, comment: string) {
  const parts: string[] = [];
  if (kind === "Done") parts.push("Done");
  else if (kind && kind !== "note") parts.push(kind);
  if (percent !== null && percent !== undefined && kind !== "Done") parts.push(percent >= 100 ? "100% — complete" : `${percent}% complete`);
  const note = String(comment || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (note) parts.push(`“${note}”`);
  return parts.join(" · ");
}

/** A %-only change folds into the unposted %-only event for the same job made within the last minute. */
export function canBatch(previous: { kind: string; postedAt: string | null; createdAt: string } | null, nowIso: string) {
  return Boolean(previous && previous.kind === "percent" && !previous.postedAt
    && Date.parse(nowIso) - Date.parse(previous.createdAt) <= DEBOUNCE_MS);
}

/** Same change on the same job within the same minute is one event; one completion per job. */
export function dedupeKey(jobKey: string, type: string, what: string, nowIso: string) {
  return type === "complete" ? `${jobKey}|complete` : `${jobKey}|${what.toLowerCase()}|${nowIso.slice(0, 16)}`;
}

export async function ensureEvents(db: Db) {
  await db.batch(EVENTS_SCHEMA.map((sql) => db.prepare(sql)));
}

export type Created = { id: number; delayMs: number };

/** Teams Workflow ("Send webhook alerts to a channel") Adaptive Card message. */
export function teamsCard(type: string, message: string) {
  const text = `${type === "complete" ? "✅ Complete: " : "🔧 Update: "}${message}`;
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive",
    content: { type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", text, wrap: true }] } }] };
}

/** POST one unposted event to the webhook; mark it posted only on a 2xx. Failures stay unposted for the backup poll. */
export async function deliverEvent(db: Db, id: number, url: string, fetchFn: typeof fetch, now = () => new Date().toISOString()) {
  if (!url) return false;
  const row = await db.prepare(`SELECT id, type, message, posted_at, created_at FROM board_events WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row || row.posted_at) return false;
  if (isStale(String(row.created_at), now())) { // too old to be news: mark posted silently
    await db.prepare(`UPDATE board_events SET posted_at = ? WHERE id = ? AND posted_at IS NULL`).bind(now(), id).run();
    return false;
  }
  const result = await postCard(url, teamsCard(String(row.type), String(row.message)), fetchFn);
  await logDelivery(db, id, result, now());
  if (!result.ok) return false;
  await db.prepare(`UPDATE board_events SET posted_at = ? WHERE id = ? AND posted_at IS NULL`).bind(now(), id).run();
  return true;
}

/** POST one card; never throws. `error` is the response body / exception text (trimmed; never the URL). */
export async function postCard(url: string, card: unknown, fetchFn: typeof fetch) {
  try {
    const response = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(card) });
    const body = response.ok ? "" : await response.text().catch(() => "");
    return { ok: response.ok, status: response.status as number | null, error: scrub(body, url) };
  } catch (error) {
    return { ok: false, status: null as number | null, error: scrub(String((error as Error)?.message || error), url) };
  }
}
const scrub = (text: string, url: string) => String(text || "").split(url).join("[webhook]").replace(/sig=[^&\s"]+/g, "sig=[hidden]").slice(0, 500);

export async function logDelivery(db: Db, eventId: number | null, result: { ok: boolean; status: number | null; error: string }, at: string) {
  await db.prepare(`INSERT INTO board_notify_log (event_id, ok, status, error, at) VALUES (?, ?, ?, ?, ?)`)
    .bind(eventId, result.ok ? 1 : 0, result.status, result.error, at).run().catch(() => undefined);
}

/** Teams posting health for the bot API: secret set?, last success, recent failures (status + error body). Never the URL. */
export async function notifyStatus(db: Db, secretSet: boolean) {
  const rows = await db.prepare(`SELECT event_id, ok, status, error, at FROM board_notify_log ORDER BY id DESC LIMIT 20`).all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));
  const list = rows.results.map((row) => ({ eventId: row.event_id === null ? null : Number(row.event_id), ok: Boolean(Number(row.ok)),
    status: row.status === null ? null : Number(row.status), error: String(row.error || ""), at: String(row.at) }));
  return { secretSet, lastSuccess: list.find((item) => item.ok) ?? null, recentFailures: list.filter((item) => !item.ok).slice(0, 10), recent: list };
}

async function createdId(db: Db, key: string, now: string) {
  const row = await db.prepare(`SELECT id, created_at FROM board_events WHERE dedupe_key = ?`).bind(key).first<Record<string, unknown>>();
  return row && String(row.created_at) === now ? Number(row.id) : null; // null = deduped (already existed)
}

/** Record a board update (writer, tech, or bot). Returns the new event to send (null when deduped or folded). */
export async function recordUpdateEvent(db: Db, input: { job: EventJob; techName: string; kind: string; percent: number | null; comment: string; source: string; now: string }): Promise<Created | null> {
  const what = describeUpdate(input.kind, input.percent, input.comment);
  if (!what) return null;
  const type = eventType(input.kind, input.percent);
  const percentOnly = input.kind === "note" && input.percent !== null && !String(input.comment || "").trim() && type === "update";
  const kind = percentOnly ? "percent" : input.kind;
  const message = eventMessage(input.job, input.techName, what);
  if (percentOnly) {
    // Only a % *change* counts: the same % as the job's last % event is not news.
    const last = await db.prepare(`SELECT percent FROM board_events WHERE job_key = ? AND percent IS NOT NULL ORDER BY id DESC LIMIT 1`)
      .bind(input.job.ro).first<Record<string, unknown>>();
    if (last && Number(last.percent) === input.percent) return null;
    const previous = await db.prepare(`SELECT id, kind, posted_at, created_at FROM board_events WHERE job_key = ? AND posted_at IS NULL
      ORDER BY id DESC LIMIT 1`).bind(input.job.ro).first<Record<string, unknown>>();
    if (previous && canBatch({ kind: String(previous.kind), postedAt: previous.posted_at ? String(previous.posted_at) : null, createdAt: String(previous.created_at) }, input.now)) {
      await db.prepare(`UPDATE board_events SET message = ?, percent = ?, updated_at = ? WHERE id = ?`).bind(message, input.percent, input.now, previous.id).run();
      return null; // the pending debounced send posts the latest %
    }
  }
  const key = dedupeKey(input.job.ro, type, what, input.now);
  await db.prepare(`INSERT OR IGNORE INTO board_events (type, ro, job_key, kind, percent, message, dedupe_key, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(type, input.job.roNumber || input.job.ro, input.job.ro, kind, input.percent, message,
    key, input.source, input.now, input.now).run();
  const id = await createdId(db, key, input.now);
  return id ? { id, delayMs: percentOnly ? DEBOUNCE_MS : 0 } : null;
}

type SyncedJob = { jobId: string; name: string; technician?: string | null; completed?: boolean };
/** Compare reader-synced Tekmetric jobs with the last seen status; emit events on changes (first sighting is silent). */
export function tekmetricChanges(prior: Map<string, { completed: boolean; technician: string }>, ro: string, jobs: SyncedJob[]) {
  const changes: { jobId: string; name: string; technician: string; kind: string; what: string }[] = [];
  for (const job of jobs) {
    const before = prior.get(`${ro}|${job.jobId}`);
    const technician = String(job.technician || "");
    if (!before) continue;
    // Only real transitions: a job turning Completed, or a reassignment between two different known techs.
    // An id resolving to a name ("#123" → "Mike Cook"), a tech appearing/disappearing, or a reopen is not news.
    if (!before.completed && job.completed) changes.push({ jobId: job.jobId, name: job.name, technician, kind: "tekmetric-complete", what: "Tekmetric shows the job completed" });
    else if (knownTech(technician) && knownTech(before.technician) && technician.trim().toLowerCase() !== before.technician.trim().toLowerCase())
      changes.push({ jobId: job.jobId, name: job.name, technician, kind: "tekmetric-tech", what: `Tekmetric tech changed from ${before.technician} to ${technician}` });
  }
  return changes;
}

export async function recordTekmetricChanges(db: Db, orders: { roNumber: string; customer?: string; label?: string; jobs?: SyncedJob[] }[], now: string) {
  const withJobs = orders.filter((order) => Array.isArray(order.jobs) && order.jobs.length);
  if (!withJobs.length) return [] as Created[];
  const rows = await db.prepare(`SELECT ro, job_id, technician, completed FROM board_job_status`).all<Record<string, unknown>>();
  const prior = new Map(rows.results.map((row) => [`${row.ro}|${row.job_id}`, { completed: Boolean(Number(row.completed)), technician: String(row.technician || "") }]));
  const statements: unknown[] = [];
  const keys: string[] = [];
  for (const order of withJobs) {
    const ro = String(order.roNumber);
    const multi = (order.jobs ?? []).length > 1;
    for (const change of tekmetricChanges(prior, ro, order.jobs ?? [])) {
      const jobKey = multi ? `${ro}-J${change.jobId}` : ro;
      const type = eventType(change.kind, null);
      const message = eventMessage({ ro: jobKey, roNumber: ro, customer: order.customer, jobName: change.name, label: order.label }, change.technician, change.what);
      statements.push(db.prepare(`INSERT OR IGNORE INTO board_events (type, ro, job_key, kind, percent, message, dedupe_key, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?, 'reader', ?, ?)`).bind(type, ro, jobKey, change.kind, message, dedupeKey(jobKey, type, change.what, now), now, now));
      keys.push(dedupeKey(jobKey, type, change.what, now));
    }
    for (const job of order.jobs ?? []) statements.push(db.prepare(`INSERT INTO board_job_status (ro, job_id, name, technician, completed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (ro, job_id) DO UPDATE SET name = excluded.name,
      technician = CASE WHEN excluded.technician = '' OR excluded.technician LIKE '#%' THEN board_job_status.technician ELSE excluded.technician END,
      completed = excluded.completed, updated_at = excluded.updated_at`).bind(ro, String(job.jobId), String(job.name || ""), String(job.technician || ""), job.completed ? 1 : 0, now));
  }
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
  const created: Created[] = [];
  for (const key of keys) { const id = await createdId(db, key, now); if (id) created.push({ id, delayMs: 0 }); }
  return created;
}

/** Unposted events after `since` (event id cursor). %-only events still inside their 1-minute batch window wait. */
export async function listEvents(db: Db, since: number, now: string, limit = 100) {
  await db.prepare(`UPDATE board_events SET posted_at = ? WHERE posted_at IS NULL AND created_at < ?`)
    .bind(now, new Date(Date.parse(now) - STALE_MS).toISOString()).run();
  const rows = await db.prepare(`SELECT id, type, ro, job_key, message, created_at, updated_at, kind FROM board_events
    WHERE posted_at IS NULL AND id > ? ORDER BY id LIMIT ?`).bind(Math.max(0, since || 0), Math.min(200, limit)).all<Record<string, unknown>>();
  // Stop at the first event still young enough for its instant send, so the cursor never skips it and never double-posts.
  const waiting = rows.results.findIndex((row) => Date.parse(now) - Date.parse(String(row.created_at)) <= POLL_GRACE_MS);
  const ready = waiting === -1 ? rows.results : rows.results.slice(0, waiting);
  const events = ready.map((row) => ({ id: Number(row.id), type: String(row.type), ro: String(row.ro), jobKey: String(row.job_key),
    message: String(row.message), createdAt: String(row.created_at) }));
  return { events, cursor: events.length ? events[events.length - 1].id : Math.max(0, since || 0) };
}

export async function ackEvents(db: Db, ids: number[], now: string) {
  const clean = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500);
  for (const id of clean) await db.prepare(`UPDATE board_events SET posted_at = ? WHERE id = ? AND posted_at IS NULL`).bind(now, id).run();
  return clean.length;
}

/** v1.6.5: "Suggest an edit" activity for Teams — a new suggestion, or a writer's status change / reply. */
export function suggestionMessage(input: { change: "new" | "update"; id: number; submitter: string; source: string; text: string; status?: string; reply?: string }) {
  const where = input.source === "tech" ? "tech page" : "writer board";
  const snippet = String(input.text || "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (input.change === "new") return `Tech Board suggestion #${input.id} from ${input.submitter || "Writer"} (${where}): ${snippet}`;
  const reply = String(input.reply || "").trim();
  return `Tech Board suggestion #${input.id} (${input.submitter || "Writer"}, ${where}) is now ${input.status}${reply ? ` · Reply: ${reply.slice(0, 300)}` : ""} · "${snippet}"`;
}
/** Schedule inbox activity for Teams — a writer (or the bot) asked for something on the schedule, or marked it done. */
export function scheduleRequestMessage(input: { change: "new" | "done"; id: number; submitter: string; text: string; doneBy?: string }) {
  const snippet = String(input.text || "").trim().replace(/\s+/g, " ").slice(0, 300);
  const who = input.submitter || "Writer";
  if (input.change === "new") return `Schedule request #${input.id} from ${who}: ${snippet}`;
  const by = String(input.doneBy || "").trim();
  return `Schedule request #${input.id} from ${who} marked done${by ? ` by ${by}` : ""}: ${snippet}`;
}
export async function recordScheduleRequestEvent(db: Db, input: { change: "new" | "done"; id: number; submitter: string; text: string; doneBy?: string; source?: string; now: string }): Promise<Created | null> {
  if (!input.id) return null;
  const message = scheduleRequestMessage(input);
  const jobKey = `schedule-request-${input.id}`;
  const key = dedupeKey(jobKey, "update", message, input.now);
  await db.prepare(`INSERT OR IGNORE INTO board_events (type, ro, job_key, kind, percent, message, dedupe_key, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind("update", "schedule-request", jobKey, input.change === "new" ? "schedule-request" : "schedule-request-done", null, message,
    key, input.source || "writer", input.now, input.now).run();
  const id = await createdId(db, key, input.now);
  return id ? { id, delayMs: 0 } : null;
}

export async function recordSuggestionEvent(db: Db, input: { change: "new" | "update"; id: number; submitter: string; source: string; text: string; status?: string; reply?: string; now: string }): Promise<Created | null> {
  if (!input.id) return null;
  const message = suggestionMessage(input);
  const jobKey = `suggest-${input.id}`;
  const key = dedupeKey(jobKey, "update", message, input.now);
  await db.prepare(`INSERT OR IGNORE INTO board_events (type, ro, job_key, kind, percent, message, dedupe_key, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind("update", "suggestion", jobKey, input.change === "new" ? "suggestion" : "suggestion-update", null, message,
    key, input.source, input.now, input.now).run();
  const id = await createdId(db, key, input.now);
  return id ? { id, delayMs: 0 } : null;
}

/** v1.6.16: a board notice (auto-placed job / needs placing) → Teams event. Deduped per job + message. */
export async function recordBoardNotice(db: Db, input: { jobKey: string; ro: string; kind: string; message: string; now: string }): Promise<Created | null> {
  const key = `notice|${input.jobKey}|${input.message}`.slice(0, 500);
  await db.prepare(`INSERT OR IGNORE INTO board_events (type, ro, job_key, kind, percent, message, dedupe_key, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind("update", input.ro, input.jobKey, input.kind, null, input.message, key, "auto-place", input.now, input.now).run();
  const id = await createdId(db, key, input.now);
  return id ? { id, delayMs: 0 } : null;
}
