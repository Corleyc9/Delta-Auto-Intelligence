import { botAuth } from "@/app/lib/bot-auth";
import { runtimeEnv } from "@/app/lib/runtime";
import { listEvents } from "@/app/tech-board/events";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

// Teams notification feed: GET ?since=<cursor> → unposted events, already formatted
// 'Customer · RO# · Job · Tech: what changed'. Same bearer auth as the bot API (TECH_BOARD_BOT_KEY). Never includes PINs.
export async function GET(request: Request) {
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = botAuth(request.headers.get("authorization"), env.TECH_BOARD_BOT_KEY);
  if (denied) return denied;
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const since = Number(new URL(request.url).searchParams.get("since") || 0) || 0;
  return Response.json(await listEvents(db as never, since, new Date().toISOString()));
}
