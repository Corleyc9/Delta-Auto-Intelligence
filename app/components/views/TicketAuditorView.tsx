"use client";

import { useDashboard } from "@/app/dashboard-context";

export default function TicketAuditorView() {
  const {
    ticketAudits,
    ticketAuditDate,
    ticketAuditCapturedAt,
    auditFilter,
    setAuditFilter,
    auditDisposition,
    updateAuditDisposition,
    auditCritical,
    auditWarnings,
    auditReviews,
    auditIsGood,
    auditIsHidden,
    visibleTicketAudits,
  } = useDashboard();
  return (
    <section className="audit-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">CURRENT WORK-IN-PROGRESS</p>
                <h2>WIP Ticket Auditor</h2>
                <p>All current WIP repair orders, refreshed about every 20 minutes.</p>
              </div>
              <div className="lead-summary">
                <strong>{ticketAudits.length}</strong>
                <span>tickets scanned</span>
                <small>{ticketAuditCapturedAt ? `Updated ${new Date(ticketAuditCapturedAt).toLocaleString()}` : "Waiting for updated reader"}</small>
              </div>
            </div>
            <div className="job-alert-grid audit-summary-grid">
              <article className="danger"><small>Critical</small><strong>{auditCritical}</strong><span>Fix before posting</span></article>
              <article><small>Warnings</small><strong>{auditWarnings}</strong><span>Pricing or margin review</span></article>
              <article><small>Review items</small><strong>{auditReviews}</strong><span>Confirm with advisor or technician</span></article>
              <article><small>Good / approved</small><strong>{ticketAudits.filter(auditIsGood).length}</strong><span>Clear or manually reviewed</span></article>
            </div>
            <div className="audit-note">
              <strong>How to read this page</strong>
              <span>Overall GP/hr must be at least $170. Diagnostic-test lines do not trigger the GP/hr rule. Overall GP under 58% is red; 58–59.9% is acceptable; 60% is the target. Mark intentional exceptions Okay or Hide them.</span>
            </div>
            <div className="audit-toolbar">
              <div className="lead-tabs">
                <button className={auditFilter === "attention" ? "active" : ""} onClick={() => setAuditFilter("attention")}>Needs Attention <span>{ticketAudits.filter((audit) => !auditIsGood(audit) && !auditIsHidden(audit)).length}</span></button>
                <button className={auditFilter === "good" ? "active" : ""} onClick={() => setAuditFilter("good")}>Good <span>{ticketAudits.filter((audit) => auditIsGood(audit) && !auditIsHidden(audit)).length}</span></button>
                <button className={auditFilter === "all" ? "active" : ""} onClick={() => setAuditFilter("all")}>All visible <span>{ticketAudits.filter((audit) => !auditIsHidden(audit)).length}</span></button>
                <button className={auditFilter === "hidden" ? "active" : ""} onClick={() => setAuditFilter("hidden")}>Hidden <span>{ticketAudits.filter(auditIsHidden).length}</span></button>
              </div>
            </div>
            <div className="audit-list">
              {visibleTicketAudits.map((audit) => (
                <article className={`audit-card ${audit.findings.some((finding) => finding.severity === "critical") ? "critical" : ""}`} key={audit.roNumber}>
                  <div className="audit-card-head">
                    <div>
                      <a href={audit.detailUrl} target="_blank" rel="noreferrer">RO#{audit.roNumber}</a>
                      <strong>{audit.customer}</strong><span>{audit.vehicle}</span>
                    </div>
                    <div><small>Service writer</small><strong>{audit.serviceWriter}</strong></div>
                    <div className="audit-margins">
                      <span><small>Overall GP</small><b>{audit.grossProfitPercent ? `${audit.grossProfitPercent.toFixed(1)}%` : "Not read"}</b></span>
                      <span><small>GP / hour</small><b>{audit.grossProfitPerHour ? `$${audit.grossProfitPerHour.toFixed(2)}` : "Not read"}</b></span>
                      <span><small>Labor GP</small><b>{audit.laborGpPercent ? `${audit.laborGpPercent.toFixed(1)}%` : "Not read"}</b></span>
                      <span><small>Parts GP</small><b>{audit.partsGpPercent ? `${audit.partsGpPercent.toFixed(1)}%` : "Not read"}</b></span>
                    </div>
                    <div className="audit-actions">
                      {auditDisposition[audit.roNumber] ? (
                        <button onClick={() => updateAuditDisposition(audit.roNumber)}>Reopen</button>
                      ) : (
                        <>
                          <button className="approve" onClick={() => updateAuditDisposition(audit.roNumber, "approved")}>✓ Mark okay</button>
                          <button className="large-job" onClick={() => updateAuditDisposition(audit.roNumber, "approved", "Large job")}>Large Job</button>
                          <button className="quick-exception" onClick={() => updateAuditDisposition(audit.roNumber, "approved", "No labor overlap — operations verified")}>No Overlap</button>
                          <button className="quick-exception" onClick={() => updateAuditDisposition(audit.roNumber, "approved", "Warranty pricing")}>Warranty</button>
                          <button onClick={() => updateAuditDisposition(audit.roNumber, "hidden", "Hidden for one week", new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))}>Hide 1 Week</button>
                        </>
                      )}
                    </div>
                  </div>
                  {auditDisposition[audit.roNumber] && (
                    <div className="audit-decision">
                      <strong>{auditDisposition[audit.roNumber].status === "approved" ? "Marked okay" : "Hidden"}</strong>
                      <span>{auditDisposition[audit.roNumber].reason}</span>
                      <small>{auditDisposition[audit.roNumber].updatedBy} · {new Date(auditDisposition[audit.roNumber].updatedAt).toLocaleString()}{auditDisposition[audit.roNumber].hideUntil ? ` · Recheck ${auditDisposition[audit.roNumber].hideUntil}` : ""}</small>
                    </div>
                  )}
                  <div className="finding-list">
                    {audit.findings.map((finding, index) => (
                      <div className={`finding ${finding.severity}`} key={`${finding.code}-${index}`}>
                        <span>{finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.detail}</p></div>
                      </div>
                    ))}
                    {!audit.findings.length && <div className="audit-clear"><strong>✓ No audit rule triggered</strong><span>Review complete based on data Tekmetric exposed.</span></div>}
                  </div>
                </article>
              ))}
              {!visibleTicketAudits.length && <div className="empty-leads"><strong>{ticketAudits.length ? `No ${auditFilter === "good" ? "good" : "matching"} tickets in this view` : "Waiting for the WIP ticket audit"}</strong><p>{ticketAudits.length ? "Choose another filter to see the other tickets." : "Replace reader.py and leave the Windows reader running. All current Work-In-Progress tickets will appear after the next scan."}</p></div>}
            </div>
            {ticketAuditDate && <p className="audit-date">Audit date: {ticketAuditDate}</p>}
          </section>
  );
}
