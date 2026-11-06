// v1.6.18: Bay Scan scans + RO VINs (board D1 only). Pure so it is unit-testable with node:sqlite.
import type { BayScan } from "./bayscan.ts";
type Bound = { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
type Stmt = Bound & { bind(...values: unknown[]): Bound };
type D1 = { prepare(sql: string): Stmt };

export const BAYSCAN_SQL = [
  `CREATE TABLE IF NOT EXISTS board_bayscan_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, vin TEXT NOT NULL, scan_json TEXT NOT NULL,
    ro TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unmatched', match_count INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL,
    attached_by TEXT NOT NULL DEFAULT '', attached_at TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS board_bayscan_scans_status_idx ON board_bayscan_scans (status, id)`,
  `CREATE TABLE IF NOT EXISTS board_ro_vin (ro TEXT PRIMARY KEY, vin TEXT NOT NULL, set_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`,
];
export type StoredScan = { id: number; deviceId: string; vin: string; scan: BayScan; ro: string; status: "matched" | "unmatched" | "attached" | "dismissed";
  matchCount: number; receivedAt: string; attachedBy: string; attachedAt: string };

const row2scan = (row: Record<string, unknown>): StoredScan => ({ id: Number(row.id), deviceId: String(row.device_id), vin: String(row.vin),
  scan: JSON.parse(String(row.scan_json || "{}")), ro: String(row.ro || ""), status: String(row.status) as StoredScan["status"], matchCount: Number(row.match_count || 0),
  receivedAt: String(row.received_at), attachedBy: String(row.attached_by || ""), attachedAt: String(row.attached_at || "") });

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
export async function markScan(db: D1, id: number, status: "attached" | "dismissed", ro: string, by: string, now: string) {
  await db.prepare(`UPDATE board_bayscan_scans SET status = ?, ro = ?, attached_by = ?, attached_at = ? WHERE id = ? AND status = 'unmatched'`).bind(status, ro, by.slice(0, 120), now, id).run();
  return getScan(db, id);
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
