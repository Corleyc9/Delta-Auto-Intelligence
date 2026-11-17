// v1.6.21: all ROs in the picker, per-module Bay Scan data, printable report, auto re-match, Tekmetric attach queue.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { formatReadiness, mergeDuplicateModules, normalizeStoredScan, parseScan, tekAttachLabel } from "../app/tech-board/bayscan.ts";
import { codeDescription } from "../app/tech-board/bayscan-codes.ts";
import { BAYSCAN_SQL, getScan, loadUnmatchedScans, saveScan } from "../app/tech-board/bayscan-store.ts";
import { ackBayScanAttachJob, claimBayScanAttachJobs, publishBayScanAttachment, retryDelayMs } from "../app/tech-board/bayscan-jobs.ts";
import { backfillAttachJobs, commitScanAttach, rematchUnmatchedScans, REMATCH_WINDOW_MS } from "../app/tech-board/bayscan-rematch.ts";
import { buildReport, renderReportFile, renderTextPdf, reportFilename } from "../app/tech-board/bayscan-report.ts";
import { compareRos, searchRos, vinsMatch } from "../app/tech-board/ro-search.ts";
import { IDENTIFIX_REQUESTS_SQL } from "../app/tech-board/identifix-store.ts";
import { techPathAllowed } from "../app/lib/tech-session.ts";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const VIN = "1GTR1VE05CZ123456";
function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({ bind: (...v) => stmt(sql, v), run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  return { prepare: (sql) => stmt(sql), sqlite };
}
async function db() {
  const database = d1();
  for (const sql of [...BAYSCAN_SQL, IDENTIFIX_REQUESTS_SQL, `CREATE TABLE IF NOT EXISTS board_checkin (ro TEXT PRIMARY KEY, codes_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`]) await database.prepare(sql).run();
  return database;
}
const ro = (number, extra = {}) => ({ ro: String(number), customer: "Pat", vehicle: "Truck", ...extra });
const scanBody = (extra = {}) => ({ deviceId: "bay1", vin: VIN, scannedAt: "2026-11-05T15:00:00Z", odometer: 88000, modules: [
  { name: "ECM", addr: "7E0", codes: [{ code: "P0301", status: "confirmed" }] },
  { name: "OBD-II", addr: "7E8", codes: [{ code: "P0301", status: "confirmed", desc: "Cyl 1 misfire" }] },
  { name: "TCM", addr: "7E1", codes: [] },
  { name: "BCM", addr: "741", codes: [{ code: "U0100", status: "history" }] },
], readinessSummary: { catalyst: "not ready", spark: { misfire: "ready", fuel: "not ready" } }, ...extra });

test("picker lists every synced RO, open/WIP first then newest, and search still filters", () => {
  const ros = [
    ro(100, { section: "completed", customer: "Old", vehicle: "Van" }),
    ro(300, { section: "estimates", customer: "Ann", vehicle: "Civic" }),
    ro(200, { section: "work-in-progress", customer: "Jim", vehicle: "Sierra" }),
    ro(400, { section: "work-in-progress", customer: "Dee", vehicle: "F-150", status: "Work In Progress" }),
    ro(150, { section: "estimates", customer: "Bea", vehicle: "Accord" }),
    ro(90, { section: "work-in-progress", posted: true, customer: "Paid", vehicle: "Car" }),
    ...Array.from({ length: 6 }, (_, index) => ro(500 + index, { section: "estimates", customer: "Pool", vehicle: "Car" })),
  ];
  const all = searchRos(ros, "");
  assert.equal(all.length, ros.length, "empty query is not capped at 8");
  assert.deepEqual(all.slice(0, 2).map((item) => item.ro), ["400", "200"]);
  assert.equal(all.at(-1).ro, "90");
  assert.ok(all.findIndex((item) => item.ro === "400") < all.findIndex((item) => item.ro === "300"));
  assert.ok(all.findIndex((item) => item.ro === "300") < all.findIndex((item) => item.ro === "100"));
  assert.equal(searchRos(ros, "civic")[0].ro, "300");
  assert.equal(searchRos(ros, "zzz").length, 0);
  assert.equal(searchRos(ros, "", 8).length, 8, "an explicit limit still caps");
  assert.ok(compareRos(ro(1, { section: "work-in-progress" }), ro(9, { section: "completed" })) < 0);
});

test("a scan VIN pins full-VIN and last-6 matches above the rest, without skipping the search filter", () => {
  const ros = [
    ro(500, { section: "work-in-progress", vin: "2HGFG3B54GH000001", customer: "Newer" }),
    ro(100, { section: "completed", vin: VIN, customer: "Match" }),
    ro(220, { section: "estimates", vin: "3FAHP0HA6CR123456", customer: "Serial" }),
  ];
  assert.equal(vinsMatch(VIN, VIN), true);
  assert.equal(vinsMatch("1GTR1VE05CX123456", VIN), true);
  assert.equal(vinsMatch(VIN, "2HGFG3B54GH000001"), false);
  assert.deepEqual(searchRos(ros, "", Number.POSITIVE_INFINITY, VIN).map((item) => item.ro), ["220", "100", "500"]);
  assert.equal(searchRos(ros, "newer", Number.POSITIVE_INFINITY, VIN)[0].ro, "500");
  assert.equal(src("../app/tech-board/TechBoardPanel.tsx").includes("searchRos(listed, filtering ? query : \"\", Number.POSITIVE_INFINITY, pinVin)"), true);
});

test("modules keep real statuses, clean modules, merged OBD-II duplicate, and readable readiness", () => {
  const scan = parseScan(scanBody());
  assert.equal(scan.readinessSummary.includes("[object Object]"), false);
  assert.match(scan.readinessSummary, /catalyst: not ready/);
  assert.match(scan.readinessSummary, /spark \(misfire: ready; fuel: not ready\)/);
  assert.equal(formatReadiness("CAT not ready"), "CAT not ready");
  assert.equal(formatReadiness("[object Object]"), "");
  const names = scan.modules.map((module) => `${module.name} ${module.addr}`);
  assert.deepEqual(names, ["ECM 7E0", "TCM 7E1", "BCM 741"]);
  assert.equal(scan.modules[0].codes[0].desc, "Cyl 1 misfire", "description moves onto the kept ECM");
  assert.equal(scan.modules[0].codes[0].status, "confirmed");
  assert.deepEqual(scan.modules[1].codes, []);
  assert.equal(scan.modules[2].codes[0].status, "history");
  const weird = parseScan(scanBody({ modules: [{ name: "BCM", addr: "741", codes: [{ code: "P0420", status: "Active" }, { code: "U0100", status: "not-a-status" }] }], readinessSummary: "CAT not ready" }));
  assert.deepEqual(weird.modules[0].codes.map((code) => code.status), ["active", "not-a-status"]);
  const both = mergeDuplicateModules([
    { name: "ECM", addr: "7E0", codes: [{ code: "P0301", status: "confirmed", desc: "" }] },
    { name: "OBD-II", addr: "7E8", codes: [{ code: "P0171", status: "pending", desc: "" }] },
  ]);
  assert.equal(both.length, 2, "different codes stay separate");
  const old = normalizeStoredScan({ deviceId: "bay1", vin: VIN, readinessSummary: "[object Object]", modules: [
    { name: "PCM", addr: "7E8", codes: [{ code: "P0420", status: "stored" }] },
    { name: "OBD-II", addr: "7E8", codes: [{ code: "P0420", status: "stored" }] },
  ] });
  assert.equal(old.modules.length, 1);
  assert.equal(old.readinessSummary, "");
});

test("report names common generic codes only, and the PDF is a real file", () => {
  const scan = parseScan(scanBody({ modules: [
    { name: "ECM", addr: "7E0", codes: [{ code: "P0301", status: "confirmed" }, { code: "P0999", status: "pending", desc: "From the tool" }] },
    { name: "ABS", addr: "760", codes: [] },
  ], readinessSummary: "catalyst not ready" }));
  const report = buildReport(scan, { scanId: 4, ro: "38307", customer: "Jim Smith", vehicle: "2012 GMC Sierra" });
  assert.equal(report.modules[0].codes[0].description, "Cylinder 1 Misfire Detected");
  assert.equal(report.modules[0].codes[1].description, "From the tool");
  assert.equal(codeDescription("B1234"), "");
  assert.equal(codeDescription("P0301", "Tool text"), "Tool text");
  assert.equal(report.when.includes("AM") || report.when.includes("PM"), true);
  assert.match(reportFilename("38307", scan.scannedAt), /^BayScan-RO38307-\d{8}-\d{4}\.pdf$/);
  const file = renderReportFile(report);
  assert.equal(file.contentType, "application/pdf");
  const text = new TextDecoder().decode(file.bytes);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes(VIN));
  assert.ok(text.includes("No codes"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.ok(renderTextPdf(["hello"]).byteLength > 100);
  assert.ok(src("../app/bayscan/report/[scanId]/page.tsx").includes("getDashboardUser"));
  assert.equal(techPathAllowed("/bayscan/report/4"), false);
});

test("unmatched scans re-match inside 14 days and attach once", async () => {
  const database = await db();
  const scan = parseScan(scanBody());
  const now = "2026-11-17T15:00:00.000Z";
  const id = await saveScan(database, scan, "", 0, now);
  const stale = await saveScan(database, scan, "", 0, new Date(Date.parse(now) - REMATCH_WINDOW_MS - 86400000).toISOString());
  const ambiguous = await saveScan(database, { ...scan, vin: "1FTFW1EF5FFA00001" }, "", 2, now);
  assert.equal(await rematchUnmatchedScans(database, [ro(38307, { vin: "", section: "estimates" }), ro(38308, { vin: "", section: "work-in-progress" })], new Map(), now), 0, "no VIN yet");
  const bucket = { puts: [], async put(key, bytes) { this.puts.push({ key, bytes }); } };
  assert.equal(await rematchUnmatchedScans(database, [ro(38307, { vin: VIN, section: "work-in-progress", customer: "Jim Smith", vehicle: "Sierra" })], new Map(), now, bucket), 1);
  assert.equal(await rematchUnmatchedScans(database, [ro(38307, { vin: VIN, section: "work-in-progress" })], new Map(), now, bucket), 0, "second pass does not attach again");
  const attached = await getScan(database, id);
  assert.equal(attached.status, "attached");
  assert.equal(attached.ro, "38307");
  assert.equal(attached.tekStatus, "queued");
  assert.equal((await getScan(database, stale)).status, "unmatched");
  assert.equal((await getScan(database, ambiguous)).status, "unmatched");
  const checkin = await database.prepare(`SELECT codes_json, notes FROM board_checkin WHERE ro = ?`).bind("38307").first();
  assert.match(checkin.codes_json, /P0301/);
  assert.match(checkin.notes, /No codes/);
  assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM board_identifix_requests`).first()).n, 1);
  assert.equal((await database.prepare(`SELECT vin FROM board_ro_vin WHERE ro = ?`).bind("38307").first()).vin, VIN);
  assert.equal(bucket.puts.length, 1);
  const last6 = await saveScan(database, { ...scan, vin: "1GTR1VE05CX123456" }, "", 0, now);
  assert.equal(await rematchUnmatchedScans(database, [ro(38307, { vin: "", section: "work-in-progress" })], new Map([["38307", VIN]]), now), 1);
  assert.equal((await getScan(database, last6)).ro, "38307");
  assert.equal((await loadUnmatchedScans(database)).some((item) => item.id === stale), true);
});

test("Tekmetric attach jobs are claimed, retried with backoff, and never attached twice", async () => {
  const database = await db();
  const scan = parseScan(scanBody({ readinessSummary: "catalyst not ready" }));
  const now = "2026-11-05T15:00:00.000Z";
  const id = await saveScan(database, scan, "38307", 1, now);
  const memory = new Map();
  const bucket = { async put(key, bytes, options) { memory.set(key, { bytes, type: options.httpMetadata.contentType }); }, async get(key) { return memory.has(key) ? { arrayBuffer: async () => memory.get(key).bytes, httpMetadata: { contentType: memory.get(key).type } } : null; } };
  const first = await publishBayScanAttachment(database, { scanId: id, scan, ro: { ro: "38307", customer: "Jim Smith", vehicle: "Sierra", detailUrl: "https://shop.tekmetric.com/ro/38307" }, now }, bucket);
  const second = await publishBayScanAttachment(database, { scanId: id, scan, ro: { ro: "38307", customer: "Jim Smith", vehicle: "Sierra" }, now }, bucket);
  assert.equal(second.reused, true);
  assert.equal(second.job.id, first.job.id);
  assert.equal((await getScan(database, id)).tekStatus, "queued");
  const claimed = await claimBayScanAttachJobs(database, { nowIso: now, limit: 4 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].roNumber, "38307");
  assert.equal(claimed[0].scanId, id);
  assert.match(claimed[0].filename, /^BayScan-RO38307-\d{8}-\d{4}\.pdf$/);
  assert.equal(claimed[0].fileUrl, `/api/bayscan/attach/file?id=${claimed[0].id}`);
  assert.equal(claimed[0].detailUrl, "https://shop.tekmetric.com/ro/38307");
  assert.equal((await claimBayScanAttachJobs(database, { nowIso: now })).length, 0, "a fresh claim is not handed out twice");
  const failed = await ackBayScanAttachJob(database, { id: claimed[0].id, status: "failed", error: "attachment control not found", nowIso: now });
  assert.equal(failed.job.status, "pending");
  assert.match((await getScan(database, id)).tekError, /attachment control/);
  assert.equal((await claimBayScanAttachJobs(database, { nowIso: now })).length, 0);
  const retryAt = new Date(Date.parse(now) + retryDelayMs(1)).toISOString();
  const retried = await claimBayScanAttachJobs(database, { nowIso: retryAt });
  assert.equal(retried.length, 1);
  assert.equal(retried[0].attempts, 2);
  await ackBayScanAttachJob(database, { id: claimed[0].id, status: "done", nowIso: retryAt });
  assert.equal((await getScan(database, id)).tekStatus, "attached");
  assert.equal(tekAttachLabel("attached"), "Attached to Tekmetric");
  assert.match(tekAttachLabel("failed", "attachment control not found"), /Failed: attachment/);
  const undone = await ackBayScanAttachJob(database, { id: claimed[0].id, status: "failed", error: "late failure", nowIso: retryAt });
  assert.equal(undone.job.status, "done", "a finished attach is not queued again");
  assert.equal((await getScan(database, id)).tekStatus, "attached");
  const staleClaim = new Date(Date.parse(retryAt) + 16 * 60 * 1000).toISOString();
  assert.equal((await claimBayScanAttachJobs(database, { nowIso: staleClaim })).length, 0);
  assert.equal(await backfillAttachJobs(database, [], retryAt, bucket), 0);
  const { readBayScanFile } = await import("../app/tech-board/bayscan-jobs.ts");
  const file = await readBayScanFile(database, claimed[0].id, bucket);
  assert.ok(file.bytes.byteLength > 100);
  assert.match(file.contentType, /pdf/);
});

test("manual attach, routes, and cron stay inside the Bay Scan rules", () => {
  const actions = src("../app/tech-board/actions.ts");
  assert.ok(actions.includes("commitScanAttach("));
  assert.ok(src("../app/tech-board/bayscan-maintain.ts").includes("rematchUnmatchedScans("));
  const scanRoute = src("../app/api/bayscan/scan/route.ts");
  assert.ok(scanRoute.includes("deviceAuth(") && scanRoute.includes("publishBayScanAttachment("));
  assert.ok(!scanRoute.includes("botAuth"));
  assert.match(scanRoute, /return Response\.json\(\{ \.\.\.scanReply\(match, id\)/);
  const attach = src("../app/api/bayscan/attach/route.ts");
  const fileRoute = src("../app/api/bayscan/attach/file/route.ts");
  assert.ok(attach.includes("botAuth(") && fileRoute.includes("botAuth("));
  assert.ok(!attach.includes("BAYSCAN_DEVICE_KEY") && !fileRoute.includes("BAYSCAN_DEVICE_KEY"));
  assert.ok(src("../app/api/job-board/route.ts").includes("runBayScanMaintenance("));
  assert.ok(src("../worker/index.ts").includes("runBayScanCron("));
  assert.ok(src("../app/tech-board/DtcBox.tsx").includes("ScanModules"));
  assert.ok(src("../app/tech-board/DtcBox.tsx").includes("Bay Scan report"));
  const panel = src("../app/tech-board/TechBoardPanel.tsx");
  assert.ok(panel.includes("/bayscan/report/"));
  assert.match(src("../app/lib/version.ts"), /"v1\.6\.22"/);
});

test("giving up after the attempt cap is a failed status the board can show", async () => {
  const database = await db();
  const scan = parseScan({ deviceId: "bay1", vin: VIN, modules: [], readinessSummary: "ready" });
  const id = await saveScan(database, scan, "38307", 1, "2026-11-05T15:00:00.000Z");
  await publishBayScanAttachment(database, { scanId: id, scan, ro: { ro: "38307", customer: "Jim", vehicle: "Sierra" }, now: "2026-11-05T15:00:00.000Z" });
  let now = Date.parse("2026-11-05T15:00:00.000Z");
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const jobs = await claimBayScanAttachJobs(database, { nowIso: new Date(now).toISOString() });
    assert.equal(jobs.length, 1, `attempt ${attempt}`);
    const acked = await ackBayScanAttachJob(database, { id: jobs[0].id, status: "failed", error: "still blocked", nowIso: new Date(now).toISOString() });
    now += retryDelayMs(attempt) + 1000;
    if (attempt < 6) assert.equal(acked.job.status, "pending");
    else assert.equal(acked.job.status, "failed");
  }
  assert.equal((await getScan(database, id)).tekStatus, "failed");
  assert.equal((await claimBayScanAttachJobs(database, { nowIso: new Date(now + 86400000).toISOString() })).length, 0);
  assert.equal(await commitScanAttach(database, id, { ro: "38307", customer: "Jim", vehicle: "Sierra" }, "Devin", new Date(now).toISOString()), false);
});
