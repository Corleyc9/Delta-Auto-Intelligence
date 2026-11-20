// v1.6.23: the shop Mac reports scanning / failed / done for a claimed Bay Scan request.
// Same device auth as POST /api/bayscan/scan. No bot key. Never logs the device key.
import { runtimeEnv } from "@/app/lib/runtime";
import { DEVICE_HEADER, deviceAuth } from "@/app/tech-board/bayscan";
import { postScanRequestStatus } from "@/app/tech-board/bayscan-request";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const deviceId = String(request.headers.get(DEVICE_HEADER) || body?.deviceId || "");
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = deviceAuth(request.headers.get("authorization"), deviceId, env.BAYSCAN_DEVICE_KEY);
  if (denied) return denied;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const db = await techBoardDb();
  await initializeTechBoard(db);
  return postScanRequestStatus(db as never, body, new Date().toISOString());
}
