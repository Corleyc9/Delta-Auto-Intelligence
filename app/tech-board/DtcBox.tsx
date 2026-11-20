"use client";
// v1.6.15 (preview): DTC box + check-in scan list → Identifix Direct-Hit (opens Direct-Hit, copies code + vehicle).
import { useState } from "react";
import { IdentifixRequestBox } from "./IdentifixPanel";
import type { IdentifixRequest } from "./identifix";
import { CHECKIN_LABEL, IDENTIFIX_URL, dtcClipboardText, normalizeDtcs, type Checkin } from "./dtc";
import { codeDescription } from "./bayscan-codes";
import { scanRequestStatusText, tekAttachLabel, type RoScanView, type ScanModule, type ScanRequestView } from "./bayscan";
import { ScanPhotos } from "./ScanPhotos";

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

/** Every module the scanner talked to, including modules that came back with no codes. */
export function ScanModules({ modules, readiness = "" }: { modules?: ScanModule[]; readiness?: string }) {
  const list = modules ?? [];
  if (!list.length && !readiness) return null;
  return (
    <div className="tb-scan-mods" data-testid="scan-modules">
      {list.map((module, index) => (
        <div key={`${module.addr}-${module.name}-${index}`} className="tb-scan-mod">
          <strong>{module.name || "Module"}{module.addr ? ` · ${module.addr}` : ""}</strong>
          {module.codes.length
            ? <ul>{module.codes.map((code) => {
              const description = codeDescription(code.code, code.desc);
              return <li key={`${code.code}-${code.status}`}><b>{code.code}</b> <span>{code.status}</span>{description ? ` — ${description}` : ""}</li>;
            })}</ul>
            : <span className="tb-scan-clean">No codes</span>}
        </div>
      ))}
      {readiness ? <p className="tb-scan-ready">Readiness: {readiness}</p> : null}
    </div>
  );
}

/** Check-in scan list (read-only), each code with its Identifix lookup, plus the per-module Bay Scan. */
export function CheckinList({ checkin, vehicle, bayScan = null }: { checkin?: Checkin | null; vehicle: string; bayScan?: RoScanView | null }) {
  const [msg, setMsg] = useState("");
  const hasCheckin = Boolean(checkin && (checkin.codes.length || checkin.notes));
  if (!hasCheckin && !bayScan) return null;
  const tek = bayScan ? tekAttachLabel(bayScan.tekStatus, bayScan.tekError) : "";
  return (
    <div className="tb-checkin" data-testid="checkin-list">
      <small>{CHECKIN_LABEL}</small>
      {bayScan ? <p className="tb-scan-link"><a href={`/bayscan/report/${bayScan.id}`}>Bay Scan report</a>{tek ? <span className={`tb-tek tb-tek-${bayScan.tekStatus}`}>{tek}</span> : null}</p> : null}
      {bayScan ? <ScanPhotos photos={bayScan.photos} pending={bayScan.photoRequest === "pending" || bayScan.photoRequest === "claimed"} /> : null}
      {checkin && checkin.codes.length > 0 && <ul>{checkin.codes.map((code) => <li key={code}><strong>{code}</strong> <button type="button" onClick={() => void lookup([code], vehicle, setMsg)}>Identifix →</button></li>)}</ul>}
      {bayScan ? <ScanModules modules={bayScan.modules} readiness={bayScan.readinessSummary} /> : null}
      {checkin?.notes && <p className="tb-checkin-notes">{checkin.notes}</p>}
      {msg && <small className="tb-dtc-msg">{msg}</small>}
    </div>
  );
}

/** Writer: the ONE check-in codes box (v1.6.18 merged the Identifix box's separate code field into this one) + VIN. */
export function CheckinEditor({ ro, checkin, vehicle, onSave, readOnly, customer = "", request, vin: savedVin = "", bayScan = null, scanRequest = null }: { ro: string; checkin?: Checkin | null; vehicle: string;
  customer?: string; request?: IdentifixRequest | null; vin?: string; bayScan?: RoScanView | null; scanRequest?: ScanRequestView | null;
  onSave: (body: Record<string, unknown>) => Promise<unknown> | void; readOnly: boolean }) {
  const [codes, setCodes] = useState(checkin?.codes.join(" ") ?? "");
  const [notes, setNotes] = useState(checkin?.notes ?? "");
  const [vin, setVin] = useState(savedVin);
  const parsed = normalizeDtcs(codes);
  const vinClean = vin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (
    <div className="tb-section tb-checkin-edit" data-testid="checkin-codes"><small>Check-in scan codes (RO#{ro}) · triage, not a diagnosis</small>
      {/* Anyone signed in can press this, including the shared Lobby TV login. readOnly is only the static preview. */}
      <div className="tb-bayscan-request" data-testid="bayscan-request">
        <button type="button" className="tb-primary" data-testid="bayscan-request-button" disabled={readOnly} onClick={() => void onSave({ action: "bayscan-scan-request", ro })}>Bay Scan</button>
        <p className="tb-scan-hint">Sends the Bay Scan dongle to this RO. The report is filed on this RO&apos;s Bay Scan check-in report.</p>
        {scanRequest ? <p className="tb-scan-request-status" data-testid="bayscan-request-status" data-status={scanRequest.status}>{scanRequestStatusText(scanRequest)}</p> : null}
      </div>
      <label className="tb-comment">Codes<input value={codes} placeholder="P0300 P0171 U0100" onChange={(event) => setCodes(event.target.value)} /></label>
      <label className="tb-comment">Freeze frame / notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <button type="button" disabled={readOnly} onClick={() => void onSave({ action: "checkin-set", ro, codes: parsed, notes })}>Save check-in scan</button>
      <label className="tb-comment">VIN (Bay Scan matches scans to this RO by VIN)<input value={vin} maxLength={17} placeholder="17 characters" onChange={(event) => setVin(event.target.value)} /></label>
      <button type="button" disabled={readOnly || vinClean === savedVin || (vinClean.length > 0 && vinClean.length !== 17)} onClick={() => void onSave({ action: "ro-vin-set", ro, vin: vinClean })}>Save VIN</button>
      <CheckinList checkin={checkin} vehicle={vehicle} bayScan={bayScan} />
      {/* v1.6.17: the writer button queues a lookup for the assistant. v1.6.18: it uses the codes typed above (no second code box). */}
      <IdentifixRequestBox key={`ix-${request?.id ?? 0}`} ro={ro} customer={customer} vehicle={vehicle} codes={parsed} vin={vinClean} request={request} onSave={onSave} readOnly={readOnly} />
    </div>
  );
}
