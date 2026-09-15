"use client";

import { useDashboard } from "@/app/dashboard-context";
import { money } from "@/app/lib/format";

export default function WritersView() {
  const {
    range,
    writerSnapshot,
    updated
  } = useDashboard();
  return (
    <section className="writers-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">LIVE TEKMETRIC</p>
                <h2>Service Writer Scorecards</h2>
                <p>{range === "Today" ? "Today" : "Wednesday–Tuesday"} performance from the Realtime Service Writer Report.</p>
              </div>
              <div className="lead-summary">
                <strong>{writerSnapshot?.writers.length || 0}</strong>
                <span>service writers</span>
                <small>{writerSnapshot ? `Updated ${new Date(writerSnapshot.capturedAt).toLocaleString()}` : "Waiting for updated reader"}</small>
              </div>
            </div>
            <div className="writer-grid">
              {writerSnapshot?.writers.map((writer) => (
                <article className="writer-card" key={writer.name}>
                  <div className="writer-card-head">
                    <div><span>{writer.name.slice(0, 1)}</span><strong>{writer.name}</strong></div>
                    <b className={writer.closeRatio >= 50 ? "good" : ""}>{writer.closeRatio.toFixed(0)}% close</b>
                  </div>
                  <div className="writer-kpis">
                    <div><small>Total Sold</small><strong>{money.format(writer.totalSold)}</strong><span>{writer.soldCount} jobs</span></div>
                    <div><small>Total Written</small><strong>{money.format(writer.totalWritten)}</strong><span>{writer.writtenCount} jobs</span></div>
                    <div><small>Car Count</small><strong>{writer.carCount}</strong><span>repair orders</span></div>
                    <div><small>ARO</small><strong>{money.format(writer.aro)}</strong><span>sold per RO</span></div>
                    <div><small>AWRO</small><strong>{money.format(writer.awro)}</strong><span>written per RO</span></div>
                  </div>
                  <div className="writer-statuses">
                    {Object.entries(writer.statuses || {}).map(([label, status]) => (
                      <span key={label}><small>{label}</small><b>{money.format(status.amount)}</b><em>{status.count}</em></span>
                    ))}
                  </div>
                </article>
              ))}
              {!writerSnapshot?.writers.length && (
                <div className="empty-leads">
                  <strong>Waiting for the first scorecard sync</strong>
                  <p>Install and run reader version 21. The scorecards will populate automatically.</p>
                </div>
              )}
            </div>
          </section>
  );
}
