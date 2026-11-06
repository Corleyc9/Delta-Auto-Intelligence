import { botAuth } from "@/app/lib/bot-auth";
import { runtimeEnv } from "@/app/lib/runtime";
import { logDelivery, notifyStatus, postCard, teamsCard } from "@/app/tech-board/events";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

// Teams posting diagnostics (bot key). GET → { secretSet, lastSuccess, recentFailures[{status, error}] }.
// POST { test: true } → sends one test card to TEAMS_SCHEDULE_WEBHOOK_URL and returns the HTTP status + error body.
// The webhook URL is never returned.
async function setup(request: Request) {
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = botAuth(request.headers.get("authorization"), env.TECH_BOARD_BOT_KEY);
  const db = denied ? null : await techBoardDb();
  if (db) await initializeTechBoard(db);
  return { denied, db, url: String(env.TEAMS_SCHEDULE_WEBHOOK_URL || "").trim() };
}

export async function GET(request: Request) {
  const { denied, db, url } = await setup(request);
  if (denied) return denied;
  return Response.json({ ...(await notifyStatus(db as never, Boolean(url))), urlLooksLikeWorkflow: /^https:\/\/[^/]+\.(logic\.azure\.com|powerplatform\.com|environment\.api\.powerplatform\.com)/i.test(url) });
}

export async function POST(request: Request) {
  const { denied, db, url } = await setup(request);
  if (denied) return denied;
  if (!url) return Response.json({ ok: false, secretSet: false, error: "TEAMS_SCHEDULE_WEBHOOK_URL is not set" });
  const result = await postCard(url, teamsCard("update", "Test from Delta Intelligence Tech Board — please ignore"), fetch);
  await logDelivery(db as never, null, result, new Date().toISOString());
  return Response.json({ ...result, secretSet: true });
}
