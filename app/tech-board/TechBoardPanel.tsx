"use client";

import { DragEvent, Fragment, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { BOARD_COLORS, cardColor, tekColor } from "./colors";
import { APP_VERSION } from "../lib/version";
import SuggestionBox from "./SuggestionBox";
import ScheduleRequestBox from "./ScheduleRequestBox";
import type { Suggestion } from "./suggestions";
import type { ScheduleRequest } from "./schedule-requests";
import { searchRos } from "./ro-search";
import { ApptDetails, apptSummary } from "./ApptDetails";
import { CheckinEditor } from "./DtcBox";
import { checkinRo, type Checkin } from "./dtc";
import { latestByRo, requestStatusText, type IdentifixRequest } from "./identifix";
import { DIAG_END, blockRo, LUNCH_END, LUNCH_START, cardSpan, clampStart, dayWallLimit, isLockedJob, isStalled, wallEnd } from "./scheduler";

type Tech = { initials: string; name: string; dayMinutes: number; diagBlockMinutes: number; dayStartMinute: number; active: boolean };
type Job = {
  ro: string; vehicle: string; customer: string; label: string; detailUrl: string; tech: string; assignedTech: string | null;
  laborGuideHours: number; techEstimateHours: number | null; laneDate: string; position: number; startMinute: number;
  durationMinutes: number; pinned: boolean; placedBy: "auto" | "writer"; status: "preset" | "diag" | "part-arrived" | "ready" | "custom" | "waiting" | "front-office"; inDiagBlock: boolean;
  title?: string; note?: string; custom?: boolean; linkedRo?: string | null; carriedOver?: boolean; roNumber?: string; jobName?: string; jobOrder?: number; durationOverrideMinutes?: number | null; loggedSeconds?: number | null; apptKey?: string | null; apptInfo?: string | null; autoPlaced?: boolean; needsPlacing?: string | null;
};
export type SyncedRo = { ro: string; customer: string; vehicle: string; label: string; hours: number; detailUrl: string };
type Update = { ro: string; kind: string; percentComplete: number | null; comment: string; createdAt: string };
type TimeOff = { id: number; initials: string; date: string; startMinute: number; endMinute: number; allDay: boolean; reason: string; createdBy?: string };
type PoolRequest = { id: number; ro: string; tech: string; status: string; note: string; createdAt: string };
export type Board = {
  today: string; days: string[]; date: string; techs: Tech[]; jobs: Job[]; unassigned: string; updates?: Update[];
  timeOff?: TimeOff[]; poolRequests?: PoolRequest[]; syncedRos?: SyncedRo[]; suggestions?: Suggestion[]; scheduleRequests?: ScheduleRequest[]; pinsSet?: string[]; version?: string;
  checkins?: Checkin[]; identifixRequests?: IdentifixRequest[];
  roVins?: Record<string, string>; unmatchedScans?: UnmatchedScan[];
};
type UnmatchedScan = { id: number; deviceId: string; vin: string; receivedAt: string; matchCount: number; scan: { modules: { codes: { code: string }[] }[]; odometer: number | null } };

/** v1.6.18: Bay Scan scans whose VIN matched 0 or 2+ open ROs — a writer picks the RO. */
function UnmatchedScans({ board, onSave, readOnly }: { board: Board; onSave: Act; readOnly: boolean }) {
  const scans = board.unmatchedScans ?? [];
  const [pick, setPick] = useState<Record<number, string>>({});
  return (<>
    <div className="tb-requests-head"><h3>Unmatched scans</h3></div>
    {scans.length === 0 ? <p className="tb-empty">Every Bay Scan scan is on an RO.</p>
      : <ul className="tb-list tb-unmatched" data-testid="unmatched-scans">{scans.map((item) => {
        const codes = [...new Set(item.scan.modules.flatMap((m) => m.codes.map((c) => c.code)))];
        return (<li key={item.id}><i style={{ background: "#c0392b" }} /><div><strong>VIN {item.vin}</strong>
          <span>{item.deviceId} · {new Date(item.receivedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} · {item.matchCount > 1 ? `${item.matchCount} open ROs have this VIN` : "no open RO has this VIN"} · {codes.length ? codes.join(" ") : "no codes"}</span>
          <RoPicker ros={board.syncedRos ?? []} value={pick[item.id] ?? null} onPick={(ro) => setPick((prev) => ({ ...prev, [item.id]: ro?.ro ?? "" }))} /></div>
          <button className="tb-approve" disabled={readOnly || !pick[item.id]} onClick={() => onSave({ action: "bayscan-attach", id: item.id, ro: pick[item.id] })}>Attach</button>
          <button disabled={readOnly} onClick={() => onSave({ action: "bayscan-dismiss", id: item.id })}>Dismiss</button></li>);
      })}</ul>}
  </>);
}
type Act = (body: Record<string, unknown>) => Promise<void>;

const PX = 1.4; // px per minute, vertical
const ISSUES = ["Need parts", "Wrong part", "Need help", "Waiting approval", "Found more work", "Done", "Diag Done"];

function clock(dayStart: number, minute: number) {
  const total = dayStart + minute;
  const h = Math.floor(total / 60), m = total % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
const roTitle = (customer: string | undefined, ro: string) => `${customer ? `${customer} · ` : ""}RO#${ro}`;
const jobTitle = (job: Job) => job.custom
  ? (job.linkedRo ? roTitle(job.customer, job.linkedRo) : (job.title || "Custom block"))
  : `${roTitle(job.customer, job.roNumber || job.ro)}${job.jobName ? ` · ${job.jobName}` : ""}`;
export const hoursText = (minutes: number) => `${(Math.round(minutes / 6) / 10).toFixed(1)}h`;

/** Type-ahead over the synced Tekmetric ROs (number, customer, vehicle). Read-only: picking only links the block. */
export function RoPicker({ ros, value, onPick, autoFocus = false }: { ros: SyncedRo[]; value: string | null; onPick: (ro: SyncedRo | null) => void; autoFocus?: boolean }) {
  const current = ros.find((item) => item.ro === value);
  const [query, setQuery] = useState(current ? `${current.customer} · RO#${current.ro}` : value ? `RO#${value}` : "");
  const [open, setOpen] = useState(false);
  const q = query.toLowerCase().replace(/^ro#?/, "").trim();
  const matches = searchRos(ros, q, 8);
  return (
    <div className="tb-ro-picker">
      <input value={query} autoFocus={autoFocus} placeholder="Search RO#, customer or vehicle" aria-label="RO search"
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); if (!event.target.value) onPick(null); }} />
      {value && <button type="button" className="tb-ro-clear" onClick={() => { setQuery(""); onPick(null); }} aria-label="Unlink RO">×</button>}
      {open && matches.length > 0 && <ul className="tb-ro-list" role="listbox">{matches.map((item) => (
        <li key={item.ro} role="option" aria-selected={item.ro === value} onMouseDown={(event) => { event.preventDefault(); setQuery(`${item.customer} · RO#${item.ro}`); setOpen(false); onPick(item); }}>
          <strong>{item.customer || "—"} · RO#{item.ro}</strong><span>{item.vehicle}{item.hours ? ` · ${item.hours.toFixed(1)}h` : ""}{item.label ? ` · ${item.label}` : ""}</span>
        </li>))}</ul>}
      {open && q && matches.length === 0 && <ul className="tb-ro-list"><li className="tb-ro-none">No synced RO matches “{query}”.</li></ul>}
    </div>
  );
}
const dayLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function TimeSelect({ value, onChange, dayStart, limit, allowLunch = false }: { value: number; onChange: (value: number) => void; dayStart: number; limit: number; allowLunch?: boolean }) {
  const options = Array.from({ length: Math.floor(limit / 15) + 1 }, (_, index) => index * 15)
    .filter((minute) => allowLunch || !(minute >= LUNCH_START && minute < LUNCH_END));
  return <select value={value} onChange={(event) => onChange(Number(event.target.value))}>{options.map((minute) => <option key={minute} value={minute}>{clock(dayStart, minute)}</option>)}</select>;
}

function EditBlock({ job, techs, days, dayStart, limit, unassigned, onSave, readOnly, ros }: {
  job: Job; techs: Tech[]; days: string[]; dayStart: number; limit: number; unassigned: string; onSave: Act; readOnly: boolean; ros: SyncedRo[];
}) {
  const [linked, setLinked] = useState<string | null>(job.linkedRo ?? null);
  const [title, setTitle] = useState(job.title || "");
  const [hours, setHours] = useState((job.durationMinutes / 60).toString());
  const [start, setStart] = useState(job.startMinute);
  const [tech, setTech] = useState(job.tech);
  const [laneDate, setLaneDate] = useState(job.laneDate);
  const [note, setNote] = useState(job.note || "");
  return (
    <div className="tb-section tb-edit">
      <small>Edit block</small>
      <div className="tb-fields">
        {job.custom && <label className="tb-wide">Tekmetric RO<RoPicker ros={ros} value={linked} onPick={(item) => setLinked(item?.ro ?? null)} /></label>}
        <label>Title<input value={title} placeholder={job.custom ? "Custom block" : jobTitle(job)} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Length (h)<input type="number" min={0.25} step={0.25} value={hours} onChange={(event) => setHours(event.target.value)} /></label>
        <label>Start<TimeSelect value={start} onChange={setStart} dayStart={dayStart} limit={limit} /></label>
        <label>Tech<select value={tech} onChange={(event) => setTech(event.target.value)}>{techs.map((item) => <option key={item.initials} value={item.initials}>{item.name}</option>)}<option value={unassigned}>Unassigned</option></select></label>
        <label>Day<select value={laneDate} onChange={(event) => setLaneDate(event.target.value)}>{days.map((value) => <option key={value} value={value}>{dayLabel(value)}</option>)}</select></label>
      </div>
      <label className="tb-comment">Note<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="tb-drawer-foot">
        <button className="tb-danger" disabled={readOnly} onClick={() => { if (window.confirm(job.custom ? "Delete this block?" : "Remove this RO from the board? (Tekmetric is not changed.)")) onSave({ action: "delete", ro: job.ro }); }}>{job.custom ? "Delete" : "Remove from board"}</button>
        <button className="tb-primary" disabled={readOnly} onClick={() => onSave({ action: "edit", ro: job.ro, title, note, startMinute: start, tech, laneDate,
          durationMinutes: Math.round(Number(hours) * 60) === job.durationMinutes ? null : Math.round(Number(hours) * 60),
          ...(job.custom ? { linkedRo: linked ?? "" } : {}) })}>Save changes</button>
      </div>
    </div>
  );
}

function TicketDrawer({ job, latest, onClose, onSave, readOnly, techs, days, dayStart, limit, unassigned, ros, checkin, identifix, vin = "" }: {
  checkin?: Checkin | null; identifix?: IdentifixRequest | null; vin?: string;
  job: Job; latest?: Update; onClose: () => void; readOnly: boolean; onSave: Act;
  techs: Tech[]; days: string[]; dayStart: number; limit: number; unassigned: string; ros: SyncedRo[];
}) {
  const [percent, setPercent] = useState(latest?.percentComplete?.toString() ?? "");
  const [comment, setComment] = useState("");
  const [estimate, setEstimate] = useState(job.techEstimateHours?.toString() ?? "");
  const [kind, setKind] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  async function save(issue?: string) {
    const chosen = issue ?? kind;
    await onSave({ action: "update", ro: job.ro, kind: chosen ?? "note", percentComplete: percent === "" ? null : Number(percent), comment, techEstimateHours: estimate === "" ? null : Number(estimate) });
    setSaved(`Saved${chosen ? ` · ${chosen}` : ""}`); setComment("");
  }
  return (
    <div className="modal-backdrop tb-drawer-backdrop" onClick={onClose}>
      <aside className="tb-drawer" onClick={(event) => event.stopPropagation()} aria-label={`${jobTitle(job)} detail`}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="panel-kicker">{job.custom ? (job.linkedRo ? `CUSTOM BLOCK · RO#${job.linkedRo}` : "CUSTOM BLOCK") : `RO#${job.roNumber || job.ro}${job.jobName ? ` · ${job.jobName.toUpperCase()}` : ""}`}{job.carriedOver ? " · CARRIED OVER" : ""}</p>
        <h2>{job.custom ? (job.title || "Custom block") : (job.vehicle || "Vehicle not read")}</h2>
        <ApptDetails info={job.apptInfo} />
        {!job.custom && <>
          <dl className="tb-facts">
            <div><dt>Customer</dt><dd>{job.customer || "—"}</dd></div>
            <div><dt>Label</dt><dd><span className="tb-label-pill" style={{ background: tekColor(job.label) }}>{job.label || "Unlabeled"}</span></dd></div>
            <div><dt>Labor hours</dt><dd>{job.laborGuideHours > 0 ? `${job.laborGuideHours.toFixed(1)}h (from RO)` : "Not on RO · 1h default"}</dd></div>
            <div><dt>Scheduled</dt><dd>{(job.durationMinutes / 60).toFixed(1)} h · {clock(dayStart, cardSpan(job.startMinute, job.durationMinutes).start)} – {clock(dayStart, cardSpan(job.startMinute, job.durationMinutes).end)}</dd></div>
            <div><dt>Logged in Tekmetric</dt><dd>{job.loggedSeconds ? `${(job.loggedSeconds / 3600).toFixed(2)} h` : "—"}</dd></div>
          </dl>
          {job.status === "preset" && <p className="tb-pinned-note">Pre-Set appointment: held at its set time. Drag it to change the time.</p>}
          {job.placedBy === "writer" && job.status !== "preset" && <p className="tb-pinned-note">Moved by a writer (kept as a preference) <button disabled={readOnly} onClick={() => onSave({ action: "unpin", ro: job.ro })}>Let the scheduler place it</button></p>}
          {job.detailUrl ? <a className="tb-link" href={job.detailUrl} target="_blank" rel="noreferrer">Open in Tekmetric →</a> : <span className="tb-link disabled">Tekmetric link unavailable</span>}
          <CheckinEditor key={`ck-${checkin?.updatedAt ?? ""}`} ro={checkinRo(job)} checkin={checkin} vehicle={job.vehicle} customer={job.customer ?? ""} request={identifix} vin={vin} onSave={onSave} readOnly={readOnly} />
          <div className="tb-section"><small>Status</small>
            <div className="tb-issues">{ISSUES.map((issue) => <button key={issue} className={kind === issue ? "active" : ""} disabled={readOnly} onClick={() => { setKind(issue); save(issue); }}>{issue}</button>)}</div>
          </div>
          <div className="tb-fields">
            <label>% complete<input type="number" min={0} max={100} value={percent} onChange={(event) => setPercent(event.target.value)} /></label>
            <label>Tech estimate (h)<input type="number" min={0} step={0.25} value={estimate} placeholder={job.laborGuideHours.toFixed(1)} onChange={(event) => setEstimate(event.target.value)} /></label>
          </div>
          <label className="tb-comment">Comment<textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a note for the writers" /></label>
          <div className="tb-drawer-foot"><span>{saved || (latest && latest.kind !== "note" ? `Last status: ${latest.kind}` : "Saved to the board only. Nothing goes to Tekmetric or Teams.")}</span><button className="tb-primary" disabled={readOnly} onClick={() => save()}>Save</button></div>
        </>}
        <EditBlock key={`${job.ro}-${job.startMinute}-${job.durationMinutes}-${job.tech}`} job={job} techs={techs} days={days} dayStart={dayStart} limit={limit} unassigned={unassigned} onSave={onSave} readOnly={readOnly} ros={ros} />
      </aside>
    </div>
  );
}

function AddForm({ slot, board, dayStart, limit, onClose, onSave, readOnly }: {
  slot: { tech: string; minute: number; ro?: SyncedRo }; board: Board; dayStart: number; limit: number; onClose: () => void; onSave: Act; readOnly: boolean;
}) {
  const day = board.date;
  // Every synced RO is searchable; ROs already on the board are moved, others become a block linked to the RO.
  const onBoard = new Map<string, Job>();
  for (const job of board.jobs.filter((item) => !item.custom).sort((a, b) => (a.jobOrder ?? 0) - (b.jobOrder ?? 0))) if (!onBoard.has(job.roNumber || job.ro)) onBoard.set(job.roNumber || job.ro, job);
  const ros: SyncedRo[] = [...(board.syncedRos ?? [])];
  for (const job of onBoard.values()) if (!ros.some((item) => item.ro === job.ro)) ros.push({ ro: job.ro, customer: job.customer, vehicle: job.vehicle, label: job.label, hours: job.laborGuideHours, detailUrl: job.detailUrl });
  const [tech, setTech] = useState(slot.tech);
  const [picked, setPicked] = useState<SyncedRo | null>(slot.ro ?? null);
  const [start, setStart] = useState(clampStart(slot.minute));
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState(slot.ro?.hours ? String(slot.ro.hours) : "1");
  const [note, setNote] = useState("");
  const existing = picked ? onBoard.get(picked.ro) : undefined;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="setup-modal tb-add" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Add to board">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="panel-kicker">ADD JOB</p>
        <h2>{dayLabel(day)} · {clock(dayStart, start)}</h2>
        <label className="tb-comment">Tekmetric RO<RoPicker ros={ros} value={picked?.ro ?? null} autoFocus
          onPick={(item) => { setPicked(item); if (item?.hours) setHours(String(item.hours)); }} /></label>
        {picked && <p className="tb-ro-picked">{existing ? `On the board (${existing.tech === board.unassigned ? "Unassigned" : existing.tech}, ${(existing.durationMinutes / 60).toFixed(1)}h). It will move here.` : `Not scheduled yet. Adds a ${hours}h block linked to RO#${picked.ro}.`}</p>}
        <div className="tb-fields">
          <label>Tech<select value={tech} onChange={(event) => setTech(event.target.value)}><option value={board.unassigned}>Unassigned</option>{board.techs.filter((item) => item.active).map((item) => <option key={item.initials} value={item.initials}>{item.name}</option>)}</select></label>
          <label>Start<TimeSelect value={start} onChange={setStart} dayStart={dayStart} limit={limit} /></label>
          {!existing && <label>Length (h)<input type="number" min={0.25} step={0.25} value={hours} onChange={(event) => setHours(event.target.value)} /></label>}
        </div>
        {!existing && <>
          <label className="tb-comment">{picked ? "Title (optional)" : "Title (custom block — no RO)"}<input value={title} placeholder={picked ? "e.g. Road test" : "e.g. Shop cleanup, Training"} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="tb-comment">Note<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </>}
        <div className="tb-drawer-foot"><span>Board only. Tekmetric is not changed.</span>
          <button className="tb-primary" disabled={readOnly} onClick={async () => {
            if (existing) await onSave({ action: "move", ro: existing.ro, tech, laneDate: day, startMinute: start });
            else await onSave({ action: "add-custom", tech, laneDate: day, startMinute: start, durationMinutes: Math.round(Number(hours) * 60), title, note, linkedRo: picked?.ro ?? "" });
            onClose();
          }}>Add</button>
        </div>
      </div>
    </div>
  );
}

function PinsPanel({ board, onSave, readOnly }: { board: Board; onSave: Act; readOnly: boolean }) {
  const [pins, setPins] = useState<Record<string, string>>({});
  const set = new Set(board.pinsSet ?? []);
  return (
    <div className="tb-requests-col">
      <div className="tb-requests-head"><h3>Tech PINs for /tech</h3></div>
      <p className="tb-empty">Each tech signs in at /tech with their own 4–8 digit PIN. PINs are stored hashed.</p>
      <ul className="tb-list">{board.techs.filter((tech) => tech.active).map((tech) => (
        <li key={tech.initials}><i style={{ background: set.has(tech.initials) ? BOARD_COLORS.ready : "#6b7280" }} />
          <div><strong>{tech.name}</strong><span>{set.has(tech.initials) ? "PIN set" : "No PIN yet"}</span></div>
          <input className="tb-pin-input" inputMode="numeric" type="password" autoComplete="new-password" maxLength={8} placeholder="New PIN" aria-label={`New PIN for ${tech.name}`}
            value={pins[tech.initials] ?? ""} onChange={(event) => setPins({ ...pins, [tech.initials]: event.target.value.replace(/\D/g, "") })} />
          <button disabled={readOnly || !/^\d{4,8}$/.test(pins[tech.initials] ?? "")} onClick={async () => { await onSave({ action: "pin-set", initials: tech.initials, pin: pins[tech.initials] }); setPins({ ...pins, [tech.initials]: "" }); }}>Set</button>
          {set.has(tech.initials) && <button disabled={readOnly} onClick={() => onSave({ action: "pin-clear", initials: tech.initials })}>Clear</button>}
        </li>))}</ul>
    </div>
  );
}

function RequestsPanel({ board, dayStart, limit, onSave, readOnly }: { board: Board; dayStart: number; limit: number; onSave: Act; readOnly: boolean }) {
  const techs = board.techs.filter((tech) => tech.active);
  const name = (initials: string) => techs.find((tech) => tech.initials === initials)?.name ?? initials;
  const blank = { id: 0, initials: techs[0]?.initials ?? "", date: board.date, startMinute: 0, endMinute: 240, allDay: true, reason: "" };
  const [form, setForm] = useState<TimeOff | null>(null);
  const [poolTech, setPoolTech] = useState(techs[0]?.initials ?? "");
  const pool = board.jobs.filter((job) => !job.custom && job.tech === board.unassigned);
  const [poolRo, setPoolRo] = useState("");
  const job = (ro: string) => board.jobs.find((item) => item.ro === ro);
  return (
    <div className="panel tb-requests">
      <div className="tb-requests-col">
        <div className="tb-requests-head"><h3>Time off</h3><button disabled={readOnly} onClick={() => setForm(blank)}>+ Request time off</button></div>
        {form && (
          <div className="tb-timeoff-form">
            <div className="tb-fields">
              <label>Tech<select value={form.initials} onChange={(event) => setForm({ ...form, initials: event.target.value })}>{techs.map((tech) => <option key={tech.initials} value={tech.initials}>{tech.name}</option>)}</select></label>
              <label>Date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
              <label className="tb-check"><input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} /> All day</label>
              {!form.allDay && <>
                <label>From<TimeSelect value={form.startMinute} onChange={(value) => setForm({ ...form, startMinute: value })} dayStart={dayStart} limit={limit} allowLunch /></label>
                <label>To<TimeSelect value={form.endMinute} onChange={(value) => setForm({ ...form, endMinute: value })} dayStart={dayStart} limit={limit} allowLunch /></label>
              </>}
            </div>
            <label className="tb-comment">Reason<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Doctor, vacation, school pickup…" /></label>
            <div className="tb-drawer-foot"><button onClick={() => setForm(null)}>Cancel</button><button className="tb-primary" disabled={readOnly} onClick={async () => { await onSave({ action: "timeoff-save", ...form, id: form.id || undefined }); setForm(null); }}>{form.id ? "Save" : "Block time"}</button></div>
          </div>
        )}
        {(board.timeOff ?? []).length === 0 && !form && <p className="tb-empty">No time off on the books.</p>}
        <ul className="tb-list">{(board.timeOff ?? []).map((off) => (
          <li key={off.id}><i style={{ background: BOARD_COLORS.timeOff }} /><div><strong>{name(off.initials)}</strong><span>{dayLabel(off.date)} · {off.allDay ? "All day" : `${clock(dayStart, off.startMinute)} – ${clock(dayStart, off.endMinute)}`}{off.reason ? ` · ${off.reason}` : ""}{off.createdBy?.startsWith("Tech ") ? " · requested on /tech" : ""}</span></div>
            <button disabled={readOnly} onClick={() => setForm(off)}>Edit</button><button disabled={readOnly} onClick={() => onSave({ action: "timeoff-delete", id: off.id })}>Remove</button></li>
        ))}</ul>
      </div>
      <div className="tb-requests-col">
        {/* v1.6.16: approved jobs the board couldn't auto-place (no tech fits / day full). Drag one from Unassigned onto a tech. */}
        <div className="tb-requests-head"><h3>Needs placing</h3></div>
        {board.jobs.filter((item) => item.needsPlacing).length === 0 ? <p className="tb-empty">Every approved job is on a schedule.</p>
          : <ul className="tb-list tb-needs-placing">{board.jobs.filter((item) => item.needsPlacing).map((item) => (
            <li key={item.ro}><i style={{ background: "#e8a317" }} /><div><strong>{jobTitle(item)}</strong><span>{(item.durationMinutes / 60).toFixed(1)} h · {item.needsPlacing} · drag it from Unassigned onto a tech</span></div></li>))}</ul>}
        <UnmatchedScans board={board} onSave={onSave} readOnly={readOnly} />
        <div className="tb-requests-head"><h3>Job requests</h3></div>
        <div className="tb-pool-form">
          <select value={poolTech} onChange={(event) => setPoolTech(event.target.value)}>{techs.map((tech) => <option key={tech.initials} value={tech.initials}>{tech.name}</option>)}</select>
          <select value={poolRo} onChange={(event) => setPoolRo(event.target.value)}><option value="">{pool.length ? "Pick an open job…" : "No open jobs in the pool"}</option>{pool.map((item) => <option key={item.ro} value={item.ro}>{jobTitle(item)} · {(item.durationMinutes / 60).toFixed(1)} h</option>)}</select>
          <button disabled={readOnly || !poolRo} onClick={async () => { await onSave({ action: "pool-request", ro: poolRo, tech: poolTech }); setPoolRo(""); }}>Request</button>
        </div>
        {(board.poolRequests ?? []).length === 0 && <p className="tb-empty">No pending requests.</p>}
        <ul className="tb-list">{(board.poolRequests ?? []).map((request) => {
          const item = job(request.ro);
          return (
            <li key={request.id}><i style={{ background: BOARD_COLORS.ready }} /><div><strong>{name(request.tech)} wants {item ? jobTitle(item) : `RO#${request.ro}`}</strong><span>{item ? `${item.vehicle} · ${(item.durationMinutes / 60).toFixed(1)} h` : "Job no longer on the board"}</span></div>
              <button className="tb-approve" disabled={readOnly || !item} onClick={() => onSave({ action: "pool-decide", id: request.id, decision: "approve", laneDate: board.date })}>Approve</button>
              <button disabled={readOnly} onClick={() => onSave({ action: "pool-decide", id: request.id, decision: "decline" })}>Decline</button></li>
          );
        })}</ul>
      </div>
      <PinsPanel board={board} onSave={onSave} readOnly={readOnly} />
    </div>
  );
}

export default function TechBoardPanel({ initial, initialOpenRo }: { initial?: Board; initialOpenRo?: string }) {
  const [board, setBoard] = useState<Board | null>(initial ?? null);
  const [date, setDate] = useState<string | null>(initial?.date ?? null);
  const [openRo, setOpenRo] = useState<string | null>(initialOpenRo ?? null);
  const [addSlot, setAddSlot] = useState<{ tech: string; minute: number; ro?: SyncedRo } | null>(null);
  const [resizing, setResizing] = useState<{ ro: string; minutes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const suppressClickUntil = useRef(0); // a resize ends with a click on the column; ignore it
  const tap = useRef<{ x: number; y: number; t: number } | null>(null);

  const load = useCallback((value?: string | null) => {
    if (initial) return;
    fetch(`/api/tech-board${value ? `?date=${value}` : ""}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load the Tech Board")))
      .then((payload: Board) => { setBoard(payload); setDate((current) => current ?? payload.date); })
      .catch((reason: Error) => setError(reason.message));
  }, [initial]);
  useEffect(() => { load(date); const timer = setInterval(() => load(date), 60000); return () => clearInterval(timer); }, [load, date]);

  async function act(body: Record<string, unknown>) {
    if (initial) return false;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/tech-board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, laneDate: body.laneDate ?? date }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Update failed");
      const payload = await response.json() as Board & { notice?: string };
      if (payload.notice) { setNotice(payload.notice); setTimeout(() => setNotice(""), 6000); }
      setBoard({ ...payload, date: date ?? payload.date });
      return true;
    } catch (reason) { setError((reason as Error).message); return false; } finally { setBusy(false); }
  }

  if (!board) return <section className="job-control-page"><div className="page-heading"><div><h2>Tech Board</h2><p>{error || "Loading…"}</p></div></div></section>;
  const day = date ?? board.date;
  const view = { ...board, date: day };
  const identifixByRo = latestByRo(board.identifixRequests ?? []); // v1.6.17
  const techs = board.techs.filter((tech) => tech.active);
  const workMinutes = Math.max(480, ...techs.map((tech) => tech.dayMinutes));
  const dayMinutes = workMinutes + (LUNCH_END - LUNCH_START); // wall clock: 8:00 AM – 5:00 PM with lunch
  const dayStart = techs[0]?.dayStartMinute ?? 480;
  const diagMinutes = techs[0]?.diagBlockMinutes ?? 120;
  const lanes = [...techs.map((tech) => ({ id: tech.initials, name: tech.name })), { id: board.unassigned, name: "Unassigned" }];
  const todays = board.jobs.filter((job) => job.laneDate === day && job.status !== "front-office" && job.startMinute >= 0);
  // v1.6.6: Front office row = Tekmetric's 6–7 AM slot (finished diags + anything a writer drops there); no work time.
  const early = board.jobs.filter((job) => job.laneDate === day && (job.status === "front-office" || job.startMinute < 0));
  const rowOf = (job: Job) => (job.startMinute < 0 && job.startMinute > -90 ? -60 : -120);
  // v1.6.7: a custom block tied to an RO (linkedRo or "RO#12345" in its title) takes that RO's status color and label chip.
  const roInfo = (job: Job) => {
    if (!job.custom) return { color: cardColor(job, latest(job.ro)?.kind), chip: "" };
    const ro = blockRo(job);
    if (!ro) return { color: "var(--steel)", chip: "" };
    const synced = board.jobs.find((item) => !item.custom && item.roNumber === ro);
    const label = synced?.label || board.syncedRos?.find((item) => item.ro === ro)?.label || job.label || "";
    const kind = latest(job.ro)?.kind ?? (synced ? latest(synced.ro)?.kind : undefined);
    const color = synced ? cardColor(synced, kind) : kind ? cardColor({ status: "ready", label }, kind) : label ? tekColor(label) : "var(--steel)";
    return { color, chip: label.trim() };
  };
  const offs = (board.timeOff ?? []).filter((off) => off.date === day);
  const hours = Array.from({ length: Math.floor(dayMinutes / 60) + 1 }, (_, index) => index * 60);
  const openJob = board.jobs.find((job) => job.ro === openRo);
  const latest = (ro: string) => board.updates?.find((update) => update.ro === ro);
  const dayIndex = board.days.indexOf(day);
  const firstOpen = (tech: string) => {
    const busy = [...todays.filter((job) => job.tech === tech).map((job) => ({ start: job.startMinute, end: wallEnd(job.startMinute, job.durationMinutes) })),
      ...offs.filter((off) => off.initials === tech).map((off) => ({ start: off.allDay ? 0 : off.startMinute, end: off.allDay ? dayMinutes : off.endMinute }))];
    for (let minute = DIAG_END; minute < dayMinutes; minute += 15) {
      if (minute >= LUNCH_START && minute < LUNCH_END) continue;
      if (!busy.some((item) => minute >= item.start && minute < item.end)) return minute;
    }
    return DIAG_END;
  };
  /** Empty 30-min slots for the visible "+" targets (outside cards, time off and lunch). */
  const openSlots = (tech: string) => {
    const busy = [...todays.filter((job) => job.tech === tech).map((job) => ({ start: job.startMinute, end: wallEnd(job.startMinute, job.durationMinutes) })),
      ...offs.filter((off) => off.initials === tech).map((off) => ({ start: off.allDay ? 0 : off.startMinute, end: off.allDay ? dayMinutes : off.endMinute })),
      { start: LUNCH_START, end: LUNCH_END }];
    const slots: number[] = [];
    for (let minute = 0; minute + 30 <= dayMinutes; minute += 30) if (!busy.some((item) => minute < item.end && minute + 30 > item.start)) slots.push(minute);
    return slots;
  };
  /** Pointer tap with a movement threshold: works for mouse, pen and touch; a drag or scroll is not a tap. */
  const tapHandlers = (open: () => void) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => { tap.current = { x: event.clientX, y: event.clientY, t: Date.now() }; },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const start = tap.current; tap.current = null;
      if (!start || Date.now() < suppressClickUntil.current) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 || Date.now() - start.t > 800) return;
      event.preventDefault(); open();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } },
  });
  const snap = (minute: number) => Math.max(0, Math.min(dayMinutes - 15, Math.round(minute / 15) * 15));

  function onDrop(event: DragEvent<HTMLDivElement>, tech: string) {
    event.preventDefault();
    const ro = event.dataTransfer.getData("text/ro");
    const offset = Number(event.dataTransfer.getData("text/offset")) || 0;
    const rect = event.currentTarget.getBoundingClientRect();
    if (ro) act({ action: "move", ro, tech, laneDate: day, startMinute: clampStart(snap((event.clientY - rect.top - offset) / PX)) });
  }

  function startResize(event: ReactPointerEvent<HTMLSpanElement>, job: Job) {
    // Drag the bottom edge to change the block's scheduled length (15-minute snap).
    event.preventDefault(); event.stopPropagation();
    const card = event.currentTarget.closest<HTMLElement>(".tb-card");
    if (card) { card.dataset.nodrag = "1"; card.draggable = false; }
    const originY = event.clientY;
    let next = job.durationMinutes;
    const move = (moveEvent: PointerEvent) => {
      next = Math.max(15, Math.round((job.durationMinutes + (moveEvent.clientY - originY) / PX) / 15) * 15);
      setResizing({ ro: job.ro, minutes: next });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      if (card) { delete card.dataset.nodrag; card.draggable = true; }
      setResizing(null);
      suppressClickUntil.current = Date.now() + 400;
      if (next !== job.durationMinutes) act({ action: "resize", ro: job.ro, durationMinutes: next });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  return (
    <section className="job-control-page tech-board-page">
      <div className="page-heading">
        <div>
          <p className="panel-kicker">SHOP SCHEDULE</p>
          <h2>Tech Board</h2>
          <p>Built day by day from the synced Tekmetric board. 8–10 AM is diag only. Drag a job to move it, drag its bottom edge to resize, tap + to add.</p>
        </div>
        <div className="job-toolbar tb-toolbar">
          <div className="tb-search" title="Find any synced Tekmetric RO (even with no approved labor) and add it to the board">
            <RoPicker ros={board.syncedRos ?? []} value={null} onPick={(item) => { if (item) setAddSlot({ tech: board.unassigned, minute: DIAG_END, ro: item }); }} />
          </div>
          <span className="tb-version" title="Build version">Build {board.version ?? APP_VERSION}</span>
          <button aria-label="Previous day" disabled={dayIndex <= 0} onClick={() => setDate(board.days[dayIndex - 1])}>‹</button>
          <button onClick={() => setDate(board.today && board.days.includes(board.today) ? board.today : board.days[0])}>Today</button>
          <button aria-label="Next day" disabled={dayIndex >= board.days.length - 1} onClick={() => setDate(board.days[dayIndex + 1])}>›</button>
          <select value={day} onChange={(event) => setDate(event.target.value)}>
            {board.days.map((value) => <option key={value} value={value}>{dayLabel(value)}{value === board.today ? " · Today" : ""}</option>)}
          </select>
          <button disabled={busy} onClick={() => act({ action: "recompute" })}>{busy ? "Working…" : "Recompute"}</button>
        </div>
      </div>
      {error && <p className="tech-board-error">{error}</p>}
      {notice && <p className="tb-notice" role="status">{notice}</p>}
      <div className="panel tb-requests tb-schedule-panel"><ScheduleRequestBox requests={board.scheduleRequests ?? []} busy={busy} readOnly={Boolean(initial)}
        onSubmit={(value) => act({ action: "schedule-request-add", ...value })} onDone={(value) => act({ action: "schedule-request-ack", ...value })} /></div>
      <div className="panel tb-board">
        <div className="tb-grid" style={{ gridTemplateColumns: `56px repeat(${lanes.length}, minmax(150px, 1fr))` }}>
          <div />
          {lanes.map((lane) => {
            const count = todays.filter((job) => job.tech === lane.id);
            const booked = count.reduce((sum, job) => sum + job.durationMinutes, 0);
            const off = offs.filter((item) => item.initials === lane.id);
            return <div key={lane.id} className="tb-col-head"><strong>{lane.name}</strong>
              {lane.id !== board.unassigned && <button type="button" className="tb-head-add" disabled={Boolean(initial)} aria-label={`Add job for ${lane.name}`} onClick={() => setAddSlot({ tech: lane.id, minute: firstOpen(lane.id) })}>+ Add job</button>}<span>{lane.id === board.unassigned ? `${count.length} parked` : off.some((item) => item.allDay) ? "Off today" : `${(booked / 60).toFixed(1)} of ${(workMinutes / 60).toFixed(0)} h`}</span></div>;
          })}
          {([[-120, "6–7 AM", "Front office", "Don't forget"], [-60, "7–8 AM", "", ""]] as const).map(([minute, time, name, hint]) => <Fragment key={`row-${minute}`}>
            <div className="tb-front-label"><b>{time}</b>{name && <span>{name}</span>}{hint && <span>{hint}</span>}</div>
            {lanes.map((lane) => <div key={`fo-${minute}-${lane.id}`} className={`tb-front ${minute === -60 ? "tb-early" : ""}`} style={{ minHeight: 60 * PX }}
              onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const ro = event.dataTransfer.getData("text/ro");
                if (ro) act({ action: "move", ro, tech: lane.id, laneDate: day, startMinute: minute }); }}>
              {early.filter((job) => job.tech === lane.id && rowOf(job) === minute).map((job) => { const info = roInfo(job); return (
                <div key={job.ro} role="button" tabIndex={0} draggable className="tb-front-card" style={{ borderLeftColor: info.color }}
                  title={`${job.custom ? job.title : job.label} · ${time}`} onClick={() => setOpenRo(job.ro)} onKeyDown={(event) => { if (event.key === "Enter") setOpenRo(job.ro); }}
                  onDragStart={(event) => { event.dataTransfer.setData("text/ro", job.ro); event.dataTransfer.setData("text/offset", "0"); }}>
                  <strong>{jobTitle(job)}</strong><span>{job.custom ? job.note : job.vehicle}{!job.custom && job.jobName && /diag/i.test(job.jobName) ? " · Diag done ✓" : ""}</span>
                  {info.chip && <span className="tb-carried" style={{ background: "rgba(255,255,255,.08)", color: info.color, alignSelf: "flex-start" }}>{info.chip}</span>}
                </div>); })}
            </div>)}
          </Fragment>)}
          <div className="tb-times" style={{ height: dayMinutes * PX }}>
            {hours.map((minute) => <span key={minute} style={{ top: minute * PX }}>{clock(dayStart, minute)}</span>)}
          </div>
          {lanes.map((lane) => {
            const unassigned = lane.id === board.unassigned;
            const jobs = todays.filter((job) => job.tech === lane.id).sort((a, b) => a.startMinute - b.startMinute);
            return (
              <div key={lane.id} className={`tb-col ${unassigned ? "unassigned" : ""}`} style={{ height: dayMinutes * PX }}
                onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, lane.id)}>
                {hours.slice(1, -1).map((minute) => <i key={minute} className="tb-hour" style={{ top: minute * PX }} />)}
                {!unassigned && diagMinutes > 0 && <div className="tb-diag" style={{ height: diagMinutes * PX }} />}
                {!unassigned && <div className="tb-diag-label" style={{ height: DIAG_END * PX }}><span>Diag only</span></div>}
                {!unassigned && openSlots(lane.id).map((minute) => (
                  <div key={`slot-${minute}`} role="button" tabIndex={0} className="tb-slot" data-minute={minute}
                    aria-label={`Add job for ${lane.name} at ${clock(dayStart, minute)}`} style={{ top: minute * PX + 1, height: 30 * PX - 2 }}
                    {...tapHandlers(() => setAddSlot({ tech: lane.id, minute }))}><span>+</span></div>
                ))}
                {!unassigned && <div className="tb-lunch" style={{ top: LUNCH_START * PX, height: (LUNCH_END - LUNCH_START) * PX }}><span>Lunch</span></div>}
                {!unassigned && offs.filter((off) => off.initials === lane.id).map((off) => {
                  const start = off.allDay ? 0 : off.startMinute;
                  const end = off.allDay ? dayMinutes : off.endMinute;
                  return <div key={off.id} className="tb-timeoff" style={{ top: start * PX + 2, height: Math.max(24, (end - start) * PX - 4), background: BOARD_COLORS.timeOff }}><strong>Time off</strong><span>{off.allDay ? "All day" : `${clock(dayStart, start)} – ${clock(dayStart, end)}`}{off.reason ? ` · ${off.reason}` : ""}</span></div>;
                })}
                {jobs.map((job, index) => {
                  const duration = resizing?.ro === job.ro ? resizing.minutes : job.durationMinutes;
                  const top = unassigned ? 6 + index * 92 : job.startMinute * PX + 2;
                  const height = unassigned ? 84 : Math.max(74, Math.min(wallEnd(job.startMinute, duration), dayMinutes) * PX - job.startMinute * PX - 4);
                  const pct = latest(job.ro)?.percentComplete ?? null;
                  const span = cardSpan(job.startMinute, duration);
                  const nowMinute = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() - dayStart; })();
                  const stalled = !unassigned && !job.custom && day === board.days[0] && isStalled(job.startMinute, duration, nowMinute, (pct ?? 0) >= 100);
                  return (
                    <div key={job.ro} role="button" tabIndex={0} draggable data-locked={isLockedJob(job) ? "1" : undefined} className={`tb-card ${job.custom ? "custom" : ""} ${isLockedJob(job) ? "locked" : ""} ${resizing?.ro === job.ro ? "resizing" : ""}`}
                      style={{ top, height, borderLeftColor: roInfo(job).color }}
                      onClick={() => { if (Date.now() >= suppressClickUntil.current) setOpenRo(job.ro); }}
                      onKeyDown={(event) => { if (event.key === "Enter") setOpenRo(job.ro); }}
                      onDragStart={(event) => { if (event.currentTarget.dataset.nodrag === "1") { event.preventDefault(); return; } event.dataTransfer.setData("text/ro", job.ro); event.dataTransfer.setData("text/offset", String(event.clientY - event.currentTarget.getBoundingClientRect().top)); }}
                      title={`${job.custom ? job.title : job.label} · ${clock(dayStart, span.start)} – ${clock(dayStart, span.end)}${span.lunch ? " (includes lunch)" : ""}`}>
                      {!unassigned && span.lunch && <span className="tb-card-lunch" aria-hidden="true" style={{ top: span.lunch.offset * PX - 2, height: span.lunch.minutes * PX }}><span>Lunch</span></span>}
                      <span className="tb-card-ro"><span className="tb-card-title">{jobTitle(job)}</span>{job.carriedOver && <span className="tb-carried" title="Not finished yesterday; remaining time carried over">Carried over</span>}{(() => { const ix = identifixByRo.get(checkinRo(job)); return ix && ix.status !== "done" ? <span className="tb-carried tb-identifix-chip" title="Identifix lookup (assistant)">{requestStatusText(ix)}</span> : ix ? <span className="tb-carried tb-identifix-chip">Identifix ✓</span> : null; })()}{job.autoPlaced && job.placedBy === "auto" && <span className="tb-carried tb-auto" title="The board placed this approved job by itself (posted to Teams)">Auto-placed</span>}{job.tech !== board.unassigned && job.startMinute >= 0 && wallEnd(job.startMinute, job.durationMinutes) > dayWallLimit(480) && <span className="tb-carried tb-overflow" title="Runs past 5 PM — move or shorten something">Past 5 PM</span>}{(job.status === "preset" || isLockedJob(job)) && <span className="tb-carried tb-preset">{isLockedJob(job) ? "🔒 Customer coming" : "Pre-Set"}</span>}{job.custom && roInfo(job).chip && <span className="tb-carried" style={{ background: "rgba(255,255,255,.08)", color: roInfo(job).color }}>{roInfo(job).chip}</span>}{job.status === "waiting" && <span className="tb-carried" style={{ background: "rgba(255,255,255,.08)", color: cardColor(job) }}>{job.label.trim()}</span>}</span>
                      {apptSummary(job.apptInfo) && <span className="tb-card-appt" title={apptSummary(job.apptInfo)}>📋 {apptSummary(job.apptInfo)}</span>}
                      <span className="tb-card-vehicle">{job.custom ? [job.linkedRo ? job.title || job.vehicle : "", job.note].filter(Boolean).join(" · ") : job.vehicle}{(job.custom ? (job.note || job.linkedRo) : job.vehicle) ? " · " : ""}<span className="tb-card-hours">{hoursText(duration)}{pct !== null && !job.custom ? ` · ${pct}%` : ""}</span>{!unassigned && <span className="tb-card-time"> · {clock(dayStart, span.start)}–{clock(dayStart, span.end)}</span>}{job.loggedSeconds ? <span className="tb-card-logged"> · logged {(job.loggedSeconds / 3600).toFixed(1)}h</span> : null}{stalled && <span className="tb-carried tb-stalled">Running long</span>}</span>
                      {!job.custom && <span className="tb-quick"
                        onPointerDown={(event) => {
                          // Quick buttons must never start a card drag: disable dragging until the pointer is released anywhere.
                          const card = event.currentTarget.closest<HTMLElement>(".tb-card");
                          if (!card) return;
                          card.dataset.nodrag = "1"; card.draggable = false;
                          window.addEventListener("pointerup", () => { delete card.dataset.nodrag; card.draggable = true; }, { once: true });
                        }}>
                        {[25, 50, 75].map((value) => (
                          <button key={value} type="button" draggable={false} className={pct === value ? "active" : ""} disabled={busy || Boolean(initial)}
                            aria-pressed={pct === value} aria-label={`Mark RO ${job.ro} ${value}% complete`}
                            onClick={(event) => { event.stopPropagation(); act({ action: "update", ro: job.ro, kind: "note", percentComplete: value, comment: "", techEstimateHours: job.techEstimateHours }); }}>
                            {value}%
                          </button>
                        ))}
                      </span>}
                      {!unassigned && <span className="tb-resize" aria-label="Drag to change length" title="Drag to change length" onPointerDown={(event) => startResize(event, job)} onClick={(event) => event.stopPropagation()} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="tb-footnote">8–10 AM = diag only. 12–1 PM is lunch. Amber = Pre-Set appointment (held at its time). Blue = time off. Times are Central.</p>
      <div className="panel tb-requests tb-suggest-panel"><SuggestionBox mode="writer" suggestions={board.suggestions ?? []} busy={busy}
        onSubmit={(value) => act({ action: "suggest-add", ...value })} onUpdate={(value) => act({ action: "suggest-update", ...value })} /></div>
      <RequestsPanel board={view} dayStart={dayStart} limit={dayMinutes} onSave={act} readOnly={Boolean(initial)} />
      {openJob && <TicketDrawer key={openJob.ro} job={openJob} latest={latest(openJob.ro)} readOnly={Boolean(initial)} onClose={() => setOpenRo(null)}
        onSave={async (body) => { await act(body); if (body.action === "delete") setOpenRo(null); }}
        techs={techs} days={board.days} dayStart={dayStart} limit={dayMinutes} unassigned={board.unassigned} ros={board.syncedRos ?? []} checkin={(board.checkins ?? []).find((item) => item.ro === checkinRo(openJob))}
        identifix={latestByRo(board.identifixRequests ?? []).get(checkinRo(openJob)) ?? null} vin={board.roVins?.[checkinRo(openJob)] ?? ""} />}
      {addSlot && <AddForm slot={addSlot} board={view} dayStart={dayStart} limit={dayMinutes} onClose={() => setAddSlot(null)} onSave={act} readOnly={Boolean(initial)} />}
    </section>
  );
}
