"use client";

import { useState } from "react";
import { SUGGESTION_CATEGORIES, SUGGESTION_STATUSES, type Suggestion } from "./suggestions";

// Tech Board revisions suggestion box. Writers: submit with a name, see all, set status + reply.
// Techs (/tech): submit as themselves (from the PIN session), see only their own and each status.

const STATUS_COLORS: Record<string, string> = { New: "#1786e8", Planned: "#fcb70d", Done: "#8bb63a", Declined: "#6b7280" };
const when = (value: string) => new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export default function SuggestionBox({ suggestions, mode, onSubmit, onUpdate, busy = false }: {
  suggestions: Suggestion[]; mode: "writer" | "tech"; busy?: boolean;
  onSubmit: (value: { text: string; category: string; name?: string }) => Promise<unknown>;
  onUpdate?: (value: { id: number; status: string; reply: string }) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<Record<number, { status: string; reply: string }>>({});
  const [sent, setSent] = useState("");
  return (
    <div className="tb-suggest" aria-label="Tech Board revisions">
      <div className="tb-requests-head"><h3>Tech Board revisions</h3><span className="tb-empty">Suggest a change to the board</span></div>
      <div className="tb-suggest-form">
        <textarea rows={2} value={text} placeholder="What should change? e.g. Make the % buttons bigger" aria-label="Suggestion" onChange={(event) => setText(event.target.value)} />
        <div className="tb-fields">
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">(optional)</option>{SUGGESTION_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          {mode === "writer" && <label>Your name<input value={name} placeholder="e.g. Devin" onChange={(event) => setName(event.target.value)} /></label>}
        </div>
        <button className="tb-primary" disabled={busy || text.trim().length < 3} onClick={async () => {
          await onSubmit({ text, category: category || "Other", ...(mode === "writer" ? { name } : {}) });
          setText(""); setSent("Thanks — suggestion sent.");
        }}>Send suggestion</button>
        {sent && <span className="tech-ok">{sent}</span>}
      </div>
      {suggestions.length === 0 ? <p className="tb-empty">{mode === "tech" ? "You haven't sent any suggestions yet." : "No suggestions yet."}</p> : (
        <ul className="tb-list tb-suggest-list">{suggestions.map((item) => {
          const draft = drafts[item.id] ?? { status: item.status, reply: item.reply };
          return (
            <li key={item.id}><i style={{ background: STATUS_COLORS[item.status] ?? "#6b7280" }} />
              <div className="tb-suggest-body">
                <strong>{item.text}</strong>
                <span>{item.category} · {mode === "writer" ? `${item.submitter}${item.source === "tech" ? " (tech)" : ""} · ` : ""}{when(item.createdAt)} · <b className="tb-suggest-status" style={{ color: STATUS_COLORS[item.status] }}>{item.status}</b></span>
                {mode === "tech" && item.reply && <span className="tb-suggest-reply">Reply: {item.reply}</span>}
                {mode === "writer" && onUpdate && (
                  <div className="tb-suggest-edit">
                    <select aria-label="Status" value={draft.status} onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...draft, status: event.target.value } })}>{SUGGESTION_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
                    <input aria-label="Reply" value={draft.reply} placeholder="Reply (optional)" onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...draft, reply: event.target.value } })} />
                    <button disabled={busy || (draft.status === item.status && draft.reply === item.reply)} onClick={() => onUpdate({ id: item.id, ...draft })}>Save</button>
                  </div>
                )}
              </div>
            </li>
          );
        })}</ul>
      )}
    </div>
  );
}
