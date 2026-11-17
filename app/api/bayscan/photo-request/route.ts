// v1.6.22: the Bay Scan handheld asks for a check-in photo. It does not talk to the camera.
// Auth: Authorization: Bearer <BAYSCAN_DEVICE_KEY entry> + x-bayscan-device: <deviceId>. Same key as POST /api/bayscan/scan.
import { runtimeEnv } from "@/app/lib/runtime";
import { DEVICE_HEADER, deviceAuth } from "@/app/tech-board/bayscan";
import { getPhotoRequestView, postPhotoRequest } from "@/app/tech-board/bayscan-photo";
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
  return postPhotoRequest(db as never, body, deviceId);
}

export async function GET(request: Request) {
  const deviceId = String(request.headers.get(DEVICE_HEADER) || "");
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = deviceAuth(request.headers.get("authorization"), deviceId, env.BAYSCAN_DEVICE_KEY);
  if (denied) return denied;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "id is required" }, { status: 400 });
  const db = await techBoardDb();
  await initializeTechBoard(db);
  return getPhotoRequestView(db as never, id, deviceId);
}
