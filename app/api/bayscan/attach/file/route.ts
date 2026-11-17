// v1.6.21: download the report file for a claimed Bay Scan attach job. Same bot-key auth as the claim endpoint.
import { botAuth } from "@/app/lib/bot-auth";
import { r2Bucket } from "@/app/lib/r2";
import { runtimeEnv } from "@/app/lib/runtime";
import { readBayScanFile } from "@/app/tech-board/bayscan-jobs";
import { initializeTechBoard, techBoardDb } from "@/app/tech-board/store";

export async function GET(request: Request) {
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = botAuth(request.headers.get("authorization"), env.TECH_BOARD_BOT_KEY);
  if (denied) return denied;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "id is required" }, { status: 400 });
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const file = await readBayScanFile(db as never, id, r2Bucket(env));
  if (!file) return Response.json({ error: "Bay Scan attach job was not found." }, { status: 404 });
  const filename = file.filename.replace(/[\r\n"]/g, "");
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
