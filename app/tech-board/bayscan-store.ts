// v1.6.18: Bay Scan scans + RO VINs (board D1 only). v1.6.21 adds the Tekmetric attach-job queue.
// v1.6.22 adds check-in photos and lets photo attach jobs share that queue.
// v1.6.23 adds board-triggered scan requests (the Mac listener claims them).
// Pure so it is unit-testable with node:sqlite.
import { normalizeStoredScan, type BayScan, type RoScanView, type ScanPhotoView } from "./bayscan.ts";
type Bound = { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
type Stmt = Bound & { bind(...values: unknown[]): Bound };
type D1 = { prepare(sql: string): Stmt };

export const BAYSCAN_SQL = [
  `CREATE TABLE IF NOT EXISTS board_bayscan_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, vin TEXT NOT NULL, scan_json TEXT NOT NULL,
    ro TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unmatched', match_count INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL,
    attached_by TEXT NOT NULL DEFAULT '', attached_at TEXT NOT NULL DEFAULT '',
    tek_status TEXT NOT NULL DEFAULT '', tek_error TEXT NOT NULL DEFAULT '', tek_job_id INTEGER, tek_filename TEXT NOT NULL DEFAULT '', tek_updated_at TEXT NOT NULL DEFAULT '',
    vin_mismatch INTEGER NOT NULL DEFAULT 0, vin_mismatch_ro TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS board_bayscan_scans_status_idx ON board_bayscan_scans (status, id)`,
  `CREATE TABLE IF NOT EXISTS board_ro_vin (ro TEXT PRIMARY KEY, vin TEXT NOT NULL, set_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS board_bayscan_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id INTEGER NOT NULL, ro_number TEXT NOT NULL,
    customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '', vin TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '',
    file_key TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_type TEXT NOT NULL DEFAULT 'application/pdf',
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, completed_at TEXT,
    last_error TEXT NOT NULL DEFAULT '', next_attempt_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'report', photo_id INTEGER)`,
  `CREATE INDEX IF NOT EXISTS board_bayscan_jobs_status_idx ON board_bayscan_jobs (status, id)`,
  `CREATE TABLE IF NOT EXISTS bayscan_photo_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, client_id TEXT NOT NULL,
    requested_at TEXT NOT NULL, effective_at TEXT NOT NULL, vin TEXT NOT NULL DEFAULT '', age_sec INTEGER,
    scan_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '',
    claimed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(device_id, client_id))`,
  `CREATE INDEX IF NOT EXISTS bayscan_photo_requests_device_idx ON bayscan_photo_requests (device_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS bayscan_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id INTEGER NOT NULL, request_id INTEGER NOT NULL, seq INTEGER NOT NULL,
    file_key TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    bytes INTEGER NOT NULL DEFAULT 0, captured_at TEXT NOT NULL, created_at TEXT NOT NULL,
    attach_status TEXT NOT NULL DEFAULT '', attach_error TEXT NOT NULL DEFAULT '',
    UNIQUE(request_id, seq))`,
  `CREATE INDEX IF NOT EXISTS bayscan_photos_scan_idx ON bayscan_photos (scan_id, id)`,
  // v1.6.23: one board click queues a scan. The Mac claims the oldest pending request, one at a time.
  `CREATE TABLE IF NOT EXISTS bayscan_scan_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ro TEXT NOT NULL, ro_id TEXT NOT NULL DEFAULT '', vin TEXT NOT NULL DEFAULT '',
    customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, claimed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
    scan_id INTEGER, vin_mismatch INTEGER NOT NULL DEFAULT 0, matched_ro TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS bayscan_scan_requests_status_idx ON bayscan_scan_requests (status, created_at, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bayscan_scan_requests_one_active_ro ON bayscan_scan_requests (ro) WHERE status IN ('pending', 'claimed', 'scanning')`,
];
/** Columns added after the first Bay Scan release. "duplicate column" on a current table is expected. */
export const BAYSCAN_ALTER = [
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_status TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_error TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_job_id INTEGER`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_filename TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN tek_updated_at TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE board_bayscan_jobs ADD COLUMN kind TEXT DEFAULT 'report'`,
  `ALTER TABLE board_bayscan_jobs ADD COLUMN photo_id INTEGER`,
  `ALTER TABLE bayscan_photos ADD COLUMN attach_status TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE bayscan_photos ADD COLUMN attach_error TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN vin_mismatch INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE board_bayscan_scans ADD COLUMN vin_mismatch_ro TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE bayscan_scan_requests ADD COLUMN matched_ro TEXT NOT NULL DEFAULT ''`,
];

export type StoredScan = { id: number; deviceId: string; vin: string; scan: BayScan; ro: string; status: "matched" | "unmatched" | "attached" | "dismissed";
  matchCount: number; receivedAt: string; attachedBy: string; attachedAt: string;
  tekStatus: string; tekError: string; tekJobId: number; tekFilename: string; tekUpdatedAt: string;
  photos?: ScanPhotoView[]; photoRequest?: "" | "pending" | "claimed" };

export type BayScanJob = {
  id: number; scanId: number; roNumber: string; customer: string; vehicle: string; vin: string; detailUrl: string;
  fileKey: string; filename: string; contentType: string; status: string; attempts: number; claimedAt: string;
  completedAt: string; lastError: string; nextAttemptAt: string; createdAt: string; updatedAt: string;
  kind: "report" | "photo"; photoId: number;
};

export type PhotoRequestRow = {
  id: number; deviceId: string; clientId: string; requestedAt: string; effectiveAt: string; vin: string;
  ageSec: number | null; scanId: number; status: string; error: string; claimedAt: string; attempts: number;
  createdAt: string; updatedAt: string;
};

export type BayScanPhotoRow = {
  id: number; scanId: number; requestId: number; seq: number; fileKey: string; filename: string;
  contentType: string; bytes: number; capturedAt: string; createdAt: string; attachStatus: string; attachError: string;
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
  kind: String(row.kind || "report") === "photo" ? "photo" : "report", photoId: Number(row.photo_id || 0),
});

const row2request = (row: Record<string, unknown>): PhotoRequestRow => ({
  id: Number(row.id), deviceId: String(row.device_id || ""), clientId: String(row.client_id || ""),
  requestedAt: String(row.requested_at || ""), effectiveAt: String(row.effective_at || ""), vin: String(row.vin || ""),
  ageSec: row.age_sec === null || row.age_sec === undefined || row.age_sec === "" ? null : Number(row.age_sec),
  scanId: Number(row.scan_id || 0), status: String(row.status || ""), error: String(row.error || ""),
  claimedAt: String(row.claimed_at || ""), attempts: Number(row.attempts || 0),
  createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
});

const row2photo = (row: Record<string, unknown>): BayScanPhotoRow => ({
  id: Number(row.id), scanId: Number(row.scan_id || 0), requestId: Number(row.request_id || 0), seq: Number(row.seq || 0),
  fileKey: String(row.file_key || ""), filename: String(row.filename || ""), contentType: String(row.content_type || "image/jpeg"),
  bytes: Number(row.bytes || 0), capturedAt: String(row.captured_at || ""), createdAt: String(row.created_at || ""),
  attachStatus: String(row.attach_status || ""), attachError: String(row.attach_error || ""),
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
  return enrichScanPhotos(db, rows.results.map(row2scan));
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
  const index = await photoIndex(db);
  const out: Record<string, RoScanView> = {};
  for (const row of rows.results) {
    const scan = row2scan(row);
    if (!scan.ro || out[scan.ro]) continue;
    out[scan.ro] = { id: scan.id, tekStatus: scan.tekStatus, tekError: scan.tekError, modules: scan.scan.modules, readinessSummary: scan.scan.readinessSummary,
      photos: index.byScan.get(scan.id) ?? [], photoRequest: index.flag.get(scan.id) ?? "" };
  }
  return out;
}
/** Matched scans that still have no report job. Photo jobs do not count. */
export async function scansMissingJobs(db: D1) {
  const rows = await db.prepare(`SELECT s.id FROM board_bayscan_scans s LEFT JOIN board_bayscan_jobs j ON j.scan_id = s.id AND COALESCE(j.kind, 'report') = 'report'
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
/** The report job for a scan. Photo jobs for the same scan are ignored. */
export async function getBayScanJobByScan(db: D1, scanId: number) {
  const row = await db.prepare(`SELECT * FROM board_bayscan_jobs WHERE scan_id = ? AND COALESCE(kind, 'report') = 'report' ORDER BY id ASC LIMIT 1`).bind(scanId).first<Record<string, unknown>>();
  return row ? row2job(row) : null;
}
export async function getBayScanJobByPhoto(db: D1, photoId: number) {
  const row = await db.prepare(`SELECT * FROM board_bayscan_jobs WHERE photo_id = ? AND kind = 'photo' ORDER BY id ASC LIMIT 1`).bind(photoId).first<Record<string, unknown>>();
  return row ? row2job(row) : null;
}
export async function insertBayScanJob(db: D1, job: { scanId: number; roNumber: string; customer: string; vehicle: string; vin: string; detailUrl: string; fileKey: string; filename: string; contentType: string }, now: string) {
  await ensureBayScanJobShape(db);
  await db.prepare(`INSERT INTO board_bayscan_jobs (scan_id, ro_number, customer, vehicle, vin, detail_url, file_key, filename, content_type, kind, status, attempts, last_error, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'report', 'pending', 0, '', '', ?, ?)
    ON CONFLICT(scan_id) WHERE kind = 'report' DO NOTHING`)
    .bind(job.scanId, job.roNumber, job.customer.slice(0, 120), job.vehicle.slice(0, 160), job.vin, job.detailUrl.slice(0, 1000), job.fileKey, job.filename, job.contentType, now, now).run();
  return getBayScanJobByScan(db, job.scanId);
}
export async function insertBayScanPhotoJob(db: D1, job: { scanId: number; photoId: number; roNumber: string; customer: string; vehicle: string; vin: string; detailUrl: string; fileKey: string; filename: string; contentType: string }, now: string) {
  await ensureBayScanJobShape(db);
  await db.prepare(`INSERT INTO board_bayscan_jobs (scan_id, ro_number, customer, vehicle, vin, detail_url, file_key, filename, content_type, kind, photo_id, status, attempts, last_error, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'photo', ?, 'pending', 0, '', '', ?, ?)
    ON CONFLICT(photo_id) WHERE photo_id IS NOT NULL DO NOTHING`)
    .bind(job.scanId, job.roNumber, job.customer.slice(0, 120), job.vehicle.slice(0, 160), job.vin, job.detailUrl.slice(0, 1000), job.fileKey, job.filename, job.contentType, job.photoId, now, now).run();
  return getBayScanJobByPhoto(db, job.photoId);
}
export async function claimableBayScanJobs(db: D1, nowIso: string, staleBefore: string, maxAttempts: number, limit: number) {
  const rows = await db.prepare(`SELECT id FROM board_bayscan_jobs
    WHERE (status = 'pending' AND attempts < ? AND (next_attempt_at = '' OR next_attempt_at <= ?))
       OR (status = 'claimed' AND attempts < ? AND (claimed_at IS NULL OR claimed_at < ?))
    ORDER BY id ASC LIMIT ?`).bind(maxAttempts, nowIso, maxAttempts, staleBefore, limit).all<Record<string, unknown>>();
  return rows.results.map((row) => Number(row.id));
}
/** A claim the reader never acked, already out of attempts, becomes a visible failure. Report jobs update the scan; photo jobs update the photo. */
export async function failAbandonedBayScanJobs(db: D1, maxAttempts: number, staleBefore: string, now: string) {
  const rows = await db.prepare(`SELECT * FROM board_bayscan_jobs
    WHERE status = 'claimed' AND attempts >= ? AND (claimed_at IS NULL OR claimed_at < ?)`).bind(maxAttempts, staleBefore).all<Record<string, unknown>>();
  for (const raw of rows.results) {
    const row = row2job(raw);
    const error = row.lastError || "Gave up after retries";
    await db.prepare(`UPDATE board_bayscan_jobs SET status = 'failed', completed_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'claimed'`)
      .bind(now, error.slice(0, 500), now, row.id).run();
    if (row.kind === "photo" && row.photoId) await setPhotoAttach(db, row.photoId, "failed", error);
    else await setScanTek(db, row.scanId, "failed", error, row.id, row.filename, now);
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

/**
 * v1.6.22: report jobs stay unique per scan, photo jobs unique per photo.
 * Tables created before photos had UNIQUE(scan_id), which would block a photo job for that scan.
 * Rebuild those tables. Partial indexes are created after the columns exist so an old database can boot.
 */
export async function ensureBayScanJobShape(db: D1) {
  for (const sql of [
    `ALTER TABLE board_bayscan_jobs ADD COLUMN kind TEXT DEFAULT 'report'`,
    `ALTER TABLE board_bayscan_jobs ADD COLUMN photo_id INTEGER`,
  ]) await db.prepare(sql).run().catch(() => undefined);
  const row = await db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'board_bayscan_jobs'`).first<Record<string, unknown>>().catch(() => null);
  const ddl = String(row?.sql || "");
  if (/scan_id\s+integer\s+not\s+null\s+unique/i.test(ddl) || /unique\s*\(\s*scan_id\s*\)/i.test(ddl)) {
    await db.prepare(`CREATE TABLE board_bayscan_jobs_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id INTEGER NOT NULL, ro_number TEXT NOT NULL,
      customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '', vin TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '',
      file_key TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_type TEXT NOT NULL DEFAULT 'application/pdf',
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, completed_at TEXT,
      last_error TEXT NOT NULL DEFAULT '', next_attempt_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'report', photo_id INTEGER)`).run();
    await db.prepare(`INSERT INTO board_bayscan_jobs_next (id, scan_id, ro_number, customer, vehicle, vin, detail_url, file_key, filename, content_type, status, attempts, claimed_at, completed_at, last_error, next_attempt_at, created_at, updated_at, kind, photo_id)
      SELECT id, scan_id, ro_number, customer, vehicle, vin, detail_url, file_key, filename, content_type, status, attempts, claimed_at, completed_at, last_error, next_attempt_at, created_at, updated_at, COALESCE(kind, 'report'), photo_id FROM board_bayscan_jobs`).run();
    await db.prepare(`DROP TABLE board_bayscan_jobs`).run();
    await db.prepare(`ALTER TABLE board_bayscan_jobs_next RENAME TO board_bayscan_jobs`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS board_bayscan_jobs_status_idx ON board_bayscan_jobs (status, id)`).run();
  }
  await db.prepare(`UPDATE board_bayscan_jobs SET kind = 'report' WHERE kind IS NULL OR kind = ''`).run().catch(() => undefined);
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS board_bayscan_jobs_report_scan_idx ON board_bayscan_jobs (scan_id) WHERE kind = 'report'`).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS board_bayscan_jobs_photo_idx ON board_bayscan_jobs (photo_id) WHERE photo_id IS NOT NULL`).run();
}

async function photoIndex(db: D1) {
  const photos = await db.prepare(`SELECT id, scan_id, attach_status, attach_error FROM bayscan_photos ORDER BY id ASC`).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  const byScan = new Map<number, ScanPhotoView[]>();
  for (const row of photos.results) {
    const scanId = Number(row.scan_id);
    const list = byScan.get(scanId) ?? [];
    list.push({ id: Number(row.id), attachStatus: String(row.attach_status || ""), attachError: String(row.attach_error || "") });
    byScan.set(scanId, list);
  }
  const requests = await db.prepare(`SELECT scan_id, status FROM bayscan_photo_requests WHERE status IN ('pending', 'claimed')`).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  const flag = new Map<number, "pending" | "claimed">();
  for (const row of requests.results) {
    const scanId = Number(row.scan_id);
    const status = String(row.status) === "claimed" ? "claimed" as const : "pending" as const;
    if (!flag.get(scanId) || status === "claimed") flag.set(scanId, status);
  }
  return { byScan, flag };
}

async function enrichScanPhotos(db: D1, scans: StoredScan[]) {
  const index = await photoIndex(db);
  return scans.map((scan) => ({ ...scan, photos: index.byScan.get(scan.id) ?? [], photoRequest: index.flag.get(scan.id) ?? "" as const }));
}

export async function loadRecentDeviceScans(db: D1, deviceId: string, limit = 100) {
  const rows = await db.prepare(`SELECT * FROM board_bayscan_scans WHERE device_id = ? ORDER BY id DESC LIMIT ?`).bind(deviceId, limit).all<Record<string, unknown>>();
  return rows.results.map(row2scan);
}

export async function getPhotoRequestByClient(db: D1, deviceId: string, clientId: string) {
  const row = await db.prepare(`SELECT * FROM bayscan_photo_requests WHERE device_id = ? AND client_id = ?`).bind(deviceId, clientId).first<Record<string, unknown>>();
  return row ? row2request(row) : null;
}
export async function getPhotoRequest(db: D1, id: number) {
  const row = await db.prepare(`SELECT * FROM bayscan_photo_requests WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? row2request(row) : null;
}
export async function countRecentPhotoRequests(db: D1, deviceId: string, sinceIso: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM bayscan_photo_requests WHERE device_id = ? AND created_at >= ?`).bind(deviceId, sinceIso).first<Record<string, unknown>>();
  return Number(row?.n || 0);
}
export async function insertPhotoRequest(db: D1, row: { deviceId: string; clientId: string; requestedAt: string; effectiveAt: string; vin: string; ageSec: number | null; scanId: number; now: string }) {
  await db.prepare(`INSERT INTO bayscan_photo_requests (device_id, client_id, requested_at, effective_at, vin, age_sec, scan_id, status, error, claimed_at, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', NULL, 0, ?, ?)`).bind(row.deviceId, row.clientId, row.requestedAt, row.effectiveAt, row.vin, row.ageSec, row.scanId, row.now, row.now).run();
  return getPhotoRequestByClient(db, row.deviceId, row.clientId);
}
export async function markPhotoRequest(db: D1, id: number, status: string, error: string, now: string) {
  await db.prepare(`UPDATE bayscan_photo_requests SET status = ?, error = ?, updated_at = ? WHERE id = ?`).bind(status, error.slice(0, 200), now, id).run();
  return getPhotoRequest(db, id);
}
export async function claimPhotoRequestRow(db: D1, id: number, now: string) {
  const result = await db.prepare(`UPDATE bayscan_photo_requests SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).bind(now, now, id).run();
  return wrote(result) ? getPhotoRequest(db, id) : null;
}
/** First camera timeout: back to pending and count the attempt. */
export async function reclaimPhotoRequest(db: D1, id: number, now: string) {
  const result = await db.prepare(`UPDATE bayscan_photo_requests SET status = 'pending', attempts = attempts + 1, claimed_at = NULL, updated_at = ? WHERE id = ? AND status = 'claimed'`).bind(now, id).run();
  return wrote(result) ? getPhotoRequest(db, id) : null;
}
export async function listActivePhotoRequests(db: D1) {
  const rows = await db.prepare(`SELECT * FROM bayscan_photo_requests WHERE status IN ('pending', 'claimed') ORDER BY id ASC LIMIT 300`).all<Record<string, unknown>>();
  return rows.results.map(row2request);
}
export async function countRequestPhotos(db: D1, requestId: number) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM bayscan_photos WHERE request_id = ?`).bind(requestId).first<Record<string, unknown>>();
  return Number(row?.n || 0);
}
export async function getPhoto(db: D1, id: number) {
  const row = await db.prepare(`SELECT * FROM bayscan_photos WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? row2photo(row) : null;
}
export async function getPhotoByRequestSeq(db: D1, requestId: number, seq: number) {
  const row = await db.prepare(`SELECT * FROM bayscan_photos WHERE request_id = ? AND seq = ?`).bind(requestId, seq).first<Record<string, unknown>>();
  return row ? row2photo(row) : null;
}
export async function insertPhotoRow(db: D1, row: { scanId: number; requestId: number; seq: number; capturedAt: string; now: string }) {
  await db.prepare(`INSERT INTO bayscan_photos (scan_id, request_id, seq, file_key, filename, content_type, bytes, captured_at, created_at)
    VALUES (?, ?, ?, '', '', 'image/jpeg', 0, ?, ?)`).bind(row.scanId, row.requestId, row.seq, row.capturedAt, row.now).run();
  return getPhotoByRequestSeq(db, row.requestId, row.seq);
}
export async function setPhotoStored(db: D1, id: number, fileKey: string, filename: string, bytes: number) {
  await db.prepare(`UPDATE bayscan_photos SET file_key = ?, filename = ?, bytes = ?, content_type = 'image/jpeg' WHERE id = ?`).bind(fileKey, filename, bytes, id).run();
  return getPhoto(db, id);
}
export async function setPhotoFilename(db: D1, id: number, filename: string) {
  await db.prepare(`UPDATE bayscan_photos SET filename = ? WHERE id = ?`).bind(filename, id).run();
}
export async function deletePhoto(db: D1, id: number) {
  await db.prepare(`DELETE FROM bayscan_photos WHERE id = ?`).bind(id).run();
}
export async function setPhotoAttach(db: D1, id: number, status: string, error: string) {
  await db.prepare(`UPDATE bayscan_photos SET attach_status = ?, attach_error = ? WHERE id = ?`).bind(status, error.slice(0, 500), id).run();
}
export async function listPhotosForScan(db: D1, scanId: number) {
  const rows = await db.prepare(`SELECT * FROM bayscan_photos WHERE scan_id = ? ORDER BY id ASC`).bind(scanId).all<Record<string, unknown>>();
  return rows.results.map(row2photo);
}
export async function photosMissingJobs(db: D1) {
  const rows = await db.prepare(`SELECT p.id, p.scan_id FROM bayscan_photos p
    JOIN board_bayscan_scans s ON s.id = p.scan_id
    LEFT JOIN board_bayscan_jobs j ON j.photo_id = p.id AND COALESCE(j.kind, '') = 'photo'
    WHERE s.status IN ('matched', 'attached') AND s.ro <> '' AND j.id IS NULL ORDER BY p.id ASC LIMIT 50`)
    .all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.map((row) => ({ photoId: Number(row.id), scanId: Number(row.scan_id) }));
}
