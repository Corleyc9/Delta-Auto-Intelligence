// v1.6.23: the shop Mac claims the oldest Bay Scan request. Same device auth as POST /api/bayscan/scan.
// No bot key. Never logs the device key. Does not create an RO.
import { runtimeEnv } from "@/app/lib/runtime";
import { DEVICE_HEADER, deviceAuth } from "@/app/tech-board/bayscan";
import { claimScanRequest } from "@/app/tech-board/bayscan-request";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const deviceId = String(request.headers.get(DEVICE_HEADER) || body?.deviceId || "");
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = deviceAuth(request.headers.get("authorization"), deviceId, env.BAYSCAN_DEVICE_KEY);
  if (denied) return denied;
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const claimed = await claimScanRequest(db as never, new Date().toISOString());
  return Response.json({ request: claimed });
}
