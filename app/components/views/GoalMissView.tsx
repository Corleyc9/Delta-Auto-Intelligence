"use client";

import { useDashboard } from "@/app/dashboard-context";
import { money } from "@/app/lib/format";

export default function GoalMissView() {
  const {
    goalMissSnapshot,
    goalDisposition,
    goalView,
    setGoalView,
    updateGoalDisposition,
    goalTickets,
    hiddenGoalTicket,
    visibleGoalTickets,
    goalTotals,
  } = useDashboard();
  return (
    <section className="goal-miss-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">WEDNESDAY–TUESDAY · TICKET-LEVEL ACCOUNTABILITY</p>
                <h2>GP Root Cause</h2>
                <p>Shows exactly which posted repair orders caused the weekly GP, with parts and labor profit separated and the worst parts losses ranked first.</p>
              </div>
              <div className="lead-summary">
                <strong>{goalTickets.length}</strong><span>weekly ROs analyzed</span>
                <small>{goalMissSnapshot ? `${goalMissSnapshot.startDate} – ${goalMissSnapshot.endDate} · Updated ${new Date(goalMissSnapshot.capturedAt).toLocaleString()}` : "Waiting for weekly ticket detail"}</small>
              </div>
            </div>
            {goalMissSnapshot && <>
              <div className="goal-week-strip">
                <article><small>Actual GP</small><strong>{money.format(goalTotals.gp)}</strong><span>{goalTotals.sales ? `${(goalTotals.gp / goalTotals.sales * 100).toFixed(1)}% of ${money.format(goalTotals.sales)}` : "No sales"}</span></article>
                <article className="danger"><small>Parts GP</small><strong>{goalTotals.partsSales ? `${(goalTotals.partsProfit / goalTotals.partsSales * 100).toFixed(1)}%` : "Not read"}</strong><span>{goalTotals.partsSales ? `${money.format(goalTotals.partsProfit)} profit on ${money.format(goalTotals.partsSales)}` : "New reader data required"}</span></article>
                <article><small>Labor GP</small><strong>{goalTotals.laborSales ? `${(goalTotals.laborProfit / goalTotals.laborSales * 100).toFixed(1)}%` : "Not read"}</strong><span>{goalTotals.laborSales ? `${money.format(goalTotals.laborProfit)} profit on ${money.format(goalTotals.laborSales)}` : "New reader data required"}</span></article>
                <article className="danger"><small>Parts profit gap</small><strong>{money.format(goalTotals.partsGap)}</strong><span>Gap to 40% parts GP minimum</span></article>
              </div>
              <div className="audit-note"><strong>How to read this</strong><span>Tickets are ranked by missing parts profit first, using 40% as the current parts GP minimum. Overall GP uses the 60% shop target and labor uses a 60% minimum. “Not read” means the installed Windows reader must be updated before that breakdown is available.</span></div>
              <div className="audit-toolbar"><div className="lead-tabs">
                {([['controllable', 'Controllable'], ['exceptions', 'Legitimate exceptions'], ['all', 'All visible'], ['hidden', 'Hidden']] as const).map(([value, label]) => (
                  <button key={value} className={goalView === value ? "active" : ""} onClick={() => setGoalView(value)}>{label}<span>{value === 'hidden' ? goalTickets.filter((ticket) => hiddenGoalTicket(ticket.roNumber)).length : value === 'controllable' ? goalTickets.filter((ticket) => ticket.controllable && !hiddenGoalTicket(ticket.roNumber)).length : value === 'exceptions' ? goalTickets.filter((ticket) => !ticket.controllable && !hiddenGoalTicket(ticket.roNumber)).length : goalTickets.filter((ticket) => !hiddenGoalTicket(ticket.roNumber)).length}</span></button>
                ))}
              </div></div>
              <div className="goal-miss-list">
                {visibleGoalTickets.map((ticket, index) => <article className={`goal-ticket ${ticket.controllable ? "controllable" : "exception"}`} key={ticket.roNumber}>
                  <div className="goal-rank">#{index + 1}</div>
                  <div className="goal-ticket-main">
                    <div className="goal-ticket-title"><div><a href={ticket.detailUrl || undefined} target="_blank" rel="noreferrer">RO#{ticket.roNumber}</a><strong>{ticket.customer}</strong><span>{ticket.vehicle}</span></div><b className={ticket.controllable ? "bad" : "exception-badge"}>{ticket.controllable ? "CONTROLLABLE" : ticket.exceptionType || "EXCEPTION"}</b></div>
                    <div className="goal-metrics">
                      <span><small>Total sales</small><strong>{money.format(ticket.sales)}</strong><em>{ticket.grossProfitPercent.toFixed(1)}% overall GP</em></span>
                      <span className={ticket.partsProfitGap > 0 ? "impact" : ""}><small>Parts GP</small><strong>{ticket.partsSales > 0 ? `${ticket.partsGpPercent.toFixed(1)}%` : "Not read"}</strong><em>{ticket.partsSales > 0 ? `${money.format(ticket.partsProfit)} profit · ${money.format(ticket.partsCost)} cost` : "reader update required"}</em></span>
                      <span><small>Labor GP</small><strong>{ticket.laborSales > 0 ? `${ticket.laborGpPercent.toFixed(1)}%` : "Not read"}</strong><em>{ticket.laborSales > 0 ? `${money.format(ticket.laborProfit)} profit` : "reader update required"}</em></span>
                      <span><small>Overall GP</small><strong>{money.format(ticket.grossProfit)}</strong><em>{ticket.hasHourDetail ? `${money.format(ticket.grossProfitPerHour)} per hour` : "GP/hour unavailable"}</em></span>
                      <span className="impact"><small>Parts profit loss</small><strong>{ticket.partsSales > 0 ? money.format(ticket.partsProfitGap) : "—"}</strong><em>{ticket.partsSales > 0 ? "gap to 40% minimum" : "waiting for breakdown"}</em></span>
                    </div>
                    <div className="goal-accountability"><span><small>Service writer</small><strong>{ticket.serviceWriter}</strong></span><span><small>Technician(s)</small><strong>{ticket.technicians.join(", ") || "Not assigned"}</strong></span><span><small>Root cause</small><strong>{ticket.rootCauses.join(" · ") || (ticket.dataComplete ? "No cause classified" : "Profitability data incomplete")}</strong></span></div>
                    {(ticket.unbilledParts > 0 || ticket.missedLabor > 0 || ticket.discount > 0 || ticket.notes) && <div className="goal-details">{ticket.unbilledParts > 0 && <span>Unbilled parts: {money.format(ticket.unbilledParts)}</span>}{ticket.missedLabor > 0 && <span>Missed labor: {money.format(ticket.missedLabor)}</span>}{ticket.discount > 0 && <span>Discounts: {money.format(ticket.discount)}</span>}{ticket.notes && <p>{ticket.notes}</p>}</div>}
                    <div className="goal-actions">
                      {goalDisposition[ticket.roNumber] ? <><span>{goalDisposition[ticket.roNumber].status}{goalDisposition[ticket.roNumber].assignedTo ? ` · ${goalDisposition[ticket.roNumber].assignedTo}` : ""}{goalDisposition[ticket.roNumber].reason ? ` · ${goalDisposition[ticket.roNumber].reason}` : ""}</span><button onClick={() => updateGoalDisposition(ticket.roNumber)}>Reopen</button></> : <>
                        <button onClick={() => updateGoalDisposition(ticket.roNumber, { status: "okay", reason: window.prompt("Exception reason or note") || "Reviewed" })}>Okay / exception</button>
                        <button onClick={() => updateGoalDisposition(ticket.roNumber, { status: "assigned", assignedTo: window.prompt("Assign to") || ticket.serviceWriter })}>Assign</button>
                        <button className="approve" onClick={() => updateGoalDisposition(ticket.roNumber, { status: "resolved" })}>Resolve</button>
                        <button onClick={() => updateGoalDisposition(ticket.roNumber, { status: "hidden", hideUntil: window.prompt("Hide until (YYYY-MM-DD)") || "" })}>Hide until</button>
                      </>}
                    </div>
                  </div>
                </article>)}
                {!visibleGoalTickets.length && <div className="empty-leads"><strong>No tickets in this view</strong><p>Choose another filter or wait for the Windows reader to send the completed Wednesday–Tuesday RO detail.</p></div>}
              </div>
            </>}
            {!goalMissSnapshot && <div className="empty-leads"><strong>Weekly posted-RO detail has not arrived yet</strong><p>Goal Miss analyzes completed Wednesday–Tuesday ROs from a favorited RO Profitability or RO History report. The separate WIP Ticket Auditor opens every current Work-in-Progress ticket about every 20 minutes.</p></div>}
          </section>
  );
}
