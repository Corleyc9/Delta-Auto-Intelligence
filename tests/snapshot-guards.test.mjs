import assert from "node:assert/strict";
import test from "node:test";
import {
  isEmptyCriticalSnapshot,
  isEmptyJobBoard,
  isEmptyListSnapshot,
} from "../app/lib/snapshot-guards.ts";

test("rejects an empty Job Board payload", () => {
  assert.equal(isEmptyJobBoard([]), true);
  assert.equal(isEmptyJobBoard([{ roNumber: "1" }]), false);
});

test("rejects a shop snapshot with no techs and zero sales/ROs", () => {
  assert.equal(isEmptyCriticalSnapshot({ technicians: [], totalSales: 0, totalROs: 0 }), true);
  assert.equal(isEmptyCriticalSnapshot({ technicians: [{ name: "Beau" }], totalSales: 0, totalROs: 0 }), false);
  assert.equal(isEmptyCriticalSnapshot({ technicians: [], totalSales: 1200, totalROs: 0 }), false);
});

test("rejects empty list snapshots used for Steer", () => {
  assert.equal(isEmptyListSnapshot([]), true);
  assert.equal(isEmptyListSnapshot([{ key: "abc" }]), false);
});
