import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";

// Lets the Windows reader report "I'm stuck and need a human" instead of the
// old behavior of just freezing on a terminal input() prompt with no way for
// anyone away from the shop computer to know. The dashboard polls this GET
// endpoint and shows a banner when status isn't "ok".
//
// This endpoint intentionally holds no secrets and no customer data — only a
// short machine-readable status string and a human-readable detail line — so
// it's safe to leave world-readable the same way a status page would be.

type ReaderStatus = {
  status: "ok" | "tekmetric_signin_required" | "steer_signin_required" | "napa_signin_required" | "error";
  detail: string;
  updatedAt: string;
  version: string;
  buildHash: string;
};

const VALID_STATUSES = [
  "ok",
  "tekmetric_signin_required",
  "steer_signin_required",
  "napa_signin_required",
  "error",
];

export async function GET() {
  const env = await runtimeEnv();
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(
    "SELECT status, detail, updated_at, version, build_hash FROM reader_status WHERE id = 1",
  ).first<Record<string, unknown>>();
  if (!row) {
    return Response.json({ status: null, detail: "", updatedAt: null, version: "", buildHash: "" });
  }
  return Response.json({
    status: row.status,
    detail: row.detail,
    updatedAt: row.updated_at,
    version: String(row.version || ""),
    buildHash: String(row.build_hash || ""),
  } satisfies ReaderStatus);
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  const body = await request.json() as {
    status?: string;
    detail?: string;
    version?: string;
    buildHash?: string;
  };
  const status = VALID_STATUSES.includes(String(body.status)) ? body.status : "error";
  const detail = String(body.detail || "").slice(0, 500);
  const version = String(body.version || "").slice(0, 40);
  const buildHash = String(body.buildHash || "").slice(0, 40);

  await ensureSchema(env.DB);
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO reader_status (id, status, detail, updated_at, version, build_hash)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      detail = excluded.detail,
      updated_at = excluded.updated_at,
      version = excluded.version,
      build_hash = excluded.build_hash
  `).bind(status, detail, updatedAt, version, buildHash).run();

  return Response.json({ ok: true, status, updatedAt, version, buildHash });
}
