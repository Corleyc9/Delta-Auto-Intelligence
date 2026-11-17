// v1.6.22: the shop Mac claims check-in photo requests. Auth is the Tech Board bot key (Bearer).
// The Mac grabs a bay-camera JPEG and uploads it. This route does not create an RO.
import { botAuth } from "@/app/lib/bot-auth";
import { handleApi, readJson } from "@/app/lib/api-errors";
import { runtimeEnv } from "@/app/lib/runtime";
import { postPhotoBot } from "@/app/tech-board/bayscan-photo";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

async function authorize(request: Request) {
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  return botAuth(request.headers.get("authorization"), env.TECH_BOARD_BOT_KEY);
}

export async function POST(request: Request) {
  return handleApi("bayscan-photo", async () => {
    const denied = await authorize(request);
    if (denied) return denied;
    const body = await readJson<{ action?: string; limit?: number; id?: number; error?: string }>(request);
    const db = await techBoardDb();
    await initializeTechBoard(db);
    return postPhotoBot(db as never, body);
  });
}
