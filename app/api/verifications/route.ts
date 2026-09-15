import { requireApiUser } from "@/app/chatgpt-auth";

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

async function initialize() {
  const env = await runtimeEnv();
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ro_verification_cycles (
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
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS ro_verification_status_idx
      ON ro_verification_cycles (status, diagnosed_at DESC)`),
  ]);
}

function record(row: Record<string, unknown>) {
  return {
    id: Number(row.id), roNumber: String(row.ro_number), customer: String(row.customer),
    vehicle: String(row.vehicle), serviceWriter: String(row.service_writer),
    detailUrl: String(row.detail_url || ""), amount: Number(row.amount) || 0,
    section: String(row.section), diagnosedAt: String(row.diagnosed_at),
    verifyLabelSeenAt: row.verify_label_seen_at ? String(row.verify_label_seen_at) : null,
    status: String(row.status), verifiedAt: row.verified_at ? String(row.verified_at) : null,
    verifiedBy: row.verified_by ? String(row.verified_by) : null,
    verificationNote: String(row.verification_note || ""), lastSeenAt: String(row.last_seen_at),
  };
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize();
  const rows = await env.DB.prepare(`SELECT * FROM ro_verification_cycles
    ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, diagnosed_at DESC LIMIT 1000`)
    .all<Record<string, unknown>>();
  return Response.json({ records: rows.results.map(record) });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const body = await request.json() as { id?: number; note?: string };
  const id = Math.floor(Number(body.id));
  if (!id || id < 1) return Response.json({ error: "Invalid verification record." }, { status: 400 });
  const env = await runtimeEnv();
  await initialize();
  const verifiedAt = new Date().toISOString();
  const verifiedBy = auth.displayName || auth.email || "Dashboard user";
  const note = String(body.note || "").trim().slice(0, 600);
  const result = await env.DB.prepare(`UPDATE ro_verification_cycles SET
    status = 'verified', verified_at = ?, verified_by = ?, verification_note = ?
    WHERE id = ? AND status = 'pending'`)
    .bind(verifiedAt, verifiedBy, note, id).run();
  if (!result.meta.changes) return Response.json({ error: "This RO was already verified or could not be found." }, { status: 409 });
  const row = await env.DB.prepare("SELECT * FROM ro_verification_cycles WHERE id = ?")
    .bind(id).first<Record<string, unknown>>();
  return Response.json({ ok: true, record: row ? record(row) : null });
}
