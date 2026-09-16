"use client";

import { useState } from "react";
import { useDashboard } from "@/app/dashboard-context";
import Icon from "../Icon";
import { money, relativeTime } from "@/app/lib/format";
import type { TekmetricLiveSignal } from "@/app/lib/types";

export default function OverviewView() {
  const {
    range,
    question,
    setQuestion,
    answer,
    setAnswer,
    aiConfigured,
    aiLoading,
    setAiSetupOpen,
    setNav,
    setConnectionOpen,
    soldHoursThisWeek,
    jobBoardCapturedAt,
    selectedLive,
    realChange,
    data,
    gpPercent,
    gpStatus,
    teamHours,
    teamTarget,
    roCount,
    calculatedAro,
    hoursPerRO,
    weeklyHoursSoldGoal,
    isToday,
    showsOperatingGoal,
    currentSalesGoal,
    currentCarGoal,
    aroGoal,
    hoursPerROGoal,
    aroMet,
    hoursPerROMet,
    weeklySalesPace,
    weeklyCarPace,
    salesGoalGap,
    projectedWeeklySalesGap,
    projectedWeeklyCarGap,
    aroDollarGap,
    hoursSoldGap,
    gpPointGap,
    gpDollarGap,
    teamHoursGap,
    activeSoldHours,
    activeSoldHourRos,
    verifyQueue,
    laborSales,
    chartPoints,
    askAI,
    usePrompt,
    webhookEvents,
    readerStatus,
    criticalJobs,
    warningJobs,
    auditCritical,
    goalTickets,
    hiddenGoalTicket,
    weeklySalesGoal,
    weeklyCarGoal,
  } = useDashboard();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const needsAttention = Boolean(readerStatus && readerStatus.status !== "ok");
  const attentionLabel =
    readerStatus?.status === "tekmetric_signin_required" ? "Tekmetric sign-in"
      : readerStatus?.status === "steer_signin_required" ? "Steer sign-in"
        : readerStatus?.status === "napa_signin_required" ? "NAPA sign-in"
          : needsAttention ? "Reader attention" : "Reader OK";
  const gpFlagCount = (goalTickets || []).filter(
    (ticket: { controllable?: boolean; roNumber: string }) =>
      ticket.controllable && !(hiddenGoalTicket?.(ticket.roNumber)),
  ).length;
  const problemCount = Number(criticalJobs || 0) + Number(warningJobs || 0) + Number(auditCritical || 0);
  const gpOffTarget = gpPercent < 60;

  return (
    <>
        <section className="action-board" aria-label="GM action board">
          <article
            className={`action-card ${needsAttention ? "action-alert" : "action-ok"}`}
            role="button"
            tabIndex={0}
            onClick={() => setConnectionOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setConnectionOpen(true);
            }}
          >
            <p>Needs Attention</p>
            <strong>{needsAttention ? "Act now" : "Clear"}</strong>
            <small>{needsAttention ? `${attentionLabel}. Sign in on the shop PC.` : "Tekmetric / Steer / NAPA sessions look fine."}</small>
          </article>
          <article
            className={`action-card ${verifyQueue.length ? "action-alert" : "action-ok"}`}
            role="button"
            tabIndex={0}
            onClick={() => setNav("Verify Queue")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setNav("Verify Queue");
            }}
          >
            <p>Verify</p>
            <strong>{verifyQueue.length}</strong>
            <small>{verifyQueue.length ? "Open Verify Queue" : "All caught up"} · Estimates + WIP</small>
          </article>
          <article
            className={`action-card ${problemCount ? "action-alert" : "action-ok"}`}
            role="button"
            tabIndex={0}
            onClick={() => setNav(Number(criticalJobs || 0) || Number(warningJobs || 0) ? "Job Board" : "Ticket Auditor")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                setNav(Number(criticalJobs || 0) || Number(warningJobs || 0) ? "Job Board" : "Ticket Auditor");
              }
            }}
          >
            <p>Problems</p>
            <strong>{problemCount}</strong>
            <small>
              {Number(criticalJobs || 0)} WIP 7+ days · {Number(warningJobs || 0)} WIP 2+ days
              {Number(auditCritical || 0) ? ` · ${auditCritical} critical GP findings` : ""}
            </small>
          </article>
          <article
            className={`action-card ${gpOffTarget || gpFlagCount ? "action-alert" : "action-ok"}`}
            role="button"
            tabIndex={0}
            onClick={() => setNav("Goal Miss")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setNav("Goal Miss");
            }}
          >
            <p>GP flags</p>
            <strong>{gpPercent.toFixed(1)}%</strong>
            <small>
              {gpStatus.label}
              {gpFlagCount ? ` · ${gpFlagCount} controllable ticket${gpFlagCount === 1 ? "" : "s"}` : " · Open Goal Miss for ticket detail"}
            </small>
          </article>
        </section>

        <section className="operations-strip" aria-label={`${range} operating metrics`}>
          <article className="team-hours-summary">
            <div>
              <p>{range === "Today" ? "TODAY BILLED HOURS VS DAILY TARGET" : "TEAM BILLED HOURS VS TARGET"}</p>
              <strong>{teamHours.toFixed(1)} <span>/ {teamTarget.toFixed(0)} hrs</span></strong>
            </div>
            <div className="team-progress">
              <i style={{ width: `${Math.min((teamHours / Math.max(teamTarget, 1)) * 100, 100)}%` }} />
            </div>
            <b>{((teamHours / Math.max(teamTarget, 1)) * 100).toFixed(1)}%</b>
          </article>
          <article className={`goal-card ${showsOperatingGoal && selectedLive?.totalROs ? (roCount >= currentCarGoal ? "goal-met" : "goal-short") : ""}`}>
            <p>Car Count</p><strong>{selectedLive?.totalROs || "—"}</strong>
            <small>{showsOperatingGoal ? (selectedLive?.totalROs ? (isToday ? `12-car daily pace · ${weeklyCarPace.toFixed(0)} projected weekly` : `60-car weekly goal`) : (isToday ? "12-car daily pace for 60/week" : "60-car weekly goal")) : "Total repair orders"}</small>
          </article>
          <article className={`goal-card ${calculatedAro ? (aroMet ? "goal-met" : "goal-short") : ""}`}>
            <p>ARO</p>
            <strong>{calculatedAro ? money.format(calculatedAro) : "—"}</strong>
            <small>{calculatedAro ? `${money.format(selectedLive?.totalSales || 0)} sales ÷ ${roCount} ROs · ${aroMet ? "goal achieved" : `${money.format(aroGoal - calculatedAro)} below $1,000`}` : "$1,000 goal · Sales ÷ total ROs"}</small>
          </article>
          <article className={`goal-card ${hoursPerRO ? (hoursPerROMet ? "goal-met" : "goal-short") : ""}`}>
            <p>Hours / RO</p>
            <strong>{hoursPerRO ? hoursPerRO.toFixed(2) : "—"}</strong>
            <small>{hoursPerRO ? `${selectedLive?.hoursSold.toFixed(1)} sold hrs ÷ ${roCount} ROs · ${hoursPerROMet ? "goal achieved" : `${(hoursPerROGoal - hoursPerRO).toFixed(2)} below 3.00`}` : "3.00-hour goal"}</small>
          </article>
        </section>

        <section className="kpi-grid pace-grid" aria-label="Shop pace">
          <article className={`kpi-card ${showsOperatingGoal ? `gp-card ${data.sales >= currentSalesGoal ? "gp-target" : "gp-critical"}` : ""}`}>
            <Icon>◇</Icon>
            <div><p>Total Sales</p><strong>{money.format(data.sales)}</strong><small className={showsOperatingGoal ? "" : "positive"}>{showsOperatingGoal ? (data.sales >= currentSalesGoal ? `● ${money.format(currentSalesGoal)} ${isToday ? "daily pace" : "weekly goal"} achieved` : `● ${money.format(salesGoalGap)} below ${money.format(currentSalesGoal)} ${isToday ? "daily pace" : "goal"}`) : `↑ ${data.salesChange}%`} <em>{showsOperatingGoal && weeklySalesPace ? `${money.format(weeklySalesPace)} projected weekly` : data.comparison}</em></small></div>
          </article>
          <article className={`kpi-card gp-card ${gpStatus.className}`}>
            <Icon>%</Icon>
            <div><p>GP %</p><strong>{gpPercent.toFixed(1)}%</strong><small>{gpStatus.label} <em>calculated</em></small></div>
          </article>
          <article className={`kpi-card gp-card ${jobBoardCapturedAt ? (soldHoursThisWeek >= weeklyHoursSoldGoal ? "gp-target" : "gp-critical") : ""}`}>
            <Icon>◷</Icon>
            <div>
              <p>Hours Sold This Week</p><strong>{jobBoardCapturedAt ? soldHoursThisWeek.toFixed(1) : "—"}</strong>
              <small>{jobBoardCapturedAt ? (soldHoursThisWeek >= weeklyHoursSoldGoal ? "● Goal achieved" : `● ${(weeklyHoursSoldGoal - soldHoursThisWeek).toFixed(1)} hrs below goal`) : "Waiting for Job Board"} <em>{activeSoldHours.toFixed(1)} approved hrs currently in shop · {activeSoldHourRos} active ROs</em></small>
            </div>
          </article>
        </section>

        {selectedLive && (
          <section className="recovery-panel" aria-label="Goal recovery based on current pace">
            <div className="recovery-heading">
              <div>
                <p className="panel-kicker">LIVE PACE</p>
                <h2>What We Need to Reach Goal</h2>
              </div>
              <span>Based on {roCount} current RO{roCount === 1 ? "" : "s"}</span>
            </div>
            <div className="recovery-grid">
              <article className={weeklySalesPace >= weeklySalesGoal ? "recovery-met" : "recovery-short"}>
                <p>Weekly sales</p>
                <strong>{weeklySalesPace >= weeklySalesGoal ? "On pace" : money.format(projectedWeeklySalesGap)}</strong>
                <small>{weeklySalesPace >= weeklySalesGoal ? `${money.format(weeklySalesPace)} projected for the week.` : `${money.format(weeklySalesPace)} projected; this is the projected gap to $60,000.`}</small>
              </article>
              <article className={weeklyCarPace >= weeklyCarGoal ? "recovery-met" : "recovery-short"}>
                <p>Weekly car count</p>
                <strong>{weeklyCarPace >= weeklyCarGoal ? "On pace" : `${Math.ceil(projectedWeeklyCarGap)} cars`}</strong>
                <small>{weeklyCarPace >= weeklyCarGoal ? `${weeklyCarPace.toFixed(0)} ROs projected for the week.` : `${weeklyCarPace.toFixed(0)} projected; this is the projected gap to 60.`}</small>
              </article>
              <article className={aroMet ? "recovery-met" : "recovery-short"}>
                <p>ARO</p>
                <strong>{aroMet ? "On goal" : money.format(aroDollarGap)}</strong>
                <small>{aroMet ? "Maintain at least $1,000 per RO." : `Additional sales needed now — ${money.format(Math.max(aroGoal - calculatedAro, 0))} more per RO.`}</small>
              </article>
              <article className={hoursPerROMet ? "recovery-met" : "recovery-short"}>
                <p>Hours / RO</p>
                <strong>{hoursPerROMet ? "On goal" : `${hoursSoldGap.toFixed(1)} hrs`}</strong>
                <small>{hoursPerROMet ? "Maintain at least 3.00 sold hours per RO." : `Additional sold hours needed now — ${Math.max(hoursPerROGoal - hoursPerRO, 0).toFixed(2)} more per RO.`}</small>
              </article>
              <article className={gpPointGap === 0 ? "recovery-met" : gpPercent >= 58 ? "recovery-watch" : "recovery-short"}>
                <p>Gross Profit</p>
                <strong>{gpPointGap === 0 ? "On goal" : `${gpPointGap.toFixed(1)} pts`}</strong>
                <small>{gpPointGap === 0 ? "Maintain a 60% or better gross profit." : `Gap to 60% — ${money.format(gpDollarGap)} more GP on the current sales mix.`}</small>
              </article>
              <article className={teamHoursGap === 0 ? "recovery-met" : "recovery-short"}>
                <p>Team Hours</p>
                <strong>{teamHoursGap === 0 ? "On goal" : `${teamHoursGap.toFixed(1)} hrs`}</strong>
                <small>{teamHoursGap === 0 ? "Current billed-hours target achieved." : "Additional billed hours needed to reach the current target."}</small>
              </article>
            </div>
          </section>
        )}

        <button
          type="button"
          className="overview-more-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {detailsOpen ? "Hide extra metrics" : "More metrics"} — labor, AR, technicians, trend, Ask Delta AI
        </button>

        {detailsOpen && (
          <div className="overview-more-panel">
            <section className="kpi-grid" aria-label="Extra shop metrics">
              <article className="kpi-card">
                <Icon>↗</Icon>
                <div><p>Gross Profit</p><strong>{money.format(data.grossProfit)}</strong>
                  {selectedLive ? (
                    realChange && realChange.grossProfit !== null ? (
                      <small className={realChange.grossProfit >= 0 ? "positive" : "negative"}>
                        {realChange.grossProfit >= 0 ? "↑" : "↓"} {Math.abs(realChange.grossProfit).toFixed(1)}% <em>{realChange.label}</em>
                      </small>
                    ) : (
                      <small><em>{range === "Today" ? "today" : "no prior-week data yet"}</em></small>
                    )
                  ) : (
                    <small className="positive">↑ {data.gpChange}% <em>{data.comparison}</em></small>
                  )}
                </div>
              </article>
              <article className="kpi-card">
                <Icon>⌕</Icon>
                <div><p>Labor Sales</p><strong>{money.format(data.laborSales ?? laborSales ?? 0)}</strong>
                  {selectedLive ? (
                    realChange && realChange.laborSales !== null ? (
                      <small className={realChange.laborSales >= 0 ? "positive" : "negative"}>
                        {realChange.laborSales >= 0 ? "↑" : "↓"} {Math.abs(realChange.laborSales).toFixed(1)}% <em>{realChange.label}</em>
                      </small>
                    ) : (
                      <small><em>{range === "Today" ? "today" : "no prior-week data yet"}</em></small>
                    )
                  ) : (
                    <small className="positive">↑ {data.laborChange}% <em>{data.comparison}</em></small>
                  )}
                </div>
              </article>
              <article className="kpi-card">
                <Icon>−</Icon>
                <div><p>Less AR</p><strong>{selectedLive ? money.format(selectedLive.lessAR || 0) : "—"}</strong><small><em>Posted to A/R</em></small></div>
              </article>
              <article className="kpi-card">
                <Icon>✓</Icon>
                <div><p>Cleared from AR</p><strong>{selectedLive ? money.format(selectedLive.clearedFromAR || 0) : "—"}</strong><small><em>End of Day report</em></small></div>
              </article>
            </section>

            {webhookEvents?.lastEventAt && (
              <section className="webhook-live-panel" aria-label="Live Tekmetric webhook signals">
                <div className="recovery-heading">
                  <div>
                    <p className="panel-kicker">CUSTOM INTEGRATION</p>
                    <h2>Live Tekmetric Events</h2>
                  </div>
                  <span>Webhooks do not replace the shop PC reader</span>
                </div>
                <div className="webhook-live-grid">
                  {([
                    ["Posted / Complete / A/R / Payment", webhookEvents.signals.overviewFreshness],
                    ["Work approved", webhookEvents.signals.lastApproval],
                    ["Work declined", webhookEvents.signals.lastDecline],
                    ["Schedule", webhookEvents.signals.scheduleChanged],
                    ["Verify / label watch", webhookEvents.signals.labelChange],
                    ["Warranty label", webhookEvents.signals.warrantyLabel],
                  ] as Array<[string, TekmetricLiveSignal | null]>).map(([label, signal]) => (
                    <article key={String(label)}>
                      <p>{label}</p>
                      <strong>{signal ? relativeTime(signal.occurredAt || signal.receivedAt) : "—"}</strong>
                      <small>{signal ? signal.detail : "No webhook yet"}</small>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="analysis-grid">
              <article className="panel tech-panel">
                <div className="panel-heading">
                  <div><p className="panel-kicker">PRODUCTION</p><h2>Technician Billed Hours</h2></div>
                  <span className="target-badge">{isToday ? "Daily target tracking" : "Target tracking"}</span>
                </div>
                <div className="tech-list">
                  {data.techs.map((tech: { name: string; hours: number; target: number }) => {
                    const hasTarget = tech.target > 0;
                    const pct = hasTarget ? Math.min((tech.hours / tech.target) * 100, 100) : 100;
                    const over = hasTarget && tech.hours >= tech.target;
                    return (
                      <div className="tech-row" key={tech.name}>
                        <div className="tech-name"><span>{tech.name.slice(0, 1)}</span><strong>{tech.name}</strong></div>
                        <div className="progress-wrap">
                          <div className="progress-track"><div className={`progress-fill ${over ? "complete" : ""}`} style={{ width: `${pct}%` }} /><i /></div>
                        </div>
                        <div className="hours"><strong>{tech.hours.toFixed(1)}</strong><small>{hasTarget ? ` / ${tech.target} hrs` : " helper hrs"}</small><em className={over ? "over" : ""}>{hasTarget ? (over ? "Over target" : "In progress") : "No target"}</em></div>
                      </div>
                    );
                  })}
                </div>
                <div className="legend"><span><i className="legend-target" />Target</span><span><i className="legend-done" />Completed</span><span><i className="legend-left" />Remaining</span></div>
              </article>

              <article className="panel trend-panel">
                <div className="panel-heading">
                  <div><p className="panel-kicker">PERFORMANCE</p><h2>Sales Trend</h2></div>
                  <span className="target-badge">Daily sales</span>
                </div>
                <div className="chart-wrap">
                  <div className="axis-labels"><span>$20K</span><span>$15K</span><span>$10K</span><span>$5K</span></div>
                  <svg className="trend-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Daily sales trend">
                    <defs>
                      <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3d7eb8" stopOpacity=".34" /><stop offset="100%" stopColor="#3d7eb8" stopOpacity="0" /></linearGradient>
                    </defs>
                    <polygon points={`3,88 ${chartPoints} 97,88`} fill="url(#salesFill)" />
                    <polyline points={chartPoints} fill="none" stroke="#5b9ad4" strokeWidth="2.3" vectorEffect="non-scaling-stroke" />
                    {chartPoints.split(" ").map((point: string, index: number) => {
                      const [cx, cy] = point.split(",");
                      return <circle key={point} cx={cx} cy={cy} r="1.6" fill="#5b9ad4"><title>{`Day ${index + 1}: $${data.trend[index]}K`}</title></circle>;
                    })}
                  </svg>
                  <div className="date-labels">{data.trend.map((_: unknown, index: number) => <span key={index}>{index + 1}</span>)}</div>
                </div>
              </article>
            </section>

            <section className="ai-panel panel">
              <div className="ai-heading"><span>✦</span><div><p className="panel-kicker">SHOP ANALYST</p><h2>Ask Delta AI</h2></div></div>
              <form id="ai-form" onSubmit={askAI} className="ai-form">
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about sales, gross profit, or technician hours…"
                  aria-label="Ask Delta AI"
                />
                <button type="submit" aria-label="Submit question" disabled={aiLoading}>
                  {aiLoading ? "…" : "➤"}
                </button>
              </form>
              <div className="prompt-row">
                <button onClick={() => usePrompt("Compare sales this week")}><span>▥</span>Compare this week</button>
                <button onClick={() => usePrompt("Who hit their billed hours target?")}><span>♙</span>Who hit target?</button>
                <button onClick={() => usePrompt("Explain the gross profit change")}><span>↗</span>Explain GP change</button>
              </div>
              {answer && <div className="ai-answer"><span>✦</span><p>{answer}</p><button onClick={() => setAnswer("")}>×</button></div>}
              {!aiConfigured && (
                <button className="secondary-action" onClick={() => setAiSetupOpen(true)}>
                  Connect OpenAI to activate Delta AI
                </button>
              )}
            </section>
          </div>
        )}
</>
  );
}
