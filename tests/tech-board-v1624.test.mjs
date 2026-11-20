// v1.6.24: Bay Scan sits on the RO card, not only inside the ticket drawer.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "../app/lib/version.ts";
import { SCAN_REQUEST_POLL_MS, scanRequestActive, scanRequestCardText, scanRequestStatusText } from "../app/tech-board/bayscan.ts";

const src = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("card status is short shop wording and the drawer wording stays", () => {
  assert.equal(scanRequestCardText({ status: "pending" }), "Requested…");
  assert.equal(scanRequestCardText({ status: "claimed" }), "Scanning…");
  assert.equal(scanRequestCardText({ status: "scanning" }), "Scanning…");
  assert.equal(scanRequestCardText({ status: "done" }), "Done");
  assert.equal(scanRequestCardText({ status: "expired" }), "Expired");
  assert.equal(scanRequestCardText({ status: "failed", reason: "no_dongle" }), "Failed: dongle not found");
  assert.equal(scanRequestCardText({ status: "failed", reason: "no_car_power" }), "Failed: car has no power");
  assert.equal(scanRequestCardText({ status: "failed", reason: "no_ecu" }), "Failed: no computer found");
  assert.equal(scanRequestCardText({ status: "failed" }), "Failed");
  assert.equal(scanRequestStatusText({ status: "pending" }), "Waiting for the Mac");
  assert.equal(scanRequestStatusText({ status: "done", codeCount: 2 }), "Done · 2 codes");
  assert.equal(scanRequestStatusText({ status: "failed", reason: "no_dongle" }), "Dongle not found");
  assert.equal(scanRequestActive("pending"), true);
  assert.equal(scanRequestActive("done"), false);
  assert.equal(SCAN_REQUEST_POLL_MS, 4000);
});

test("the RO card has a Bay Scan button that does not open the drawer, and the drawer button stays", () => {
  const panel = src("../app/tech-board/TechBoardPanel.tsx");
  const drawer = src("../app/tech-board/DtcBox.tsx");
  assert.equal((panel.match(/<RequestedJobRow /g) || []).length, 2, "grid cards and front-office cards");
  assert.match(panel, /!job\.custom && <RequestedJobRow/);
  assert.match(panel, /<CardBayScan /);
  assert.match(panel, /data-testid="bayscan-card-button"/);
  assert.match(panel, /action: "bayscan-scan-request"/);
  assert.match(panel, /event\.stopPropagation\(\)/);
  assert.match(panel, /scanHot \? SCAN_REQUEST_POLL_MS : 60000/);
  assert.match(panel, /Bay Scan dongle/);
  assert.equal(panel.includes("ViaBecs"), false);
  assert.match(drawer, /data-testid="bayscan-request-button"/);
  assert.match(drawer, />Bay Scan</);
  assert.match(src("../app/globals.css"), /min-height: 32px/);
  assert.match(src("../README.md"), /Requested…/);
  assert.match(APP_VERSION, /^v1\.6\.2[4-9]$/);
});
