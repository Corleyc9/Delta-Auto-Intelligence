"use client";

import { useDashboard } from "@/app/dashboard-context";
import { money } from "@/app/lib/format";

export default function JobBoardView() {
  const {
    repairOrders,
    jobBoardCapturedAt,
    jobSection,
    setJobSection,
    jobCategory,
    setJobCategory,
    jobWriter,
    setJobWriter,
    jobSearch,
    setJobSearch,
    data,
    visibleRepairOrders,
    jobCategories,
    jobWriters,
    criticalJobs,
    warningJobs,
    completedProblems,
  } = useDashboard();
  return (
    <section className="job-control-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">LIVE TEKMETRIC JOB BOARD</p>
                <h2>Job Board Control</h2>
                <p>Oldest WIP first, completed-label audits, and service-writer accountability.</p>
              </div>
              <div className="lead-summary">
                <strong>{repairOrders.length}</strong>
                <span>active repair orders</span>
                <small>{jobBoardCapturedAt ? `Updated ${new Date(jobBoardCapturedAt).toLocaleString()}` : "Waiting for the Windows reader"}</small>
              </div>
            </div>
            <div className="job-alert-grid">
              <article><small>WIP 2+ days</small><strong>{warningJobs}</strong><span>Needs review</span></article>
              <article className="danger"><small>WIP 7+ days</small><strong>{criticalJobs}</strong><span>Critical</span></article>
              <article><small>Completed issues</small><strong>{completedProblems}</strong><span>Label or balance audit</span></article>
              <article><small>Completed ROs</small><strong>{repairOrders.filter((item) => item.section === "completed").length}</strong><span>Current board</span></article>
            </div>
            <div className="job-toolbar">
              <div className="lead-tabs">
                {([
                  ["all", "All"],
                  ["estimates", "Estimates"],
                  ["work-in-progress", "In Progress"],
                  ["completed", "Completed"],
                ] as const).map(([value, label]) => (
                  <button key={value} className={jobSection === value ? "active" : ""} onClick={() => setJobSection(value)}>
                    {label}<span>{value === "all" ? repairOrders.length : repairOrders.filter((item) => item.section === value).length}</span>
                  </button>
                ))}
              </div>
              <select value={jobCategory} onChange={(event) => setJobCategory(event.target.value)}>
                <option value="all">All categories</option>
                {jobCategories.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
              <select value={jobWriter} onChange={(event) => setJobWriter(event.target.value)}>
                <option value="all">All service writers</option>
                {jobWriters.map((writer) => <option value={writer} key={writer}>{writer}</option>)}
              </select>
              <input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Search RO, customer, vehicle, or label…" />
            </div>
            <div className="job-table">
              <div className="job-table-head"><span>Age</span><span>RO / Customer</span><span>Vehicle</span><span>Label / Category</span><span>Service Writer</span><span>Amount</span></div>
              {visibleRepairOrders.map((item) => {
                const aging = item.ageDays >= 7 ? "critical" : item.ageDays >= 4 ? "red" : item.ageDays >= 2 ? "yellow" : "current";
                const mismatch = item.section === "completed" && ["production", "parts", "authorization", "attention"].includes(item.category);
                return (
                  <article className={`job-row aging-${aging}`} key={`${item.section}-${item.roNumber}`}>
                    <div className="job-age"><strong>{item.ageDays}</strong><small>days</small></div>
                    <div><strong>RO#{item.roNumber} · {item.customer}</strong><small>{item.phone}</small></div>
                    <div>
                      <strong>{item.vehicle}</strong>
                      <small>{item.customerComplaint ? `Complaint: ${item.customerComplaint}` : item.assignedInitials.join(" · ") || "No employees shown"}</small>
                    </div>
                    <div className="job-label"><strong>{item.label}</strong><small>{item.category}{mismatch ? " · CHECK LABEL" : ""}</small></div>
                    <div><strong>{item.serviceWriter}</strong><small>{item.serviceWriterInitials || "Unassigned"}</small></div>
                    <div className="job-money"><strong>{money.format(item.amount)}</strong>{item.balanceDue && <small>Balance due</small>}</div>
                  </article>
                );
              })}
              {!visibleRepairOrders.length && <div className="empty-leads"><strong>Waiting for Job Board data</strong><p>Install the packaged Windows reader and leave it running. The next successful Job Board scan will populate this page without overwriting a good last-known board with an empty scrape.</p></div>}
            </div>
          </section>
  );
}
