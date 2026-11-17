// v1.6.18: Bay Scan scanner endpoint — scoped device key, scan parsing, VIN → open RO matching, unmatched list, single code box.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deviceAuth, parseDeviceKeys, parseScan, scanCodes, scanNotes, matchVin, isOpenRo, scanReply, BAYSCAN_LABEL } from "../app/tech-board/bayscan.ts";
import { BAYSCAN_SQL, saveScan, loadUnmatchedScans, markScan, setRoVin, loadRoVins } from "../app/tech-board/bayscan-store.ts";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, values = []) => ({ bind: (...v) => stmt(sql, v), run: async () => sqlite.prepare(sql).run(...values),
    first: async () => sqlite.prepare(sql).get(...values) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }) });
  return { prepare: (sql) => stmt(sql) };
}
const VIN = "1GTR1VE05CZ123456";
const body = { deviceId: "bay1", vin: VIN.toLowerCase(), odometer: "123456", protocol: "ISO 15765-4 CAN 11/500", scannedAt: "2026-11-05T14:00:00Z", battery: 87, milOn: true,
  modules: [{ name: "ECM", addr: "7E0", codes: [{ code: "p0301", status: "stored", desc: "Cyl 1 misfire" }, { code: "P0420", status: "pending" }] },
    { name: "BCM", addr: "741", codes: [{ code: "U0100", status: "permanent" }, { code: "P0301", status: "weird" }, { code: "junk" }] }], readinessSummary: "CAT not ready" };

test("device key: shared, per-device list and JSON; wrong/missing key and unset secret refused", async () => {
  assert.equal(deviceAuth("Bearer abc", "bay1", "abc"), null);
  assert.equal((deviceAuth("Bearer nope", "bay1", "abc")).status, 401);
  assert.equal((deviceAuth(null, "bay1", "abc")).status, 401);
  assert.equal((deviceAuth("Bearer abc", "bay1", "")).status, 503);
  const list = "bay1:k1,bay2:k2";
  assert.equal(parseDeviceKeys(list).devices.size, 2);
  assert.equal(deviceAuth("Bearer k1", "bay1", list), null);
  assert.equal(deviceAuth("Bearer k1", "bay2", list).status, 401, "one device's key can't post as another");
  assert.equal(deviceAuth("Bearer k1", "", list).status, 401);
  assert.equal(deviceAuth("Bearer k2", "BAY2", JSON.stringify({ bay2: "k2" })), null);
  const res = deviceAuth("Bearer zz", "bay1", "secret-value"); assert.ok(!(await res.text()).includes("secret-value"));
});

test("scoped: BAYSCAN_DEVICE_KEY only read by /api/bayscan/scan; that route accepts no other key", () => {
  const files = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
  walk(new URL("../app", import.meta.url).pathname); walk(new URL("../worker", import.meta.url).pathname);
  const readers = files.filter((f) => readFileSync(f, "utf8").includes("BAYSCAN_DEVICE_KEY") && !f.endsWith("bayscan.ts"));
  assert.deepEqual(readers.map((f) => f.split("/app/")[1]), ["api/bayscan/scan/route.ts"]);
  const route = src("../app/api/bayscan/scan/route.ts");
  assert.ok(!/env\.(TECH_BOARD_BOT_KEY|READER_API_KEY)/.test(route) && !route.includes("botAuth") && !route.includes("requireApiUser"));
  assert.ok(!src("../app/lib/bot-auth.ts").includes("BAYSCAN"));
  assert.match(route, /export async function POST/); assert.ok(!/export async function GET/.test(route));
});

test("scan parsing: VIN required/normalized, code statuses, dedupe across modules, notes label", () => {
  const scan = parseScan(body, "bay1");
  assert.equal(scan.vin, VIN); assert.equal(scan.odometer, 123456); assert.equal(scan.battery, 87);
  assert.deepEqual(scan.modules[1].codes.map((c) => [c.code, c.status]), [["U0100", "permanent"], ["P0301", "stored"]]);
  assert.deepEqual(scanCodes(scan), ["P0301", "P0420", "U0100"]);
  assert.ok(scanNotes(scan).startsWith(BAYSCAN_LABEL)); assert.match(BAYSCAN_LABEL, /not a diagnosis/);
  assert.ok("error" in parseScan({ ...body, vin: "123" }));
  assert.ok("error" in parseScan({ ...body, deviceId: "" }, ""));
});

test("matching: exactly one open RO; closed/posted excluded; writer VIN overrides; 0 or 2+ → unmatched", () => {
  const ros = [{ ro: "38307", customer: "Jim Smith", vehicle: "2012 GMC Sierra", vin: VIN, section: "work-in-progress" },
    { ro: "38100", customer: "Old Ro", vehicle: "2012 GMC Sierra", vin: VIN, status: "Posted" },
    { ro: "38200", customer: "Amy Lee", vehicle: "2015 Ford F-150", vin: "" }];
  assert.equal(isOpenRo(ros[1]), false);
  assert.deepEqual(matchVin(VIN, ros, new Map()).map((r) => r.ro), ["38307"]);
  assert.equal(matchVin(VIN, ros, new Map([["38200", VIN]])).length, 2, "two open ROs → ambiguous");
  assert.deepEqual(matchVin(VIN, ros, new Map([["38307", "2FTRX18W1XCA00000"]])).map((r) => r.ro), [], "writer VIN overrides synced");
  assert.equal(matchVin("bad", ros, new Map()).length, 0);
  assert.deepEqual(scanReply(ros[0], 5), { matched: true, ro: "38307", customer: "Jim Smith", vehicle: "2012 GMC Sierra", scanId: 5, display: "RO 38307 – Smith" });
  assert.equal(scanReply(null, 6).display, "Unmatched – pick on board"); assert.equal(scanReply(null, 6).matched, false);
});

test("store: unmatched list, writer attach removes it, RO VINs", async () => {
  const db = d1(); for (const sql of BAYSCAN_SQL) await db.prepare(sql).run();
  assert.ok(src("../app/tech-board/store.ts").includes("...BAYSCAN_SQL"));
  const scan = parseScan(body, "bay1");
  const a = await saveScan(db, scan, "", 0, "2026-11-05T14:00:01Z");
  await saveScan(db, scan, "38307", 1, "2026-11-05T14:00:02Z");
  assert.deepEqual((await loadUnmatchedScans(db)).map((s) => s.id), [a]);
  const done = await markScan(db, a, "attached", "38307", "Devin", "2026-11-05T14:05:00Z");
  assert.equal(done.status, "attached"); assert.equal((await loadUnmatchedScans(db)).length, 0);
  await setRoVin(db, "38307", VIN, "Devin", "x"); assert.equal((await loadRoVins(db)).get("38307"), VIN);
  await setRoVin(db, "38307", "", "Devin", "y"); assert.equal((await loadRoVins(db)).size, 0);
});

test("attach → check-in codes + auto Identifix request; writer UI has ONE code box; version", () => {
  const attach = src("../app/tech-board/bayscan-attach.ts");
  assert.ok(attach.includes("saveCheckin(") && attach.includes("addIdentifixRequest("));
  const panel = src("../app/tech-board/IdentifixPanel.tsx");
  assert.ok(!panel.includes("DTC code(s)<input"), "Identifix box no longer has its own code field");
  assert.equal((src("../app/tech-board/DtcBox.tsx").match(/Codes<input/g) || []).length, 1);
  assert.ok(src("../app/tech-board/TechBoardPanel.tsx").includes("Unmatched scans"));
  assert.ok(!src("../app/api/tech/route.ts").includes("unmatchedScans"), "techs don't get the unmatched list");
  assert.match(src("../app/lib/version.ts"), /"v1\.6\.(1[8-9]|[2-9]\d)"/);
});
