import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureSchema } from "../db/ensure-schema.ts";
import {
  ackTekmetricLabelJob,
  claimTekmetricLabelJobs,
  DEFAULT_TEKMETRIC_VERIFY_LABEL,
  enqueueTekmetricVerifyLabelJob,
  FAILED_RETRY_MS,
  resolveTekmetricVerifyLabel,
} from "../app/lib/tekmetric-verify-label.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relative) {
  return readFile(path.join(root, relative), "utf8");
}

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
          return {
            success: true,
            meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) },
          };
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

async function seedPendingVerification(d1, sqlite, roNumber = "4412") {
  await ensureSchema(d1);
  sqlite.prepare(`INSERT INTO ro_verification_cycles
    (ro_number, customer, vehicle, service_writer, detail_url, amount, section, diagnosed_at, status, verification_note, last_seen_at)
    VALUES (?, 'Taylor', '2018 Ford F-150', 'Writer',
      'https://shop.tekmetric.com/admin/shop/4326/repair-orders/4412/estimate',
      420, 'work-in-progress', '2026-09-17T12:00:00Z', 'pending', '', '2026-09-17T12:00:00Z')`).run(roNumber);
  sqlite.prepare(`INSERT INTO ro_diagnosis_watch (ro_number, needs_diag_present, last_label, last_seen_at)
    VALUES (?, 0, 'Verify Parts&Labor', '2026-09-17T12:00:00Z')`).run(roNumber);
  return sqlite.prepare("SELECT id FROM ro_verification_cycles WHERE ro_number = ?").get(roNumber).id;
}

test("default Verify label is the shop Job Board chip, overridable by env", async () => {
  assert.equal(DEFAULT_TEKMETRIC_VERIFY_LABEL, "Verified/Send Estimate");
  assert.equal(resolveTekmetricVerifyLabel({}), DEFAULT_TEKMETRIC_VERIFY_LABEL);
  assert.equal(resolveTekmetricVerifyLabel({ TEKMETRIC_VERIFY_LABEL: "  Verified / Send Estimate  " }), "Verified / Send Estimate");
  const config = await read("reader/config.py");
  assert.match(config, /"Verified\/Send Estimate"/);
  assert.doesNotMatch(config.slice(config.indexOf("JOB_BOARD_LABELS")), /"Verified",/);
});

test("markVerified enqueues a durable label job keyed by RO number", async () => {
  const { sqlite, d1 } = asD1();
  const id = await seedPendingVerification(d1, sqlite);
  const now = "2026-09-17T13:00:00Z";
  await d1.prepare(`UPDATE ro_verification_cycles SET
    status = 'verified', verified_at = ?, verified_by = ?, verification_note = ?
    WHERE id = ? AND status = 'pending'`).bind(now, "Delta shared login", "", id).run();
  const queued = await enqueueTekmetricVerifyLabelJob(d1, {
    verificationId: id,
    roNumber: "4412",
    detailUrl: "https://shop.tekmetric.com/admin/shop/4326/repair-orders/4412/estimate",
    targetLabel: resolveTekmetricVerifyLabel({}),
    nowIso: now,
  });
  assert.equal(queued.reused, false);
  assert.equal(queued.status, "pending");
  const job = sqlite.prepare("SELECT * FROM tekmetric_label_jobs WHERE ro_number = '4412'").get();
  assert.equal(job.target_label, "Verified/Send Estimate");
  assert.equal(job.status, "pending");
  assert.equal(job.current_label, "Verify Parts&Labor");
  const cycle = sqlite.prepare("SELECT * FROM ro_verification_cycles WHERE id = ?").get(id);
  assert.equal(cycle.status, "verified");
  assert.equal(cycle.tekmetric_label_status, "pending");
  assert.equal(cycle.tekmetric_label_target, "Verified/Send Estimate");
  const again = await enqueueTekmetricVerifyLabelJob(d1, {
    verificationId: id,
    roNumber: "4412",
    detailUrl: "https://shop.tekmetric.com/admin/shop/4326/repair-orders/4412",
    targetLabel: "Verified/Send Estimate",
    nowIso: "2026-09-17T13:01:00Z",
  });
  assert.equal(again.reused, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM tekmetric_label_jobs").get().n, 1);
});

test("shop reader can claim a job and ack success or failure", async () => {
  const { sqlite, d1 } = asD1();
  const id = await seedPendingVerification(d1, sqlite);
  await enqueueTekmetricVerifyLabelJob(d1, {
    verificationId: id,
    roNumber: "4412",
    detailUrl: "https://shop.tekmetric.com/admin/shop/4326/repair-orders/4412",
    targetLabel: "Verified/Send Estimate",
    nowIso: "2026-09-17T13:00:00Z",
  });
  const claimed = await claimTekmetricLabelJobs(d1, { nowIso: "2026-09-17T13:01:00Z", limit: 4 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].roNumber, "4412");
  assert.equal(claimed[0].targetLabel, "Verified/Send Estimate");
  const afterClaim = sqlite.prepare("SELECT tekmetric_label_status FROM ro_verification_cycles WHERE id = ?").get(id);
  assert.equal(afterClaim.tekmetric_label_status, "claimed");
  const empty = await claimTekmetricLabelJobs(d1, { nowIso: "2026-09-17T13:01:30Z" });
  assert.equal(empty.length, 0);

  const done = await ackTekmetricLabelJob(d1, {
    id: claimed[0].id, status: "done", nowIso: "2026-09-17T13:02:00Z",
  });
  assert.equal(done.ok, true);
  const synced = sqlite.prepare("SELECT tekmetric_label_status, tekmetric_label_error FROM ro_verification_cycles WHERE id = ?").get(id);
  assert.equal(synced.tekmetric_label_status, "synced");
  assert.equal(synced.tekmetric_label_error, "");
  const watch = sqlite.prepare("SELECT last_label FROM ro_diagnosis_watch WHERE ro_number = '4412'").get();
  assert.equal(watch.last_label, "Verified/Send Estimate");

  const { sqlite: sqlite2, d1: d12 } = asD1();
  const id2 = await seedPendingVerification(d12, sqlite2, "8801");
  await enqueueTekmetricVerifyLabelJob(d12, {
    verificationId: id2,
    roNumber: "8801",
    targetLabel: "Verified/Send Estimate",
    nowIso: "2026-09-17T13:00:00Z",
  });
  const [failedJob] = await claimTekmetricLabelJobs(d12, { nowIso: "2026-09-17T13:01:00Z" });
  await ackTekmetricLabelJob(d12, {
    id: failedJob.id, status: "failed", error: "Could not find the Tekmetric label control",
    nowIso: "2026-09-17T13:02:00Z",
  });
  const failed = sqlite2.prepare("SELECT tekmetric_label_status, tekmetric_label_error FROM ro_verification_cycles WHERE id = ?").get(id2);
  assert.equal(failed.tekmetric_label_status, "failed");
  assert.match(failed.tekmetric_label_error, /label control/);
});

test("failed jobs are retried after a cooldown and sign-in acks unclaim without burning the RO", async () => {
  const { sqlite, d1 } = asD1();
  const id = await seedPendingVerification(d1, sqlite);
  await enqueueTekmetricVerifyLabelJob(d1, {
    verificationId: id,
    roNumber: "4412",
    targetLabel: "Verified/Send Estimate",
    nowIso: "2026-09-17T13:00:00Z",
  });
  const [job] = await claimTekmetricLabelJobs(d1, { nowIso: "2026-09-17T13:01:00Z" });
  await ackTekmetricLabelJob(d1, {
    id: job.id, status: "retry", error: "Tekmetric needs sign-in on the shop PC.",
    nowIso: "2026-09-17T13:01:10Z",
  });
  const pending = sqlite.prepare("SELECT status, attempts, tekmetric_label_jobs.last_error AS err FROM tekmetric_label_jobs").get();
  assert.equal(pending.status, "pending");
  assert.equal(pending.attempts, 0);
  await ackTekmetricLabelJob(d1, {
    id: job.id, status: "failed", error: "temporary", nowIso: "2026-09-17T13:02:00Z",
  });
  const tooSoon = await claimTekmetricLabelJobs(d1, { nowIso: "2026-09-17T13:03:00Z" });
  assert.equal(tooSoon.length, 0);
  const later = new Date(Date.parse("2026-09-17T13:02:00Z") + FAILED_RETRY_MS + 1000).toISOString();
  const retried = await claimTekmetricLabelJobs(d1, { nowIso: later });
  assert.equal(retried.length, 1);
});

test("Verify UI and reader still work if the shop PC is offline", async () => {
  const page = await read("app/page.tsx");
  const view = await read("app/components/views/VerifyQueueView.tsx");
  const route = await read("app/api/verifications/route.ts");
  const reader = await read("reader/reader.py");
  assert.match(route, /enqueueTekmetricVerifyLabelJob/);
  assert.match(route, /status = 'verified'/);
  assert.match(route, /Dashboard Verify still succeeds/);
  assert.match(page, /next shop-reader cycle/);
  assert.match(view, /waiting for shop reader/);
  assert.match(view, /Tekmetric label failed/);
  assert.match(reader, /sync_tekmetric_label_jobs/);
  assert.match(reader, /apply_via_job_board_card/);
  assert.match(reader, /JOB_BOARD_URL/);
  assert.match(reader, /board=ACTIVE/);
  assert.match(reader, /raise_if_tekmetric_signin/);
  assert.match(reader, /action": "claim"/);
  assert.doesNotMatch(reader, /TEKMETRIC_PASSWORD|tekmetric_password/);
  const jobsRoute = await read("app/api/tekmetric-label-jobs/route.ts");
  assert.match(jobsRoute, /x-reader-key/);
  assert.doesNotMatch(jobsRoute, /requireApiUser/);
  const readme = await read("README.md");
  assert.match(readme, /TEKMETRIC_VERIFY_LABEL/);
  assert.match(readme, /Verified\/Send Estimate/);
});
