// Writer schedule inbox: a shared freeform "put this on the schedule" box.
// Board D1 only. Separate from Tech Board revisions and from pool / time-off requests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BOARD_SCHEDULE_REQUESTS_SQL, newScheduleRequest, rowToScheduleRequest, scheduleRequestAck } from "../app/tech-board/schedule-requests.ts";
import { scheduleRequestMessage } from "../app/tech-board/events.ts";
import { botToBoardAction } from "../app/lib/bot-auth.ts";
import { createTechCookie, techGate, writerSessionValid } from "../app/lib/tech-session.ts";
import { APP_VERSION } from "../app/lib/version.ts";

const src = (path) => readFileSync(path, "utf8");

test("build version is v1.6.20 (schedule inbox)", () => {
  assert.equal(APP_VERSION, "v1.6.20");
});

test("a schedule need is freeform text plus a writer name, and never a typed tech identity", () => {
  const devin = newScheduleRequest({ text: "  Put Bradley 38468 on Andrew this afternoon  ", name: "Ignored" }, { name: "Devin" });
  assert.deepEqual(devin, { text: "Put Bradley 38468 on Andrew this afternoon", submitter: "Devin", source: "writer" });
  assert.equal(newScheduleRequest({ text: "Recheck House on Andrew today" }, {}).submitter, "Writer");
  assert.equal(newScheduleRequest({ text: "From Teams", name: "Kody" }, { source: "teams-bot" }).source, "teams-bot");
  // A writer cannot label their own note as the bot by stuffing source into the body.
  assert.equal(newScheduleRequest({ text: "Not from Teams", source: "teams-bot" }, { name: "Andrea" }).source, "writer");
  assert.ok("error" in newScheduleRequest({ text: "  no " }, { name: "Devin" }));
  assert.ok("error" in newScheduleRequest({ text: "" }, {}));
});

test("ack is once: missing is 404, already done is 409", () => {
  const open = { id: 4, text: "Put Bradley 38468 on Andrew this afternoon", submitter: "Devin", source: "writer", status: "open", createdAt: "", updatedAt: "", doneBy: "", doneAt: null };
  assert.deepEqual(scheduleRequestAck(open, " Kody "), { id: 4, doneBy: "Kody" });
  assert.equal(scheduleRequestAck(open, "   ").doneBy, "Writer");
  assert.deepEqual(scheduleRequestAck(null, "Kody"), { error: "Schedule request not found", status: 404 });
  assert.equal(scheduleRequestAck({ ...open, status: "done" }, "Kody").status, 409);
});

test("board_schedule_requests round-trips and is in the tech board schema, migration 0005, and ensureSchema", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(BOARD_SCHEDULE_REQUESTS_SQL);
  db.prepare(`INSERT INTO board_schedule_requests (text, submitter, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run("Recheck House on Andrew today", "Andrea", "writer", "2026-11-06T15:00:00Z", "2026-11-06T15:00:00Z");
  const row = rowToScheduleRequest(db.prepare(`SELECT * FROM board_schedule_requests`).get());
  assert.equal(row.status, "open");
  assert.equal(row.doneBy, "");
  assert.equal(row.doneAt, null);
  assert.equal(row.submitter, "Andrea");
  db.prepare(`UPDATE board_schedule_requests SET status = 'done', done_by = ?, done_at = ? WHERE id = ?`).run("Devin", "2026-11-06T16:00:00Z", row.id);
  const done = rowToScheduleRequest(db.prepare(`SELECT * FROM board_schedule_requests`).get());
  assert.equal(done.status, "done");
  assert.equal(done.doneBy, "Devin");
  assert.match(src("drizzle/0005_board_schedule_requests.sql"), /CREATE TABLE IF NOT EXISTS board_schedule_requests/);
  assert.match(src("db/ensure-schema.ts"), /CREATE TABLE IF NOT EXISTS board_schedule_requests/);
  assert.match(src("app/tech-board/store.ts"), /BOARD_SCHEDULE_REQUESTS_SQL,/);
  assert.match(src("drizzle/meta/_journal.json"), /0005_board_schedule_requests/);
});

test("Teams copy names the schedule request and does not look like a revision suggestion", () => {
  assert.equal(scheduleRequestMessage({ change: "new", id: 12, submitter: "Devin", text: "Put Bradley 38468 on Andrew this afternoon" }),
    "Schedule request #12 from Devin: Put Bradley 38468 on Andrew this afternoon");
  assert.equal(scheduleRequestMessage({ change: "done", id: 12, submitter: "Devin", text: "Put Bradley 38468 on Andrew this afternoon", doneBy: "Kody" }),
    "Schedule request #12 from Devin marked done by Kody: Put Bradley 38468 on Andrew this afternoon");
  assert.match(scheduleRequestMessage({ change: "new", id: 1, submitter: "", text: "x" }), /from Writer/);
});

test("the writer Tech Board shows the schedule box; /tech, scorecards, and the revision box stay separate", () => {
  const panel = src("app/tech-board/TechBoardPanel.tsx");
  const box = src("app/tech-board/ScheduleRequestBox.tsx");
  assert.match(panel, /ScheduleRequestBox/);
  assert.match(panel, /schedule-request-add/);
  assert.match(panel, /schedule-request-ack/);
  assert.match(box, /Need it on the schedule/);
  assert.match(box, /not a Tech Board revision/);
  assert.doesNotMatch(box, /Send suggestion/);
  assert.match(src("app/tech-board/SuggestionBox.tsx"), /Tech Board revisions/);
  assert.doesNotMatch(src("app/tech-board/TechPage.tsx"), /ScheduleRequestBox|schedule-request/);
  assert.doesNotMatch(src("app/tech/page.tsx"), /ScheduleRequestBox|schedule-request/);
  assert.doesNotMatch(src("app/components/views/WritersView.tsx"), /ScheduleRequestBox|schedule-request/);
  assert.doesNotMatch(src("app/api/tech/route.ts"), /schedule-request|board_schedule_requests/);
});

test("bot list/create/ack use the existing bearer API and do not place the job", () => {
  assert.deepEqual(botToBoardAction({ action: "add-schedule-request", text: "  Recheck House on Andrew today  ", by: "Andrea" }),
    { action: "schedule-request-add", text: "Recheck House on Andrew today", name: "Andrea" });
  assert.deepEqual(botToBoardAction({ action: "ack-schedule-request", id: 7, by: "Kody" }),
    { action: "schedule-request-ack", id: 7, name: "Kody" });
  assert.equal(botToBoardAction({ action: "done-schedule-request", id: 7 }).action, "schedule-request-ack");
  assert.ok("error" in botToBoardAction({ action: "add-schedule-request", text: "no" }));
  assert.ok("error" in botToBoardAction({ action: "ack-schedule-request" }));
  assert.ok("error" in botToBoardAction({ action: "list-schedule-requests" }));
  const route = src("app/api/tech-board/bot/route.ts");
  assert.match(route, /list-schedule-requests/);
  assert.match(route, /loadScheduleRequests\(db, body\.includeDone === true \? "inbox" : "open"\)/);
  assert.match(route, /scheduleRequests:/);
  assert.match(route, /data\.scheduleRequest/);
  assert.match(src("docs/bot-api.md"), /add-schedule-request/);
  assert.match(src("docs/bot-api.md"), /ack-schedule-request/);
  const actions = src("app/tech-board/actions.ts");
  const add = actions.slice(actions.indexOf('body.action === "schedule-request-add"'), actions.indexOf('body.action === "schedule-request-ack"'));
  assert.match(add, /recordScheduleRequestEvent/);
  assert.match(add, /return Response\.json/);
  assert.doesNotMatch(add, /recomputeTechBoard|add-custom|UPDATE board_jobs/);
  for (const file of ["app/tech-board/schedule-requests.ts", "app/tech-board/ScheduleRequestBox.tsx", "app/api/tech-board/bot/route.ts"]) {
    assert.doesNotMatch(src(file), /tekmetric\.com|markVerified|shop\.tekmetric/i, file);
  }
});

test("a tech PIN session still cannot post schedule requests through the writer or bot API", async () => {
  const secret = "test-secret";
  const cookie = (await createTechCookie(secret, "MC", "v1")).split(";")[0];
  const gate = (path, method = "POST") => techGate(new Request(`https://deltaintelligence.cc${path}`, { method, headers: { cookie } }), secret, (c) => writerSessionValid(c, secret));
  assert.equal((await gate("/api/tech-board"))?.status, 403);
  assert.equal((await gate("/api/tech-board/bot", "GET"))?.status, 403);
  assert.equal(await gate("/api/tech"), null);
});
