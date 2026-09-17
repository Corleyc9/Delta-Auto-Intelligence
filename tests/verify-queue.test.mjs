import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureSchema } from "../db/ensure-schema.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("Verified click does not depend on window.prompt", async () => {
  const page = await read("app/page.tsx");
  const view = await read("app/components/views/VerifyQueueView.tsx");
  const markVerified = page.slice(page.indexOf("async function markVerified"), page.indexOf("useEffect", page.indexOf("async function markVerified")));
  assert.match(markVerified, /fetch\("\/api\/verifications"/);
  assert.match(markVerified, /method: "PATCH"/);
  assert.doesNotMatch(markVerified, /window\.prompt/);
  assert.doesNotMatch(markVerified, /note === undefined/);
  assert.match(page, /markVerified,/);
  assert.match(view, /onClick=\{\(\) => markVerified\(item, notes\[item\.id\] \?\? ""\)\}/);
  assert.match(view, /className="verify-note-field"/);
  assert.match(view, /Leave blank if none/);
});

test("PATCH /api/verifications still records history with an optional note", async () => {
  const route = await read("app/api/verifications/route.ts");
  assert.match(route, /requireApiUser/);
  assert.match(route, /status = 'verified'/);
  assert.match(route, /verification_note/);
  assert.match(route, /String\(body\.note \|\| ""\)\.trim\(\)/);
  assert.match(route, /WHERE id = \? AND status = 'pending'/);
});

function asD1(sqlite = new DatabaseSync(":memory:")) {
  const d1 = {
    prepare(sql) {
      let bound = [];
      const statement = {
        bind(...params) {
          bound = params;
          return statement;
        },
        async run() {
          const result = sqlite.prepare(sql).run(...bound);
          return { success: true, meta: { changes: result.changes } };
        },
        async first() {
          return sqlite.prepare(sql).get(...bound) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...bound) };
        },
      };
      return statement;
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return { sqlite, d1 };
}

test("marking verified with an empty note keeps the RO in history", async () => {
  const { sqlite, d1 } = asD1();
  await ensureSchema(d1);
  sqlite.prepare(`INSERT INTO ro_verification_cycles
    (ro_number, customer, vehicle, service_writer, detail_url, amount, section, diagnosed_at, status, verification_note, last_seen_at)
    VALUES ('4412', 'Taylor', '2018 Ford F-150', 'Writer', '', 420, 'work-in-progress', '2026-09-17T12:00:00Z', 'pending', '', '2026-09-17T12:00:00Z')`).run();
  const id = sqlite.prepare("SELECT id FROM ro_verification_cycles WHERE ro_number = '4412'").get().id;
  const verifiedAt = "2026-09-17T13:00:00Z";
  const verifiedBy = "Delta shared login";
  const note = String("").trim().slice(0, 600);
  const result = await d1.prepare(`UPDATE ro_verification_cycles SET
    status = 'verified', verified_at = ?, verified_by = ?, verification_note = ?
    WHERE id = ? AND status = 'pending'`).bind(verifiedAt, verifiedBy, note, id).run();
  assert.equal(result.meta.changes, 1);
  const row = sqlite.prepare("SELECT * FROM ro_verification_cycles WHERE id = ?").get(id);
  assert.equal(row.status, "verified");
  assert.equal(row.verified_by, verifiedBy);
  assert.equal(row.verification_note, "");
  const second = await d1.prepare(`UPDATE ro_verification_cycles SET
    status = 'verified', verified_at = ?, verified_by = ?, verification_note = ?
    WHERE id = ? AND status = 'pending'`).bind(verifiedAt, verifiedBy, "late note", id).run();
  assert.equal(second.meta.changes, 0);
  const history = sqlite.prepare("SELECT * FROM ro_verification_cycles WHERE status = 'verified'").all();
  assert.equal(history.length, 1);
});
