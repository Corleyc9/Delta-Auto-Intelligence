// Tech Board revisions suggestion box: validation, schema, and the tech gate for its routes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BOARD_SUGGESTIONS_SQL, newSuggestion, rowToSuggestion, suggestionUpdate } from "../app/tech-board/suggestions.ts";
import { createTechCookie, techGate, writerSessionValid } from "../app/lib/tech-session.ts";
import { APP_VERSION } from "../app/lib/version.ts";

test("build version is v1.2 or later", () => assert.ok(/^v1\.([2-9]|\d\d)(\.\d+)?$/.test(APP_VERSION), APP_VERSION));

test("tech submitter comes only from the PIN session; writers give a name", () => {
  const tech = newSuggestion({ text: "Bigger % buttons", category: "Buttons", name: "Someone Else" }, { tech: "MC" });
  assert.deepEqual(tech, { text: "Bigger % buttons", category: "Buttons", submitter: "MC", submitterTech: "MC", source: "tech" });
  const writer = newSuggestion({ text: "Show promised time", category: "Nope" }, { name: "Devin" });
  assert.equal(writer.submitter, "Devin"); assert.equal(writer.category, "Other"); assert.equal(writer.submitterTech, null);
  assert.equal(newSuggestion({ text: "Hi there" }, {}).submitter, "Writer");
  assert.ok("error" in newSuggestion({ text: "  " }, { tech: "MC" }));
});

test("status changes accept only New/Planned/Done/Declined", () => {
  assert.deepEqual(suggestionUpdate({ id: 3, status: "Planned", reply: "Next build" }), { id: 3, status: "Planned", reply: "Next build" });
  assert.ok("error" in suggestionUpdate({ id: 3, status: "Shipped" }));
});

test("board_suggestions table is in the tech board schema, migration 0004 and ensureSchema", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(BOARD_SUGGESTIONS_SQL);
  db.prepare(`INSERT INTO board_suggestions (text, category, submitter, submitter_tech, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("Bigger % buttons", "Buttons", "MC", "MC", "tech", "2026-11-03T15:00:00Z", "2026-11-03T15:00:00Z");
  const row = rowToSuggestion(db.prepare(`SELECT * FROM board_suggestions`).get());
  assert.equal(row.status, "New"); assert.equal(row.reply, ""); assert.equal(row.submitterTech, "MC");
  assert.match(readFileSync("drizzle/0004_tech_board.sql", "utf8"), /CREATE TABLE IF NOT EXISTS board_suggestions/);
  assert.match(readFileSync("db/ensure-schema.ts", "utf8"), /CREATE TABLE IF NOT EXISTS board_suggestions/);
  assert.match(readFileSync("app/tech-board/store.ts", "utf8"), /BOARD_SUGGESTIONS_SQL,/);
});

test("tech gate: a tech can post suggestions only through /api/tech", async () => {
  const secret = "test-secret";
  const cookie = (await createTechCookie(secret, "MC", "v1")).split(";")[0];
  const gate = (path) => techGate(new Request(`https://deltaintelligence.cc${path}`, { method: "POST", headers: { cookie } }), secret, (c) => writerSessionValid(c, secret));
  assert.equal(await gate("/api/tech"), null);
  for (const path of ["/api/tech-board", "/api/suggestions", "/api/tech-board/suggestions", "/api/techs"]) {
    assert.equal((await gate(path))?.status, 403, path);
  }
});
