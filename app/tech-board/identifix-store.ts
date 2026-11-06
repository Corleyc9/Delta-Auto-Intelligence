// v1.6.17: Identifix lookup request storage (board D1 only). Pure so it is unit-testable with node:sqlite.
type Bound = { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
type Stmt = { bind(...values: unknown[]): Bound; run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
type D1 = { prepare(sql: string): Stmt };
export const IDENTIFIX_REQUESTS_SQL =   `CREATE TABLE IF NOT EXISTS board_identifix_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ro TEXT NOT NULL, customer TEXT NOT NULL DEFAULT '',
    vehicle_json TEXT NOT NULL DEFAULT '{}', codes_json TEXT NOT NULL DEFAULT '[]', symptom TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued',
    requested_by TEXT NOT NULL DEFAULT '', requested_at TEXT NOT NULL DEFAULT '', claimed_by TEXT NOT NULL DEFAULT '', claimed_at TEXT NOT NULL DEFAULT '',
    finished_at TEXT NOT NULL DEFAULT '', fail_reason TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '')`;

/** v1.6.17: Identifix lookup requests. */
const parse = <T,>(value: unknown, fallback: T): T => { try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; } };
function identifixRow(row: Record<string, unknown>): import("./identifix.ts").IdentifixRequest {
  return { id: Number(row.id), ro: String(row.ro), customer: String(row.customer || ""), vehicle: parse(row.vehicle_json, { year: "", make: "", model: "", engine: "", vin: "", text: "" }),
    codes: parse(row.codes_json, [] as string[]), symptom: String(row.symptom || ""), status: String(row.status || "queued") as import("./identifix.ts").IdentifixStatus,
    requestedBy: String(row.requested_by || ""), requestedAt: String(row.requested_at || ""), claimedBy: String(row.claimed_by || ""), claimedAt: String(row.claimed_at || ""),
    finishedAt: String(row.finished_at || ""), failReason: String(row.fail_reason || ""), result: parse(row.result_json, null) };
}
export async function loadIdentifixRequests(db: D1, status?: string) {
  const sql = status ? `SELECT * FROM board_identifix_requests WHERE status = ? ORDER BY id` : `SELECT * FROM board_identifix_requests ORDER BY id DESC LIMIT 500`;
  const stmt: Bound = status ? db.prepare(sql).bind(status) : db.prepare(sql);
  const rows = await stmt.all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  return rows.results.map(identifixRow);
}
export async function getIdentifixRequest(db: D1, id: number) {
  const row = await db.prepare(`SELECT * FROM board_identifix_requests WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? identifixRow(row) : null;
}
export async function addIdentifixRequest(db: D1, req: { ro: string; customer: string; vehicle: unknown; codes: string[]; symptom: string }, by: string, now: string) {
  await db.prepare(`INSERT INTO board_identifix_requests (ro, customer, vehicle_json, codes_json, symptom, status, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`)
    .bind(req.ro, req.customer, JSON.stringify(req.vehicle), JSON.stringify(req.codes), req.symptom, by.slice(0, 120), now).run();
  const row = await db.prepare(`SELECT id FROM board_identifix_requests WHERE ro = ? AND requested_at = ? ORDER BY id DESC LIMIT 1`).bind(req.ro, now).first<Record<string, unknown>>();
  return row ? Number(row.id) : 0;
}
/** Claim: queued → in-progress only (a second claim fails). */
export async function claimIdentifixRequest(db: D1, id: number, by: string, now: string) {
  await db.prepare(`UPDATE board_identifix_requests SET status = 'in-progress', claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'queued'`).bind(by.slice(0, 120), now, id).run();
  const req = await getIdentifixRequest(db, id);
  return req && req.status === "in-progress" && req.claimedAt === now ? req : null;
}
export async function finishIdentifixRequest(db: D1, id: number, outcome: { result?: unknown; failReason?: string }, now: string) {
  if (outcome.result) await db.prepare(`UPDATE board_identifix_requests SET status = 'done', result_json = ?, fail_reason = '', finished_at = ? WHERE id = ?`).bind(JSON.stringify(outcome.result), now, id).run();
  else await db.prepare(`UPDATE board_identifix_requests SET status = 'failed', fail_reason = ?, finished_at = ? WHERE id = ?`).bind(String(outcome.failReason || "").slice(0, 500), now, id).run();
  return getIdentifixRequest(db, id);
}
