import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleApi, HttpError, jsonError, readJson } from "../app/lib/api-errors.ts";
import { ensureSchema, requireD1 } from "../db/ensure-schema.ts";

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
          sqlite.prepare(sql).run(...bound);
          return { success: true };
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
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return { sqlite, d1 };
}

function columnNames(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

test("requireD1 explains a missing Sites→Worker binding", () => {
  assert.throws(() => requireD1(undefined), /binding `DB` is unavailable/);
});

test("ensureSchema creates reader write tables on an empty database", async () => {
  const { sqlite, d1 } = asD1();
  await ensureSchema(d1);
  for (const table of ["shop_snapshots", "reader_status", "schedule_snapshots", "schedule_capture_request"]) {
    assert.ok(columnNames(sqlite, table).length > 0, table);
  }
  await d1.prepare(`
    INSERT INTO shop_snapshots
      (start_date, end_date, total_sales, gross_profit, labor_sales, technicians_json, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind("2026-09-09", "2026-09-15", 1200, 800, 400, '{"period":"weekly","technicians":[{"name":"Beau"}]}', "2026-09-16T12:00:00Z").run();
  await d1.prepare(`
    INSERT INTO reader_status (id, status, detail, updated_at, version, build_hash)
    VALUES (1, ?, ?, ?, ?, ?)
  `).bind("ok", "running", "2026-09-16T12:00:00Z", "2.0.0", "bef75f17f257").run();
  await d1.prepare(`
    INSERT INTO schedule_snapshots
      (schedule_date, hour_key, hour_label, employees_json, appointments_json, raw_text, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind("2026-09-16", "0800", "8:00 AM", "[]", "[]", "", "2026-09-16T13:00:00Z").run();
  const status = await d1.prepare(
    "SELECT status, version, build_hash FROM reader_status WHERE id = 1",
  ).first();
  assert.equal(status.status, "ok");
  assert.equal(status.build_hash, "bef75f17f257");
});

test("ensureSchema adds missing columns on a Sites-era reader_status and shop_snapshots table", async () => {
  const { sqlite, d1 } = asD1();
  sqlite.exec(`
    CREATE TABLE reader_status (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO reader_status (id, status, detail, updated_at)
      VALUES (1, 'ok', 'legacy row', '2026-01-01T00:00:00Z');
    CREATE TABLE shop_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      total_sales REAL NOT NULL,
      gross_profit REAL NOT NULL,
      labor_sales REAL NOT NULL,
      technicians_json TEXT NOT NULL
    );
  `);
  await ensureSchema(d1);
  assert.ok(columnNames(sqlite, "reader_status").includes("version"));
  assert.ok(columnNames(sqlite, "reader_status").includes("build_hash"));
  assert.ok(columnNames(sqlite, "shop_snapshots").includes("captured_at"));
  const row = await d1.prepare(
    "SELECT status, detail, updated_at, version, build_hash FROM reader_status WHERE id = 1",
  ).first();
  assert.equal(row.status, "ok");
  assert.equal(row.version, "");
  await d1.prepare(`
    INSERT INTO shop_snapshots
      (start_date, end_date, total_sales, gross_profit, labor_sales, technicians_json, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind("2026-09-09", "2026-09-15", 1, 1, 1, '{"period":"weekly","technicians":[{"name":"Mario"}]}', "2026-09-16T12:00:00Z").run();
});

test("a single failed CREATE INDEX in one D1 batch rolls back new reader tables", async () => {
  const { sqlite, d1 } = asD1();
  sqlite.exec(`
    CREATE TABLE shop_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      total_sales REAL NOT NULL,
      gross_profit REAL NOT NULL,
      labor_sales REAL NOT NULL,
      technicians_json TEXT NOT NULL
    );
  `);
  await assert.rejects(async () => {
    await d1.batch([
      d1.prepare(`CREATE TABLE IF NOT EXISTS reader_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL,
        detail TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '',
        build_hash TEXT NOT NULL DEFAULT ''
      )`),
      d1.prepare("CREATE INDEX IF NOT EXISTS shop_snapshots_captured_idx ON shop_snapshots(captured_at DESC)"),
    ]);
  });
  assert.equal(columnNames(sqlite, "reader_status").length, 0);
});

test("jsonError returns a body the Windows reader can log", async () => {
  const response = jsonError(new Error("no such table: reader_status"), "reader-status failed");
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "reader-status failed");
  assert.match(body.detail, /no such table: reader_status/);
});

test("handleApi turns thrown DB errors into JSON 500s instead of an empty body", async () => {
  const response = await handleApi("snapshot", async () => {
    throw new Error("D1_ERROR: no such table: shop_snapshots");
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "snapshot failed");
  assert.match(body.detail, /shop_snapshots/);
});

test("readJson rejects invalid bodies with HTTP 400", async () => {
  await assert.rejects(
    () => readJson(new Request("https://deltaintelligence.cc/api/snapshot", { method: "POST", body: "not-json" })),
    (error) => error instanceof HttpError && error.status === 400,
  );
});
