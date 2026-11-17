// v1.6.21: reader claim/ack for Bay Scan report files. Auth is the Tech Board bot key (Bearer), same as /api/tech-board/bot.
// The reader uploads the file onto the existing RO's attachments. It must not create an RO or approve / authorize / send / pay.
import { botAuth } from "@/app/lib/bot-auth";
import { handleApi, readJson } from "@/app/lib/api-errors";
import { runtimeEnv } from "@/app/lib/runtime";
import { ackBayScanAttachJob, claimBayScanAttachJobs, DEFAULT_BAYSCAN_CLAIM_LIMIT } from "@/app/tech-board/bayscan-jobs";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

async function authorize(request: Request) {
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  return botAuth(request.headers.get("authorization"), env.TECH_BOARD_BOT_KEY);
}

export async function GET(request: Request) {
  return handleApi("bayscan-attach", async () => {
    const denied = await authorize(request);
    if (denied) return denied;
    const db = await techBoardDb();
    await initializeTechBoard(db);
    const limit = Number(new URL(request.url).searchParams.get("limit") || DEFAULT_BAYSCAN_CLAIM_LIMIT);
    return Response.json({ jobs: await claimBayScanAttachJobs(db as never, { limit }) });
  });
}

export async function POST(request: Request) {
  return handleApi("bayscan-attach", async () => {
    const denied = await authorize(request);
    if (denied) return denied;
    const body = await readJson<{ action?: string; id?: number; status?: string; error?: string; limit?: number }>(request);
    const db = await techBoardDb();
    await initializeTechBoard(db);
    const action = String(body.action || "").trim().toLowerCase();
    if (action === "claim" || !action) {
      return Response.json({ jobs: await claimBayScanAttachJobs(db as never, { limit: Number(body.limit || DEFAULT_BAYSCAN_CLAIM_LIMIT) }) });
    }
    if (action === "ack") {
      const status = String(body.status || "");
      if (status !== "done" && status !== "failed") return Response.json({ error: "Ack status must be done or failed." }, { status: 400 });
      const result = await ackBayScanAttachJob(db as never, { id: Number(body.id), status, error: String(body.error || "") });
      if (!result.ok) return Response.json({ error: "Bay Scan attach job was not found." }, { status: 404 });
      return Response.json({ ok: true, job: result.job });
    }
    return Response.json({ error: "Unsupported action" }, { status: 400 });
  });
}
