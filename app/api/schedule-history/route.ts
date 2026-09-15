import { requireApiUser } from "@/app/chatgpt-auth";

type ScheduleAppointment = {
  employee?: string;
  startTime?: string;
  endTime?: string;
  text?: string;
  color?: string;
};

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

async function initialize() {
  const env = await runtimeEnv();
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedule_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_date TEXT NOT NULL,
      hour_key TEXT NOT NULL,
      hour_label TEXT NOT NULL,
      employees_json TEXT NOT NULL,
      appointments_json TEXT NOT NULL,
      raw_text TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,
      UNIQUE(schedule_date, hour_key)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS schedule_snapshots_date_idx
      ON schedule_snapshots (schedule_date DESC, hour_key DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedule_capture_request (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedule_snapshot_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_date TEXT NOT NULL,
      hour_key TEXT NOT NULL,
      object_key TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      UNIQUE(schedule_date, hour_key)
    )`),
  ]);
}

export async function GET(request: Request) {
  const env = await runtimeEnv();
  const machineAuthorized = Boolean(
    env.READER_API_KEY && request.headers.get("x-reader-key") === env.READER_API_KEY,
  );
  await initialize();
  if (machineAuthorized) {
    const pending = await env.DB.prepare(
      "SELECT requested_at FROM schedule_capture_request WHERE id = 1 AND status = 'pending'",
    ).first<Record<string, unknown>>();
    return Response.json({ captureRequested: Boolean(pending), requestedAt: pending?.requested_at || null });
  }
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const rows = await env.DB.prepare(`
    SELECT id, schedule_date, hour_key, hour_label, employees_json,
      appointments_json, captured_at,
      EXISTS(SELECT 1 FROM schedule_snapshot_images i
        WHERE i.schedule_date = schedule_snapshots.schedule_date
          AND i.hour_key = schedule_snapshots.hour_key) AS screenshot_available
    FROM schedule_snapshots
    WHERE schedule_date >= date('now', '-8 days')
    ORDER BY schedule_date DESC, hour_key DESC
    LIMIT 250
  `).all<Record<string, unknown>>();
  return Response.json({
    retentionDays: 30,
    snapshots: rows.results.map((row) => ({
      id: Number(row.id),
      scheduleDate: String(row.schedule_date),
      hourKey: String(row.hour_key),
      hourLabel: String(row.hour_label),
      employees: JSON.parse(String(row.employees_json || "[]")),
      appointments: JSON.parse(String(row.appointments_json || "[]")),
      capturedAt: String(row.captured_at),
      screenshotAvailable: Boolean(row.screenshot_available),
    })),
  });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  const machineAuthorized = Boolean(
    env.READER_API_KEY && request.headers.get("x-reader-key") === env.READER_API_KEY,
  );
  await initialize();
  if (!machineAuthorized) {
    const auth = await requireApiUser();
    if (auth instanceof Response) return auth;
    const actionBody = await request.json() as { action?: string };
    if (actionBody.action !== "request-capture") {
      return Response.json({ error: "Unsupported action" }, { status: 400 });
    }
    const requestedAt = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO schedule_capture_request (id, status, requested_at, completed_at)
      VALUES (1, 'pending', ?, NULL)
      ON CONFLICT(id) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at, completed_at = NULL`)
      .bind(requestedAt).run();
    return Response.json({ ok: true, requestedAt }, { status: 202 });
  }
  const body = await request.json() as {
    scheduleDate?: string;
    hourKey?: string;
    hourLabel?: string;
    employees?: unknown[];
    appointments?: ScheduleAppointment[];
    rawText?: string;
    capturedAt?: string;
  };
  const scheduleDate = String(body.scheduleDate || "");
  const hourKey = String(body.hourKey || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate) || !/^\d{2}(?:\d{2})?$/.test(hourKey)) {
    return Response.json({ error: "Invalid schedule snapshot date or hour" }, { status: 400 });
  }
  const employees = (Array.isArray(body.employees) ? body.employees : [])
    .map(String).map((value) => value.slice(0, 100)).slice(0, 30);
  const appointments = (Array.isArray(body.appointments) ? body.appointments : [])
    .slice(0, 500).map((item) => ({
      employee: String(item.employee || "Unassigned").slice(0, 100),
      startTime: String(item.startTime || "").slice(0, 20),
      endTime: String(item.endTime || "").slice(0, 20),
      text: String(item.text || "").slice(0, 700),
      color: String(item.color || "").slice(0, 60),
    })).filter((item) => item.text);
  const capturedAt = body.capturedAt || new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO schedule_snapshots
      (schedule_date, hour_key, hour_label, employees_json, appointments_json, raw_text, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(schedule_date, hour_key) DO UPDATE SET
      hour_label = excluded.hour_label,
      employees_json = excluded.employees_json,
      appointments_json = excluded.appointments_json,
      raw_text = excluded.raw_text,
      captured_at = excluded.captured_at
  `).bind(scheduleDate, hourKey, String(body.hourLabel || hourKey),
    JSON.stringify(employees), JSON.stringify(appointments),
    String(body.rawText || "").slice(0, 50000), capturedAt).run();
  // Keep a full month even though the UI's normal recordkeeping window is one week.
  await env.DB.prepare(`DELETE FROM schedule_snapshots
    WHERE schedule_date < date('now', '-30 days')`).run();

  return Response.json({ ok: true, count: appointments.length, capturedAt }, { status: 201 });
}
