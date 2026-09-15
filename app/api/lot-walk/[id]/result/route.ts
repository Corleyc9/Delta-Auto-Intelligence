import { requireApiUser } from "@/app/chatgpt-auth";

// The background reader may use its machine key. A signed-in manager may also
// save a reviewed result from the protected Lot Walk page.

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

export async function POST(
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
  const body = await request.json() as {
    status?: string;
    result?: unknown;
    errorDetail?: string;
  };
  const status = ["processing", "complete", "failed"].includes(String(body.status))
    ? body.status
    : "complete";
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE lot_walk_audits
    SET status = ?, result_json = ?, error_detail = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    status,
    body.result !== undefined ? JSON.stringify(body.result) : null,
    body.errorDetail || null,
    now,
    id,
  ).run();

  return Response.json({ ok: true, status });
}
