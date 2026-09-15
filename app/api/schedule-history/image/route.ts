import { requireApiUser } from "@/app/chatgpt-auth";
import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";
import { r2Bucket } from "@/app/lib/r2";


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
  const bucket = r2Bucket(env as Record<string, unknown>) as
    | { put: (key: string, value: ArrayBuffer, options?: unknown) => Promise<unknown> }
    | undefined;
  if (!bucket) return Response.json({ error: "Screenshot storage is not configured" }, { status: 503 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 15_000_000) {
    return Response.json({ error: "Invalid screenshot" }, { status: 400 });
  }
  await ensureSchema(env.DB);
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
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const row = await env.DB.prepare(`SELECT object_key FROM schedule_snapshot_images
    WHERE schedule_date = ? AND hour_key = ?`)
    .bind(url.searchParams.get("date") || "", url.searchParams.get("hour") || "")
    .first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "Screenshot not found" }, { status: 404 });
  const bucket = r2Bucket(env as Record<string, unknown>) as
    | { get: (key: string) => Promise<{ body: ReadableStream } | null> }
    | undefined;
  const object = bucket ? await bucket.get(String(row.object_key)) : null;
  if (!object) return Response.json({ error: "Screenshot missing from storage" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}
