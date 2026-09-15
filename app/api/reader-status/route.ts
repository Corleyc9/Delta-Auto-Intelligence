// Lets the Windows reader report "I'm stuck and need a human" instead of the
// old behavior of just freezing on a terminal input() prompt with no way for
// anyone away from the shop computer to know. The dashboard polls this GET
// endpoint and shows a banner when status isn't "ok".
//
// This endpoint intentionally holds no secrets and no customer data — only a
// short machine-readable status string and a human-readable detail line — so
// it's safe to leave world-readable the same way a status page would be.

type ReaderStatus = {
  status: "ok" | "tekmetric_signin_required" | "steer_signin_required" | "error";
  detail: string;
  updatedAt: string;
};

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

async function initialize() {
  const env = await runtimeEnv();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS reader_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

const VALID_STATUSES = ["ok", "tekmetric_signin_required", "steer_signin_required", "error"];

export async function GET() {
  const env = await runtimeEnv();
  await initialize();
  const row = await env.DB.prepare(
    "SELECT status, detail, updated_at FROM reader_status WHERE id = 1",
  ).first<Record<string, unknown>>();
  if (!row) {
    return Response.json({ status: null, detail: "", updatedAt: null });
  }
  return Response.json({
    status: row.status,
    detail: row.detail,
    updatedAt: row.updated_at,
  } satisfies ReaderStatus);
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  const body = await request.json() as { status?: string; detail?: string };
  const status = VALID_STATUSES.includes(String(body.status)) ? body.status : "error";
  const detail = String(body.detail || "").slice(0, 500);

  await initialize();
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO reader_status (id, status, detail, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at
  `).bind(status, detail, updatedAt).run();

  return Response.json({ ok: true, status, updatedAt });
}
