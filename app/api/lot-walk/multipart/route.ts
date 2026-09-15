import { requireApiUser } from "@/app/chatgpt-auth";

type UploadedPart = { partNumber: number; etag: string };
type MultipartUpload = {
  uploadId: string;
  uploadPart: (partNumber: number, value: ArrayBuffer) => Promise<UploadedPart>;
  complete: (parts: UploadedPart[]) => Promise<{ size?: number }>;
};
type LotWalkBucket = {
  createMultipartUpload: (key: string, options?: Record<string, unknown>) => Promise<MultipartUpload>;
  resumeMultipartUpload: (key: string, uploadId: string) => MultipartUpload;
};

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

async function initialize() {
  const env = await runtimeEnv();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lot_walk_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'uploaded',
    video_key TEXT NOT NULL,
    video_filename TEXT NOT NULL,
    video_size INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
}

function bucketFrom(env: Record<string, unknown>) {
  return env.delta_auto_lot_walks as LotWalkBucket | undefined;
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  const bucket = bucketFrom(env as unknown as Record<string, unknown>);
  if (!bucket) return Response.json({ error: "Video storage is not configured" }, { status: 503 });
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action || "");

  if (action === "start") {
    const filename = String(body.filename || `lot-walk-${Date.now()}.mp4`).slice(0, 240);
    const contentType = String(body.contentType || "application/octet-stream").slice(0, 150);
    const now = new Date().toISOString();
    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
    const key = `lot-walks/${now.slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
    const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType } });
    return Response.json({ key, uploadId: upload.uploadId });
  }

  if (action === "complete") {
    const key = String(body.key || "");
    const uploadId = String(body.uploadId || "");
    const filename = String(body.filename || "lot-walk.mp4").slice(0, 240);
    const expectedSize = Math.max(0, Number(body.size) || 0);
    const parts = (Array.isArray(body.parts) ? body.parts : []).slice(0, 1000).map((part) => {
      const value = part as Record<string, unknown>;
      return { partNumber: Number(value.partNumber), etag: String(value.etag || "") };
    }).filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag);
    if (!key || !uploadId || !parts.length) return Response.json({ error: "Incomplete upload information" }, { status: 400 });
    const completed = await bucket.resumeMultipartUpload(key, uploadId).complete(parts);
    await initialize();
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`INSERT INTO lot_walk_audits
      (status, video_key, video_filename, video_size, created_at, updated_at)
      VALUES ('uploaded', ?, ?, ?, ?, ?)`)
      .bind(key, filename, completed?.size || expectedSize, now, now).run();
    return Response.json({ ok: true, id: result.meta.last_row_id, size: completed?.size || expectedSize }, { status: 201 });
  }

  return Response.json({ error: "Unknown upload action" }, { status: 400 });
}

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  const bucket = bucketFrom(env as unknown as Record<string, unknown>);
  if (!bucket) return Response.json({ error: "Video storage is not configured" }, { status: 503 });
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const uploadId = url.searchParams.get("uploadId") || "";
  const partNumber = Number(url.searchParams.get("part"));
  if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1)
    return Response.json({ error: "Invalid upload part" }, { status: 400 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return Response.json({ error: "Empty upload part" }, { status: 400 });
  const part = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, bytes);
  return Response.json({ partNumber: part.partNumber, etag: part.etag });
}
