// v1.6.23: Tech Board Bay Scan button → Mac listener claim/status → scanRequestId on POST /api/bayscan/scan.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { APP_VERSION } from "../app/lib/version.ts";
import { SCAN_REQUEST_POLL_MS, deviceAuth, parseScan, scanReply, scanRequestStatusText, matchScanVin } from "../app/tech-board/bayscan.ts";
import { BAYSCAN_SQL, ensureBayScanJobShape, getBayScanJobByScan, loadRoVins, saveScan, setRoVin } from "../app/tech-board/bayscan-store.ts";
import { IDENTIFIX_REQUESTS_SQL } from "../app/tech-board/identifix-store.ts";
import { loadCheckins } from "../app/tech-board/checkin-store.ts";
import { postPhotoRequest } from "../app/tech-board/bayscan-photo.ts";
import {
  SCAN_REQUEST_CLAIM_MS, SCAN_REQUEST_PENDING_MS, claimScanRequest, createScanRequest, getScanRequest,
  loadScanRequestViews, postScanRequestStatus, receiveRequestedScan, saveMatchedBayScan, scanRequestIdFrom, scanRequestTarget,
} from "../app/tech-board/bayscan-request.ts";

const src = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const VIN = "1GTR1VE05CZ123456";
const OTHER = "2HGFG3B54GH000001";
const FRESH = "3FAHP0HA6AR000111";
const DETAIL = "https://shop.tekmetric.com/admin/shop/4326/repair-orders/366529871/estimate";
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({ bind: (...v) => stmt(sql, v), run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  return { prepare: (sql) => stmt(sql), sqlite };
}
async function db() {
  const database = d1();
  for (const sql of [...BAYSCAN_SQL, IDENTIFIX_REQUESTS_SQL, `CREATE TABLE IF NOT EXISTS board_checkin (ro TEXT PRIMARY KEY, codes_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`]) await database.prepare(sql).run();
  await ensureBayScanJobShape(database);
  return database;
}
const scanBody = (vin = VIN) => ({ deviceId: "mac1", vin, scannedAt: "2026-11-20T15:00:00.000Z", modules: [{ name: "ECM", addr: "7E0", codes: [{ code: "P0301", status: "confirmed" }] }] });
function bucket() {
  const memory = new Map();
  return { memory, async put(key, bytes, options) { memory.set(key, { bytes, type: options?.httpMetadata?.contentType }); } };
}
const ros = [
  { ro: "38307", customer: "Jim Smith", vehicle: "Sierra", vin: VIN, detailUrl: DETAIL, section: "work-in-progress" },
  { ro: "38308", customer: "Ann Lee", vehicle: "Civic", vin: OTHER, detailUrl: "https://shop.tekmetric.com/admin/shop/4326/repair-orders/999000/estimate", section: "work-in-progress" },
  { ro: "38309", customer: "Pat", vehicle: "No VIN yet", vin: "", section: "work-in-progress" },
];
const ask = (database, ro, now, extra = {}) => createScanRequest(database, {
  ro, roId: extra.roId ?? "", vin: extra.vin ?? "", customer: extra.customer ?? "Jim Smith", vehicle: extra.vehicle ?? "Sierra",
  detailUrl: extra.detailUrl ?? DETAIL, requestedBy: extra.requestedBy ?? "Lobby TV",
}, now);

test("a second press returns the active request, and a finished one can be asked again", async () => {
  const database = await db();
  const now = "2026-11-20T15:00:00.000Z";
  const first = await ask(database, "38307", now, { roId: "366529871", vin: VIN });
  assert.equal(first.created, true);
  assert.equal(first.request.status, "pending");
  assert.equal(first.request.requestedBy, "Lobby TV");
  assert.equal(first.request.roId, "366529871");
  const again = await ask(database, "RO#38307", plus(now, 1000), { vin: OTHER });
  assert.equal(again.created, false);
  assert.equal(again.request.id, first.request.id);
  assert.equal(again.request.vin, VIN);
  await database.prepare(`INSERT INTO bayscan_scan_requests (ro, ro_id, vin, customer, vehicle, detail_url, requested_by, created_at, updated_at, status) VALUES ('38307', '', '', '', '', '', '', ?, ?, 'pending')`)
    .bind(plus(now, 2000), plus(now, 2000)).run().then(() => assert.fail("two active requests for one RO"), () => undefined);
  const claimed = await claimScanRequest(database, plus(now, 3000));
  assert.deepEqual(claimed, { id: first.request.id, ro: "38307", roId: "366529871", vin: VIN });
  await postScanRequestStatus(database, { id: first.request.id, status: "failed", reason: "no_dongle" }, plus(now, 4000));
  const next = await ask(database, "38307", plus(now, 5000));
  assert.equal(next.created, true);
  assert.notEqual(next.request.id, first.request.id);
  const target = scanRequestTarget("38307", ros, [], "");
  assert.equal(target.roId, "366529871");
  assert.equal(target.vin, VIN);
  const writer = scanRequestTarget("38307", ros, [], OTHER);
  assert.equal(writer.vin, OTHER);
  const fromJob = scanRequestTarget("38310", [], [{ ro: "38310-J9", roNumber: "38310", customer: "Ada", vehicle: "Bolt", detailUrl: DETAIL }], "");
  assert.equal(fromJob.ro, "38310");
  assert.equal(fromJob.customer, "Ada");
  assert.deepEqual(scanRequestTarget("99999", ros, []), { error: "RO#99999 isn't on the board", status: 404 });
  assert.equal(scanRequestTarget("", [], []).status, 400);
});

test("claim hands out the oldest pending request and never a second while one is open", async () => {
  const database = await db();
  const t0 = "2026-11-20T16:00:00.000Z";
  const older = await ask(database, "38307", t0, { roId: "366529871", vin: VIN });
  const newer = await ask(database, "38308", plus(t0, 1000), { roId: "999000", vin: OTHER, customer: "Ann Lee" });
  const first = await claimScanRequest(database, plus(t0, 2000));
  assert.deepEqual(first, { id: older.request.id, ro: "38307", roId: "366529871", vin: VIN });
  assert.equal(await claimScanRequest(database, plus(t0, 3000)), null);
  const scanning = await postScanRequestStatus(database, { id: older.request.id, status: "scanning" }, plus(t0, 4000));
  assert.deepEqual(await scanning.json(), { ok: true });
  assert.equal((await getScanRequest(database, older.request.id)).status, "scanning");
  assert.equal(await claimScanRequest(database, plus(t0, 5000)), null);
  const failed = await postScanRequestStatus(database, { id: older.request.id, status: "failed", reason: "No Dongle", message: "usb empty" }, plus(t0, 6000));
  assert.deepEqual(await failed.json(), { ok: true });
  assert.equal((await getScanRequest(database, older.request.id)).reason, "no_dongle");
  const second = await claimScanRequest(database, plus(t0, 7000));
  assert.deepEqual(second, { id: newer.request.id, ro: "38308", roId: "999000", vin: OTHER });
  const done = await postScanRequestStatus(database, { id: newer.request.id, status: "done" }, plus(t0, 8000));
  assert.deepEqual(await done.json(), { ok: true });
  assert.equal(await claimScanRequest(database, plus(t0, 9000)), null);
  const missing = await postScanRequestStatus(database, { id: 999, status: "done" }, t0);
  assert.equal(missing.status, 404);
  const bad = await postScanRequestStatus(database, { id: newer.request.id, status: "claimed" }, t0);
  assert.equal(bad.status, 400);
  const noId = await postScanRequestStatus(database, { status: "done" }, t0);
  assert.equal(noId.status, 400);
  assert.deepEqual(await (await postScanRequestStatus(database, { id: newer.request.id, status: "failed", reason: "upload_failed" }, t0)).json(), { ok: true });
  assert.equal((await getScanRequest(database, newer.request.id)).status, "done");
  const views = await loadScanRequestViews(database, plus(t0, 9000));
  const failedView = views.find((item) => item.ro === "38307");
  assert.equal(scanRequestStatusText(failedView), "Dongle not found");
  assert.equal(scanRequestStatusText({ status: "pending" }), "Waiting for the Mac");
  assert.equal(scanRequestStatusText({ status: "claimed" }), "Scanning");
  assert.equal(scanRequestStatusText({ status: "done", codeCount: 1 }), "Done · 1 code");
  assert.equal(scanRequestStatusText({ status: "done", codeCount: 0 }), "Done · no codes");
  assert.equal(scanRequestStatusText({ status: "failed", reason: "no_car_power" }), "Failed: car has no power");
  assert.equal(scanRequestStatusText({ status: "failed", reason: "no_ecu" }), "Failed: no computer found");
  assert.equal(scanRequestStatusText({ status: "expired" }), "Expired");
});

test("pending expires after 5 minutes and a claim expires after 10, lazily", async () => {
  const database = await db();
  const t0 = "2026-11-20T17:00:00.000Z";
  const pending = await ask(database, "38307", t0);
  const atFive = await loadScanRequestViews(database, plus(t0, SCAN_REQUEST_PENDING_MS));
  assert.equal(atFive.find((item) => item.id === pending.request.id).status, "pending");
  const expired = await loadScanRequestViews(database, plus(t0, SCAN_REQUEST_PENDING_MS + 1));
  assert.equal(expired.find((item) => item.id === pending.request.id).status, "expired");
  assert.equal(await claimScanRequest(database, plus(t0, SCAN_REQUEST_PENDING_MS + 1)), null);
  const quiet = await postScanRequestStatus(database, { id: pending.request.id, status: "scanning" }, plus(t0, SCAN_REQUEST_PENDING_MS + 2));
  assert.deepEqual(await quiet.json(), { ok: true });
  assert.equal((await getScanRequest(database, pending.request.id)).status, "expired");
  const untouched = await ask(database, "38308", plus(t0, SCAN_REQUEST_PENDING_MS + 4), { vin: OTHER });
  const revived = await postScanRequestStatus(database, { id: untouched.request.id, status: "scanning" }, plus(t0, SCAN_REQUEST_PENDING_MS + 4 + SCAN_REQUEST_PENDING_MS + 1));
  assert.deepEqual(await revived.json(), { ok: true });
  assert.equal((await getScanRequest(database, untouched.request.id)).status, "expired");
  const late = await postScanRequestStatus(database, { id: pending.request.id, status: "failed", reason: "upload_failed" }, plus(t0, SCAN_REQUEST_PENDING_MS + 3));
  assert.equal((await late.json()).ok, true);
  assert.equal((await getScanRequest(database, pending.request.id)).status, "failed");

  const held = await ask(database, "38307", plus(t0, 20 * 60 * 1000));
  const claimAt = plus(t0, 20 * 60 * 1000 + 1000);
  assert.equal((await claimScanRequest(database, claimAt)).id, held.request.id);
  const waiting = await ask(database, "38308", plus(claimAt, 6 * 60 * 1000), { vin: OTHER });
  assert.equal(await claimScanRequest(database, plus(claimAt, SCAN_REQUEST_CLAIM_MS)), null);
  assert.equal((await getScanRequest(database, held.request.id)).status, "claimed");
  const freed = await claimScanRequest(database, plus(claimAt, SCAN_REQUEST_CLAIM_MS + 1));
  assert.deepEqual(freed, { id: waiting.request.id, ro: "38308", roId: null, vin: OTHER });
  assert.equal((await getScanRequest(database, held.request.id)).status, "expired");
  const replacement = await ask(database, "38307", plus(claimAt, SCAN_REQUEST_CLAIM_MS + 2));
  assert.equal(replacement.created, true);
  assert.notEqual(replacement.request.id, held.request.id);
});

test("scanRequestId attaches to the clicked RO, flags a VIN mismatch, and the photo follows", async () => {
  const database = await db();
  const now = "2026-11-20T18:00:00.000Z";
  await setRoVin(database, "38307", VIN, "writer", now);
  await saveScan(database, parseScan({ ...scanBody(OTHER), deviceId: "mac1" }), "38308", 1, plus(now, -10 * 60 * 1000));
  const request = await ask(database, "38307", now, { roId: "366529871", vin: VIN, customer: "Jim Smith", vehicle: "Sierra" });
  await claimScanRequest(database, plus(now, 1000));
  const scan = parseScan(scanBody(OTHER), "mac1");
  const response = await receiveRequestedScan(database, scan, request.request.id, { ros, writerVins: await loadRoVins(database), now: plus(now, 2000), bucket: bucket() });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.matched, true);
  assert.equal(body.ro, "38307");
  assert.equal(body.customer, "Jim Smith");
  assert.equal(body.matchedBy, "request");
  assert.equal(body.vinMismatch, true);
  assert.equal(body.scanRequestId, request.request.id);
  assert.equal(body.openRosWithoutVin, 1);
  const saved = await database.prepare(`SELECT ro, status, vin_mismatch, vin_mismatch_ro, scan_json FROM board_bayscan_scans WHERE id = ?`).bind(body.scanId).first();
  assert.equal(saved.ro, "38307");
  assert.equal(saved.status, "matched");
  assert.equal(Number(saved.vin_mismatch), 1);
  assert.equal(saved.vin_mismatch_ro, "38308");
  assert.equal(JSON.parse(saved.scan_json).vinMismatch, true);
  const notes = (await loadCheckins(database)).find((item) => item.ro === "38307");
  assert.match(notes.notes, /Bay Scan dongle/);
  assert.match(notes.notes, /RO#38308/);
  assert.equal((await loadCheckins(database)).some((item) => item.ro === "38308"), false);
  assert.equal((await loadRoVins(database)).get("38307"), VIN);
  const job = await getBayScanJobByScan(database, body.scanId);
  assert.equal(job.roNumber, "38307");
  assert.equal(job.customer, "Jim Smith");
  assert.equal(job.kind, "report");
  assert.equal((await getScanRequest(database, request.request.id)).status, "done");
  assert.equal((await getScanRequest(database, request.request.id)).vinMismatch, true);
  const photo = await postPhotoRequest(database, { clientId: "after-scan", requestedAt: plus(now, 2000), vin: OTHER, ageSec: 0 }, "mac1", new Date(plus(now, 2500)));
  const photoBody = await photo.json();
  assert.equal(photo.status, 200);
  assert.equal(photoBody.ro, "38307");
  assert.equal(photoBody.scanId, body.scanId);
  const view = (await loadScanRequestViews(database, plus(now, 3000))).find((item) => item.ro === "38307");
  assert.equal(scanRequestStatusText(view), "Done · 1 code · VIN does not match this RO");
  const closed = await receiveRequestedScan(database, scan, request.request.id, { ros, writerVins: new Map(), now: plus(now, 4000), bucket: bucket() });
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).error, "Scan request is not open");
});

test("a scanRequestId whose VIN matches no other open RO stays on the clicked RO", async () => {
  const database = await db();
  const now = "2026-11-20T18:30:00.000Z";
  const memory = bucket();
  const request = await ask(database, "38307", now, { customer: "Jim Smith", vehicle: "Sierra" });
  const response = await receiveRequestedScan(database, parseScan(scanBody(FRESH), "mac1"), request.request.id, {
    ros: ros.map((item) => ({ ...item, vin: "" })), writerVins: new Map(), now: plus(now, 1000), bucket: memory,
  });
  const body = await response.json();
  assert.equal(body.vinMismatch, false);
  assert.equal(body.ro, "38307");
  assert.equal(body.matchedBy, "request");
  assert.equal((await loadRoVins(database)).get("38307"), FRESH);
  assert.equal((await database.prepare(`SELECT vin_mismatch FROM board_bayscan_scans WHERE id = ?`).bind(body.scanId).first()).vin_mismatch, 0);
  assert.doesNotMatch((await loadCheckins(database)).find((item) => item.ro === "38307").notes, /does not match/);
  const photo = await postPhotoRequest(database, { clientId: "fresh", requestedAt: plus(now, 1000), vin: FRESH, ageSec: 0 }, "mac1", new Date(plus(now, 1500)));
  const photoBody = await photo.json();
  assert.equal(photoBody.ro, "38307");
  assert.equal(photoBody.scanId, body.scanId);
});

test("without scanRequestId the VIN match is unchanged and does not consume a request", async () => {
  const database = await db();
  const now = "2026-11-20T19:00:00.000Z";
  const memory = bucket();
  const pending = await ask(database, "38307", now, { vin: VIN });
  const scan = parseScan(scanBody(VIN), "mac1");
  const { matches, by, unknownVin } = matchScanVin(scan.vin, ros, new Map());
  const match = matches.length === 1 ? matches[0] : null;
  const id = await saveMatchedBayScan(database, scan, match, matches.length, now, memory);
  const reply = { ...scanReply(match, id), matchedBy: match ? by : null, openRosWithoutVin: unknownVin };
  assert.equal(reply.matched, true);
  assert.equal(reply.ro, "38307");
  assert.equal(reply.customer, "Jim Smith");
  assert.equal(reply.matchedBy, "vin");
  assert.equal(reply.openRosWithoutVin, 1);
  assert.equal("vinMismatch" in reply, false);
  assert.equal("scanRequestId" in reply, false);
  assert.deepEqual(Object.keys(reply).sort(), ["customer", "display", "matched", "matchedBy", "openRosWithoutVin", "ro", "scanId", "vehicle"]);
  assert.equal((await getBayScanJobByScan(database, id)).roNumber, "38307");
  assert.equal((await getScanRequest(database, pending.request.id)).status, "pending");
  const other = parseScan(scanBody(OTHER), "mac1");
  const otherMatch = matchScanVin(other.vin, ros, new Map());
  const otherId = await saveMatchedBayScan(database, other, otherMatch.matches[0], otherMatch.matches.length, plus(now, 1000), memory);
  assert.equal((await database.prepare(`SELECT ro FROM board_bayscan_scans WHERE id = ?`).bind(otherId).first()).ro, "38308");
  assert.equal((await getScanRequest(database, pending.request.id)).status, "pending");
  const none = parseScan(scanBody("JH4KA8270MC999999"), "mac1");
  const unmatched = matchScanVin(none.vin, ros, new Map());
  assert.equal(unmatched.matches.length, 0);
  const looseId = await saveMatchedBayScan(database, none, null, 0, plus(now, 2000), memory);
  const loose = await database.prepare(`SELECT ro, status FROM board_bayscan_scans WHERE id = ?`).bind(looseId).first();
  assert.equal(loose.ro, "");
  assert.equal(loose.status, "unmatched");
  assert.equal(await getBayScanJobByScan(database, looseId), null);
  const drifted = matchScanVin("1GTR1VE05CX123456", ros, new Map());
  assert.equal(drifted.by, "last6");
  assert.deepEqual(drifted.matches.map((item) => item.ro), ["38307"]);
  assert.equal(scanRequestIdFrom({}), null);
  assert.equal(scanRequestIdFrom({ scanRequestId: "" }), null);
  assert.equal(scanRequestIdFrom({ scanRequestId: 12 }), 12);
  assert.equal(scanRequestIdFrom({ scanRequestId: "12" }), 12);
  assert.equal(scanRequestIdFrom({ scanRequestId: 0 }), "invalid");
  assert.equal(scanRequestIdFrom({ scanRequestId: "nope" }), "invalid");
  const missing = await receiveRequestedScan(database, parseScan(scanBody(), "mac1"), 4242, { ros, writerVins: new Map(), now, bucket: memory });
  assert.equal(missing.status, 404);
});

test("device routes reject a bad key and do not take the bot key", async () => {
  const denied = deviceAuth("Bearer wrong", "mac1", "device-secret");
  assert.equal(denied.status, 401);
  const body = await denied.json();
  assert.equal(body.error, "Invalid device key");
  assert.equal(JSON.stringify(body).includes("device-secret"), false);
  assert.equal(deviceAuth("Bearer device-secret", "mac1", "").status, 503);
  assert.equal(deviceAuth("Bearer device-secret", "mac1", "device-secret"), null);
  for (const path of ["../app/api/bayscan/scan-request/claim/route.ts", "../app/api/bayscan/scan-request/status/route.ts", "../app/api/bayscan/scan/route.ts"]) {
    const file = src(path);
    assert.ok(file.includes("deviceAuth("), path);
    assert.equal(file.includes("botAuth"), false, path);
    assert.equal(file.includes("ViaBecs"), false, path);
  }
  assert.equal(src("../app/api/bayscan/scan-request/claim/route.ts").includes("TECH_BOARD_BOT_KEY"), false);
  assert.equal(src("../app/api/bayscan/scan-request/status/route.ts").includes("TECH_BOARD_BOT_KEY"), false);
  const scan = src("../app/api/bayscan/scan/route.ts");
  assert.ok(scan.indexOf("deviceAuth(") < scan.indexOf("parseScan("));
  assert.ok(scan.indexOf("parseScan(") < scan.indexOf("scanRequestIdFrom("));
  assert.match(scan, /return Response\.json\(\{ \.\.\.scanReply\(match, id\)/);
  assert.match(scan, /scanRequestId is invalid/);
  const claim = src("../app/api/bayscan/scan-request/claim/route.ts");
  assert.ok(claim.indexOf("deviceAuth(") < claim.indexOf("claimScanRequest("));
  const status = src("../app/api/bayscan/scan-request/status/route.ts");
  assert.ok(status.indexOf("deviceAuth(") < status.indexOf("postScanRequestStatus("));
  const drawer = src("../app/tech-board/DtcBox.tsx");
  assert.match(drawer, />Bay Scan</);
  assert.match(drawer, /Bay Scan dongle/);
  assert.match(drawer, /bayscan-scan-request/);
  assert.equal(drawer.includes("ViaBecs"), false);
  const panel = src("../app/tech-board/TechBoardPanel.tsx");
  assert.match(panel, /SCAN_REQUEST_POLL_MS/);
  assert.match(panel, /60000/);
  assert.equal(SCAN_REQUEST_POLL_MS, 4000);
  assert.match(src("../app/tech-board/actions.ts"), /bayscan-scan-request/);
  assert.match(src("../app/tech-board/actions.ts"), /No extra role gate/);
  assert.match(src("../README.md"), /POST \/api\/bayscan\/scan-request\/claim/);
  assert.match(src("../README.md"), /scanRequestId/);
  assert.match(src("../README.md"), /Bay Scan dongle/);
  assert.equal(APP_VERSION, "v1.6.23");
});
