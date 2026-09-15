import { requireApiUser } from "@/app/chatgpt-auth";

// Lot Walk audits: video goes into R2, a DB row tracks status, and the
// actual vehicle/plate analysis is done out-of-band (by Claude, when asked
// to process a pending video) — that kind of video/vision work doesn't fit
// inside a Worker's request lifecycle. This route is the upload + list
// surface; app/api/lot-walk/[id]/video and .../result are the machine-key
// endpoints the analysis process uses to fetch a video and report back.

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

async function initialize() {
  const env = await runtimeEnv();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS lot_walk_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'uploaded',
      video_key TEXT NOT NULL,
      video_filename TEXT NOT NULL,
      video_size INTEGER NOT NULL DEFAULT 0,
      result_json TEXT,
      error_detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize();
  const rows = await env.DB.prepare(`
    SELECT id, status, video_filename, video_size, result_json, error_detail, created_at, updated_at
    FROM lot_walk_audits
    ORDER BY created_at DESC
    LIMIT 50
  `).all<Record<string, unknown>>();

  const audits = rows.results.map((row) => {
    const parsed = row.result_json ? JSON.parse(String(row.result_json)) : null;
    return {
      id: row.id,
      status: row.status,
      videoFilename: row.video_filename,
      videoSize: row.video_size,
      summary: parsed?.summary ?? null,
      errorDetail: row.error_detail,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  return Response.json({ audits });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize();

  const bucket = (env as Record<string, unknown>).delta_auto_lot_walks as
    | { put: (key: string, body: ReadableStream | null, opts?: Record<string, unknown>) => Promise<{ size?: number } | null> }
    | undefined;
  if (!bucket) {
    return Response.json({ error: "Video storage (R2) is not configured yet" }, { status: 503 });
  }
  if (!request.body) {
    return Response.json({ error: "No video data received" }, { status: 400 });
  }

  const filenameHeader = request.headers.get("x-lot-walk-filename") || "";
  const filename = filenameHeader.trim() || `lot-walk-${Date.now()}.mp4`;
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const now = new Date().toISOString();
  const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
  const key = `lot-walks/${now.slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;

  const uploaded = await bucket.put(key, request.body, {
    httpMetadata: { contentType },
  });

  const result = await env.DB.prepare(`
    INSERT INTO lot_walk_audits (status, video_key, video_filename, video_size, created_at, updated_at)
    VALUES ('uploaded', ?, ?, ?, ?, ?)
  `).bind(key, filename, uploaded?.size ?? 0, now, now).run();

  return Response.json(
    { ok: true, id: result.meta.last_row_id, key, size: uploaded?.size ?? 0 },
    { status: 201 },
  );
}
