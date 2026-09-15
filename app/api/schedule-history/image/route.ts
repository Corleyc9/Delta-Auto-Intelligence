import { requireApiUser } from "@/app/chatgpt-auth";

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

async function initialize(env: Awaited<ReturnType<typeof runtimeEnv>>) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedule_snapshot_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_date TEXT NOT NULL,
    hour_key TEXT NOT NULL,
    object_key TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    UNIQUE(schedule_date, hour_key)
  )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedule_capture_request (
      id INTEGER PRIMARY KEY CHECK (id = 1), status TEXT NOT NULL,
      requested_at TEXT NOT NULL, completed_at TEXT
    )`),
  ]);
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  const url = new URL(request.url);
  const scheduleDate = url.searchParams.get("date") || "";
  const hourKey = url.searchParams.get("hour") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate) || !/^\d{2}(?:\d{2})?$/.test(hourKey)) {
    return Response.json({ error: "Invalid schedule screenshot key" }, { status: 400 });
  }
  const bucket = (env as Record<string, unknown>).delta_auto_lot_walks as
    | { put: (key: string, value: ArrayBuffer, options?: unknown) => Promise<unknown> }
    | undefined;
  if (!bucket) return Response.json({ error: "Screenshot storage is not configured" }, { status: 503 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 15_000_000) {
    return Response.json({ error: "Invalid screenshot" }, { status: 400 });
  }
  await initialize(env);
  const capturedAt = new Date().toISOString();
  const objectKey = `schedule-history/${scheduleDate}/${hourKey}-${Date.now()}.png`;
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare(`INSERT INTO schedule_snapshot_images
    (schedule_date, hour_key, object_key, captured_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(schedule_date, hour_key) DO UPDATE SET
      object_key = excluded.object_key, captured_at = excluded.captured_at`)
    .bind(scheduleDate, hourKey, objectKey, capturedAt).run();
  await env.DB.prepare(`UPDATE schedule_capture_request
    SET status = 'completed', completed_at = ? WHERE id = 1 AND status = 'pending'`)
    .bind(capturedAt).run();
  return Response.json({ ok: true, capturedAt }, { status: 201 });
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize(env);
  const url = new URL(request.url);
  const row = await env.DB.prepare(`SELECT object_key FROM schedule_snapshot_images
    WHERE schedule_date = ? AND hour_key = ?`)
    .bind(url.searchParams.get("date") || "", url.searchParams.get("hour") || "")
    .first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "Screenshot not found" }, { status: 404 });
  const bucket = (env as Record<string, unknown>).delta_auto_lot_walks as
    | { get: (key: string) => Promise<{ body: ReadableStream } | null> }
    | undefined;
  const object = bucket ? await bucket.get(String(row.object_key)) : null;
  if (!object) return Response.json({ error: "Screenshot missing from storage" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}
