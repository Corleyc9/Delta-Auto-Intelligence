import { handleApi, readJson } from "@/app/lib/api-errors";
import {
  ackTekmetricLabelJob,
  claimTekmetricLabelJobs,
  DEFAULT_CLAIM_LIMIT,
  resolveTekmetricVerifyLabel,
} from "@/app/lib/tekmetric-verify-label";
import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";

function readerUnauthorized(env: Record<string, any>, request: Request): Response | null {
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  return handleApi("tekmetric-label-jobs", async () => {
    const env = await runtimeEnv();
    const denied = readerUnauthorized(env, request);
    if (denied) return denied;
    await ensureSchema(env.DB);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || DEFAULT_CLAIM_LIMIT);
    const jobs = await claimTekmetricLabelJobs(env.DB, { limit });
    return Response.json({
      jobs,
      targetLabel: resolveTekmetricVerifyLabel(env),
    });
  });
}

export async function POST(request: Request) {
  return handleApi("tekmetric-label-jobs", async () => {
    const env = await runtimeEnv();
    const denied = readerUnauthorized(env, request);
    if (denied) return denied;
    await ensureSchema(env.DB);
    const body = await readJson<{
      action?: string;
      id?: number;
      status?: string;
      error?: string;
      limit?: number;
    }>(request);
    const action = String(body.action || "").trim().toLowerCase();
    if (action === "claim" || !action) {
      const jobs = await claimTekmetricLabelJobs(env.DB, {
        limit: Number(body.limit || DEFAULT_CLAIM_LIMIT),
      });
      return Response.json({
        jobs,
        targetLabel: resolveTekmetricVerifyLabel(env),
      });
    }
    if (action === "ack") {
      const status = String(body.status || "");
      if (status !== "done" && status !== "failed" && status !== "retry") {
        return Response.json({ error: "Ack status must be done, failed, or retry." }, { status: 400 });
      }
      const result = await ackTekmetricLabelJob(env.DB, {
        id: Number(body.id),
        status,
        error: String(body.error || ""),
      });
      if (!result.ok) return Response.json({ error: "Label job was not found." }, { status: 404 });
      return Response.json({ ok: true, job: result.job });
    }
    return Response.json({ error: "Unsupported action" }, { status: 400 });
  });
}
