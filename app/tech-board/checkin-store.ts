// v1.6.15: check-in scan codes per RO. Kept out of store.ts so Bay Scan attach can be unit-tested without the board scheduler.
import type { Checkin } from "./dtc.ts";

type Bound = { run(): Promise<unknown>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
type Stmt = Bound & { bind(...values: unknown[]): Bound };
type D1 = { prepare(sql: string): Stmt };

export async function loadCheckins(db: D1): Promise<Checkin[]> {
  const rows = await db.prepare(`SELECT * FROM board_checkin`).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.map((row) => { let codes: string[] = []; try { codes = JSON.parse(String(row.codes_json || "[]")); } catch { codes = []; }
    return { ro: String(row.ro), codes, notes: String(row.notes || ""), updatedBy: String(row.updated_by || ""), updatedAt: String(row.updated_at || "") }; });
}

export async function saveCheckin(db: D1, ro: string, codes: string[], notes: string, by: string, now: string) {
  if (!codes.length && !notes.trim()) { await db.prepare(`DELETE FROM board_checkin WHERE ro = ?`).bind(ro).run(); return; }
  await db.prepare(`INSERT INTO board_checkin (ro, codes_json, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(ro) DO UPDATE SET codes_json = excluded.codes_json, notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(ro, JSON.stringify(codes), notes.slice(0, 2000), by.slice(0, 120), now).run();
}
