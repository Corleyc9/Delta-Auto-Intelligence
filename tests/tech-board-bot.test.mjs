// v1.4 Teams bot API: bearer key from TECH_BOARD_BOT_KEY, 503 when unset, writer-level board actions only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { botAuth, botToBoardAction } from "../app/lib/bot-auth.ts";
import { createTechCookie, techGate, writerSessionValid } from "../app/lib/tech-session.ts";

test("missing secret disables the API (503); wrong or absent key is 401; right key passes", async () => {
  assert.equal(botAuth("Bearer anything", undefined).status, 503);
  assert.equal(botAuth("Bearer anything", "   ").status, 503);
  assert.equal(botAuth(null, "s3cret-key").status, 401);
  assert.equal(botAuth("Bearer wrong", "s3cret-key").status, 401);
  assert.equal(botAuth("Basic s3cret-key", "s3cret-key").status, 401);
  assert.equal(botAuth("Bearer s3cret-key", "s3cret-key"), null);
  assert.equal(botAuth("bearer  s3cret-key ", "s3cret-key"), null);
});

test("key comparison is constant-time and the key is never in code", () => {
  const src = readFileSync("app/lib/bot-auth.ts", "utf8");
  assert.match(src, /timingSafeEqual\(/); assert.doesNotMatch(src, /===\s*key|key\s*===/);
  const route = readFileSync("app/api/tech-board/bot/route.ts", "utf8");
  assert.match(route, /env\.TECH_BOARD_BOT_KEY/);
  assert.doesNotMatch(readFileSync("wrangler.toml", "utf8"), /TECH_BOARD_BOT_KEY\s*=/);
});

test("bot actions map onto writer board actions only", () => {
  assert.deepEqual(botToBoardAction({ action: "move", ro: "18402-J2", tech: "AN", date: "2026-11-03", startMinute: 300 }),
    { action: "move", ro: "18402-J2", tech: "AN", laneDate: "2026-11-03", startMinute: 300 });
  assert.equal(botToBoardAction({ action: "resize", ro: "1", durationMinutes: 90 }).action, "resize");
  assert.equal(botToBoardAction({ action: "add-block", tech: "MC", date: "2026-11-03", startMinute: 120, durationMinutes: 60, title: "Loaner", linkedRo: "18402" }).action, "add-custom");
  assert.equal(botToBoardAction({ action: "add-time-off", tech: "BC", date: "2026-11-04", allDay: true }).action, "timeoff-save");
  assert.deepEqual(botToBoardAction({ action: "set-percent", ro: "18402-J1", percent: 50 }),
    { action: "update", ro: "18402-J1", kind: "note", percentComplete: 50, comment: "", techEstimateHours: null });
  assert.equal(botToBoardAction({ action: "set-percent", ro: "1", percent: 100 }).kind, "Done");
  assert.ok("error" in botToBoardAction({ action: "set-percent", ro: "1", percent: 140 }));
  for (const action of ["pin-set", "delete", "pool-decide", "recompute", "approve"]) assert.ok("error" in botToBoardAction({ action }), action);
});

test("changes go through the shared writer action (same-RO rules) and are logged as teams-bot; nothing touches Tekmetric", () => {
  const route = readFileSync("app/api/tech-board/bot/route.ts", "utf8");
  assert.match(route, /boardAction\(db, [^)]*"teams-bot"\)/);
  const actions = readFileSync("app/tech-board/actions.ts", "utf8");
  assert.match(actions, /INSERT INTO board_change_log/); assert.match(actions, /snapSameRo/); assert.match(actions, /resizePush/);
  for (const file of ["app/api/tech-board/bot/route.ts", "app/tech-board/actions.ts", "app/lib/bot-auth.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /tekmetric-label|markVerified|shop\.tekmetric\.com\/api|fetch\(/i, file);
  }
  assert.match(readFileSync("drizzle/0004_tech_board.sql", "utf8"), /CREATE TABLE IF NOT EXISTS board_change_log/);
});

test("tech PIN sessions cannot reach the bot API", async () => {
  const secret = "test-secret";
  const cookie = (await createTechCookie(secret, "MC", "v1")).split(";")[0];
  for (const method of ["GET", "POST"]) {
    const request = new Request("https://deltaintelligence.cc/api/tech-board/bot", { method, headers: { cookie, authorization: "Bearer guessed" } });
    assert.equal((await techGate(request, secret, (c) => writerSessionValid(c, secret)))?.status, 403);
  }
});
