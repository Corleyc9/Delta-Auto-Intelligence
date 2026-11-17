// v1.6.22: the shop Mac uploads one check-in JPEG. Auth is the Tech Board bot key (Bearer).
// Raw image/jpeg body. Stored in R2 and, once the scan has an RO, queued on the existing attach queue.
import { botAuth } from "@/app/lib/bot-auth";
import { runtimeEnv } from "@/app/lib/runtime";
import { r2Bucket } from "@/app/lib/r2";
import { PHOTO_MAX_BYTES, savePhotoUpload } from "@/app/tech-board/bayscan-photo";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

export async function POST(request: Request) {
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = botAuth(request.headers.get("authorization"), env.TECH_BOARD_BOT_KEY);
  if (denied) return denied;
  const url = new URL(request.url);
  const requestRaw = url.searchParams.get("requestId");
  const seqRaw = url.searchParams.get("seq");
  if (!requestRaw || !seqRaw || !/^\d+$/.test(requestRaw) || !/^\d+$/.test(seqRaw)) return Response.json({ error: "requestId and seq are required" }, { status: 400 });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PHOTO_MAX_BYTES) return Response.json({ error: "Photo is too large" }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  const db = await techBoardDb();
  await initializeTechBoard(db);
  return savePhotoUpload(db as never, r2Bucket(env), {
    requestId: Number(url.searchParams.get("requestId")),
    seq: Number(url.searchParams.get("seq")),
    bytes,
    contentType: request.headers.get("content-type") || "",
  });
}
