// v1.6.22: Bay Scan check-in photos. The Pi requests, the Mac claims and uploads, the reader attaches.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { deviceAuth } from "../app/tech-board/bayscan.ts";
import { botAuth } from "../app/lib/bot-auth.ts";
import { techPathAllowed } from "../app/lib/tech-session.ts";
import { photoFilename } from "../app/tech-board/bayscan-report.ts";
import { BAYSCAN_SQL, ensureBayScanJobShape, getBayScanJobByPhoto, getBayScanJobByScan, getPhoto, getScan, insertBayScanJob, insertBayScanPhotoJob, photosMissingJobs, saveScan, scansMissingJobs } from "../app/tech-board/bayscan-store.ts";
import { ackBayScanAttachJob, bayScanFileResponse, claimBayScanAttachJobs, publishBayScanAttachment, readBayScanFile } from "../app/tech-board/bayscan-jobs.ts";
import { backfillAttachJobs, backfillPhotoJobs, rematchUnmatchedScans } from "../app/tech-board/bayscan-rematch.ts";
import { BAYSCAN_PHOTO_SHOTS, PHOTO_MAX_BYTES, PHOTO_MISS_ERROR, getPhotoRequestView, postPhotoBot, postPhotoRequest, savePhotoUpload } from "../app/tech-board/bayscan-photo.ts";
import { parseScan } from "../app/tech-board/bayscan.ts";
import { IDENTIFIX_REQUESTS_SQL } from "../app/tech-board/identifix-store.ts";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const VIN = "1GTR1VE05CZ123456";
const OTHER = "2HGFG3B54GH000001";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
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
const scanBody = (vin = VIN) => ({ deviceId: "bay1", vin, scannedAt: "2026-11-17T14:50:00.000Z", modules: [{ name: "ECM", addr: "7E0", codes: [{ code: "P0301", status: "confirmed" }] }] });
function bucket() {
  const memory = new Map();
  return { memory, async put(key, bytes, options) { memory.set(key, { bytes, type: options?.httpMetadata?.contentType }); }, async get(key) {
    if (!memory.has(key)) return null;
    const item = memory.get(key);
    return { arrayBuffer: async () => item.bytes, httpMetadata: { contentType: item.type } };
  } };
}
const at = (iso) => new Date(iso);
async function request(database, extra = {}, deviceId = "bay1", now = at("2026-11-17T15:00:00.000Z")) {
  const response = await postPhotoRequest(database, { deviceId, clientId: "press-1", requestedAt: now.toISOString(), vin: "", ageSec: 0, ...extra }, deviceId, now);
  return { response, body: await response.json() };
}

test("photo requests: no scan, too old, idempotent client id, VIN preference, and device mismatch", async () => {
  const database = await db();
  const now = at("2026-11-17T15:00:00.000Z");
  const missing = await request(database, { clientId: "none" }, "bay1", now);
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.code, "no_scan");
  assert.equal(missing.body.error, "No recent scan from this device");
  const older = await saveScan(database, parseScan(scanBody(VIN)), "", 0, "2026-11-17T14:40:00.000Z");
  const newer = await saveScan(database, parseScan(scanBody(OTHER)), "", 0, "2026-11-17T14:55:00.000Z");
  const stale = await request(database, { clientId: "old", ageSec: 601 }, "bay1", now);
  assert.equal(stale.response.status, 410);
  assert.deepEqual(stale.body, { error: "Photo request is too old", code: "expired" });
  const preferred = await request(database, { clientId: "vin", vin: VIN, ageSec: 0 }, "bay1", now);
  assert.equal(preferred.response.status, 200);
  assert.equal(preferred.body.ok, true);
  assert.equal(preferred.body.scanId, older);
  assert.equal(preferred.body.ro, "");
  assert.equal(preferred.body.status, "pending");
  const again = await request(database, { clientId: "vin", vin: OTHER, ageSec: 9999 }, "bay1", now);
  assert.equal(again.response.status, 200);
  assert.equal(again.body.requestId, preferred.body.requestId);
  assert.equal(again.body.scanId, older);
  const newest = await request(database, { clientId: "any", vin: "" }, "bay1", now);
  assert.equal(newest.body.scanId, newer);
  const outside = await postPhotoRequest(database, { deviceId: "bay1", clientId: "late", requestedAt: "2026-11-17T16:00:00.000Z", vin: "", ageSec: 0 }, "bay1", at("2026-11-17T16:00:00.000Z"));
  assert.equal(outside.status, 404);
  assert.equal((await outside.json()).code, "no_scan");
  const otherDevice = await getPhotoRequestView(database, preferred.body.requestId, "bay2", now);
  assert.equal(otherDevice.status, 404);
  const mine = await getPhotoRequestView(database, preferred.body.requestId, "bay1", now);
  assert.deepEqual(await mine.json(), { requestId: preferred.body.requestId, scanId: older, ro: "", status: "pending", photos: 0, error: "" });
  assert.equal(deviceAuth(null, "bay1", "device-secret").status, 401);
  assert.equal(botAuth(null, "bot-secret").status, 401);
  for (let n = 0; n < 8; n += 1) assert.equal((await request(database, { clientId: `more-${n}` }, "bay1", now)).response.status, 200);
  const limited = await request(database, { clientId: "over" }, "bay1", now);
  assert.equal(limited.response.status, 429);
  assert.match(limited.body.error, /Too many/);
});

test("claim applies lazy expiry, and a second missed claim fails", async () => {
  const database = await db();
  const created = at("2026-11-17T15:00:00.000Z");
  await saveScan(database, parseScan(scanBody()), "38307", 1, created.toISOString());
  const first = await request(database, { clientId: "sit" }, "bay1", created);
  const quiet = await getPhotoRequestView(database, first.body.requestId, "bay1", at(new Date(created.getTime() + 3 * 60 * 1000).toISOString()));
  assert.equal((await quiet.json()).status, "pending");
  const expired = await getPhotoRequestView(database, first.body.requestId, "bay1", new Date(created.getTime() + 3 * 60 * 1000 + 1));
  assert.equal((await expired.json()).status, "expired");
  const open = await request(database, { clientId: "live" }, "bay1", created);
  const empty = await postPhotoBot(database, { action: "nope" }, created);
  assert.equal(empty.status, 400);
  const claimed = await postPhotoBot(database, { action: "claim", limit: 2 }, created);
  const payload = await claimed.json();
  assert.equal(payload.requests.length, 1);
  assert.equal(payload.requests[0].id, open.body.requestId);
  assert.equal(payload.requests[0].shots, BAYSCAN_PHOTO_SHOTS);
  assert.equal(payload.requests[0].ro, "38307");
  assert.equal(payload.requests[0].deviceId, "bay1");
  assert.equal((await postPhotoBot(database, { action: "claim", limit: 2 }, created)).status, 200);
  assert.deepEqual((await (await postPhotoBot(database, { action: "claim", limit: 2 }, created)).json()).requests, []);
  const returned = await getPhotoRequestView(database, open.body.requestId, "bay1", new Date(created.getTime() + 2 * 60 * 1000 + 1));
  assert.equal((await returned.json()).status, "pending");
  const again = await postPhotoBot(database, { action: "claim", limit: 2 }, new Date(created.getTime() + 2 * 60 * 1000 + 1));
  assert.equal((await again.json()).requests.length, 1);
  const missed = await getPhotoRequestView(database, open.body.requestId, "bay1", new Date(created.getTime() + 4 * 60 * 1000 + 2));
  const missedBody = await missed.json();
  assert.equal(missedBody.status, "failed");
  assert.equal(missedBody.error, PHOTO_MISS_ERROR);
  const fresh = await request(database, { clientId: "fail-me" }, "bay1", created);
  const failed = await postPhotoBot(database, { action: "fail", id: fresh.body.requestId, error: "lens covered" }, created);
  assert.equal(failed.status, 200);
  assert.deepEqual(await failed.json(), { ok: true });
  assert.equal((await (await getPhotoRequestView(database, fresh.body.requestId, "bay1", created)).json()).error, "lens covered");
});

test("upload rejects a bad JPEG, replays the same seq, and marks the request saved", async () => {
  const database = await db();
  const now = at("2026-11-17T15:00:00.000Z");
  await saveScan(database, parseScan(scanBody()), "", 0, now.toISOString());
  const made = await request(database, { clientId: "shot" }, "bay1", now);
  const memory = bucket();
  const bad = await savePhotoUpload(database, memory, { requestId: made.body.requestId, seq: 1, bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/jpeg", now });
  assert.equal(bad.status, 400);
  const typed = await savePhotoUpload(database, memory, { requestId: made.body.requestId, seq: 1, bytes: JPEG, contentType: "text/plain", now });
  assert.equal(typed.status, 400);
  const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
  big[0] = 0xff; big[1] = 0xd8;
  const huge = await savePhotoUpload(database, memory, { requestId: made.body.requestId, seq: 1, bytes: big, contentType: "image/jpeg", now });
  assert.equal(huge.status, 413);
  const saved = await savePhotoUpload(database, memory, { requestId: made.body.requestId, seq: 1, bytes: JPEG, contentType: "image/jpeg", now });
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.ok, true);
  assert.equal(body.attachQueued, false);
  assert.equal(body.filename, photoFilename(body.scanId, body.photoId, now.toISOString(), ""));
  assert.equal(memory.memory.get(`bayscan/${body.scanId}/photos/${body.photoId}.jpg`).type, "image/jpeg");
  const replay = await savePhotoUpload(database, memory, { requestId: made.body.requestId, seq: 1, bytes: new Uint8Array([9]), contentType: "image/jpeg", now });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).photoId, body.photoId);
  const view = await (await getPhotoRequestView(database, made.body.requestId, "bay1", now)).json();
  assert.equal(view.status, "saved");
  assert.equal(view.photos, 1);
  const closed = await postPhotoBot(database, { action: "fail", id: made.body.requestId, error: "too late" }, now);
  assert.equal(closed.status, 200);
  assert.equal((await (await getPhotoRequestView(database, made.body.requestId, "bay1", now)).json()).status, "saved");
});

test("a matched photo is queued immediately, a later re-match queues the rest, and the report job is untouched", async () => {
  const database = await db();
  const nowIso = "2026-11-17T15:00:00.000Z";
  const now = at(nowIso);
  const matchedId = await saveScan(database, parseScan(scanBody()), "38307", 1, nowIso);
  const memory = bucket();
  const scan = parseScan(scanBody());
  await publishBayScanAttachment(database, { scanId: matchedId, scan, ro: { ro: "38307", customer: "Jim Smith", vehicle: "Sierra", detailUrl: "https://shop.tekmetric.com/ro/38307" }, now: nowIso }, memory);
  const matchedRequest = await request(database, { clientId: "matched" }, "bay1", now);
  assert.equal(matchedRequest.body.ro, "38307");
  const uploaded = await savePhotoUpload(database, memory, { requestId: matchedRequest.body.requestId, seq: 1, bytes: JPEG, contentType: "image/jpeg", now });
  const uploadedBody = await uploaded.json();
  assert.equal(uploadedBody.attachQueued, true);
  assert.equal(uploadedBody.filename, photoFilename(matchedId, uploadedBody.photoId, nowIso, "38307"));
  const report = await getBayScanJobByScan(database, matchedId);
  const photoJob = await getBayScanJobByPhoto(database, uploadedBody.photoId);
  assert.equal(report.kind, "report");
  assert.equal(photoJob.kind, "photo");
  assert.equal(photoJob.contentType, "image/jpeg");
  assert.notEqual(report.id, photoJob.id);
  assert.equal(photoJob.customer, "Jim Smith");
  assert.equal(photoJob.detailUrl, "https://shop.tekmetric.com/ro/38307");
  assert.deepEqual(await scansMissingJobs(database), []);
  const claimed = await claimBayScanAttachJobs(database, { nowIso, limit: 10 });
  assert.equal(claimed.length, 2);
  assert.ok(claimed.some((job) => job.kind === "report" && job.photoId === null));
  const photoClaim = claimed.find((job) => job.kind === "photo");
  assert.equal(photoClaim.photoId, uploadedBody.photoId);
  assert.equal(photoClaim.contentType, "image/jpeg");
  const before = (await getScan(database, matchedId)).tekStatus;
  assert.equal(before, "queued");
  await ackBayScanAttachJob(database, { id: photoClaim.id, status: "done", nowIso });
  assert.equal((await getScan(database, matchedId)).tekStatus, "queued");
  assert.equal((await getPhoto(database, uploadedBody.photoId)).attachStatus, "attached");
  const file = await readBayScanFile(database, photoClaim.id, memory);
  assert.equal(file.contentType, "image/jpeg");
  assert.equal(file.bytes[0], 0xff);
  assert.equal(file.bytes[1], 0xd8);
  const response = bayScanFileResponse(file);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(new Uint8Array(await response.arrayBuffer())[0], 0xff);
  const gone = { puts: 0, async get() { return null; }, async put() { this.puts += 1; } };
  assert.equal(await readBayScanFile(database, photoClaim.id, gone), null);
  assert.equal(gone.puts, 0);
  await database.prepare(`DELETE FROM board_bayscan_jobs WHERE id = ?`).bind(report.id).run();
  assert.deepEqual(await scansMissingJobs(database), [matchedId]);
  assert.equal(await backfillAttachJobs(database, [{ ro: "38307", customer: "Jim Smith", vehicle: "Sierra" }], nowIso, memory), 1);
  assert.equal((await getBayScanJobByScan(database, matchedId)).kind, "report");

  const waitingId = await saveScan(database, parseScan(scanBody()), "", 0, nowIso);
  const waiting = await request(database, { clientId: "later" }, "bay1", now);
  assert.equal(waiting.body.scanId, waitingId);
  const held = await savePhotoUpload(database, memory, { requestId: waiting.body.requestId, seq: 1, bytes: JPEG, contentType: "image/jpeg", now });
  const heldBody = await held.json();
  assert.equal(heldBody.attachQueued, false);
  assert.match(heldBody.filename, /^BayScan-scan\d+-photo-\d{8}-\d{6}-\d+\.jpg$/);
  assert.equal(await rematchUnmatchedScans(database, [{ ro: "38308", customer: "Pat", vehicle: "Truck", vin: VIN, section: "work-in-progress" }], new Map(), nowIso, memory), 1);
  const queuedPhoto = await getPhoto(database, heldBody.photoId);
  assert.equal(queuedPhoto.attachStatus, "queued");
  assert.equal(queuedPhoto.filename, photoFilename(waitingId, heldBody.photoId, queuedPhoto.capturedAt, "38308"));
  const queuedJob = await getBayScanJobByPhoto(database, heldBody.photoId);
  assert.equal(queuedJob.kind, "photo");
  assert.equal(queuedJob.roNumber, "38308");
  assert.equal(queuedJob.filename, queuedPhoto.filename);
  assert.equal((await getScan(database, waitingId)).tekStatus, "queued");
  assert.equal((await getBayScanJobByScan(database, waitingId)).contentType, "application/pdf");
  await database.prepare(`DELETE FROM board_bayscan_jobs WHERE photo_id = ?`).bind(heldBody.photoId).run();
  await database.prepare(`UPDATE bayscan_photos SET attach_status = '' WHERE id = ?`).bind(heldBody.photoId).run();
  assert.equal((await photosMissingJobs(database)).some((row) => row.photoId === heldBody.photoId), true);
  assert.equal(await backfillPhotoJobs(database, [{ ro: "38308", customer: "Pat", vehicle: "Truck" }], nowIso), 1);
  assert.equal((await getBayScanJobByPhoto(database, heldBody.photoId)).kind, "photo");
});

test("an older jobs table can hold a report and a photo for the same scan", async () => {
  const database = d1();
  await database.prepare(`CREATE TABLE board_bayscan_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id INTEGER NOT NULL UNIQUE, ro_number TEXT NOT NULL,
    customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '', vin TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '',
    file_key TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_type TEXT NOT NULL DEFAULT 'application/pdf',
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, completed_at TEXT,
    last_error TEXT NOT NULL DEFAULT '', next_attempt_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  const now = "2026-11-17T15:00:00.000Z";
  await insertBayScanJob(database, { scanId: 4, roNumber: "38307", customer: "Jim", vehicle: "Sierra", vin: VIN, detailUrl: "", fileKey: "bayscan/4/report.pdf", filename: "BayScan-RO38307.pdf", contentType: "application/pdf" }, now);
  await insertBayScanPhotoJob(database, { scanId: 4, photoId: 9, roNumber: "38307", customer: "Jim", vehicle: "Sierra", vin: VIN, detailUrl: "", fileKey: "bayscan/4/photos/9.jpg", filename: "BayScan-RO38307-photo.jpg", contentType: "image/jpeg" }, now);
  const report = await getBayScanJobByScan(database, 4);
  const photo = await getBayScanJobByPhoto(database, 9);
  assert.equal(report.kind, "report");
  assert.equal(photo.kind, "photo");
  assert.equal(photo.photoId, 9);
  assert.notEqual(report.id, photo.id);
});

test("photo routes keep the device key and the bot key apart, and the board shows the pictures", () => {
  const requestRoute = src("../app/api/bayscan/photo-request/route.ts");
  const claimRoute = src("../app/api/bayscan/photo/route.ts");
  const uploadRoute = src("../app/api/bayscan/photo/upload/route.ts");
  const imageRoute = src("../app/bayscan/photo/[photoId]/route.ts");
  assert.ok(requestRoute.includes("deviceAuth(") && requestRoute.includes("BAYSCAN_DEVICE_KEY"));
  assert.ok(requestRoute.indexOf("deviceAuth(") < requestRoute.indexOf("postPhotoRequest("));
  assert.ok(!requestRoute.includes("botAuth"));
  assert.ok(claimRoute.includes("botAuth(") && uploadRoute.includes("botAuth("));
  assert.ok(!claimRoute.includes("BAYSCAN_DEVICE_KEY") && !uploadRoute.includes("BAYSCAN_DEVICE_KEY"));
  assert.ok(claimRoute.indexOf("botAuth(") < claimRoute.indexOf("postPhotoBot("));
  assert.ok(imageRoute.includes("getDashboardUser"));
  assert.ok(imageRoute.includes('"cache-control": "private"'));
  assert.equal(techPathAllowed("/bayscan/photo/4"), false);
  assert.ok(src("../app/tech-board/DtcBox.tsx").includes("ScanPhotos"));
  assert.ok(src("../app/tech-board/TechBoardPanel.tsx").includes("ScanPhotos"));
  assert.ok(src("../app/bayscan/report/[scanId]/page.tsx").includes("ScanPhotos"));
  assert.ok(src("../app/tech-board/ScanPhotos.tsx").includes("Photo requested…"));
  assert.ok(src("../app/tech-board/ScanPhotos.tsx").includes("/bayscan/photo/"));
  assert.equal(photoFilename(9, 4, "2026-11-05T15:00:00.000Z", "38307"), "BayScan-RO38307-photo-20261105-090000-4.jpg");
  assert.equal(photoFilename(9, 4, "2026-11-05T15:00:00.000Z", ""), "BayScan-scan9-photo-20261105-090000-4.jpg");
  assert.match(src("../app/lib/version.ts"), /"v1\.6\.22"/);
  const photo = src("../app/tech-board/bayscan-photo.ts");
  assert.ok(!photo.includes("saveCheckin(") && !photo.includes("addIdentifixRequest("));
});
