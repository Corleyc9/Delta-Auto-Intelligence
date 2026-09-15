import { requireApiUser } from "@/app/chatgpt-auth";

type RepairOrder = {
  roNumber: string;
  section: "estimates" | "work-in-progress" | "completed";
  label: string;
  category: string;
  customer: string;
  phone: string;
  vehicle: string;
  serviceWriter: string;
  serviceWriterInitials: string;
  assignedInitials: string[];
  ageDays: number;
  daysSinceActivity: number;
  amount: number;
  soldHours: number;
  balanceDue: boolean;
  customerComplaint: string;
  detailUrl: string;
};

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

function reportingWeekKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const localDate = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  localDate.setUTCDate(localDate.getUTCDate() - ((localDate.getUTCDay() - 3 + 7) % 7));
  return localDate.toISOString().slice(0, 10);
}

async function initialize() {
  const env = await runtimeEnv();
  await env.DB.batch([env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS job_board_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_orders_json TEXT NOT NULL,
      captured_at TEXT NOT NULL
    )
  `), env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_diagnosis_watch (
      ro_number TEXT PRIMARY KEY,
      needs_diag_present INTEGER NOT NULL DEFAULT 0,
      last_label TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL
    )`), env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_verification_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ro_number TEXT NOT NULL,
      customer TEXT NOT NULL,
      vehicle TEXT NOT NULL,
      service_writer TEXT NOT NULL,
      detail_url TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      section TEXT NOT NULL,
      diagnosed_at TEXT NOT NULL,
      verify_label_seen_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      verified_at TEXT,
      verified_by TEXT,
      verification_note TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL
    )`), env.DB.prepare(`CREATE INDEX IF NOT EXISTS ro_verification_status_idx
      ON ro_verification_cycles (status, diagnosed_at DESC)`), env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_sold_hours_watch (
      ro_number TEXT PRIMARY KEY, sold_hours REAL NOT NULL DEFAULT 0, last_seen_at TEXT NOT NULL
    )`), env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_sold_hours_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ro_number TEXT NOT NULL,
      customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '',
      hours_delta REAL NOT NULL, week_key TEXT NOT NULL, captured_at TEXT NOT NULL
    )`), env.DB.prepare(`CREATE INDEX IF NOT EXISTS ro_sold_hours_events_week_idx
      ON ro_sold_hours_events (week_key, captured_at DESC)`), env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_sold_hours_watch_v2 (
      ro_number TEXT PRIMARY KEY, sold_hours REAL NOT NULL DEFAULT 0, last_seen_at TEXT NOT NULL
    )`), env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_sold_hours_events_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ro_number TEXT NOT NULL,
      customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '',
      hours_delta REAL NOT NULL, week_key TEXT NOT NULL, captured_at TEXT NOT NULL
    )`), env.DB.prepare(`CREATE INDEX IF NOT EXISTS ro_sold_hours_events_v2_week_idx
      ON ro_sold_hours_events_v2 (week_key, captured_at DESC)`)]);
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize();
  const row = await env.DB.prepare(`
    SELECT repair_orders_json, captured_at FROM job_board_snapshots
    WHERE repair_orders_json <> '[]'
    ORDER BY captured_at DESC, id DESC LIMIT 1
  `).first<Record<string, unknown>>();
  const weekKey = reportingWeekKey(new Date());
  const eventRows = await env.DB.prepare(`SELECT ro_number, customer, vehicle, hours_delta, captured_at
    FROM ro_sold_hours_events_v2 WHERE week_key = ? ORDER BY captured_at DESC, id DESC`)
    .bind(weekKey).all<Record<string, unknown>>();
  const soldHourEvents = eventRows.results.map((event) => ({
    roNumber: String(event.ro_number), customer: String(event.customer), vehicle: String(event.vehicle),
    hours: Number(event.hours_delta) || 0, capturedAt: String(event.captured_at),
  }));
  const soldHoursThisWeek = soldHourEvents.reduce((sum, event) => sum + event.hours, 0);
  if (!row) return Response.json({ repairOrders: [], capturedAt: null, soldHoursThisWeek, soldHourEvents, weekKey });
  return Response.json({
    repairOrders: JSON.parse(String(row.repair_orders_json)),
    capturedAt: row.captured_at,
    soldHoursThisWeek,
    soldHourEvents,
    weekKey,
  });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  const body = await request.json() as { repairOrders?: Partial<RepairOrder>[]; capturedAt?: string };
  if (!Array.isArray(body.repairOrders)) {
    return Response.json({ error: "Invalid Job Board payload" }, { status: 400 });
  }
  const repairOrders = body.repairOrders.slice(0, 5000).map((item) => ({
    roNumber: String(item.roNumber || ""),
    section: ["estimates", "work-in-progress", "completed"].includes(String(item.section))
      ? item.section : "estimates",
    label: String(item.label || "Unlabeled"),
    category: String(item.category || "other"),
    customer: String(item.customer || ""),
    phone: String(item.phone || ""),
    vehicle: String(item.vehicle || ""),
    serviceWriter: String(item.serviceWriter || "Unassigned"),
    serviceWriterInitials: String(item.serviceWriterInitials || ""),
    assignedInitials: Array.isArray(item.assignedInitials) ? item.assignedInitials.map(String) : [],
    ageDays: Math.max(0, Number(item.ageDays) || 0),
    daysSinceActivity: Math.max(0, Number(item.daysSinceActivity) || 0),
    amount: Math.max(0, Number(item.amount) || 0),
    soldHours: Math.max(0, Number(item.soldHours) || 0),
    balanceDue: Boolean(item.balanceDue),
    customerComplaint: String(item.customerComplaint || "").slice(0, 900),
    detailUrl: String(item.detailUrl || "").slice(0, 1000),
  })).filter((item) => item.roNumber && item.customer);

  if (!repairOrders.length) {
    return Response.json({
      error: "Empty Job Board snapshot rejected; last valid snapshot preserved.",
    }, { status: 422 });
  }

  await initialize();
  const capturedAt = body.capturedAt || new Date().toISOString();
  const watchRows = await env.DB.prepare(`
    SELECT ro_number, needs_diag_present FROM ro_diagnosis_watch
  `).all<Record<string, unknown>>();
  const watched = new Map(watchRows.results.map((row) => [String(row.ro_number), Number(row.needs_diag_present) === 1]));
  const pendingRows = await env.DB.prepare(`
    SELECT id, ro_number FROM ro_verification_cycles WHERE status = 'pending'
  `).all<Record<string, unknown>>();
  const pending = new Map(pendingRows.results.map((row) => [String(row.ro_number), Number(row.id)]));
  const soldWatchRows = await env.DB.prepare(`SELECT ro_number, sold_hours FROM ro_sold_hours_watch_v2`)
    .all<Record<string, unknown>>();
  const soldWatched = new Map(soldWatchRows.results.map((row) => [String(row.ro_number), Number(row.sold_hours) || 0]));
  const weekKey = reportingWeekKey(new Date(capturedAt));
  const capturedLocal = new Date(capturedAt);
  const weekStart = new Date(`${weekKey}T00:00:00Z`);
  const capturedParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(capturedLocal);
  const capturedPart = (type: string) => Number(capturedParts.find((part) => part.type === type)?.value || 0);
  const capturedDay = new Date(Date.UTC(capturedPart("year"), capturedPart("month") - 1, capturedPart("day")));
  const daysIntoWeek = Math.max(0, Math.floor((capturedDay.getTime() - weekStart.getTime()) / 86400000));
  const statements = [];
  for (const order of repairOrders) {
    const label = order.label.toLowerCase();
    const needsDiag = label.includes("needs diag");
    const verifyTagged = label === "verify" || label.includes("verify parts&labor") || label.includes("verify parts/labor");
    const wasNeedsDiag = watched.get(order.roNumber) === true;
    const diagnosisCompleted = wasNeedsDiag && !needsDiag;
    let pendingId = pending.get(order.roNumber);

    // A Needs Diag -> no Needs Diag transition creates the required review.
    // Existing Verify-tagged work is also enrolled on the first scan after rollout.
    if (!pendingId && (diagnosisCompleted || verifyTagged)) {
      statements.push(env.DB.prepare(`INSERT INTO ro_verification_cycles
        (ro_number, customer, vehicle, service_writer, detail_url, amount, section,
         diagnosed_at, verify_label_seen_at, status, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .bind(order.roNumber, order.customer, order.vehicle, order.serviceWriter,
          order.detailUrl, order.amount, order.section, capturedAt,
          verifyTagged ? capturedAt : null, capturedAt));
      // The id is not known until the batch runs. The metadata update below is
      // intentionally skipped for this new row because the insert already has it.
    } else if (pendingId) {
      statements.push(env.DB.prepare(`UPDATE ro_verification_cycles SET
        customer = ?, vehicle = ?, service_writer = ?, detail_url = ?, amount = ?,
        section = ?, verify_label_seen_at = CASE
          WHEN ? = 1 THEN COALESCE(verify_label_seen_at, ?) ELSE verify_label_seen_at END,
        last_seen_at = ? WHERE id = ?`)
        .bind(order.customer, order.vehicle, order.serviceWriter, order.detailUrl,
          order.amount, order.section, verifyTagged ? 1 : 0, capturedAt, capturedAt, pendingId));
    }
    statements.push(env.DB.prepare(`INSERT INTO ro_diagnosis_watch
      (ro_number, needs_diag_present, last_label, last_seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(ro_number) DO UPDATE SET needs_diag_present = excluded.needs_diag_present,
        last_label = excluded.last_label, last_seen_at = excluded.last_seen_at`)
      .bind(order.roNumber, needsDiag ? 1 : 0, order.label, capturedAt));

    const priorHours = soldWatched.get(order.roNumber);
    // On a fresh install, backfill ROs created during the current Wed-Tue
    // reporting week. Older active ROs establish a zero baseline; only later
    // approval increases are credited to this week.
    const hoursDelta = priorHours === undefined
      ? (order.ageDays <= daysIntoWeek ? order.soldHours : 0)
      : Math.max(0, order.soldHours - priorHours);
    if (hoursDelta > 0.001) {
      statements.push(env.DB.prepare(`INSERT INTO ro_sold_hours_events_v2
        (ro_number, customer, vehicle, hours_delta, week_key, captured_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(order.roNumber, order.customer, order.vehicle, hoursDelta, weekKey, capturedAt));
    }
    statements.push(env.DB.prepare(`INSERT INTO ro_sold_hours_watch_v2 (ro_number, sold_hours, last_seen_at)
      VALUES (?, ?, ?) ON CONFLICT(ro_number) DO UPDATE SET
      sold_hours = MAX(ro_sold_hours_watch_v2.sold_hours, excluded.sold_hours), last_seen_at = excluded.last_seen_at`)
      .bind(order.roNumber, order.soldHours, capturedAt));
  }
  if (statements.length) await env.DB.batch(statements);
  await env.DB.prepare(`
    INSERT INTO job_board_snapshots (repair_orders_json, captured_at)
    VALUES (?, ?)
  `).bind(JSON.stringify(repairOrders), capturedAt).run();
  return Response.json({ ok: true, count: repairOrders.length, capturedAt }, { status: 201 });
}
