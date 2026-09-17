"use client";

import { useState } from "react";
import { useDashboard } from "@/app/dashboard-context";
import { money } from "@/app/lib/format";

export default function VerifyQueueView() {
  const {
    verificationView,
    setVerificationView,
    jobBoardCapturedAt,
    markVerified,
    verifyQueue,
    verificationHistory,
    visibleVerificationRecords,
    verificationSavingId,
    verificationMessage,
    verificationMessageError,
  } = useDashboard();
  const [notes, setNotes] = useState<Record<number, string>>({});
  return (
    <section className="job-control-page verify-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">LIVE TEKMETRIC REVIEW QUEUE</p>
                <h2>Repair Orders Waiting for Verification</h2>
                <p>Every RO becomes required here when its Needs Diag label is removed. It stays open until you click Verified.</p>
              </div>
              <div className="lead-summary">
                <strong>{verifyQueue.length}</strong>
                <span>waiting for verification</span>
                <small>{jobBoardCapturedAt ? `Updated ${new Date(jobBoardCapturedAt).toLocaleString()}` : "Waiting for the reader"}</small>
              </div>
            </div>
            <div className="job-alert-grid verify-summary">
              <article><small>Required</small><strong>{verifyQueue.length}</strong><span>Diagnosed but not verified</span></article>
              <article><small>Missing Verify label</small><strong>{verifyQueue.filter((item) => !item.verifyLabelSeenAt).length}</strong><span>Caught automatically</span></article>
              <article><small>Verified history</small><strong>{verificationHistory.length}</strong><span>Permanent completed record</span></article>
              <article><small>Live refresh</small><strong>30s</strong><span>Reader scans about every 2 minutes</span></article>
            </div>
            <div className="verify-tabs" role="tablist" aria-label="Verification records">
              <button className={verificationView === "pending" ? "active" : ""} onClick={() => setVerificationView("pending")}>Needs Verification ({verifyQueue.length})</button>
              <button className={verificationView === "history" ? "active" : ""} onClick={() => setVerificationView("history")}>Verification History ({verificationHistory.length})</button>
            </div>
            {verificationMessage && <p className={`verify-feedback${verificationMessageError ? " error" : ""}`} role="status">{verificationMessage}</p>}
            <div className="verify-list">
              {visibleVerificationRecords.map((item) => (
                <article className={`verify-card ${item.status === "verified" ? "verified" : ""}`} key={item.id}>
                  <div className="verify-status">
                    <span>{item.status === "verified" ? "VERIFIED" : "REQUIRED"}</span>
                    <small>{item.verifyLabelSeenAt ? "Verify label seen" : "Verify label missing"}</small>
                  </div>
                  <div className="verify-main">
                    <a href={item.detailUrl || undefined} target="_blank" rel="noreferrer">RO#{item.roNumber}</a>
                    <strong>{item.customer}</strong>
                    <span>{item.vehicle}</span>
                    <small>Diagnosed {new Date(item.diagnosedAt).toLocaleString()}</small>
                  </div>
                  <div className="verify-owner"><small>Service writer</small><strong>{item.serviceWriter}</strong><span>{item.section}</span></div>
                  <div className="verify-amount"><small>Estimate</small><strong>{money.format(item.amount)}</strong><span>{item.status === "verified" ? `${item.verifiedBy || "Dashboard user"} · ${item.verifiedAt ? new Date(item.verifiedAt).toLocaleString() : ""}` : "Waiting for your review"}</span></div>
                  <div className="verify-actions">
                    {item.detailUrl ? <a className="verify-open" href={item.detailUrl} target="_blank" rel="noreferrer">Open in Tekmetric →</a> : <span className="verify-open disabled">Link unavailable</span>}
                    {item.status === "pending" && (
                      <button
                        type="button"
                        className="verify-complete"
                        disabled={verificationSavingId === item.id}
                        onClick={() => markVerified(item, notes[item.id] ?? "")}
                      >
                        {verificationSavingId === item.id ? "Saving…" : "✓ Verified"}
                      </button>
                    )}
                  </div>
                  {item.status === "pending" && (
                    <label className="verify-note-field">
                      <span>Optional note</span>
                      <input
                        type="text"
                        maxLength={600}
                        value={notes[item.id] ?? ""}
                        onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="Leave blank if none"
                      />
                    </label>
                  )}
                  {item.verificationNote && <p className="verification-note">Note: {item.verificationNote}</p>}
                </article>
              ))}
              {!visibleVerificationRecords.length && <div className="empty-leads"><strong>{verificationView === "pending" ? "No repair orders need verification" : "No verified repair orders yet"}</strong><p>{verificationView === "pending" ? "A record will be created when the reader sees a Needs Diag label removed." : "Completed verifications will remain here permanently."}</p></div>}
            </div>
          </section>
  );
}
