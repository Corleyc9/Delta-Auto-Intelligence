"use client";
// v1.6.15 (preview): DTC box + check-in scan list → Identifix Direct-Hit (opens Direct-Hit, copies code + vehicle).
import { useState } from "react";
import { IdentifixRequestBox } from "./IdentifixPanel";
import type { IdentifixRequest } from "./identifix";
import { CHECKIN_LABEL, IDENTIFIX_URL, dtcClipboardText, normalizeDtcs, type Checkin } from "./dtc";

async function lookup(codes: string[], vehicle: string, setMsg: (value: string) => void) {
  const text = dtcClipboardText(codes, vehicle);
  window.open(IDENTIFIX_URL, "_blank", "noopener");
  try { await navigator.clipboard.writeText(text); setMsg(`Copied "${text}". Paste it into Direct-Hit's vehicle / code search.`); }
  catch { setMsg(`Search Direct-Hit for: ${text}`); }
}

export default function DtcBox({ vehicle }: { vehicle: string }) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState("");
  const codes = normalizeDtcs(value);
  return (
    <div className="tb-dtc" data-testid="dtc-box">
      <label className="tb-comment">DTC code(s)<input value={value} placeholder="P0300, P0171" onChange={(event) => setValue(event.target.value)} /></label>
      <button type="button" className="tb-primary" disabled={!codes.length} onClick={() => void lookup(codes, vehicle, setMsg)}>Look up in Identifix</button>
      {msg && <small className="tb-dtc-msg">{msg}</small>}
    </div>
  );
}

/** Check-in scan list (read-only), each code with its Identifix lookup. */
export function CheckinList({ checkin, vehicle }: { checkin?: Checkin | null; vehicle: string }) {
  const [msg, setMsg] = useState("");
  if (!checkin || (!checkin.codes.length && !checkin.notes)) return null;
  return (
    <div className="tb-checkin" data-testid="checkin-list">
      <small>{CHECKIN_LABEL}</small>
      <ul>{checkin.codes.map((code) => <li key={code}><strong>{code}</strong> <button type="button" onClick={() => void lookup([code], vehicle, setMsg)}>Identifix →</button></li>)}</ul>
      {checkin.notes && <p className="tb-checkin-notes">{checkin.notes}</p>}
      {msg && <small className="tb-dtc-msg">{msg}</small>}
    </div>
  );
}

/** Writer: the ONE check-in codes box (v1.6.18 merged the Identifix box's separate code field into this one) + VIN. */
export function CheckinEditor({ ro, checkin, vehicle, onSave, readOnly, customer = "", request, vin: savedVin = "" }: { ro: string; checkin?: Checkin | null; vehicle: string;
  customer?: string; request?: IdentifixRequest | null; vin?: string; onSave: (body: Record<string, unknown>) => Promise<unknown> | void; readOnly: boolean }) {
  const [codes, setCodes] = useState(checkin?.codes.join(" ") ?? "");
  const [notes, setNotes] = useState(checkin?.notes ?? "");
  const [vin, setVin] = useState(savedVin);
  const parsed = normalizeDtcs(codes);
  const vinClean = vin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (
    <div className="tb-section tb-checkin-edit" data-testid="checkin-codes"><small>Check-in scan codes (RO#{ro}) · triage, not a diagnosis</small>
      <label className="tb-comment">Codes<input value={codes} placeholder="P0300 P0171 U0100" onChange={(event) => setCodes(event.target.value)} /></label>
      <label className="tb-comment">Freeze frame / notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <button type="button" disabled={readOnly} onClick={() => void onSave({ action: "checkin-set", ro, codes: parsed, notes })}>Save check-in scan</button>
      <label className="tb-comment">VIN (Bay Scan matches scans to this RO by VIN)<input value={vin} maxLength={17} placeholder="17 characters" onChange={(event) => setVin(event.target.value)} /></label>
      <button type="button" disabled={readOnly || vinClean === savedVin || (vinClean.length > 0 && vinClean.length !== 17)} onClick={() => void onSave({ action: "ro-vin-set", ro, vin: vinClean })}>Save VIN</button>
      <CheckinList checkin={checkin} vehicle={vehicle} />
      {/* v1.6.17: the writer button queues a lookup for the assistant. v1.6.18: it uses the codes typed above (no second code box). */}
      <IdentifixRequestBox key={`ix-${request?.id ?? 0}`} ro={ro} customer={customer} vehicle={vehicle} codes={parsed} vin={vinClean} request={request} onSave={onSave} readOnly={readOnly} />
    </div>
  );
}
