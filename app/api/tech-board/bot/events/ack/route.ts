import { botAuth } from "@/app/lib/bot-auth";
import { runtimeEnv } from "@/app/lib/runtime";
import { ackEvents } from "@/app/tech-board/events";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

// POST { ids: [eventId, ...] } → marks those events posted to Teams so the feed won't return them again.
export async function POST(request: Request) {
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = botAuth(request.headers.get("authorization"), env.TECH_BOARD_BOT_KEY);
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as { ids?: unknown };
  if (!Array.isArray(body.ids)) return Response.json({ error: "Send { ids: [...] }" }, { status: 400 });
  const db = await techBoardDb();
  await initializeTechBoard(db);
  return Response.json({ ok: true, acked: await ackEvents(db as never, body.ids as number[], new Date().toISOString()) });
}
