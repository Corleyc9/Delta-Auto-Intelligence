import { requireApiUser } from "@/app/chatgpt-auth";
import { boardAction, boardPayload } from "@/app/tech-board/actions";
import { initializeTechBoard, loadJobs, recomputeTechBoard, techBoardDb } from "@/app/tech-board/store";

// Tech Board API (writers). Writes only to this app's D1 tables — never to Tekmetric.

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const url = new URL(request.url);
  if ((await loadJobs(db)).length === 0) await recomputeTechBoard(db);
  return Response.json(await boardPayload(db, url.searchParams.get("date")));
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const body = await request.json().catch(() => ({})) as Record<string, unknown> & { action?: string };
  return boardAction(db, body, auth.displayName, "writer");
}
