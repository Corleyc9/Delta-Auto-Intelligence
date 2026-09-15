import { requireApiUser } from "@/app/chatgpt-auth";
import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";


export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await ensureSchema(env.DB);
  const requested = new URL(request.url).searchParams.get("period");
  const period = requested === "daily" ? "daily" : requested === "last_week" ? "last_week" : "weekly";
  const row = await env.DB.prepare(`
    SELECT start_date, end_date, writers_json, captured_at
    FROM service_writer_snapshots WHERE period = ?
    ORDER BY captured_at DESC, id DESC LIMIT 1
  `).bind(period).first<Record<string, unknown>>();
  if (!row) return Response.json({ snapshot: null });
  return Response.json({ snapshot: {
    period, startDate: row.start_date, endDate: row.end_date,
    writers: JSON.parse(String(row.writers_json)), capturedAt: row.captured_at,
  }});
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  const body = await request.json() as Record<string, unknown>;
  if (!body.startDate || !body.endDate || !Array.isArray(body.writers)) {
    return Response.json({ error: "Invalid writer payload" }, { status: 400 });
  }
  await ensureSchema(env.DB);
  const capturedAt = String(body.capturedAt || new Date().toISOString());
  await env.DB.prepare(`
    INSERT INTO service_writer_snapshots
      (period, start_date, end_date, writers_json, captured_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    body.period === "daily" ? "daily" : body.period === "last_week" ? "last_week" : "weekly",
    String(body.startDate), String(body.endDate),
    JSON.stringify(body.writers), capturedAt,
  ).run();
  return Response.json({ ok: true, capturedAt }, { status: 201 });
}
