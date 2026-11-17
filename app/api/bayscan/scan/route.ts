// v1.6.18: Bay Scan scanner endpoint. Auth: Authorization: Bearer <BAYSCAN_DEVICE_KEY entry> + x-bayscan-device: <deviceId>.
// This key is accepted ONLY here (no other route reads BAYSCAN_DEVICE_KEY); TECH_BOARD_BOT_KEY / READER_API_KEY are not accepted here.
import { runtimeEnv } from "@/app/lib/runtime";
import { DEVICE_HEADER, deviceAuth, matchScanVin, parseScan, scanReply } from "@/app/tech-board/bayscan";
import { attachScan } from "@/app/tech-board/bayscan-attach";
import { initializeTechBoard, loadRoVins, loadSyncedRos, saveScan, techBoardDb } from "@/app/tech-board/store";

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
  // Synced VIN (reader 2.1.3+) first, writer VIN override wins; last-6 fallback only if no full-VIN match.
  const { matches, by, unknownVin } = matchScanVin(scan.vin, await loadSyncedRos(db), await loadRoVins(db));
  const match = matches.length === 1 ? matches[0] : null;
  const id = await saveScan(db as never, scan, match?.ro ?? "", matches.length, now);
  if (match) await attachScan(db, scan, match, `Bay Scan ${scan.deviceId}`, now);
  return Response.json({ ...scanReply(match, id), matchedBy: match ? by : null, openRosWithoutVin: unknownVin });
}
