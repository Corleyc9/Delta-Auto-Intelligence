// D1 persistence for the Tech Board. Tables are also created lazily (house style),
// matching drizzle/0001_tech_board.sql.
import { jobsFromPayload, normalizeJobs } from "./ro-jobs";
import { ensureEvents, recordBoardNotice, recordTekmetricChanges } from "./events";
import { sendInstant } from "./teams-notify";
import { IDENTIFIX_REQUESTS_SQL } from "./identifix-store.ts";
import { BAYSCAN_SQL } from "./bayscan-store.ts";
import { BOARD_SUGGESTIONS_SQL, rowToSuggestion } from "./suggestions";
import { BOARD_SCHEDULE_REQUESTS_SQL, rowToScheduleRequest, type ScheduleRequest } from "./schedule-requests";
import { BoardJob, BoardRepairOrder, DEFAULT_TECHS, ExistingRow, TechCapacity, toTekSchedule, TimeOff, UNASSIGNED, chicagoDate, schedule, Appointment, JobProgress, appointmentMinute, chicagoMinute, parentRoOf } from "./scheduler";

type D1 = {
  prepare(sql: string): { bind(...values: unknown[]): D1Stmt } & D1Stmt;
  batch(statements: unknown[]): Promise<unknown>;
};
type D1Stmt = {
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

export const TECH_BOARD_SCHEMA = [
  IDENTIFIX_REQUESTS_SQL,
  ...BAYSCAN_SQL, // v1.6.18 Bay Scan scans + RO VINs
  // v1.6.15: check-in scan codes per RO (writer/bot entered; triage only).
  `CREATE TABLE IF NOT EXISTS board_checkin (ro TEXT PRIMARY KEY, codes_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS board_jobs (
    ro TEXT PRIMARY KEY,
    vehicle TEXT NOT NULL DEFAULT '',
    customer TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    detail_url TEXT NOT NULL DEFAULT '',
    tech TEXT NOT NULL DEFAULT 'UN',
    assigned_tech TEXT,
    labor_guide_hours REAL NOT NULL DEFAULT 0,
    tech_estimate_hours REAL,
    lane_date TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    start_minute INTEGER NOT NULL DEFAULT 0,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    pinned INTEGER NOT NULL DEFAULT 0,
    placed_by TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'ready',
    in_diag_block INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    custom INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    duration_override_minutes INTEGER,
    linked_ro TEXT,
    carried_over INTEGER NOT NULL DEFAULT 0,
    ro_number TEXT NOT NULL DEFAULT '',
    job_name TEXT NOT NULL DEFAULT '',
    job_order INTEGER NOT NULL DEFAULT 0,
    logged_seconds INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS board_jobs_lane_idx ON board_jobs (lane_date, tech, position)`,
  `CREATE TABLE IF NOT EXISTS tech_capacity (
    initials TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    day_minutes INTEGER NOT NULL DEFAULT 480,
    diag_block_minutes INTEGER NOT NULL DEFAULT 120,
    day_start_minute INTEGER NOT NULL DEFAULT 480,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS board_job_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ro TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'note',
    percent_complete REAL,
    comment TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS board_job_updates_ro_idx ON board_job_updates (ro, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS tech_time_off (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    initials TEXT NOT NULL,
    date TEXT NOT NULL,
    start_minute INTEGER NOT NULL DEFAULT 0,
    end_minute INTEGER NOT NULL DEFAULT 0,
    all_day INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tech_time_off_date_idx ON tech_time_off (date, initials)`,
  BOARD_SUGGESTIONS_SQL,
  BOARD_SCHEDULE_REQUESTS_SQL,
  `CREATE TABLE IF NOT EXISTS board_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    ro TEXT NOT NULL DEFAULT '',
    body_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tech_pins (
    initials TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    iterations INTEGER NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS board_pool_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ro TEXT NOT NULL,
    tech TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT
  )`,
  // v1.6.7: board settings (start_date) and the first date the board saw each RO (Tekmetric created dates aren't synced).
  `CREATE TABLE IF NOT EXISTS board_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS board_tek_appointments (id TEXT PRIMARY KEY, ro TEXT NOT NULL DEFAULT '', employee_id TEXT,
    employee_name TEXT, start_at TEXT NOT NULL, end_at TEXT NOT NULL, updated TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS board_ro_seen (ro TEXT PRIMARY KEY, first_seen TEXT NOT NULL)`,
  // Phase 3 placeholder (not built): tech_time_off (id, initials, date, start_minute, minutes, status, requested_at, approved_by)
];

export async function techBoardDb(): Promise<D1> {
  // @ts-ignore -- provided by the Cloudflare Worker runtime (same pattern as the other API routes)
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: D1 }).DB;
}

const BOARD_JOB_ADDED_COLUMNS = [
  "title TEXT NOT NULL DEFAULT ''", "note TEXT NOT NULL DEFAULT ''", "custom INTEGER NOT NULL DEFAULT 0",
  "hidden INTEGER NOT NULL DEFAULT 0", "duration_override_minutes INTEGER", "linked_ro TEXT", "carried_over INTEGER NOT NULL DEFAULT 0", "ro_number TEXT NOT NULL DEFAULT ''", "job_name TEXT NOT NULL DEFAULT ''", "job_order INTEGER NOT NULL DEFAULT 0", "logged_seconds INTEGER", "appt_key TEXT", "appt_info TEXT",
  "auto_placed INTEGER NOT NULL DEFAULT 0", "needs_placing TEXT", // v1.6.16
];

export async function initializeTechBoard(db: D1) {
  await db.batch(TECH_BOARD_SCHEMA.map((sql) => db.prepare(sql)));
  await ensureEvents(db as never);
  // Older board_jobs tables (pre time-off/custom blocks) get the new columns; "duplicate column" errors are expected.
  for (const column of BOARD_JOB_ADDED_COLUMNS) {
    await db.prepare(`ALTER TABLE board_jobs ADD COLUMN ${column}`).run().catch(() => undefined);
  }
  await db.batch(DEFAULT_TECHS.map((tech) => db.prepare(`INSERT OR IGNORE INTO tech_capacity
    (initials, name, day_minutes, diag_block_minutes, day_start_minute, active, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .bind(tech.initials, tech.name, tech.dayMinutes, tech.diagBlockMinutes, tech.dayStartMinute, tech.sortOrder)));
  await db.prepare(`INSERT OR IGNORE INTO board_settings (key, value, updated_at) VALUES ('start_date', ?, '')`).bind(DEFAULT_START_DATE).run();
  // One-time seed: each RO's first-seen date = the earliest job-board snapshot that had it (Central dates are close enough: UTC day).
  const seen = await db.prepare(`SELECT COUNT(*) AS n FROM board_ro_seen`).first<Record<string, unknown>>().catch(() => null);
  if (seen && Number(seen.n) === 0) {
    await db.prepare(`INSERT OR IGNORE INTO board_ro_seen (ro, first_seen)
      SELECT CAST(json_extract(j.value, '$.roNumber') AS TEXT), MIN(substr(s.captured_at, 1, 10))
      FROM job_board_snapshots s, json_each(s.repair_orders_json) j
      WHERE json_extract(j.value, '$.roNumber') IS NOT NULL GROUP BY 1`).run().catch(() => undefined);
  }
}

/** v1.6.8: replace the stored Tekmetric schedule with the reader's latest read. */
export type TekAppointmentRow = { id: string; roNumber: string; employeeId: string | null; employeeName: string | null; start: string; end: string; updated: string;
  color?: string; customer?: string; title?: string; details?: string };
export async function saveTekSchedule(db: D1, rows: TekAppointmentRow[]) {
  // v1.6.11: the reader reads today forward, so keep earlier days' 6–8 AM (front office) appointments for up to 30 days —
  // those tickets roll forward until the RO is closed. Everything from today on is replaced by the latest read.
  const today = chicagoDate(new Date());
  const cutoff = chicagoDate(new Date(Date.now() - 30 * 86400000));
  const keep = (await loadTekSchedule(db)).filter((row) => { const day = chicagoDate(new Date(row.start));
    return day < today && day >= cutoff && chicagoMinute(row.start) < 0 && !rows.some((item) => item.id === row.id); });
  for (const column of ["color TEXT NOT NULL DEFAULT ''", "customer TEXT NOT NULL DEFAULT ''", "title TEXT NOT NULL DEFAULT ''", "details TEXT NOT NULL DEFAULT ''"]) {
    await db.prepare(`ALTER TABLE board_tek_appointments ADD COLUMN ${column}`).run().catch(() => undefined);
  }
  const statements: unknown[] = [db.prepare(`DELETE FROM board_tek_appointments`)];
  for (const row of keep) statements.push(db.prepare(`INSERT OR REPLACE INTO board_tek_appointments
    (id, ro, employee_id, employee_name, start_at, end_at, updated, color, customer, title, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.roNumber, row.employeeId, row.employeeName, row.start, row.end, row.updated, row.color ?? "", row.customer ?? "", row.title ?? "", row.details ?? ""));
  for (const row of rows.slice(0, 2000)) statements.push(db.prepare(`INSERT OR REPLACE INTO board_tek_appointments
    (id, ro, employee_id, employee_name, start_at, end_at, updated, color, customer, title, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.roNumber, row.employeeId, row.employeeName, row.start, row.end, row.updated, row.color ?? "", row.customer ?? "", row.title ?? "", row.details ?? ""));
  await db.batch(statements);
}
export async function loadTekSchedule(db: D1) {
  const rows = await db.prepare(`SELECT * FROM board_tek_appointments`).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.map((row) => ({ id: String(row.id), roNumber: String(row.ro || ""), employeeId: row.employee_id ? String(row.employee_id) : null,
    employeeName: row.employee_name ? String(row.employee_name) : null, start: String(row.start_at), end: String(row.end_at), updated: String(row.updated || ""),
    color: String(row.color || ""), customer: String(row.customer || ""), title: String(row.title || ""), details: String(row.details || "") }));
}

export const DEFAULT_START_DATE = "2026-11-03";
export async function getStartDate(db: D1) {
  const row = await db.prepare(`SELECT value FROM board_settings WHERE key = 'start_date'`).first<Record<string, unknown>>().catch(() => null);
  return row ? String(row.value) : DEFAULT_START_DATE;
}
export async function setStartDate(db: D1, date: string, now: string) {
  await db.prepare(`INSERT INTO board_settings (key, value, updated_at) VALUES ('start_date', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(date, now).run();
}
/** Record today as first-seen for ROs the board hasn't seen before; returns ro → first-seen date. */
export async function firstSeenDates(db: D1, ros: string[], today: string) {
  const unique = [...new Set(ros.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    await db.batch(unique.slice(i, i + 50).map((ro) => db.prepare(`INSERT OR IGNORE INTO board_ro_seen (ro, first_seen) VALUES (?, ?)`).bind(ro, today)));
  }
  const rows = await db.prepare(`SELECT ro, first_seen FROM board_ro_seen`).all<Record<string, unknown>>();
  return Object.fromEntries(rows.results.map((row) => [String(row.ro), String(row.first_seen)]));
}

export async function loadTechs(db: D1): Promise<TechCapacity[]> {
  const rows = await db.prepare(`SELECT * FROM tech_capacity ORDER BY sort_order, initials`).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    initials: String(row.initials), name: String(row.name), dayMinutes: Number(row.day_minutes) || 480,
    diagBlockMinutes: Number(row.diag_block_minutes) || 0, dayStartMinute: Number(row.day_start_minute) || 480,
    active: Number(row.active) === 1, sortOrder: Number(row.sort_order) || 0,
  }));
}

export function rowToJob(row: Record<string, unknown>): BoardJob {
  return {
    ro: String(row.ro), vehicle: String(row.vehicle || ""), customer: String(row.customer || ""), label: String(row.label || ""),
    detailUrl: String(row.detail_url || ""), tech: String(row.tech || UNASSIGNED),
    assignedTech: row.assigned_tech ? String(row.assigned_tech) : null,
    laborGuideHours: Number(row.labor_guide_hours) || 0,
    techEstimateHours: row.tech_estimate_hours === null || row.tech_estimate_hours === undefined ? null : Number(row.tech_estimate_hours),
    laneDate: String(row.lane_date), position: Number(row.position) || 0, startMinute: Number(row.start_minute) || 0,
    durationMinutes: Number(row.duration_minutes) || 60, pinned: Number(row.pinned) === 1,
    placedBy: row.placed_by === "writer" ? "writer" : "auto", status: (String(row.status) as BoardJob["status"]) || "ready",
    inDiagBlock: Number(row.in_diag_block) === 1, startedAt: row.started_at ? String(row.started_at) : null,
    updatedAt: String(row.updated_at || ""), title: String(row.title || ""), note: String(row.note || ""),
    custom: Number(row.custom) === 1, hidden: Number(row.hidden) === 1,
    durationOverrideMinutes: row.duration_override_minutes === null || row.duration_override_minutes === undefined ? null : Number(row.duration_override_minutes),
    linkedRo: row.linked_ro ? String(row.linked_ro) : (Number(row.custom) === 1 ? null : String(row.ro)),
    carriedOver: Number(row.carried_over) === 1,
    roNumber: String(row.ro_number || "") || parentRoOf(String(row.ro)), jobName: String(row.job_name || ""), jobOrder: Number(row.job_order) || 0, loggedSeconds: row.logged_seconds === null || row.logged_seconds === undefined ? null : Number(row.logged_seconds),
    apptKey: row.appt_key ? String(row.appt_key) : null, apptInfo: row.appt_info ? String(row.appt_info) : null,
    autoPlaced: Number(row.auto_placed) === 1, needsPlacing: row.needs_placing ? String(row.needs_placing) : null,
  };
}

export async function loadJobs(db: D1) {
  const rows = await db.prepare(`SELECT * FROM board_jobs ORDER BY lane_date, tech, position`).all<Record<string, unknown>>();
  return rows.results.map(rowToJob);
}

/** Latest % and whether the job was marked Done / Diag Done on the board. */
async function loadProgress(db: D1): Promise<Record<string, JobProgress>> {
  const updates = await loadLatestUpdates(db).catch(() => []);
  return Object.fromEntries(updates.map((update) => [update.ro, {
    percent: update.percentComplete, done: update.kind === "Done" || update.kind === "Diag Done" }]));
}

/** Synced Tekmetric appointment snapshots (latest capture per day) from today on. Read-only. */
async function loadAppointments(db: D1, today: string, before = false): Promise<Appointment[]> {
  const rows = await db.prepare(`SELECT schedule_date, appointments_json FROM schedule_snapshots s WHERE ${before ? "schedule_date < ? AND schedule_date >= date(?, '-30 days')" : "schedule_date >= ?"}
    AND captured_at = (SELECT MAX(captured_at) FROM schedule_snapshots t WHERE t.schedule_date = s.schedule_date)`)
    .bind(...(before ? [today, today] : [today])).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.flatMap((row) => {
    let list: Record<string, unknown>[] = [];
    try { list = JSON.parse(String(row.appointments_json || "[]")); } catch { list = []; }
    return list.map((appt) => ({ date: String(row.schedule_date).slice(0, 10), employee: String(appt.employee || ""),
      startMinute: appointmentMinute(String(appt.startTime || "")), endMinute: appointmentMinute(String(appt.endTime || "")),
      text: String(appt.text || ""), color: String(appt.color || "") }));
  });
}

/**
 * Job-level tech + hours per RO. Reader-sent `jobs` win; otherwise the latest Tekmetric webhook payload
 * for the RO that carries a jobs[] array. Read-only.
 */
async function withRoJobs(db: D1, orders: BoardRepairOrder[], techs: TechCapacity[]) {
  const need = orders.filter((order) => !Array.isArray(order.jobs) || order.jobs.length === 0).map((order) => String(order.roNumber));
  const fromHooks = new Map<string, unknown[]>();
  if (need.length) {
    const rows = await db.prepare(`SELECT repair_order_number, payload_json FROM tekmetric_webhook_events
      WHERE repair_order_number <> '' AND payload_json LIKE '%"jobs"%' ORDER BY received_at DESC, id DESC LIMIT 500`)
      .all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
    for (const row of rows.results) {
      const ro = String(row.repair_order_number);
      if (fromHooks.has(ro) || !need.includes(ro)) continue;
      try { const jobs = jobsFromPayload(JSON.parse(String(row.payload_json))); if (jobs) fromHooks.set(ro, jobs); } catch { /* skip */ }
    }
  }
  return orders.map((order) => {
    const raw = Array.isArray(order.jobs) && order.jobs.length ? order.jobs : fromHooks.get(String(order.roNumber));
    return raw ? { ...order, jobs: normalizeJobs(raw, techs) } : order;
  });
}

/** Attach the highest labor hours seen per RO (reader syncs + Tekmetric webhooks) as a fallback for cards that show 0. */
async function withKnownLaborHours(db: D1, orders: BoardRepairOrder[]) {
  const rows = await db.prepare(`SELECT ro_number, sold_hours FROM ro_sold_hours_watch_v2`).all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));
  const known = new Map(rows.results.map((row) => [String(row.ro_number), Number(row.sold_hours) || 0]));
  return orders.map((order) => ({ ...order, knownLaborHours: known.get(String(order.roNumber)) ?? 0 }));
}

/** Synced ROs (latest job-board snapshot) for the RO search box. Read-only copy of Tekmetric data. */
export async function loadSyncedRos(db: D1) {
  const orders = await latestOrders(db);
  return orders.slice(0, 1500).map((order) => ({
    ro: String(order.roNumber), customer: String(order.customer || ""), vehicle: String(order.vehicle || ""),
    label: String(order.label || ""), hours: Math.max(0, Number(order.soldHours) || 0), detailUrl: String(order.detailUrl || ""),
    // v1.6.19: VIN from the reader (2.1.3 reads it for every job-board RO); a writer-entered VIN still wins.
    vin: String(order.vin || "").toUpperCase(), section: String(order.section || ""),
    status: String((order as { status?: unknown }).status || ""),
  }));
}

export async function latestOrders(db: D1): Promise<BoardRepairOrder[]> {
  const row = await db.prepare(`SELECT repair_orders_json FROM job_board_snapshots WHERE repair_orders_json <> '[]'
    ORDER BY captured_at DESC, id DESC LIMIT 1`).first<Record<string, unknown>>().catch(() => null);
  return row ? JSON.parse(String(row.repair_orders_json)) : [];
}

/** Recompute the auto schedule. Writer-pinned rows are preserved; everything else is re-placed. */
export async function recomputeTechBoard(db: D1, orders?: BoardRepairOrder[], now = new Date()) {
  await initializeTechBoard(db);
  const techList = await loadTechs(db);
  const source = await withRoJobs(db, await withKnownLaborHours(db, orders ?? await latestOrders(db)), techList);
  // Reader-detected Tekmetric job status changes (completed / reopened / tech changed) → Teams events.
  await sendInstant(db, await recordTekmetricChanges(db as never, source.map((order) => ({ roNumber: String(order.roNumber), customer: order.customer, label: order.label,
    jobs: (order.jobs ?? []).map((job) => ({ jobId: job.jobId, name: job.name, technician: job.technician ?? job.techInitials ?? "", completed: job.completed })) })),
    now.toISOString()).catch(() => [])).catch(() => undefined);
  const priorJobs = await loadJobs(db);
  const existing: ExistingRow[] = priorJobs.map((job) => ({
    ro: job.ro, tech: job.tech, laneDate: job.laneDate, position: job.position, startMinute: job.startMinute,
    pinned: job.pinned, placedBy: job.placedBy, techEstimateHours: job.techEstimateHours, startedAt: job.startedAt,
    title: job.title, note: job.note, custom: job.custom, hidden: job.hidden,
    durationOverrideMinutes: job.durationOverrideMinutes, durationMinutes: job.durationMinutes,
    carriedOver: job.carriedOver, linkedRo: job.custom ? job.linkedRo : null, status: job.status, roNumber: job.roNumber, apptKey: job.apptKey ?? null, customer: job.customer, vehicle: job.vehicle, detailUrl: job.detailUrl, label: job.label,
    autoPlaced: Boolean(job.autoPlaced), needsPlacing: job.needsPlacing ?? null,
  }));
  const techs = await loadTechs(db);
  const timeOff = await loadTimeOff(db);
  const [progress, appointments, pastAll] = await Promise.all([loadProgress(db), loadAppointments(db, chicagoDate(now)), loadAppointments(db, chicagoDate(now), true)]);
  const pastAppointments = pastAll.filter((appt) => appt.startMinute !== null && appt.startMinute < 0); // v1.6.11: front-office rows only
  const startDate = await getStartDate(db);
  const firstSeen = await firstSeenDates(db, source.map((order) => String(order.roNumber)), chicagoDate(now));
  const jobs = schedule(source, existing, techs, { today: chicagoDate(now), now: now.toISOString(), timeOff, progress, appointments, approvedOnly: true,
    startDate, firstSeen, keepToday: true, autoPlace: true, pastAppointments, tekSchedule: toTekSchedule(await loadTekSchedule(db), techs) });
  const statements: unknown[] = [db.prepare(`DELETE FROM board_jobs`)];
  for (const job of jobs) {
    statements.push(db.prepare(`INSERT INTO board_jobs (ro, vehicle, customer, label, detail_url, tech, assigned_tech,
      labor_guide_hours, tech_estimate_hours, lane_date, position, start_minute, duration_minutes, pinned, placed_by,
      status, in_diag_block, started_at, updated_at, title, note, custom, hidden, duration_override_minutes, linked_ro, carried_over, ro_number, job_name, job_order, logged_seconds, appt_key, appt_info, auto_placed, needs_placing)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(job.ro, job.vehicle, job.customer, job.label, job.detailUrl, job.tech, job.assignedTech, job.laborGuideHours,
        job.techEstimateHours, job.laneDate, job.position, job.startMinute, job.durationMinutes, job.pinned ? 1 : 0,
        job.placedBy, job.status, job.inDiagBlock ? 1 : 0, job.startedAt, job.updatedAt, job.title, job.note,
        job.custom ? 1 : 0, job.hidden ? 1 : 0, job.durationOverrideMinutes, job.custom ? job.linkedRo : null, job.carriedOver ? 1 : 0, job.roNumber, job.jobName, job.jobOrder, job.loggedSeconds ?? null, job.apptKey ?? null, job.apptInfo ?? null, job.autoPlaced ? 1 : 0, job.needsPlacing ?? null));
  }
  await db.batch(statements);
  await logAutoPlacements(db, priorJobs, jobs, techs, now.toISOString()).catch(() => undefined);
  return jobs;
}

/** v1.6.16: newly auto-placed / newly "Needs placing" jobs → change log + a Teams event (once per job, not every sync). */
export function autoPlaceNotices(prior: BoardJob[], jobs: BoardJob[], techs: { initials: string; name: string }[]) {
  const before = new Map(prior.map((job) => [job.ro, job]));
  const time = (minute: number) => { const total = 480 + minute; const h = Math.floor(total / 60), m = total % 60; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
  const notices: { ro: string; roNumber: string; kind: "auto-placed" | "needs-placing"; message: string }[] = [];
  for (const job of jobs) {
    if (job.hidden || job.custom || job.ro.includes("~")) continue;
    const old = before.get(job.ro);
    const who = `RO#${job.roNumber}${job.customer ? ` ${job.customer}` : ""}${job.jobName ? ` · ${job.jobName}` : ""}`;
    if (job.autoPlaced && !(old?.autoPlaced && old.tech === job.tech && old.laneDate === job.laneDate)) {
      const name = techs.find((tech) => tech.initials === job.tech)?.name || job.tech;
      notices.push({ ro: job.ro, roNumber: job.roNumber, kind: "auto-placed", message: `Auto-placed ${who} on ${name} at ${time(job.startMinute)} (${(job.durationMinutes / 60).toFixed(1)} h).` });
    } else if (job.needsPlacing && !old?.needsPlacing) {
      notices.push({ ro: job.ro, roNumber: job.roNumber, kind: "needs-placing", message: `Needs placing: ${who} — ${job.needsPlacing}.` });
    }
  }
  return notices;
}
async function logAutoPlacements(db: D1, prior: BoardJob[], jobs: BoardJob[], techs: TechCapacity[], now: string) {
  for (const notice of autoPlaceNotices(prior, jobs, techs)) {
    await db.prepare(`INSERT INTO board_change_log (source, actor, action, ro, body_json, created_at) VALUES ('auto-place', 'Tech Board', ?, ?, ?, ?)`)
      .bind(notice.kind, notice.ro.slice(0, 40), JSON.stringify(notice).slice(0, 4000), now).run().catch(() => undefined);
    await sendInstant(db, await recordBoardNotice(db as never, { jobKey: notice.ro, ro: notice.roNumber, kind: notice.kind, message: notice.message, now }).catch(() => null)).catch(() => undefined);
  }
}

export async function loadLatestUpdates(db: D1) {
  // Per RO: latest status kind (ignoring plain notes / %-only updates), latest non-null %,
  // and the latest comment + time overall.
  const rows = await db.prepare(`SELECT u.ro, u.comment, u.created_at,
      COALESCE((SELECT k.kind FROM board_job_updates k WHERE k.ro = u.ro AND k.kind <> 'note' ORDER BY k.id DESC LIMIT 1), 'note') AS kind,
      (SELECT p.percent_complete FROM board_job_updates p WHERE p.ro = u.ro AND p.percent_complete IS NOT NULL ORDER BY p.id DESC LIMIT 1) AS percent_complete
    FROM board_job_updates u
    JOIN (SELECT ro, MAX(id) AS id FROM board_job_updates GROUP BY ro) latest ON latest.id = u.id`).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    ro: String(row.ro), kind: String(row.kind), comment: String(row.comment || ""), createdAt: String(row.created_at),
    percentComplete: row.percent_complete === null || row.percent_complete === undefined ? null : Number(row.percent_complete),
  }));
}

export async function loadTimeOff(db: D1): Promise<TimeOff[]> {
  const rows = await db.prepare(`SELECT * FROM tech_time_off ORDER BY date, initials, start_minute`).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: Number(row.id), initials: String(row.initials), date: String(row.date), startMinute: Number(row.start_minute) || 0,
    endMinute: Number(row.end_minute) || 0, allDay: Number(row.all_day) === 1, reason: String(row.reason || ""), createdBy: String(row.created_by || ""),
  }));
}

export async function loadPoolRequests(db: D1, includeDecided = false) {
  const rows = await db.prepare(includeDecided
    ? `SELECT * FROM board_pool_requests WHERE status = 'pending' OR decided_at >= datetime('now', '-3 days') ORDER BY id DESC LIMIT 50`
    : `SELECT * FROM board_pool_requests WHERE status = 'pending' ORDER BY id`).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: Number(row.id), ro: String(row.ro), tech: String(row.tech), status: String(row.status), note: String(row.note || ""),
    createdAt: String(row.created_at),
  }));
}

// ---- Tech PINs (hashed; never stored or returned in plain text) ----
export async function pinStatus(db: D1) {
  const rows = await db.prepare(`SELECT initials, updated_at FROM tech_pins`).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ initials: String(row.initials), updatedAt: String(row.updated_at) }));
}
export async function pinRow(db: D1, initials: string) {
  return db.prepare(`SELECT * FROM tech_pins WHERE initials = ?`).bind(initials).first<Record<string, unknown>>();
}

// ---- Tech Board revisions suggestion box ----
export async function loadSuggestions(db: D1, tech?: string) {
  const rows = tech
    ? await db.prepare(`SELECT * FROM board_suggestions WHERE submitter_tech = ? ORDER BY id DESC LIMIT 100`).bind(tech).all<Record<string, unknown>>()
    : await db.prepare(`SELECT * FROM board_suggestions ORDER BY id DESC LIMIT 300`).all<Record<string, unknown>>();
  return rows.results.map(rowToSuggestion);
}
export async function addSuggestion(db: D1, value: { text: string; category: string; submitter: string; submitterTech: string | null; source: string }, now: string) {
  await db.prepare(`INSERT INTO board_suggestions (text, category, submitter, submitter_tech, source, status, reply, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'New', '', ?, ?)`).bind(value.text, value.category, value.submitter, value.submitterTech, value.source, now, now).run();
  const row = await db.prepare(`SELECT id FROM board_suggestions WHERE created_at = ? AND text = ? ORDER BY id DESC LIMIT 1`).bind(now, value.text).first<Record<string, unknown>>();
  return row ? Number(row.id) : 0;
}

// ---- Writer schedule inbox (freeform "put this on the schedule"; not suggestions or pool requests) ----
const SCHEDULE_INBOX_MS = 3 * 24 * 60 * 60 * 1000;
export async function loadScheduleRequests(db: D1, scope: "open" | "inbox" = "inbox"): Promise<ScheduleRequest[]> {
  const rows = await db.prepare(`SELECT * FROM board_schedule_requests ORDER BY id DESC LIMIT 200`).all<Record<string, unknown>>();
  const cutoff = Date.now() - SCHEDULE_INBOX_MS;
  const items = rows.results.map(rowToScheduleRequest).filter((item) => item.status === "open" || (scope === "inbox" && item.doneAt != null && Date.parse(item.doneAt) >= cutoff));
  return items.sort((a, b) => (a.status === b.status ? b.id - a.id : a.status === "open" ? -1 : 1));
}
export async function addScheduleRequest(db: D1, value: { text: string; submitter: string; source: string }, now: string) {
  await db.prepare(`INSERT INTO board_schedule_requests (text, submitter, source, status, created_at, updated_at, done_by, done_at)
    VALUES (?, ?, ?, 'open', ?, ?, '', NULL)`).bind(value.text, value.submitter, value.source === "teams-bot" ? "teams-bot" : "writer", now, now).run();
  const row = await db.prepare(`SELECT id FROM board_schedule_requests WHERE created_at = ? AND text = ? ORDER BY id DESC LIMIT 1`).bind(now, value.text).first<Record<string, unknown>>();
  return row ? Number(row.id) : 0;
}
export async function getScheduleRequest(db: D1, id: number) {
  const row = await db.prepare(`SELECT * FROM board_schedule_requests WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? rowToScheduleRequest(row) : null;
}
export async function markScheduleRequestDone(db: D1, id: number, doneBy: string, now: string) {
  await db.prepare(`UPDATE board_schedule_requests SET status = 'done', done_by = ?, done_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`)
    .bind(doneBy, now, now, id).run();
}

/** v1.6.15: check-in scan codes per RO. */
export async function loadCheckins(db: D1): Promise<import("./dtc").Checkin[]> {
  const rows = await db.prepare(`SELECT * FROM board_checkin`).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.map((row) => { let codes: string[] = []; try { codes = JSON.parse(String(row.codes_json || "[]")); } catch { codes = []; }
    return { ro: String(row.ro), codes, notes: String(row.notes || ""), updatedBy: String(row.updated_by || ""), updatedAt: String(row.updated_at || "") }; });
}
export async function saveCheckin(db: D1, ro: string, codes: string[], notes: string, by: string, now: string) {
  if (!codes.length && !notes.trim()) { await db.prepare(`DELETE FROM board_checkin WHERE ro = ?`).bind(ro).run(); return; }
  await db.prepare(`INSERT INTO board_checkin (ro, codes_json, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(ro) DO UPDATE SET codes_json = excluded.codes_json, notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(ro, JSON.stringify(codes), notes.slice(0, 2000), by.slice(0, 120), now).run();
}

export { loadIdentifixRequests, getIdentifixRequest, addIdentifixRequest, claimIdentifixRequest, finishIdentifixRequest } from "./identifix-store.ts";

export { saveScan, getScan, loadUnmatchedScans, markScan, loadRoVins, setRoVin } from "./bayscan-store.ts";
