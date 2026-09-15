"use client";

import { useDashboard } from "@/app/dashboard-context";

export default function LeadsView() {
  const {
    opportunities,
    opportunitiesCapturedAt,
    leadType,
    setLeadType,
    leadSearch,
    setLeadSearch,
    showCompleted,
    setShowCompleted,
    businessQueue,
    personalQueue,
    dailyCallQueue,
    visibleOpportunities,
    completedLeads,
    updateOpportunityStatus,
  } = useDashboard();
  return (
    <section className="leads-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">STEER OPPORTUNITY HUB</p>
                <h2>Calls That Need to Be Made</h2>
                <p>Daily queue: {personalQueue.length}/30 personal and {businessQueue.length}/30 fleet or business customers, ranked by Steer.</p>
              </div>
              <div className="lead-summary">
                <strong>{completedLeads}/{dailyCallQueue.length}</strong>
                <span>calls completed</span>
                <small>{opportunitiesCapturedAt ? `Updated ${new Date(opportunitiesCapturedAt).toLocaleString()}` : "Waiting for first Steer sync"}</small>
              </div>
            </div>
            <div className="lead-toolbar">
              <div className="lead-tabs">
                {([
                  ["all", "All"],
                  ["business", "Fleet & Business"],
                  ["personal", "Personal"],
                ] as const).map(([value, label]) => (
                  <button className={leadType === value ? "active" : ""} key={value} onClick={() => setLeadType(value)}>
                    {label}
                    <span>{value === "all" ? dailyCallQueue.length : dailyCallQueue.filter((item) => item.customerType === value).length}</span>
                  </button>
                ))}
              </div>
              <input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Search customer, vehicle, phone, or signal…" />
              <button className={`completed-toggle ${showCompleted ? "active" : ""}`} onClick={() => setShowCompleted((value) => !value)}>
                {showCompleted ? "Hide completed" : `Show completed (${completedLeads})`}
              </button>
            </div>
            <div className="opportunity-list">
              {visibleOpportunities.map((item, index) => (
                <article className={`opportunity-card status-${item.status}`} key={`${item.customer}-${item.vehicle}-${item.phone}-${index}`}>
                  <div className="lead-priority"><b>{"🔥".repeat(item.heat || 1)}</b><small>Priority</small></div>
                  <div className="lead-customer"><strong>{item.customer}</strong><span>{item.vehicle}</span><small>Last visit: {item.lastVisit || "Not available"}</small></div>
                  <div>
                    <div className="lead-signals">{item.signals.length ? item.signals.map((signal) => <span key={signal}>{signal}</span>) : <span>Steer opportunity</span>}</div>
                    <div className="recommended-services">
                      <small>Recommended services</small>
                      <p>{item.recommendedServices?.length ? item.recommendedServices.join(" • ") : "Open the Steer Call Guide for the detailed recommendation."}</p>
                    </div>
                  </div>
                  <div className="lead-contact">
                    <strong>{item.phone || "No phone shown"}</strong>
                    <span className={`customer-type ${item.customerType}`}>{item.customerType === "business" ? "Fleet / Business" : item.customerType}</span>
                    <div className="lead-actions">
                      {item.status === "done" ? (
                        <button className="done" onClick={() => updateOpportunityStatus(item, "open")}>✓ Done</button>
                      ) : (
                        <button onClick={() => updateOpportunityStatus(item, "done")}>Mark done</button>
                      )}
                      <button className={item.status === "follow-up" ? "follow-active" : ""} onClick={() => updateOpportunityStatus(item, item.status === "follow-up" ? "open" : "follow-up")}>Follow-up</button>
                      <button onClick={() => updateOpportunityStatus(item, "skipped")}>Skip</button>
                    </div>
                  </div>
                </article>
              ))}
              {!visibleOpportunities.length && (
                <div className="empty-leads">
                  <strong>{opportunities.length ? "No matching opportunities" : "Waiting for Steer"}</strong>
                  <p>{opportunities.length ? "Try another customer type or search." : "Run the updated Windows reader and sign into Steer when its browser opens."}</p>
                </div>
              )}
            </div>
          </section>
  );
}
