// Writer schedule inbox. Pure helpers (no Cloudflare imports) so they are unit-testable.
// Board-only D1 data. Nothing here writes to Tekmetric or places a job on the board.

export const SCHEDULE_REQUEST_STATUSES = ["open", "done"] as const;

export const BOARD_SCHEDULE_REQUESTS_SQL = `CREATE TABLE IF NOT EXISTS board_schedule_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    submitter TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'writer',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    done_by TEXT NOT NULL DEFAULT '',
    done_at TEXT
  )`;

export type ScheduleRequest = {
  id: number; text: string; submitter: string; source: "writer" | "teams-bot";
  status: "open" | "done"; createdAt: string; updatedAt: string; doneBy: string; doneAt: string | null;
};

/** Validate a freeform "put this on the schedule" note. The shared dashboard login has no personal name, so the writer types one. */
export function newScheduleRequest(input: Record<string, unknown>, who: { name?: string; source?: "writer" | "teams-bot" } = {}) {
  const text = String(input.text ?? "").trim().slice(0, 2000);
  if (text.length < 3) return { error: "Write what you need on the schedule" } as const;
  const submitter = String(who.name ?? input.name ?? "").trim().slice(0, 60) || "Writer";
  const source = who.source === "teams-bot" ? "teams-bot" as const : "writer" as const;
  return { text, submitter, source };
}

/** Mark an open request done. Missing and already-done are distinct so the bot can ack once. */
export function scheduleRequestAck(current: ScheduleRequest | null, by: string) {
  if (!current) return { error: "Schedule request not found", status: 404 as const };
  if (current.status === "done") return { error: "Schedule request is already done", status: 409 as const };
  return { id: current.id, doneBy: by.trim().slice(0, 60) || "Writer" };
}

export function rowToScheduleRequest(row: Record<string, unknown>): ScheduleRequest {
  return {
    id: Number(row.id), text: String(row.text), submitter: String(row.submitter || ""),
    source: row.source === "teams-bot" ? "teams-bot" : "writer",
    status: row.status === "done" ? "done" : "open",
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    doneBy: String(row.done_by || ""), doneAt: row.done_at ? String(row.done_at) : null,
  };
}
