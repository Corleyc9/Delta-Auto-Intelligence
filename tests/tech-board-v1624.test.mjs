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

test("Bay Scan is one header button, not a control on each RO card or in the drawer", () => {
  const panel = src("../app/tech-board/TechBoardPanel.tsx");
  const drawer = src("../app/tech-board/DtcBox.tsx");
  assert.equal((panel.match(/data-testid="bayscan-board-button"/g) || []).length, 1);
  assert.match(panel, /action: "bayscan-scan-request"/);
  assert.equal(panel.includes("bayscan-card-button"), false);
  assert.equal(panel.includes("<CardBayScan "), false);
  assert.match(panel, /scanHot \? SCAN_REQUEST_POLL_MS : 60000/);
  assert.equal(panel.includes("ViaBecs"), false);
  assert.equal(drawer.includes("bayscan-request-button"), false);
  assert.match(src("../app/globals.css"), /min-height:\s*48px/);
  assert.match(src("../app/globals.css"), /touch-action:\s*manipulation/);
  assert.match(src("../README.md"), /Requested…/);
  assert.match(APP_VERSION, /^v1\.6\.2[4-9]$/);
});
