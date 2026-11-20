// v1.6.26: one Tech Board Bay Scan button. The request has no RO. The scan VIN-matches or lands in Unmatched.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { APP_VERSION } from "../app/lib/version.ts";
import { boardScanRequest, boardScanStatusText, parseScan } from "../app/tech-board/bayscan.ts";
import { postPhotoRequest, savePhotoUpload } from "../app/tech-board/bayscan-photo.ts";
import { rematchUnmatchedScans } from "../app/tech-board/bayscan-rematch.ts";
import {
  BAYSCAN_SQL, ensureBayScanJobShape, getBayScanJobByPhoto, getBayScanJobByScan, loadUnmatchedScans,
} from "../app/tech-board/bayscan-store.ts";
import { IDENTIFIX_REQUESTS_SQL } from "../app/tech-board/identifix-store.ts";
import {
  claimScanRequest, createScanRequest, loadScanRequestViews, receiveRequestedScan,
} from "../app/tech-board/bayscan-request.ts";

const src = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const VIN = "1GTR1VE05CZ123456";
const OTHER = "2HGFG3B54GH000001";
const NONE = "JH4KA8270MC999999";
const DETAIL = "https://shop.tekmetric.com/admin/shop/4326/repair-orders/366529871/estimate";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
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
const scanBody = (vin) => ({ deviceId: "mac1", vin, scannedAt: "2026-11-20T15:00:00.000Z", modules: [{ name: "ECM", addr: "7E0", codes: [{ code: "P0301", status: "confirmed" }] }] });
function bucket() {
  const memory = new Map();
  return { memory, async put(key, bytes, options) { memory.set(key, { bytes, type: options?.httpMetadata?.contentType }); } };
}
const ros = [
  { ro: "38307", customer: "Jim Smith", vehicle: "Sierra", vin: VIN, detailUrl: DETAIL, section: "work-in-progress" },
  { ro: "38308", customer: "Ann Lee", vehicle: "Civic", vin: OTHER, detailUrl: "https://shop.tekmetric.com/admin/shop/4326/repair-orders/999000/estimate", section: "work-in-progress" },
  { ro: "38309", customer: "Pat", vehicle: "No VIN yet", vin: "", section: "work-in-progress" },
];

test("a no-RO request is claimed with null ro, roId, and vin, and a second press does not start another", async () => {
  const database = await db();
  const now = "2026-11-20T15:00:00.000Z";
  const first = await createScanRequest(database, { ro: "", requestedBy: "Lobby TV" }, now);
  assert.equal(first.created, true);
  assert.equal(first.request.ro, "");
  assert.equal(first.request.roId, "");
  assert.equal(first.request.vin, "");
  assert.equal(first.request.requestedBy, "Lobby TV");
  const again = await createScanRequest(database, { requestedBy: "Tech JS" }, plus(now, 1000));
  assert.equal(again.created, false);
  assert.equal(again.request.id, first.request.id);
  const held = await createScanRequest(database, { ro: "38307", roId: "366529871", vin: VIN, customer: "Jim Smith", requestedBy: "writer" }, plus(now, 1500));
  assert.equal(held.created, true);
  const blocked = await createScanRequest(database, { ro: "" }, plus(now, 1600));
  assert.equal(blocked.created, false);
  assert.equal(blocked.request.id, first.request.id);
  const claimed = await claimScanRequest(database, plus(now, 2000));
  assert.deepEqual(claimed, { id: first.request.id, ro: null, roId: null, vin: null });
  assert.equal(await claimScanRequest(database, plus(now, 3000)), null);
});

test("a no-RO scanRequestId matches one open RO by VIN and records it on the request", async () => {
  const database = await db();
  const now = "2026-11-20T18:00:00.000Z";
  const request = await createScanRequest(database, { ro: "", requestedBy: "Lobby TV" }, now);
  await claimScanRequest(database, plus(now, 500));
  const response = await receiveRequestedScan(database, parseScan(scanBody(VIN), "mac1"), request.request.id, {
    ros, writerVins: new Map(), now: plus(now, 1000), bucket: bucket(),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["customer", "display", "matched", "matchedBy", "openRosWithoutVin", "ro", "scanId", "scanRequestId", "vehicle"]);
  assert.equal(body.matched, true);
  assert.equal(body.ro, "38307");
  assert.equal(body.customer, "Jim Smith");
  assert.equal(body.vehicle, "Sierra");
  assert.equal(body.matchedBy, "vin");
  assert.equal(body.display, "RO 38307 – Smith");
  assert.equal(body.openRosWithoutVin, 1);
  assert.equal(body.scanRequestId, request.request.id);
  assert.equal((await database.prepare(`SELECT ro, status FROM board_bayscan_scans WHERE id = ?`).bind(body.scanId).first()).status, "matched");
  assert.equal((await getBayScanJobByScan(database, body.scanId)).roNumber, "38307");
  const view = boardScanRequest(await loadScanRequestViews(database, plus(now, 1500)));
  assert.equal(view.status, "done");
  assert.equal(view.matchedRo, "38307");
  assert.equal(view.ro, "");
  assert.equal(boardScanStatusText(view), "Done — saved to RO 38307");
  const closed = await receiveRequestedScan(database, parseScan(scanBody(VIN), "mac1"), request.request.id, { ros, writerVins: new Map(), now: plus(now, 2000), bucket: bucket() });
  assert.equal(closed.status, 409);
});

test("a no-RO scan with no matching VIN is stored unmatched, and its photo follows the later match", async () => {
  const database = await db();
  const now = "2026-11-20T19:00:00.000Z";
  const memory = bucket();
  const request = await createScanRequest(database, { ro: "", requestedBy: "Lobby TV" }, now);
  const response = await receiveRequestedScan(database, parseScan(scanBody(NONE), "mac1"), request.request.id, {
    ros, writerVins: new Map(), now: plus(now, 1000), bucket: memory,
  });
  const body = await response.json();
  assert.deepEqual(body, {
    matched: false, ro: null, customer: null, vehicle: null, scanId: body.scanId,
    display: "Unmatched – pick on board", matchedBy: null, openRosWithoutVin: 1, scanRequestId: request.request.id,
  });
  const row = await database.prepare(`SELECT ro, status, match_count FROM board_bayscan_scans WHERE id = ?`).bind(body.scanId).first();
  assert.equal(row.ro, "");
  assert.equal(row.status, "unmatched");
  assert.equal(Number(row.match_count), 0);
  assert.equal(await getBayScanJobByScan(database, body.scanId), null);
  const listed = await loadUnmatchedScans(database);
  assert.equal(listed.some((item) => item.id === body.scanId && item.status === "unmatched"), true);
  const view = boardScanRequest(await loadScanRequestViews(database, plus(now, 1500)));
  assert.equal(boardScanStatusText(view), "Done — no matching RO, sent to Unmatched");
  const photo = await postPhotoRequest(database, { clientId: "after", scanId: body.scanId, requestedAt: plus(now, 1000), vin: NONE, ageSec: 0 }, "mac1", new Date(plus(now, 1200)));
  const photoBody = await photo.json();
  assert.equal(photo.status, 200);
  assert.equal(photoBody.scanId, body.scanId);
  assert.equal(photoBody.ro, "");
  const uploaded = await savePhotoUpload(database, memory, { requestId: photoBody.requestId, seq: 1, bytes: JPEG, contentType: "image/jpeg", now: new Date(plus(now, 1300)) });
  const uploadedBody = await uploaded.json();
  assert.equal(uploadedBody.attachQueued, false);
  assert.equal(uploadedBody.scanId, body.scanId);
  assert.equal(await rematchUnmatchedScans(database, [{ ro: "38311", customer: "Kim", vehicle: "Truck", vin: NONE, section: "work-in-progress" }], new Map(), plus(now, 2000), memory), 1);
  assert.equal((await loadUnmatchedScans(database)).some((item) => item.id === body.scanId), false);
  const photoJob = await getBayScanJobByPhoto(database, uploadedBody.photoId);
  assert.equal(photoJob.kind, "photo");
  assert.equal(photoJob.roNumber, "38311");
  assert.equal((await getBayScanJobByScan(database, body.scanId)).roNumber, "38311");
});

test("a no-RO scan uses last-6 when that is the only hit, and two full VIN hits stay unmatched", async () => {
  const database = await db();
  const now = "2026-11-20T20:00:00.000Z";
  const last6 = await createScanRequest(database, { ro: "" }, now);
  const drifted = await receiveRequestedScan(database, parseScan(scanBody("1GTR1VE05CX123456"), "mac1"), last6.request.id, {
    ros, writerVins: new Map(), now: plus(now, 1000), bucket: bucket(),
  });
  const driftedBody = await drifted.json();
  assert.equal(driftedBody.matched, true);
  assert.equal(driftedBody.ro, "38307");
  assert.equal(driftedBody.matchedBy, "last6");
  assert.equal(boardScanStatusText(boardScanRequest(await loadScanRequestViews(database, plus(now, 1500)))), "Done — saved to RO 38307");

  const both = await createScanRequest(database, { ro: "" }, plus(now, 2000));
  const twins = ros.map((item) => item.ro === "38308" ? { ...item, vin: VIN } : item);
  const response = await receiveRequestedScan(database, parseScan(scanBody(VIN), "mac1"), both.request.id, {
    ros: twins, writerVins: new Map(), now: plus(now, 3000), bucket: bucket(),
  });
  const body = await response.json();
  assert.equal(body.matched, false);
  assert.equal(body.ro, null);
  assert.equal(body.matchedBy, null);
  const row = await database.prepare(`SELECT status, match_count FROM board_bayscan_scans WHERE id = ?`).bind(body.scanId).first();
  assert.equal(row.status, "unmatched");
  assert.equal(Number(row.match_count), 2);
  assert.equal((await loadUnmatchedScans(database)).some((item) => item.id === body.scanId && item.matchCount === 2), true);
  assert.equal(boardScanStatusText({ status: "failed", reason: "no_dongle" }), "Failed: dongle not found");
  assert.equal(boardScanStatusText({ status: "failed", reason: "no_car_power" }), "Failed: car has no power");
  assert.equal(boardScanStatusText({ status: "failed", message: "usb empty" }), "Failed: usb empty");
  assert.equal(boardScanStatusText({ status: "pending" }), "Requested…");
  assert.equal(boardScanStatusText({ status: "scanning" }), "Scanning…");
});

test("the board and the tech PIN page each have one Bay Scan button, and Unmatched stays on the board", () => {
  const panel = src("../app/tech-board/TechBoardPanel.tsx");
  const tech = src("../app/tech-board/TechPage.tsx");
  const actions = src("../app/tech-board/actions.ts");
  const route = src("../app/api/tech/route.ts");
  assert.equal((panel.match(/data-testid="bayscan-board-button"/g) || []).length, 1);
  assert.match(panel, /action: "bayscan-scan-request" \}/);
  assert.equal(panel.includes("bayscan-card-button"), false);
  assert.equal(panel.includes("bayscan-request-button"), false);
  assert.match(panel, /id="unmatched-scans"/);
  assert.match(panel, /data-testid="unmatched-scans"/);
  assert.match(panel, /scanHot \? SCAN_REQUEST_POLL_MS : 60000/);
  assert.equal((tech.match(/data-testid="bayscan-tech-button"/g) || []).length, 1);
  assert.match(tech, /action: "bayscan-scan-request"/);
  assert.match(tech, /scanHot \? SCAN_REQUEST_POLL_MS : 60000/);
  assert.match(actions, /No extra role gate/);
  assert.match(actions, /ro: ""/);
  assert.match(route, /bayscan-scan-request/);
  assert.match(route, /ro: ""/);
  assert.match(src("../app/tech-board/bayscan-request.ts"), /if \(!request\.ro\)/);
  assert.match(src("../app/tech-board/bayscan-photo.ts"), /scanId/);
  assert.match(src("../README.md"), /Done — no matching RO, sent to Unmatched/);
  assert.match(src("../README.md"), /"ro": null/);
  assert.equal(APP_VERSION, "v1.6.26");
});
