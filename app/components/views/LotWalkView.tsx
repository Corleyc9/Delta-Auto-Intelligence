"use client";

import { useDashboard } from "@/app/dashboard-context";

export default function LotWalkView() {
  const {
    lotWalkAudits,
    lotWalkUploading,
    lotWalkProgress,
    lotWalkTransferred,
    lotWalkUploadSize,
    lotWalkUploadName,
    lotWalkUploadComplete,
    lotWalkError,
    lotWalkSelectedId,
    setLotWalkSelectedId,
    lotWalkDetail,
    lotWalkResultInput,
    setLotWalkResultInput,
    lotWalkResultMessage,
    lotWalkRoInputs,
    setLotWalkRoInputs,
    lotWalkAssigningIndex,
    repairOrders,
    refreshLotWalkAudits,
    uploadLotWalkVideo,
    openLotWalkDetail,
    saveLotWalkResult,
    assignLotWalkRo,
    markLotWalkFixed,
    lotWalkRoLink
  } = useDashboard();
  return (
    <section className="leads-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">TRI-WEEKLY LOT WALK</p>
                <h2>Lot Walk Audit</h2>
                <p>Upload a walk-through video to match every vehicle on the lot against its Tekmetric repair order.</p>
              </div>
              <div className="lead-summary">
                <strong>{lotWalkAudits.length}</strong>
                <span>audits on file</span>
              </div>
            </div>

            <div className="audit-note">
              <strong>How this works</strong>
              <span>Upload the video here. Then, in a Claude/Cowork session, ask Claude to run the lot walk audit for it — that&apos;s where the actual vehicle and plate reading happens. Results appear back here once it&apos;s done.</span>
            </div>

            <div className="lead-toolbar">
              <input
                type="file"
                accept="video/*"
                disabled={lotWalkUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadLotWalkVideo(file);
                  event.target.value = "";
                }}
              />
              {lotWalkUploading && <span>Uploading {lotWalkProgress}%</span>}
              <button onClick={() => refreshLotWalkAudits()}>Refresh</button>
            </div>
            {(lotWalkUploading || lotWalkUploadComplete || lotWalkError) && lotWalkUploadName && (
              <div className={`lot-upload-progress ${lotWalkError ? "failed" : lotWalkUploadComplete ? "complete" : ""}`} role="status" aria-live="polite">
                <div className="lot-upload-progress-head">
                  <div><strong>{lotWalkUploadName}</strong><span>{lotWalkUploadComplete ? "Upload complete" : lotWalkError ? "Upload failed" : lotWalkTransferred >= lotWalkUploadSize ? "Finalizing video…" : "Uploading video…"}</span></div>
                  <b>{lotWalkProgress}%</b>
                </div>
                <div className="lot-upload-track" aria-label={`Upload ${lotWalkProgress}% complete`}>
                  <span style={{ width: `${lotWalkProgress}%` }} />
                </div>
                <small>{(lotWalkTransferred / (1024 * 1024)).toFixed(1)} MB of {(lotWalkUploadSize / (1024 * 1024)).toFixed(1)} MB transferred</small>
              </div>
            )}
            {lotWalkError && <p className="credential-error">{lotWalkError}</p>}

            <div className="job-table">
              <div className="job-table-head"><span>Uploaded</span><span>File</span><span>Status</span><span>Summary</span><span></span></div>
              {lotWalkAudits.map((audit) => (
                <article className="job-row" key={audit.id}>
                  <div><strong>{new Date(audit.createdAt).toLocaleString()}</strong></div>
                  <div><strong>{audit.videoFilename}</strong><small>{(audit.videoSize / (1024 * 1024)).toFixed(1)} MB</small></div>
                  <div><strong>{audit.status}</strong>{audit.errorDetail && <small>{audit.errorDetail}</small>}</div>
                  <div>
                    {audit.summary ? (
                      <small>
                        {audit.summary.vehiclesSeen ?? 0} seen · {audit.summary.matched ?? 0} matched · {audit.summary.needsManualId ?? 0} need manual ID
                      </small>
                    ) : (
                      <small>{audit.status === "complete" ? "No summary" : "Waiting on analysis"}</small>
                    )}
                  </div>
                  <div>
                    <button onClick={() => openLotWalkDetail(audit.id)}>View</button>
                  </div>
                </article>
              ))}
              {!lotWalkAudits.length && <div className="empty-leads"><strong>No lot walk videos yet</strong><p>Upload one above to get started.</p></div>}
            </div>

            {lotWalkSelectedId && (
              <div className="modal-backdrop" role="presentation" onMouseDown={() => setLotWalkSelectedId(null)}>
                <section className="setup-modal lot-walk-modal" role="dialog" aria-modal="true" aria-labelledby="lot-walk-results-title" onMouseDown={(event) => event.stopPropagation()}>
                  <button className="modal-close" onClick={() => setLotWalkSelectedId(null)} aria-label="Close">×</button>
                  <header className="lot-review-header">
                    <div><p className="panel-kicker">LOT WALK AUDIT #{lotWalkSelectedId}</p><h2 id="lot-walk-results-title">Lot Walk Review</h2></div>
                    {lotWalkDetail?.summary && <div className="lot-review-total"><strong>{lotWalkDetail.summary.vehiclesSeen ?? 0}</strong><span>vehicles seen</span></div>}
                  </header>
                  {lotWalkDetail ? (
                    <div className="lot-review-content">
                      {lotWalkDetail.summary && (
                        <div className="lot-review-summary" aria-label="Lot walk summary">
                          <article className="matched"><strong>{lotWalkDetail.summary.matched ?? 0}</strong><span>Matched to RO</span></article>
                          <article className="warning"><strong>{lotWalkDetail.summary.staleRos ?? 0}</strong><span>Stale ROs</span></article>
                          <article className="review"><strong>{lotWalkDetail.summary.needsManualId ?? 0}</strong><span>Need review</span></article>
                          <article><strong>{lotWalkDetail.summary.notCheckedIn ?? 0}</strong><span>Not checked in</span></article>
                        </div>
                      )}
                      {lotWalkDetail.notes && <p className="lot-review-notes">{lotWalkDetail.notes}</p>}
                      {lotWalkDetail.actionList?.length ? (
                        <div className="lot-review-groups">
                          {[
                            { key: "urgent", title: "Fix these first", items: lotWalkDetail.actionList.filter((item) => item.priority === "critical" || item.priority === "warning") },
                            { key: "review", title: "Vehicles needing identification", items: lotWalkDetail.actionList.filter((item) => item.priority === "review") },
                            { key: "good", title: "Confirmed okay", items: lotWalkDetail.actionList.filter((item) => item.priority === "good") },
                          ].filter((group) => group.items.length).map((group) => (
                            <section className={`lot-review-group ${group.key}`} key={group.key}>
                              <div className="lot-review-group-title"><h3>{group.title}</h3><span>{group.items.length}</span></div>
                              <div className="finding-list">
                                {group.items.map((item, index) => {
                                  const itemIndex = lotWalkDetail.actionList!.indexOf(item);
                                  const tekmetricUrl = lotWalkRoLink(item);
                                  return (
                                  <article className={`finding ${item.priority}`} key={`${group.key}-${index}`}>
                                    <span>{item.priority === "critical" ? "urgent" : item.priority}</span>
                                    <div>
                                      <strong>{item.vehicle || (item.roNumber ? `RO #${item.roNumber}` : "Unidentified vehicle")}</strong>
                                      <p className="finding-problem">{item.problem}</p>
                                      <p className="finding-action"><b>Next:</b> {item.recommendedAction}</p>
                                      {(item.roNumber || item.customer || item.serviceWriter) && <small>{[item.roNumber ? `RO #${item.roNumber}` : "", item.customer, item.serviceWriter].filter(Boolean).join(" · ")}</small>}
                                      <div className="lot-finding-controls">
                                        {tekmetricUrl && <a href={tekmetricUrl} target="_blank" rel="noreferrer">Open in Tekmetric ↗</a>}
                                        {item.priority !== "good" && (
                                          <button className="lot-fixed-button" disabled={lotWalkAssigningIndex === itemIndex} onClick={() => markLotWalkFixed(itemIndex)}>
                                            {lotWalkAssigningIndex === itemIndex ? "Saving…" : "✓ Mark Fixed"}
                                          </button>
                                        )}
                                        {!item.roNumber && (
                                          <div className="lot-ro-assign">
                                            <input
                                              aria-label={`RO number for ${item.vehicle || "unidentified vehicle"}`}
                                              inputMode="numeric"
                                              list="lot-walk-ro-options"
                                              placeholder="Enter RO number"
                                              value={lotWalkRoInputs[itemIndex] || ""}
                                              onChange={(event) => setLotWalkRoInputs((current) => ({ ...current, [itemIndex]: event.target.value }))}
                                              onKeyDown={(event) => { if (event.key === "Enter") void assignLotWalkRo(itemIndex); }}
                                            />
                                            <button disabled={!lotWalkRoInputs[itemIndex]?.trim() || lotWalkAssigningIndex === itemIndex} onClick={() => assignLotWalkRo(itemIndex)}>
                                              {lotWalkAssigningIndex === itemIndex ? "Assigning…" : "Assign RO"}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </article>
                                  );
                                })}
                              </div>
                            </section>
                          ))}
                        </div>
                      ) : (
                        <p className="modal-intro">No results yet — this video hasn&apos;t been processed.</p>
                      )}
                      <datalist id="lot-walk-ro-options">
                        {repairOrders.map((order) => <option key={order.roNumber} value={order.roNumber}>{order.customer} — {order.vehicle}</option>)}
                      </datalist>
                      {lotWalkResultMessage && <p className="lot-review-message" role="status">{lotWalkResultMessage}</p>}
                    </div>
                  ) : (
                    <p className="modal-intro">Loading…</p>
                  )}
                  <details className="lot-result-entry">
                    <summary>Save reviewed analysis</summary>
                    <textarea
                      aria-label="Reviewed analysis JSON"
                      placeholder="Paste the reviewed lot-walk result JSON"
                      value={lotWalkResultInput}
                      onChange={(event) => setLotWalkResultInput(event.target.value)}
                    />
                    <button disabled={!lotWalkResultInput.trim()} onClick={saveLotWalkResult}>Save analysis</button>
                    {lotWalkResultMessage && <small>{lotWalkResultMessage}</small>}
                  </details>
                </section>
              </div>
            )}
          </section>
  );
}
