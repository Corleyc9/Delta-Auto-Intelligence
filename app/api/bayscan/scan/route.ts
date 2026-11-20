// v1.6.18: Bay Scan scanner endpoint. Auth: Authorization: Bearer <BAYSCAN_DEVICE_KEY entry> + x-bayscan-device: <deviceId>.
// v1.6.23: optional scanRequestId attaches the scan to the RO that was clicked on the board.
// This key is accepted ONLY here, on /api/bayscan/photo-request, and on /api/bayscan/scan-request/*.
// TECH_BOARD_BOT_KEY / READER_API_KEY are not accepted here.
import { runtimeEnv } from "@/app/lib/runtime";
import { r2Bucket } from "@/app/lib/r2";
import { DEVICE_HEADER, deviceAuth, matchScanVin, parseScan, scanReply } from "@/app/tech-board/bayscan";
import { receiveRequestedScan, saveMatchedBayScan, scanRequestIdFrom } from "@/app/tech-board/bayscan-request";
import { initializeTechBoard, loadRoVins, loadSyncedRos, techBoardDb } from "@/app/tech-board/store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const deviceId = String(request.headers.get(DEVICE_HEADER) || body?.deviceId || "");
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  const denied = deviceAuth(request.headers.get("authorization"), deviceId, env.BAYSCAN_DEVICE_KEY);
  if (denied) return denied;
  if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
  const scan = parseScan(body, deviceId);
  if ("error" in scan) return Response.json({ error: scan.error }, { status: 400 });
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const now = new Date().toISOString();
  const requestId = scanRequestIdFrom(body);
  if (requestId === "invalid") return Response.json({ error: "scanRequestId is invalid" }, { status: 400 });
  if (typeof requestId === "number") {
    return receiveRequestedScan(db as never, scan, requestId, {
      ros: await loadSyncedRos(db), writerVins: await loadRoVins(db), now, bucket: r2Bucket(env),
    });
  }
  // No scanRequestId: VIN match, then unique last-6. Unchanged from v1.6.22.
  const { matches, by, unknownVin } = matchScanVin(scan.vin, await loadSyncedRos(db), await loadRoVins(db));
  const match = matches.length === 1 ? matches[0] : null;
  const id = await saveMatchedBayScan(db as never, scan, match, matches.length, now, r2Bucket(env));
  return Response.json({ ...scanReply(match, id), matchedBy: match ? by : null, openRosWithoutVin: unknownVin });
}
