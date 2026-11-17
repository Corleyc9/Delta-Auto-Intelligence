// v1.6.18: Bay Scan scans + RO VINs (board D1 only). v1.6.21 adds the Tekmetric attach-job queue.
// Pure so it is unit-testable with node:sqlite.
import { normalizeStoredScan, type BayScan, type RoScanView } from "./bayscan.ts";
type Bound = { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
type Stmt = Bound & { bind(...values: unknown[]): Bound };
type D1 = { prepare(sql: string): Stmt };

export const BAYSCAN_SQL = [
  `CREATE TABLE IF NOT EXISTS board_bayscan_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, vin TEXT NOT NULL, scan_json TEXT NOT NULL,
    ro TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unmatched', match_count INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL,
    attached_by TEXT NOT NULL DEFAULT '', attached_at TEXT NOT NULL DEFAULT '',
    tek_status TEXT NOT NULL DEFAULT '', tek_error TEXT NOT NULL DEFAULT '', tek_job_id INTEGER, tek_filename TEXT NOT NULL DEFAULT '', tek_updated_at TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS board_bayscan_scans_status_idx ON board_bayscan_scans (status, id)`,
  `CREATE TABLE IF NOT EXISTS board_ro_vin (ro TEXT PRIMARY KEY, vin TEXT NOT NULL, set_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS board_bayscan_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id INTEGER NOT NULL UNIQUE, ro_number TEXT NOT NULL,
    customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '', vin TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '',
    file_key TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_type TEXT NOT NULL DEFAULT 'application/pdf',
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, completed_at TEXT,
    last_error TEXT NOT NULL DEFAULT '', next_attempt_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS board_bayscan_jobs_status_idx ON board_bayscan_jobs (status, id)`,
];
/** Columns added after the first Bay Scan release. "duplicate column" on a current table is expected. */
export const BAYSCAN_ALTER = [
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_status TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_error TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_job_id INTEGER`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_filename TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_updated_at TEXT NOT NULL DEFAULT ''`,
];

export type StoredScan = { id: number; deviceId: string; vin: string; scan: BayScan; ro: string; status: "matched" | "unmatched" | "attached" | "dismissed";
  matchCount: number; receivedAt: string; attachedBy: string; attachedAt: string;
  tekStatus: string; tekError: string; tekJobId: number; tekFilename: string; tekUpdatedAt: string };

export type BayScanJob = {
  id: number; scanId: number; roNumber: string; customer: string; vehicle: string; vin: string; detailUrl: string;
  fileKey: string; filename: string; contentType: string; status: string; attempts: number; claimedAt: string;
  completedAt: string; lastError: string; nextAttemptAt: string; createdAt: string; updatedAt: string;
};

const row2scan = (row: Record<string, unknown>): StoredScan => ({ id: Number(row.id), deviceId: String(row.device_id), vin: String(row.vin),
  scan: normalizeStoredScan(JSON.parse(String(row.scan_json || "{}"))), ro: String(row.ro || ""), status: String(row.status) as StoredScan["status"], matchCount: Number(row.match_count || 0),
  receivedAt: String(row.received_at), attachedBy: String(row.attached_by || ""), attachedAt: String(row.attached_at || ""),
  tekStatus: String(row.tek_status || ""), tekError: String(row.tek_error || ""), tekJobId: Number(row.tek_job_id || 0),
  tekFilename: String(row.tek_filename || ""), tekUpdatedAt: String(row.tek_updated_at || "") });

const row2job = (row: Record<string, unknown>): BayScanJob => ({
  id: Number(row.id), scanId: Number(row.scan_id), roNumber: String(row.ro_number || ""), customer: String(row.customer || ""),
  vehicle: String(row.vehicle || ""), vin: String(row.vin || ""), detailUrl: String(row.detail_url || ""),
  fileKey: String(row.file_key || ""), filename: String(row.filename || ""), contentType: String(row.content_type || "application/pdf"),
  status: String(row.status || ""), attempts: Number(row.attempts || 0), claimedAt: String(row.claimed_at || ""),
  completedAt: String(row.completed_at || ""), lastError: String(row.last_error || ""), nextAttemptAt: String(row.next_attempt_at || ""),
  createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
});

/** D1 reports meta.changes; node:sqlite reports changes. Missing either means "assume it wrote". */
export function wrote(result: unknown) {
  if (!result || typeof result !== "object") return true;
  const row = result as { changes?: number; meta?: { changes?: number } };
  if (typeof row.meta?.changes === "number") return row.meta.changes > 0;
  if (typeof row.changes === "number") return row.changes > 0;
  return true;
}

export async function saveScan(db: D1, scan: BayScan, ro: string, matchCount: number, now: string) {
  await db.prepare(`INSERT INTO board_bayscan_scans (device_id, vin, scan_json, ro, status, match_count, received_at, attached_by, attached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(scan.deviceId, scan.vin, JSON.stringify(scan), ro, ro ? "matched" : "unmatched", matchCount, now, ro ? `Bay Scan ${scan.deviceId}` : "", ro ? now : "").run();
  const row = await db.prepare(`SELECT id FROM board_bayscan_scans WHERE device_id = ? AND received_at = ? ORDER BY id DESC LIMIT 1`).bind(scan.deviceId, now).first<Record<string, unknown>>();
  return row ? Number(row.id) : 0;
}
export async function getScan(db: D1, id: number) {
  const row = await db.prepare(`SELECT * FROM board_bayscan_scans WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? row2scan(row) : null;
}
export async function loadUnmatchedScans(db: D1) {
  const rows = await db.prepare(`SELECT * FROM board_bayscan_scans WHERE status = 'unmatched' ORDER BY id DESC LIMIT 100`).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.map(row2scan);
}
/** Unmatched scans still inside the retry window, oldest first. */
export async function loadRematchScans(db: D1, receivedAfter: string) {
  const rows = await db.prepare(`SELECT * FROM board_bayscan_scans WHERE status = 'unmatched' AND received_at >= ? ORDER BY id ASC LIMIT 500`)
    .bind(receivedAfter).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.map(row2scan);
}
export async function markScan(db: D1, id: number, status: "attached" | "dismissed", ro: string, by: string, now: string) {
  await db.prepare(`UPDATE board_bayscan_scans SET status = ?, ro = ?, attached_by = ?, attached_at = ? WHERE id = ? AND status = 'unmatched'`).bind(status, ro, by.slice(0, 120), now, id).run();
  return getScan(db, id);
}
/** unmatched → attached, once. A second caller loses and must not attach again. */
export async function claimScanForRo(db: D1, id: number, ro: string, by: string, now: string) {
  const result = await db.prepare(`UPDATE board_bayscan_scans SET status = 'attached', ro = ?, attached_by = ?, attached_at = ? WHERE id = ? AND status = 'unmatched'`)
    .bind(ro, by.slice(0, 120), now, id).run();
  return wrote(result);
}
/** Put a scan back on the unmatched list when attach failed before the check-in was saved. */
export async function releaseScanClaim(db: D1, id: number, now: string) {
  await db.prepare(`UPDATE board_bayscan_scans SET status = 'unmatched', ro = '', attached_by = '', attached_at = '' WHERE id = ? AND status = 'attached' AND attached_at = ?`)
    .bind(id, now).run();
}
export async function setScanTek(db: D1, id: number, status: string, error: string, jobId: number, filename: string, now: string) {
  await db.prepare(`UPDATE board_bayscan_scans SET tek_status = ?, tek_error = ?, tek_job_id = ?, tek_filename = ?, tek_updated_at = ? WHERE id = ?`)
    .bind(status, error.slice(0, 500), jobId || null, filename.slice(0, 180), now, id).run();
}
/** Latest attached/matched scan per RO, for the ticket drawer. */
export async function loadRoScans(db: D1): Promise<Record<string, RoScanView>> {
  const rows = await db.prepare(`SELECT * FROM board_bayscan_scans WHERE status IN ('matched', 'attached') AND ro <> '' ORDER BY id DESC LIMIT 400`)
    .all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  const out: Record<string, RoScanView> = {};
  for (const row of rows.results) {
    const scan = row2scan(row);
    if (!scan.ro || out[scan.ro]) continue;
    out[scan.ro] = { id: scan.id, tekStatus: scan.tekStatus, tekError: scan.tekError, modules: scan.scan.modules, readinessSummary: scan.scan.readinessSummary };
  }
  return out;
}
export async function scansMissingJobs(db: D1) {
  const rows = await db.prepare(`SELECT s.id FROM board_bayscan_scans s LEFT JOIN board_bayscan_jobs j ON j.scan_id = s.id
    WHERE s.status IN ('matched', 'attached') AND s.ro <> '' AND j.id IS NULL ORDER BY s.id ASC LIMIT 50`)
    .all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.map((row) => Number(row.id));
}
export async function loadRoVins(db: D1) {
  const rows = await db.prepare(`SELECT ro, vin FROM board_ro_vin`).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return new Map(rows.results.map((row) => [String(row.ro), String(row.vin)]));
}
export async function setRoVin(db: D1, ro: string, vin: string, by: string, now: string) {
  if (!vin) { await db.prepare(`DELETE FROM board_ro_vin WHERE ro = ?`).bind(ro).run(); return; }
  await db.prepare(`INSERT INTO board_ro_vin (ro, vin, set_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(ro) DO UPDATE SET vin = excluded.vin, set_by = excluded.set_by, updated_at = excluded.updated_at`)
    .bind(ro, vin, by.slice(0, 120), now).run();
}

export async function getBayScanJob(db: D1, id: number) {
  const row = await db.prepare(`SELECT * FROM board_bayscan_jobs WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? row2job(row) : null;
}
export async function getBayScanJobByScan(db: D1, scanId: number) {
  const row = await db.prepare(`SELECT * FROM board_bayscan_jobs WHERE scan_id = ?`).bind(scanId).first<Record<string, unknown>>();
  return row ? row2job(row) : null;
}
export async function insertBayScanJob(db: D1, job: { scanId: number; roNumber: string; customer: string; vehicle: string; vin: string; detailUrl: string; fileKey: string; filename: string; contentType: string }, now: string) {
  await db.prepare(`INSERT INTO board_bayscan_jobs (scan_id, ro_number, customer, vehicle, vin, detail_url, file_key, filename, content_type, status, attempts, last_error, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', ?, ?)
    ON CONFLICT(scan_id) DO NOTHING`)
    .bind(job.scanId, job.roNumber, job.customer.slice(0, 120), job.vehicle.slice(0, 160), job.vin, job.detailUrl.slice(0, 1000), job.fileKey, job.filename, job.contentType, now, now).run();
  return getBayScanJobByScan(db, job.scanId);
}
export async function claimableBayScanJobs(db: D1, nowIso: string, staleBefore: string, maxAttempts: number, limit: number) {
  const rows = await db.prepare(`SELECT id FROM board_bayscan_jobs
    WHERE (status = 'pending' AND attempts < ? AND (next_attempt_at = '' OR next_attempt_at <= ?))
       OR (status = 'claimed' AND attempts < ? AND (claimed_at IS NULL OR claimed_at < ?))
    ORDER BY id ASC LIMIT ?`).bind(maxAttempts, nowIso, maxAttempts, staleBefore, limit).all<Record<string, unknown>>();
  return rows.results.map((row) => Number(row.id));
}
/** A claim the reader never acked, already out of attempts, becomes a visible failure. */
export async function failAbandonedBayScanJobs(db: D1, maxAttempts: number, staleBefore: string, now: string) {
  const rows = await db.prepare(`SELECT id, scan_id, filename, last_error FROM board_bayscan_jobs
    WHERE status = 'claimed' AND attempts >= ? AND (claimed_at IS NULL OR claimed_at < ?)`).bind(maxAttempts, staleBefore).all<Record<string, unknown>>();
  for (const row of rows.results) {
    const error = String(row.last_error || "Gave up after retries");
    await db.prepare(`UPDATE board_bayscan_jobs SET status = 'failed', completed_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'claimed'`)
      .bind(now, error.slice(0, 500), now, row.id).run();
    await setScanTek(db, Number(row.scan_id), "failed", error, Number(row.id), String(row.filename || ""), now);
  }
}
export async function markBayScanJobClaimed(db: D1, id: number, now: string) {
  const result = await db.prepare(`UPDATE board_bayscan_jobs SET status = 'claimed', claimed_at = ?, updated_at = ?, attempts = attempts + 1
    WHERE id = ? AND status IN ('pending', 'claimed')`).bind(now, now, id).run();
  return wrote(result) ? getBayScanJob(db, id) : null;
}
export async function ackBayScanJobRow(db: D1, id: number, status: "done" | "pending" | "failed", error: string, nextAttemptAt: string, now: string) {
  const completed = status === "pending" ? null : now;
  await db.prepare(`UPDATE board_bayscan_jobs SET status = ?, completed_at = ?, last_error = ?, next_attempt_at = ?, claimed_at = CASE WHEN ? = 'pending' THEN NULL ELSE claimed_at END, updated_at = ? WHERE id = ? AND status <> 'done'`)
    .bind(status, completed, error.slice(0, 500), nextAttemptAt, status, now, id).run();
  return getBayScanJob(db, id);
}
