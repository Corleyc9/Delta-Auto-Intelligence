// Tech Board revisions suggestion box. Pure helpers (no Cloudflare imports) so they are unit-testable.
// Board-only D1 data; nothing goes to Tekmetric.

export const SUGGESTION_CATEGORIES = ["Layout", "Scheduling", "Colors", "Buttons", "Other"] as const;
export const SUGGESTION_STATUSES = ["New", "Planned", "Done", "Declined"] as const;

export const BOARD_SUGGESTIONS_SQL = `CREATE TABLE IF NOT EXISTS board_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    submitter TEXT NOT NULL DEFAULT '',
    submitter_tech TEXT,
    source TEXT NOT NULL DEFAULT 'writer',
    status TEXT NOT NULL DEFAULT 'New',
    reply TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;

export type Suggestion = {
  id: number; text: string; category: string; submitter: string; submitterTech: string | null; source: "writer" | "tech";
  status: string; reply: string; createdAt: string; updatedAt: string;
};

/** Validate a new suggestion. Techs are identified only by their PIN session, never by a typed name. */
export function newSuggestion(input: Record<string, unknown>, who: { tech?: string | null; name?: string }) {
  const text = String(input.text ?? "").trim().slice(0, 2000);
  if (text.length < 3) return { error: "Write a suggestion first" } as const;
  const category = (SUGGESTION_CATEGORIES as readonly string[]).includes(String(input.category)) ? String(input.category) : "Other";
  const tech = who.tech || null;
  const submitter = tech ? tech : String(who.name ?? input.name ?? "").trim().slice(0, 60) || "Writer";
  return { text, category, submitter, submitterTech: tech, source: tech ? "tech" : "writer" } as const;
}

export function suggestionUpdate(input: Record<string, unknown>) {
  const id = Number(input.id) || 0;
  const status = (SUGGESTION_STATUSES as readonly string[]).includes(String(input.status)) ? String(input.status) : null;
  if (!id || !status) return { error: "Invalid status" } as const;
  return { id, status, reply: String(input.reply ?? "").slice(0, 2000) } as const;
}

export function rowToSuggestion(row: Record<string, unknown>): Suggestion {
  return { id: Number(row.id), text: String(row.text), category: String(row.category), submitter: String(row.submitter),
    submitterTech: row.submitter_tech ? String(row.submitter_tech) : null, source: row.source === "tech" ? "tech" : "writer",
    status: String(row.status), reply: String(row.reply || ""), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
