"use client";

import { useState } from "react";
import type { ScheduleRequest } from "./schedule-requests";

// Writer-only shared inbox: "I need this on the schedule." Not Tech Board revisions, time off, or a pool/job claim.
// The note is stored on the board and shown to every writer. It does not move a job by itself.

const when = (value: string) => new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export default function ScheduleRequestBox({ requests, busy = false, readOnly = false, onSubmit, onDone }: {
  requests: ScheduleRequest[]; busy?: boolean; readOnly?: boolean;
  onSubmit: (value: { text: string; name: string }) => Promise<unknown>;
  onDone: (value: { id: number; name: string }) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState("");
  const open = requests.filter((item) => item.status === "open");
  const done = requests.filter((item) => item.status === "done");
  return (
    <div className="tb-schedule" aria-label="Need it on the schedule">
      <div className="tb-requests-head">
        <h3>Need it on the schedule</h3>
        <span className="tb-empty">{open.length ? `${open.length} open` : "Shared inbox"} · not a Tech Board revision, time off, or a job claim</span>
      </div>
      <div className="tb-schedule-form">
        <label className="tb-comment">
          <textarea rows={2} value={text} placeholder="Put Bradley 38468 on Andrew this afternoon" aria-label="Schedule need" onChange={(event) => setText(event.target.value)} />
        </label>
        <label>Your name<input value={name} placeholder="e.g. Devin" aria-label="Your name" onChange={(event) => setName(event.target.value)} /></label>
        <button type="button" className="tb-primary" disabled={busy || readOnly || text.trim().length < 3} onClick={async () => {
          const ok = await onSubmit({ text, name });
          if (ok) { setText(""); setSent("Sent — the other writers can see it."); }
        }}>Send schedule request</button>
      </div>
      {sent && <p className="tech-ok tb-schedule-sent">{sent}</p>}
      {open.length === 0 ? <p className="tb-empty">Nothing waiting. Type a schedule need above if a job, block, or recheck should be on the board.</p> : (
        <ul className="tb-list tb-schedule-list">{open.map((item) => (
          <li key={item.id}><i style={{ background: "#e8a317" }} />
            <div className="tb-suggest-body">
              <strong>{item.text}</strong>
              <span>{item.submitter || "Writer"}{item.source === "teams-bot" ? " · Teams" : ""} · {when(item.createdAt)} · <b className="tb-suggest-status" style={{ color: "#e8a317" }}>Open</b></span>
            </div>
            <button type="button" disabled={busy || readOnly} aria-label={`Mark schedule request ${item.id} done`} onClick={() => onDone({ id: item.id, name })}>Done</button>
          </li>
        ))}</ul>
      )}
      {done.length > 0 && (
        <ul className="tb-list tb-schedule-list tb-schedule-done">{done.map((item) => (
          <li key={item.id}><i style={{ background: "#8bb63a" }} />
            <div className="tb-suggest-body">
              <strong>{item.text}</strong>
              <span>{item.submitter || "Writer"} · done{item.doneBy ? ` by ${item.doneBy}` : ""}{item.doneAt ? ` · ${when(item.doneAt)}` : ""}</span>
            </div>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
