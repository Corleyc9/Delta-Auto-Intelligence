"use client";

import { useDashboard } from "@/app/dashboard-context";
import type { DeltaAiReviewItem } from "@/app/lib/types";

export default function DeltaAiReviewView() {
  const {
    deltaAiAudits,
    deltaAiClearingRo,
    clearDeltaAiAudit,
  } = useDashboard();
  return (
    <section className="audit-page delta-ai-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">TAGGED ESTIMATE REVIEW</p>
                <h2>Delta AI Estimate Review</h2>
                <p>Tekmetric WIP tickets tagged <strong>Delta AI</strong> are opened and reviewed directly from their Estimate tab.</p>
              </div>
              <div className="lead-summary">
                <strong>{deltaAiAudits.length}</strong><span>tagged estimates</span>
              </div>
            </div>
            <div className="audit-note">
              <strong>Automatic review</strong>
              <span>The AI checks labor rates and time, diagnostics, overlap, parts and quantities, customer concerns, repair justification, and customer-facing clarity. An unchanged estimate is not reviewed again.</span>
            </div>
            <div className="delta-ai-list">
              {deltaAiAudits.map((audit) => {
                const groups: Array<[string, DeltaAiReviewItem[]]> = [
                  ["Labor Review", audit.review.laborReview], ["Parts Review", audit.review.partsReview],
                  ["Customer Concerns", audit.review.customerConcerns], ["Clarity & Communication", audit.review.clarityReview],
                ];
                const ready = audit.conclusion === "Ready to present";
                return <article className={`delta-ai-card ${ready ? "ready" : "correction"}`} key={audit.roNumber}>
                  <header>
                    <div><a href={audit.detailUrl} target="_blank" rel="noreferrer">RO#{audit.roNumber}</a><strong>{audit.customer}</strong><span>{audit.vehicle}</span></div>
                    <div><small>Service writer</small><strong>{audit.serviceWriter}</strong></div>
                    <b className="delta-ai-conclusion">{audit.conclusion}</b>
                  </header>
                  <p className="delta-ai-summary">{audit.summary}</p>
                  <div className="delta-ai-groups">
                    {groups.map(([title, items]) => <section key={title}><h3>{title}</h3>
                      {items.map((item, index) => <p className={`delta-ai-item ${item.status}`} key={index}><span>{item.status === "correct" ? "✓" : item.status === "incorrect" ? "×" : "!"}</span>{item.text}</p>)}
                      {!items.length && <p className="delta-ai-empty">No issue identified.</p>}
                    </section>)}
                  </div>
                  <section className="delta-ai-recommendations"><h3>Final Recommendations</h3>
                    {audit.review.recommendations.length ? <ul>{audit.review.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No corrections listed.</p>}
                  </section>
                  <footer><span>Reviewed {new Date(audit.capturedAt).toLocaleString()}</span><div className="delta-ai-footer-actions"><button className="delta-ai-clear-button" disabled={deltaAiClearingRo === audit.roNumber} onClick={() => clearDeltaAiAudit(audit.roNumber)}>{deltaAiClearingRo === audit.roNumber ? "Clearing…" : "✓ Clear — ticket is okay"}</button><a href={audit.detailUrl} target="_blank" rel="noreferrer">Open Estimate in Tekmetric →</a></div></footer>
                </article>;
              })}
              {!deltaAiAudits.length && <div className="empty-leads"><strong>No Delta AI estimates yet</strong><p>Add the Delta AI tag to a Work-In-Progress RO. The reader will open its Estimate tab and send the review here.</p></div>}
            </div>
          </section>
  );
}
