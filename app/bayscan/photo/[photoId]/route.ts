// v1.6.22: full check-in photo. Same dashboard login as /bayscan/report. Not public.
import { getDashboardUser } from "@/app/chatgpt-auth";
import { r2Bucket } from "@/app/lib/r2";
import { runtimeEnv } from "@/app/lib/runtime";
import { readBucketBytes } from "@/app/tech-board/bayscan-jobs";
import { getPhoto } from "@/app/tech-board/bayscan-store";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

const PRIVATE = { "cache-control": "private" };

export async function GET(_request: Request, context: { params: Promise<{ photoId: string }> }) {
  const user = await getDashboardUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401, headers: PRIVATE });
  const { photoId } = await context.params;
  const id = Number(photoId);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Photo was not found" }, { status: 404, headers: PRIVATE });
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const photo = await getPhoto(db as never, id);
  if (!photo) return Response.json({ error: "Photo was not found" }, { status: 404, headers: PRIVATE });
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const file = await readBucketBytes(r2Bucket(env), photo.fileKey);
  if (!file) return Response.json({ error: "Photo was not found" }, { status: 404, headers: PRIVATE });
  return new Response(file.bytes as unknown as BodyInit, { headers: { "content-type": "image/jpeg", "cache-control": "private" } });
}
