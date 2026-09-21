/**
 * Dashboard Verify → shop-PC Tekmetric label.
 *
 * Tekmetric has no public write API for this shop. markVerified stores a
 * durable job; the signed-in Windows reader applies the label in the UI.
 *
 * Shop Job Board label (reader/config.py JOB_BOARD_LABELS):
 *   "Verified/Send Estimate"
 * Incoming queue tags ("Verify", "Verify Parts&Labor") mean *needs* review.
 * After GM clicks Verified, the outgoing tag is Verified/Send Estimate.
 *
 * Override without a code change: Worker env/secret TEKMETRIC_VERIFY_LABEL.
 */

export const DEFAULT_TEKMETRIC_VERIFY_LABEL = "Verified/Send Estimate";
export const MAX_TEKMETRIC_LABEL_ATTEMPTS = 6;
export const STALE_CLAIM_MS = 15 * 60 * 1000;
export const FAILED_RETRY_MS = 8 * 60 * 1000;
export const DEFAULT_CLAIM_LIMIT = 4;

export type TekmetricLabelJobStatus = "pending" | "claimed" | "done" | "failed";
export type TekmetricLabelSyncStatus = "" | "pending" | "claimed" | "synced" | "failed";

export type TekmetricLabelJobRow = {
  id: number;
  ro_number: string;
  verification_id: number | null;
  target_label: string;
  current_label: string;
  detail_url: string;
  status: string;
  attempts: number;
  claimed_at: string | null;
  completed_at: string | null;
  last_error: string;
  created_at: string;
  updated_at: string;
};

export type TekmetricLabelJob = {
  id: number;
  roNumber: string;
  verificationId: number | null;
  targetLabel: string;
  currentLabel: string;
  detailUrl: string;
  status: string;
  attempts: number;
};

export function resolveTekmetricVerifyLabel(env?: Record<string, unknown> | null): string {
  const raw = typeof env?.TEKMETRIC_VERIFY_LABEL === "string" ? env.TEKMETRIC_VERIFY_LABEL.trim() : "";
  return raw.slice(0, 80) || DEFAULT_TEKMETRIC_VERIFY_LABEL;
}

export function mapTekmetricLabelJob(row: TekmetricLabelJobRow): TekmetricLabelJob {
  return {
    id: Number(row.id),
    roNumber: String(row.ro_number),
    verificationId: row.verification_id == null ? null : Number(row.verification_id),
    targetLabel: String(row.target_label || ""),
    currentLabel: String(row.current_label || ""),
    detailUrl: String(row.detail_url || ""),
    status: String(row.status || ""),
    attempts: Number(row.attempts) || 0,
  };
}

function isoMinutesAgo(nowIso: string, ms: number): string {
  const now = Date.parse(nowIso);
  const value = Number.isFinite(now) ? now : Date.now();
  return new Date(value - ms).toISOString();
}

export async function enqueueTekmetricVerifyLabelJob(
  database: D1Database,
  options: {
    verificationId: number;
    roNumber: string;
    detailUrl?: string;
    targetLabel: string;
    nowIso?: string;
  },
): Promise<{ jobId: number; reused: boolean; status: TekmetricLabelJobStatus }> {
  const nowIso = options.nowIso || new Date().toISOString();
  const roNumber = String(options.roNumber || "").trim();
  const targetLabel = String(options.targetLabel || "").trim().slice(0, 80);
  const detailUrl = String(options.detailUrl || "").trim().slice(0, 1000);
  if (!roNumber || !targetLabel) {
    throw new Error("Tekmetric label job needs an RO number and target label.");
  }

  const watch = await database.prepare(
    "SELECT last_label FROM ro_diagnosis_watch WHERE ro_number = ?",
  ).bind(roNumber).first<{ last_label?: string }>();
  const currentLabel = String(watch?.last_label || "").slice(0, 80);

  const existing = await database.prepare(`
    SELECT id, status FROM tekmetric_label_jobs
    WHERE ro_number = ? AND target_label = ? AND status IN ('pending', 'claimed')
    ORDER BY id DESC LIMIT 1
  `).bind(roNumber, targetLabel).first<{ id: number; status: string }>();

  if (existing?.id) {
    await database.prepare(`
      UPDATE tekmetric_label_jobs SET
        verification_id = ?,
        detail_url = CASE WHEN ? = '' THEN detail_url ELSE ? END,
        current_label = CASE WHEN ? = '' THEN current_label ELSE ? END,
        updated_at = ?
      WHERE id = ?
    `).bind(
      options.verificationId, detailUrl, detailUrl, currentLabel, currentLabel, nowIso, existing.id,
    ).run();
    const syncStatus = existing.status === "claimed" ? "claimed" : "pending";
    await database.prepare(`
      UPDATE ro_verification_cycles SET
        tekmetric_label_status = ?,
        tekmetric_label_target = ?,
        tekmetric_label_error = '',
        tekmetric_label_updated_at = ?,
        tekmetric_label_job_id = ?
      WHERE id = ?
    `).bind(syncStatus, targetLabel, nowIso, existing.id, options.verificationId).run();
    return {
      jobId: Number(existing.id),
      reused: true,
      status: existing.status === "claimed" ? "claimed" : "pending",
    };
  }

  const inserted = await database.prepare(`
    INSERT INTO tekmetric_label_jobs (
      ro_number, verification_id, target_label, current_label, detail_url,
      status, attempts, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, '', ?, ?)
  `).bind(
    roNumber, options.verificationId, targetLabel, currentLabel, detailUrl, nowIso, nowIso,
  ).run();
  let jobId = Number(inserted.meta?.last_row_id || 0);
  if (!jobId) {
    const created = await database.prepare(`
      SELECT id FROM tekmetric_label_jobs
      WHERE ro_number = ? AND target_label = ? AND created_at = ?
      ORDER BY id DESC LIMIT 1
    `).bind(roNumber, targetLabel, nowIso).first<{ id: number }>();
    jobId = Number(created?.id || 0);
  }
  await database.prepare(`
    UPDATE ro_verification_cycles SET
      tekmetric_label_status = 'pending',
      tekmetric_label_target = ?,
      tekmetric_label_error = '',
      tekmetric_label_updated_at = ?,
      tekmetric_label_job_id = ?
    WHERE id = ?
  `).bind(targetLabel, nowIso, jobId || null, options.verificationId).run();
  return { jobId, reused: false, status: "pending" };
}

export async function claimTekmetricLabelJobs(
  database: D1Database,
  options?: { nowIso?: string; limit?: number },
): Promise<TekmetricLabelJob[]> {
  const nowIso = options?.nowIso || new Date().toISOString();
  const limit = Math.min(10, Math.max(1, Math.floor(options?.limit || DEFAULT_CLAIM_LIMIT)));
  const staleBefore = isoMinutesAgo(nowIso, STALE_CLAIM_MS);
  const retryFailedBefore = isoMinutesAgo(nowIso, FAILED_RETRY_MS);

  const candidates = await database.prepare(`
    SELECT id FROM tekmetric_label_jobs
    WHERE status = 'pending'
       OR (status = 'claimed' AND (claimed_at IS NULL OR claimed_at < ?))
       OR (status = 'failed' AND attempts < ? AND updated_at < ?)
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(staleBefore, MAX_TEKMETRIC_LABEL_ATTEMPTS, retryFailedBefore, limit)
    .all<{ id: number }>();

  const claimed: TekmetricLabelJob[] = [];
  for (const row of candidates.results) {
    const result = await database.prepare(`
      UPDATE tekmetric_label_jobs
      SET status = 'claimed', claimed_at = ?, updated_at = ?, attempts = attempts + 1
      WHERE id = ? AND status IN ('pending', 'claimed', 'failed')
    `).bind(nowIso, nowIso, row.id).run();
    if (!result.meta.changes) continue;

    const job = await database.prepare(
      "SELECT * FROM tekmetric_label_jobs WHERE id = ?",
    ).bind(row.id).first<TekmetricLabelJobRow>();
    if (!job) continue;

    if (job.verification_id) {
      await database.prepare(`
        UPDATE ro_verification_cycles SET
          tekmetric_label_status = 'claimed',
          tekmetric_label_updated_at = ?,
          tekmetric_label_job_id = ?
        WHERE id = ?
      `).bind(nowIso, job.id, job.verification_id).run();
    }
    claimed.push(mapTekmetricLabelJob(job));
  }
  return claimed;
}

export async function ackTekmetricLabelJob(
  database: D1Database,
  options: {
    id: number;
    status: "done" | "failed" | "retry";
    error?: string;
    nowIso?: string;
  },
): Promise<{ ok: boolean; job: TekmetricLabelJob | null }> {
  const nowIso = options.nowIso || new Date().toISOString();
  const id = Math.floor(Number(options.id));
  if (!id || id < 1) return { ok: false, job: null };

  const existing = await database.prepare(
    "SELECT * FROM tekmetric_label_jobs WHERE id = ?",
  ).bind(id).first<TekmetricLabelJobRow>();
  if (!existing) return { ok: false, job: null };

  const errorText = String(options.error || "").trim().slice(0, 500);
  if (options.status === "retry") {
    await database.prepare(`
      UPDATE tekmetric_label_jobs SET
        status = 'pending',
        claimed_at = NULL,
        attempts = MAX(0, attempts - 1),
        last_error = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(errorText, nowIso, id).run();
  } else {
    const nextStatus = options.status === "done" ? "done" : "failed";
    await database.prepare(`
      UPDATE tekmetric_label_jobs SET
        status = ?,
        completed_at = ?,
        last_error = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(nextStatus, nowIso, errorText, nowIso, id).run();
  }

  const job = await database.prepare(
    "SELECT * FROM tekmetric_label_jobs WHERE id = ?",
  ).bind(id).first<TekmetricLabelJobRow>();
  if (!job) return { ok: false, job: null };

  const verificationId = job.verification_id;
  if (verificationId) {
    const syncStatus = options.status === "done"
      ? "synced"
      : options.status === "retry"
        ? "pending"
        : "failed";
    await database.prepare(`
      UPDATE ro_verification_cycles SET
        tekmetric_label_status = ?,
        tekmetric_label_target = ?,
        tekmetric_label_error = ?,
        tekmetric_label_updated_at = ?,
        tekmetric_label_job_id = ?
      WHERE id = ?
    `).bind(syncStatus, job.target_label, errorText, nowIso, job.id, verificationId).run();
  }

  if (options.status === "done" && job.ro_number && job.target_label) {
    await database.prepare(`
      UPDATE ro_diagnosis_watch SET last_label = ?, last_seen_at = ?
      WHERE ro_number = ?
    `).bind(job.target_label, nowIso, job.ro_number).run();
  }

  return { ok: true, job: mapTekmetricLabelJob(job) };
}
