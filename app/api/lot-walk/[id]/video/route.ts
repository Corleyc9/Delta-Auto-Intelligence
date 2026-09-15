import { requireApiUser } from "@/app/chatgpt-auth";

// The Windows reader may use its machine key. A signed-in dashboard user may
// also retrieve a video they can already see in the protected Lot Walk page.

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const env = await runtimeEnv();
  const machineAuthorized = Boolean(
    env.READER_API_KEY && request.headers.get("x-reader-key") === env.READER_API_KEY,
  );
  if (!machineAuthorized) {
    const auth = await requireApiUser();
    if (auth instanceof Response) return auth;
  }

  const { id } = await params;
  const row = await env.DB.prepare(
    "SELECT video_key, video_filename FROM lot_walk_audits WHERE id = ?",
  ).bind(id).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const bucket = (env as Record<string, unknown>).delta_auto_lot_walks as
    | { get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> }
    | undefined;
  if (!bucket) {
    return Response.json({ error: "Video storage (R2) is not configured" }, { status: 503 });
  }

  const object = await bucket.get(String(row.video_key));
  if (!object) return Response.json({ error: "Video missing from storage" }, { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${String(row.video_filename)}"`,
    },
  });
}
