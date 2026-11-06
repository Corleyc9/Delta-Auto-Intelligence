"use client";
// v1.6.17: writer "Look up in Identifix" → queues a request for the assistant; results panel (triage, not a diagnosis).
import { useState } from "react";
import { normalizeDtcs } from "./dtc";
import { IDENTIFIX_RESULTS_LABEL, requestStatusText, splitVehicle, type IdentifixRequest } from "./identifix";

export function IdentifixResults({ request }: { request?: IdentifixRequest | null }) {
  if (!request) return null;
  const r = request.result;
  return (
    <div className="tb-section tb-identifix" data-testid="identifix-results">
      <small>{IDENTIFIX_RESULTS_LABEL}</small>
      <p className={`tb-identifix-status tb-identifix-${request.status}`}>{requestStatusText(request)} · {request.codes.join(" ")}{request.symptom ? ` · ${request.symptom}` : ""}</p>
      {request.status === "done" && r && <>
        {r.confirmedFixes.length > 0 && <><strong>Confirmed fixes</strong>
          <ol>{r.confirmedFixes.map((fix, i) => <li key={i}>{fix.fix}{fix.count !== null ? ` (${fix.count})` : ""}{fix.note ? ` — ${fix.note}` : ""}</li>)}</ol></>}
        {r.testSteps.length > 0 && <><strong>Suggested testing</strong><ol>{r.testSteps.map((step, i) => <li key={i}>{step}</li>)}</ol></>}
        {r.tsbs.length > 0 && <><strong>TSBs</strong><ul>{r.tsbs.map((tsb, i) => <li key={i}>{[tsb.id, tsb.title].filter(Boolean).join(" — ")}</li>)}</ul></>}
        {r.notes && <p className="tb-checkin-notes">{r.notes}</p>}
        <small>Source: {r.source}</small>
      </>}
    </div>
  );
}

/** Writer/admin: queue an Identifix lookup for this RO. */
export function IdentifixRequestBox({ ro, customer, vehicle, codes, vin = "", request, onSave, readOnly }: { ro: string; customer: string; vehicle: string;
  codes: string[]; vin?: string; request?: IdentifixRequest | null; onSave: (body: Record<string, unknown>) => Promise<unknown> | void; readOnly: boolean }) {
  // v1.6.18: no code field here — codes come from the single check-in codes box above.
  const [symptom, setSymptom] = useState("");
  const [engine, setEngine] = useState("");
  const parsed = normalizeDtcs(codes);
  const pending = request && (request.status === "queued" || request.status === "in-progress");
  return (
    <div className="tb-section tb-dtc" data-testid="identifix-request">
      <small>Identifix lookup uses: {parsed.length ? parsed.join(" ") : "no codes yet — type them in Codes above"}</small>
      <label className="tb-comment">Symptom (optional)<input value={symptom} placeholder="no communication with ECM" onChange={(e) => setSymptom(e.target.value)} /></label>
      <label className="tb-comment">Engine (optional)<input value={engine} placeholder="5.3L" onChange={(e) => setEngine(e.target.value)} /></label>
      <button type="button" className="tb-primary" disabled={readOnly || Boolean(pending) || (!parsed.length && !symptom.trim())}
        onClick={() => void onSave({ action: "identifix-request", ro, customer, codes: parsed, symptom,
          vehicle: { ...splitVehicle(vehicle), engine, vin, text: [vehicle, engine].filter(Boolean).join(" ") } })}>Look up in Identifix</button>
      {pending && <small className="tb-dtc-msg">{requestStatusText(request)}</small>}
      <IdentifixResults request={request} />
    </div>
  );
}
