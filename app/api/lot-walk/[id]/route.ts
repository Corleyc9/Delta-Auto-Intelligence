import { requireApiUser } from "@/app/chatgpt-auth";

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const env = await runtimeEnv();

  const row = await env.DB.prepare(`
    SELECT id, status, video_filename, video_size, result_json, error_detail, created_at, updated_at
    FROM lot_walk_audits WHERE id = ?
  `).bind(id).first<Record<string, unknown>>();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    id: row.id,
    status: row.status,
    videoFilename: row.video_filename,
    videoSize: row.video_size,
    result: row.result_json ? JSON.parse(String(row.result_json)) : null,
    errorDetail: row.error_detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
