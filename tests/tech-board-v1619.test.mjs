// v1.6.19: VINs come from the reader (2.1.3) on every job-board RO; matching uses synced VIN, writer override wins; last-6 fallback.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { matchScanVin, matchVin } from "../app/tech-board/bayscan.ts";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const VIN = "1GTR1VE05CZ123456";
const ros = [
  { ro: "38307", customer: "Jim Smith", vehicle: "2012 GMC Sierra", vin: VIN, section: "work-in-progress" },
  { ro: "38310", customer: "Amy Lee", vehicle: "2015 Ford F-150", vin: "1FTFW1EF5FFA00001", section: "estimates" },
  { ro: "38311", customer: "No Vin", vehicle: "2018 Honda Accord", vin: "", section: "estimates" },
];

test("synced VIN matches with no writer VIN; writer override wins", () => {
  assert.deepEqual(matchVin(VIN, ros, new Map()).map((r) => r.ro), ["38307"]);
  const r = matchScanVin(VIN, ros, new Map()); assert.equal(r.by, "vin"); assert.equal(r.unknownVin, 1);
  assert.deepEqual(matchVin(VIN, ros, new Map([["38311", VIN], ["38307", "1FTFW1EF5FFA00009"]])).map((x) => x.ro), ["38311"]);
});

test("last-6 fallback: one mis-read char matches one RO; ambiguous or none → unmatched", () => {
  const misread = "1GTR1VE05CX123456"; // one char off, same serial
  const r = matchScanVin(misread, ros, new Map()); assert.equal(r.by, "last6"); assert.deepEqual(r.matches.map((x) => x.ro), ["38307"]);
  const twin = [...ros, { ro: "38320", customer: "Other", vehicle: "x", vin: "2GTR1VE05CZ123456" }];
  assert.equal(matchScanVin(misread, twin, new Map()).matches.length, 0);
  assert.equal(matchScanVin("5YJ3E1EA7KF000000", ros, new Map()).matches.length, 0);
  // full match never falls through to last-6
  assert.equal(matchScanVin(VIN, twin, new Map()).by, "vin");
});

test("ingest keeps vin/year/make/model; store + route use synced VIN; reader 2.1.3", () => {
  const ingest = src("../app/api/job-board/route.ts");
  assert.ok(ingest.includes("vin: /^[A-HJ-NPR-Z0-9]{17}$/") && ingest.includes("make: String("));
  assert.ok(src("../app/tech-board/store.ts").includes('vin: String(order.vin || "").toUpperCase()'));
  assert.ok(src("../app/api/bayscan/scan/route.ts").includes("matchScanVin("));
  assert.ok(src("../reader/version.py").includes('READER_VERSION = "2.1.3"'));
  assert.ok(src("../reader/reader.py").includes("attach_ro_vehicles(context, repair_orders, appointments)"));
  assert.match(src("../app/lib/version.ts"), /"v1\.6\.(19|[2-9]\d)"/);
});
