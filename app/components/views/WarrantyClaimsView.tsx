"use client";

import { useDashboard } from "@/app/dashboard-context";
import CopyValue from "../CopyValue";
import { money } from "@/app/lib/format";

export default function WarrantyClaimsView() {
  const {
    warrantyClaims,
    warrantyView,
    setWarrantyView,
    updateWarrantyClaim,
    chooseWarrantyOriginal,
  } = useDashboard();
  return (
    <section className="warranty-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">NAPA WARRANTY WORKFLOW</p>
                <h2>Warranty Claims</h2>
                <p>Completed Tekmetric tickets tagged <strong>Need Warranty Payment</strong>, matched to the most likely original paid RO.</p>
              </div>
              <div className="lead-summary"><strong>{warrantyClaims.filter((claim) => claim.status !== "paid" && claim.status !== "dismissed").length}</strong><span>open claims</span></div>
            </div>
            <div className="warranty-warning"><strong>Review before filing</strong><span>The reader only uses documented RO information. A failure draft marked incomplete must be corrected with the technician&apos;s actual findings before it is submitted.</span></div>
            <div className="lead-tabs warranty-tabs">
              {([['open','Open'],['submitted','Submitted'],['paid','Paid'],['all','All']] as const).map(([value,label]) => <button key={value} className={warrantyView === value ? "active" : ""} onClick={() => setWarrantyView(value)}>{label}</button>)}
            </div>
            <div className="warranty-list">
              {warrantyClaims.filter((claim) => warrantyView === "all" || (warrantyView === "open" ? ["needs_review","ready"].includes(claim.status) : claim.status === warrantyView)).map((claim) => {
                const claimText = [
                  `CURRENT RO: #${claim.roNumber}`, `ORIGINAL RO: #${claim.originalRoNumber || "NOT MATCHED"}`,
                  `CUSTOMER: ${claim.customer}`, `PHONE: ${claim.phone}`, `EMAIL: ${claim.email || "Not read"}`,
                  `VEHICLE: ${claim.vehicle}`, `VIN: ${claim.vin || "Not read"}`,
                  `ORIGINAL REPAIR DATE: ${claim.originalRepairDate || "Not read"}`, `ORIGINAL MILEAGE: ${claim.originalMileage || "Not read"}`,
                  `SUBSEQUENT REPAIR DATE: ${claim.currentRepairDate || "Not read"}`, `SUBSEQUENT MILEAGE: ${claim.currentMileage || "Not read"}`,
                  `ORIGINAL LABOR RATE: ${claim.originalLaborRate ? money.format(claim.originalLaborRate) : "Not read"}`,
                  `ORIGINAL LABOR AMOUNT: ${claim.originalLaborAmount ? money.format(claim.originalLaborAmount) : "Not read"}`,
                  `PART NUMBER(S): ${claim.partNumbers.join(", ") || "Not read"}`, `QUANTITY: ${claim.quantities.join(", ") || "Not read"}`,
                  `NAPA INVOICE(S): ${(claim.napaInvoices || []).map((item) => `${item.partNumber}: ${item.invoiceNumber}`).join(", ") || "Not read"}`,
                  `LABOR HOURS: ${claim.laborHours || "Not read"}`, `PART STORE: ${claim.partStore || "Not read"}`,
                  `CUSTOMER COMPLAINT: ${claim.customerComplaint || "Not documented"}`,
                  `ORIGINAL REPAIR: ${claim.originalRepair || "Not read"}`,
                  `FAILURE SYMPTOMS: ${claim.failureSymptoms || "Not documented"}`,
                  `DIAGNOSIS: ${claim.diagnosis || "Not documented"}`,
                  `CLAIM DESCRIPTION DRAFT: ${claim.failureDraft || "Technician findings required"}`,
                ].join("\n");
                return <article className={`warranty-card ${claim.status}`} key={claim.roNumber}>
                  <header><div><a href={claim.currentRoUrl} target="_blank" rel="noreferrer">RO#{claim.roNumber}</a><strong>{claim.customer}</strong><span>{claim.vehicle}</span></div><div><small>Service writer</small><strong>{claim.serviceWriter}</strong></div><b>{claim.status.replace("_", " ")}</b></header>
                  {!!claim.missingFields.length && <div className="warranty-missing"><strong>Missing before filing:</strong> {claim.missingFields.join(" · ")}</div>}
                  <div className="warranty-ro-links"><a href={claim.currentRoUrl} target="_blank" rel="noreferrer">Open current RO #{claim.roNumber}</a>{claim.originalRoUrl ? <a href={claim.originalRoUrl} target="_blank" rel="noreferrer">Open original paid RO #{claim.originalRoNumber}</a> : <span>Original paid RO needs to be selected</span>}<button onClick={() => chooseWarrantyOriginal(claim)}>{claim.originalRoOverride ? `Change selected RO #${claim.originalRoOverride}` : "Select original RO"}</button></div>
                  <div className="warranty-fields">
                    <section><h3>Vehicle &amp; owner</h3><dl><dt>VIN</dt><dd><span>{claim.vin || "Not read"}</span><CopyValue value={claim.vin} /></dd><dt>Phone</dt><dd><span>{claim.phone || "Not read"}</span><CopyValue value={claim.phone} /></dd><dt>Email</dt><dd><span>{claim.email || "Not read"}</span><CopyValue value={claim.email} /></dd></dl></section>
                    <section><h3>Original repair</h3><dl><dt>Original RO</dt><dd><span>RO#{claim.originalRoNumber || "Not matched"}</span><CopyValue value={claim.originalRoNumber} /></dd><dt>Date</dt><dd><span>{claim.originalRepairDate || "—"}</span><CopyValue value={claim.originalRepairDate} /></dd><dt>Miles</dt><dd><span>{claim.originalMileage || "—"}</span><CopyValue value={claim.originalMileage} /></dd><dt>Labor rate</dt><dd><span>{claim.originalLaborRate ? money.format(claim.originalLaborRate) : "—"}</span><CopyValue value={claim.originalLaborRate} /></dd><dt>Labor amount</dt><dd><span>{claim.originalLaborAmount ? money.format(claim.originalLaborAmount) : "—"}</span><CopyValue value={claim.originalLaborAmount} /></dd></dl></section>
                    <section><h3>Subsequent repair</h3><dl><dt>Invoice</dt><dd><span>RO#{claim.roNumber}</span><CopyValue value={claim.roNumber} /></dd><dt>Date</dt><dd><span>{claim.currentRepairDate || "—"}</span><CopyValue value={claim.currentRepairDate} /></dd><dt>Miles</dt><dd><span>{claim.currentMileage || "—"}</span><CopyValue value={claim.currentMileage} /></dd><dt>Parts</dt><dd><span>{claim.partNumbers.join(", ") || "Not read"}</span><CopyValue value={claim.partNumbers.join(", ")} /></dd></dl></section>
                    <section><h3>NAPA line information</h3><dl><dt>Part number</dt><dd><span>{claim.partNumbers.join(", ") || "—"}</span><CopyValue value={claim.partNumbers.join(", ")} /></dd><dt>NAPA invoice</dt><dd><span>{(claim.napaInvoices || []).map((item) => item.invoiceNumber).join(", ") || "—"}</span><CopyValue value={(claim.napaInvoices || []).map((item) => item.invoiceNumber).join(", ")} /></dd><dt>Quantity</dt><dd><span>{claim.quantities.join(", ") || "—"}</span><CopyValue value={claim.quantities.join(", ")} /></dd><dt>Labor hours</dt><dd><span>{claim.laborHours || "—"}</span><CopyValue value={claim.laborHours} /></dd><dt>Part store</dt><dd><span>{claim.partStore || "Not read"}</span><CopyValue value={claim.partStore} /></dd></dl></section>
                  </div>
                  <div className="warranty-narrative"><section><h3>Customer complaint <CopyValue value={claim.customerComplaint} /></h3><p>{claim.customerComplaint || "Not documented on the current RO."}</p></section><section><h3>Original repair <CopyValue value={claim.originalRepair} /></h3><p>{claim.originalRepair || "Original repair description was not read."}</p></section><section><h3>Failure symptoms <CopyValue value={claim.failureSymptoms} /></h3><p>{claim.failureSymptoms || "Failure symptoms are not documented."}</p><h3>Diagnosis <CopyValue value={claim.diagnosis} /></h3><p>{claim.diagnosis || "Technician diagnosis is required before filing."}</p></section><section className={claim.diagnosis ? "draft" : "draft incomplete"}><h3>Claim description draft <CopyValue value={claim.failureDraft} label="Copy draft" /></h3><p>{claim.failureDraft || "No claim description was created because documented diagnosis is missing."}</p></section></div>
                  {!!claim.candidatePreviousRos?.length && <details><summary>Possible previous ROs</summary>{claim.candidatePreviousRos.map((candidate, index) => <p key={index}>{candidate.url ? <a href={candidate.url} target="_blank" rel="noreferrer">RO#{candidate.roNumber || "?"}</a> : `RO#${candidate.roNumber || "?"}`} · {candidate.date || "date not read"} · {candidate.text || ""}<button onClick={() => chooseWarrantyOriginal(claim, candidate.roNumber || "")}>Use this RO</button></p>)}</details>}
                  <footer><span>Read {new Date(claim.capturedAt).toLocaleString()}{claim.claimNumber ? ` · Claim #${claim.claimNumber}` : ""}{claim.paymentAmount ? ` · Paid ${money.format(claim.paymentAmount)}` : ""}</span><div><button onClick={() => navigator.clipboard.writeText(claimText)}>Copy claim information</button>{claim.status !== "ready" && claim.status !== "submitted" && claim.status !== "paid" && <button onClick={() => updateWarrantyClaim(claim, "ready")}>Mark ready</button>}{claim.status !== "submitted" && claim.status !== "paid" && <button className="primary" onClick={() => updateWarrantyClaim(claim, "submitted")}>Mark submitted</button>}{claim.status === "submitted" && <button className="paid" onClick={() => updateWarrantyClaim(claim, "paid")}>Mark paid</button>}<button onClick={() => updateWarrantyClaim(claim, "dismissed")}>Remove</button></div></footer>
                </article>;
              })}
              {!warrantyClaims.filter((claim) => warrantyView === "all" || (warrantyView === "open" ? ["needs_review","ready"].includes(claim.status) : claim.status === warrantyView)).length && <div className="empty-leads"><strong>No warranty claims in this view</strong><p>When the reader finds a Completed RO tagged Need Warranty Payment, it will appear here with its previous-RO match.</p></div>}
            </div>
          </section>
  );
}
