"use client";

import { useCallback, useEffect, useState } from "react";
import { BOARD_COLORS, cardColor } from "./colors";
import { hiddenFromTech, wallEnd } from "./scheduler";
import SuggestionBox from "./SuggestionBox";
import { ApptDetails, apptSummary } from "./ApptDetails";
import DtcBox, { CheckinList } from "./DtcBox";
import { checkinRo, type Checkin } from "./dtc";
import { latestByRo, type IdentifixRequest } from "./identifix";
import { IdentifixResults } from "./IdentifixPanel";
import type { Suggestion } from "./suggestions";

// /tech: a tech's own page, unlocked with their PIN. Shows only their column today, the open pool,
// their % / ticket buttons and a time-off form. The server limits a tech session to /tech and /api/tech.

type Job = { ro: string; roNumber?: string; jobName?: string; customer: string; vehicle: string; label: string; status: string; startMinute: number; durationMinutes: number;
  laborGuideHours: number; techEstimateHours?: number | null; apptKey?: string | null; apptInfo?: string | null; custom?: boolean; title?: string; linkedRo?: string | null; carriedOver?: boolean; detailUrl: string };
type PoolJob = { ro: string; roNumber?: string; jobName?: string; customer: string; vehicle: string; label: string; hours: number; durationMinutes: number };
type Data = {
  signedIn: boolean; version?: string; techs?: { initials: string; name: string }[];
  today?: string; tech?: { initials: string; name: string; dayStartMinute: number }; jobs?: Job[]; pool?: PoolJob[];
  updates?: { ro: string; kind: string; percentComplete: number | null; comment?: string; createdAt?: string }[];
  timeOff?: { id: number; date: string; startMinute: number; endMinute: number; allDay: boolean; reason: string }[];
  suggestions?: Suggestion[];
  /** v1.6.15: Worker var IDENTIFIX_FOR_TECHS="1" turns DTC/Identifix + check-in scan on for techs (off by default). */
  features?: { identifix?: boolean; identifixResults?: boolean }; checkins?: Checkin[];
  /** v1.6.17: only sent when IDENTIFIX_RESULTS_FOR_TECHS="1". */ identifixRequests?: IdentifixRequest[];
  requests?: { id: number; ro: string; status: string; createdAt: string }[];
};
const ISSUES = ["Need parts", "Wrong part", "Need help", "Waiting approval", "Found more work", "Done", "Diag Done"];
const clock = (dayStart: number, minute: number) => {
  const total = dayStart + minute, h = Math.floor(total / 60), m = total % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};
const hoursText = (minutes: number) => `${(Math.round(minutes / 6) / 10).toFixed(1)}h`;
const title = (job: { customer?: string; ro: string; roNumber?: string; jobName?: string; custom?: boolean; linkedRo?: string | null; title?: string }) =>
  job.custom && !job.linkedRo ? (job.title || "Custom block")
    : `${job.customer ? `${job.customer} · ` : ""}RO#${job.custom ? job.linkedRo : (job.roNumber || job.ro)}${!job.custom && job.jobName ? ` · ${job.jobName}` : ""}`;
const TIMES = Array.from({ length: 37 }, (_, index) => index * 15);

export default function TechPage({ initial }: { initial?: Data }) {
  const [data, setData] = useState<Data | null>(initial ?? null);
  const [initials, setInitials] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openRo, setOpenRo] = useState<string | null>(null);
  const [off, setOff] = useState({ date: "", allDay: true, startMinute: 0, endMinute: 120, reason: "" });
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    if (initial) return;
    fetch("/api/tech", { cache: "no-store" }).then((r) => r.json()).then((payload: Data) => setData(payload)).catch(() => setError("Could not load"));
  }, [initial]);
  useEffect(() => { load(); const timer = setInterval(load, 60000); return () => clearInterval(timer); }, [load]);

  async function post(body: Record<string, unknown>) {
    if (initial) return null;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/tech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.error || "Something went wrong"); return null; }
      setData(payload); return payload;
    } finally { setBusy(false); }
  }

  if (!data) return <main className="tech-page"><p>Loading…</p></main>;
  if (!data.signedIn) {
    return (
      <main className="tech-page tech-login">
        <div className="tech-login-card">
          <p className="panel-kicker">DELTA AUTO · TECH</p>
          <h1>Sign in</h1>
          <label>Who are you?<select value={initials} onChange={(event) => setInitials(event.target.value)}>
            <option value="">Pick your name</option>{(data.techs ?? []).map((tech) => <option key={tech.initials} value={tech.initials}>{tech.name}</option>)}</select></label>
          <label>PIN<input type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => { if (event.key === "Enter" && initials && pin) post({ action: "login", initials, pin }).then(() => setPin("")); }} /></label>
          {error && <p className="tech-error">{error}</p>}
          <button className="tb-primary" disabled={busy || !initials || pin.length < 4} onClick={async () => { await post({ action: "login", initials, pin }); setPin(""); }}>Unlock my day</button>
          <small>Build {data.version}</small>
        </div>
      </main>
    );
  }
  const tech = data.tech!;
  const latest = (ro: string) => data.updates?.find((update) => update.ro === ro);
  const requestFor = (ro: string) => data.requests?.find((request) => request.ro === ro);
  const offToday = (data.timeOff ?? []).filter((item) => item.date >= (data.today ?? ""));
  return (
    <main className="tech-page">
      <header className="tech-head">
        <div><p className="panel-kicker">DELTA AUTO · TECH · Build {data.version}</p><h1>{tech.name}</h1>
          <p>{new Date(`${data.today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}</p></div>
        <button onClick={() => post({ action: "logout" }).then(() => { setData(null); fetch("/api/tech").then((r) => r.json()).then(setData); })}>Sign out</button>
      </header>
      {error && <p className="tech-error">{error}</p>}
      <section className="tech-section">
        <h2>My day</h2>
        {(data.jobs ?? []).length === 0 && <p className="tb-empty">Nothing on your column today.</p>}
        <ul className="tech-jobs">{(data.jobs ?? []).filter((job) => !hiddenFromTech(job)).map((job) => {
          const pct = latest(job.ro)?.percentComplete ?? null;
          return (
            <li key={job.ro} className="tech-job" style={{ borderLeftColor: cardColor(job, latest(job.ro)?.kind) }}>
              <div className="tech-job-main" role="button" aria-expanded={openRo === job.ro} title="Tap for status, % done, estimate and comments" tabIndex={0} onClick={() => setOpenRo(openRo === job.ro ? null : job.ro)}>
                <span className="tech-time">{job.status === "front-office" || job.startMinute < 0 ? (job.startMinute > -90 && job.startMinute < 0 ? "7–8 AM" : "6–7 AM · Front office") : <>{clock(tech.dayStartMinute, job.startMinute)} – {clock(tech.dayStartMinute, wallEnd(job.startMinute, job.durationMinutes))}</>}</span>
                <strong>{title(job)}</strong>
                <span>{job.vehicle}{job.vehicle ? " · " : ""}{hoursText(job.durationMinutes)}{pct !== null ? ` · ${pct}%` : ""}{job.carriedOver ? " · Carried over" : ""}{String(job.apptKey || "").startsWith("Y|") ? " · 🔒 Customer coming" : ""}{job.status === "diag" ? " · Diag" : ""}</span>
                {apptSummary(job.apptInfo) && <span className="tech-appt">📋 {apptSummary(job.apptInfo)}</span>}
              </div>
              {openRo === job.ro && job.custom && <ApptDetails info={job.apptInfo} />}
              {!job.custom && <div className="tb-quick tech-quick">{[25, 50, 75, 100].map((value) => (
                <button key={value} className={pct === value ? "active" : ""} disabled={busy} aria-label={`Mark ${value}% complete`}
                  onClick={() => post({ action: "update", ro: job.ro, kind: value === 100 ? (job.status === "diag" ? "Diag Done" : "Done") : "note", percentComplete: value })}>{value === 100 ? "Done" : `${value}%`}</button>))}</div>}
              {openRo === job.ro && !job.custom && <TechTicket key={job.ro} identifix={Boolean(data.features?.identifix)} checkin={(data.checkins ?? []).find((item) => item.ro === checkinRo(job))} identifixResult={data.features?.identifixResults ? latestByRo(data.identifixRequests ?? []).get(checkinRo(job)) ?? null : null} job={job} latest={latest(job.ro)} busy={busy} post={post} dayStart={tech.dayStartMinute} />}
            </li>
          );
        })}</ul>
      </section>
      <section className="tech-section">
        <h2>Open jobs</h2>
        {(data.pool ?? []).length === 0 && <p className="tb-empty">No unassigned jobs right now.</p>}
        <ul className="tech-pool">{(data.pool ?? []).map((job) => {
          const request = requestFor(job.ro);
          return (
            <li key={job.ro}><div><strong>{title(job)}</strong><span>{job.vehicle}{job.label ? ` · ${job.label}` : ""} · {job.hours > 0 ? `${job.hours.toFixed(1)}h` : hoursText(job.durationMinutes)}</span></div>
              {request ? <span className={`tech-status ${request.status}`}>{request.status === "pending" ? "Requested · pending" : request.status === "approved" ? "Approved" : "Declined"}</span>
                : <button className="tb-primary" disabled={busy} onClick={() => post({ action: "pool-request", ro: job.ro })}>Request this job</button>}</li>
          );
        })}</ul>
        {(data.requests ?? []).filter((request) => !(data.pool ?? []).some((job) => job.ro === request.ro)).map((request) => (
          <p key={request.id} className="tech-request-line">RO#{request.ro}: <span className={`tech-status ${request.status}`}>{request.status === "approved" ? "Approved · on your column" : request.status === "declined" ? "Declined" : "Pending"}</span></p>))}
      </section>
      <section className="tech-section">
        <SuggestionBox mode="tech" suggestions={data.suggestions ?? []} busy={busy} onSubmit={(value) => post({ action: "suggest", ...value })} />
      </section>
      <section className="tech-section">
        <h2>Request time off</h2>
        <div className="tb-fields">
          <label>Date<input type="date" value={off.date} min={data.today} onChange={(event) => setOff({ ...off, date: event.target.value })} /></label>
          <label className="tb-check"><input type="checkbox" checked={off.allDay} onChange={(event) => setOff({ ...off, allDay: event.target.checked })} /> All day</label>
          {!off.allDay && <>
            <label>From<select value={off.startMinute} onChange={(event) => setOff({ ...off, startMinute: Number(event.target.value) })}>{TIMES.map((m) => <option key={m} value={m}>{clock(tech.dayStartMinute, m)}</option>)}</select></label>
            <label>To<select value={off.endMinute} onChange={(event) => setOff({ ...off, endMinute: Number(event.target.value) })}>{TIMES.map((m) => <option key={m} value={m}>{clock(tech.dayStartMinute, m)}</option>)}</select></label>
          </>}
        </div>
        <label className="tb-comment">Reason<input value={off.reason} onChange={(event) => setOff({ ...off, reason: event.target.value })} placeholder="Doctor, vacation…" /></label>
        <button className="tb-primary" disabled={busy || !off.date} onClick={async () => { if (await post({ action: "timeoff", ...off })) { setNotice("Time off added. The writers can see it."); setOff({ ...off, reason: "" }); } }}>Request time off</button>
        {notice && <p className="tech-ok">{notice}</p>}
        <ul className="tb-list">{offToday.map((item) => <li key={item.id}><i style={{ background: BOARD_COLORS.timeOff }} /><div><strong>{item.date}</strong><span>{item.allDay ? "All day" : `${clock(tech.dayStartMinute, item.startMinute)} – ${clock(tech.dayStartMinute, item.endMinute)}`}{item.reason ? ` · ${item.reason}` : ""}</span></div></li>)}</ul>
      </section>
    </main>
  );
}

/** v1.6.12: the writer ticket card's controls for the tech's own job (status, % complete, tech estimate, comment, Tekmetric link).
 *  Writer-only controls (move/resize, remove, unpin, add block, RO search, PINs) are not here. */
function TechTicket({ job, latest, busy, post, dayStart, identifix = false, checkin, identifixResult }: { job: Job; identifix?: boolean; checkin?: Checkin; identifixResult?: IdentifixRequest | null; latest?: { kind: string; percentComplete: number | null; comment?: string };
  busy: boolean; post: (body: Record<string, unknown>) => Promise<unknown>; dayStart: number }) {
  const [percent, setPercent] = useState(latest?.percentComplete?.toString() ?? "");
  const [estimate, setEstimate] = useState(job.techEstimateHours?.toString() ?? "");
  const [comment, setComment] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  async function save(issue?: string) {
    const chosen = issue ?? kind;
    const ok = await post({ action: "update", ro: job.ro, kind: chosen ?? "note", percentComplete: percent === "" ? null : Number(percent), comment,
      techEstimateHours: estimate === "" ? null : Number(estimate) });
    if (ok) { setSaved(`Saved${chosen ? ` · ${chosen}` : ""}`); setComment(""); }
  }
  return (
    <div className="tech-ticket" data-testid="tech-ticket">
      <ApptDetails info={job.apptInfo} />
      <dl className="tb-facts">
        <div><dt>Customer</dt><dd>{job.customer || "—"}</dd></div>
        <div><dt>Label</dt><dd>{job.label || "Unlabeled"}</dd></div>
        <div><dt>Labor hours</dt><dd>{job.laborGuideHours > 0 ? `${job.laborGuideHours.toFixed(1)}h (from RO)` : "Not on RO"}</dd></div>
        <div><dt>Scheduled</dt><dd>{job.startMinute < 0 ? "Front office row" : `${hoursText(job.durationMinutes)} · ${clock(dayStart, job.startMinute)} – ${clock(dayStart, wallEnd(job.startMinute, job.durationMinutes))}`}</dd></div>
      </dl>
      {job.status === "preset" && <p className="tb-pinned-note">Pre-Set appointment: the customer is coming at this time.</p>}
      {job.detailUrl ? <a className="tb-link" href={job.detailUrl} target="_blank" rel="noreferrer">Open in Tekmetric →</a> : null}
      {identifix && <CheckinList checkin={checkin} vehicle={job.vehicle} />}
      {identifix && !(checkin?.codes.length) && <DtcBox vehicle={job.vehicle} />}{/* v1.6.18: one code place — the box only shows when there are no check-in codes */}
      {identifixResult && <IdentifixResults request={identifixResult} />}
      <div className="tb-section"><small>Status</small>
        <div className="tb-issues tech-issues">{ISSUES.map((issue) => <button key={issue} className={kind === issue ? "active" : ""} disabled={busy}
          onClick={() => { setKind(issue); void save(issue); }}>{issue}</button>)}</div>
      </div>
      <div className="tb-fields">
        <label>% complete<input type="number" inputMode="numeric" min={0} max={100} value={percent} onChange={(event) => setPercent(event.target.value)} /></label>
        <label>My estimate (h)<input type="number" inputMode="decimal" min={0} step={0.25} value={estimate} placeholder={job.laborGuideHours.toFixed(1)} onChange={(event) => setEstimate(event.target.value)} /></label>
      </div>
      <label className="tb-comment">Comment<textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What's going on with this ticket? (writers see this)" /></label>
      {latest?.comment ? <p className="tech-last-comment">Last note: {latest.comment}</p> : null}
      <div className="tb-drawer-foot"><span>{saved || (latest && latest.kind !== "note" ? `Last status: ${latest.kind}` : "Saved to the board only. Nothing goes to Tekmetric.")}</span>
        <button className="tb-primary" disabled={busy} onClick={() => void save()}>Save</button></div>
    </div>
  );
}
