"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { MANAGER_BRACKETS, TECH_PAY_PLANS, tierForHours } from "./config";
import { emptyPayrollInputs, PayrollInputs } from "./types";

type Snapshot = { startDate: string; endDate: string; technicians: Array<{ name: string; billedHours: number }> } | null;
type WriterSnapshot = { writers: Array<{ name: string; statuses: Record<string, { amount: number }> }> } | null;
type Props = { weekly: Snapshot; lastWeek: Snapshot; weeklyWriters: WriterSnapshot; lastWeekWriters: WriterSnapshot };

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const numberValue = (value: string) => Number(value) || 0;

export default function PayrollPanel({ weekly, lastWeek, weeklyWriters, lastWeekWriters }: Props) {
  const [authorized, setAuthorized] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"weekly" | "last_week">("weekly");
  const [inputs, setInputs] = useState<PayrollInputs>(emptyPayrollInputs());
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const snapshot = period === "weekly" ? weekly : lastWeek;
  const writers = period === "weekly" ? weeklyWriters : lastWeekWriters;
  const weekStart = snapshot?.startDate || "";

  useEffect(() => { fetch("/api/payroll/session", { cache: "no-store" }).then((r) => r.json()).then((data) => { setAuthorized(Boolean(data.authenticated)); setConfigured(Boolean(data.configured)); }); }, []);
  useEffect(() => {
    if (!authorized || !weekStart) return;
    setLoaded(false);
    fetch(`/api/payroll/inputs?weekStart=${weekStart}`, { cache: "no-store" }).then((r) => r.json()).then((data) => { setInputs(data.inputs || emptyPayrollInputs()); setSavedAt(data.updatedAt || null); setLoaded(true); });
  }, [authorized, weekStart]);
  useEffect(() => {
    if (!authorized || !weekStart || !loaded) return;
    const timer = window.setTimeout(() => fetch("/api/payroll/inputs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart, inputs }) }).then((r) => r.json()).then((data) => { if (data.updatedAt) setSavedAt(data.updatedAt); }), 900);
    return () => window.clearTimeout(timer);
  }, [inputs, authorized, weekStart, loaded]);

  async function unlock(event: FormEvent) {
    event.preventDefault(); setError("");
    const response = await fetch("/api/payroll/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await response.json(); if (!response.ok) { setError(data.error || "Unable to unlock payroll."); return; }
    setAuthorized(true); setPassword("");
  }
  async function lock() { await fetch("/api/payroll/session", { method: "DELETE" }); setAuthorized(false); setInputs(emptyPayrollInputs()); }
  function techInput(name: string) { return inputs.techs[name] || { tierOverride: null, holiday: 0, reimbursement: 0, other: 0, notes: "" }; }
  function setTech(name: string, change: Partial<ReturnType<typeof techInput>>) { setInputs((current) => ({ ...current, techs: { ...current.techs, [name]: { ...techInput(name), ...change } } })); }
  function liveHours(name: string) { return snapshot?.technicians.find((tech) => tech.name.toLowerCase() === name.toLowerCase())?.billedHours || 0; }
  function posted(name: string) { return writers?.writers.find((writer) => writer.name.toLowerCase().includes(name.toLowerCase()))?.statuses?.Posted?.amount || 0; }

  const techRows = useMemo(() => Object.entries(TECH_PAY_PLANS).map(([name, plan]) => {
    const actual = liveHours(name); const autoTier = tierForHours(plan, actual); const adjustment = techInput(name);
    const tier = adjustment.tierOverride ?? autoTier; const rate = plan.rates[tier];
    const progressivePay = actual * rate;
    const hourlyBasePay = actual * plan.baseHourlyRate;
    const guaranteedBasePay = plan.guaranteedPay ?? (plan.guaranteedHours || 0) * plan.baseHourlyRate;
    const quickBooksBasePay = Math.max(hourlyBasePay, guaranteedBasePay);
    const totalTechPay = Math.max(progressivePay, quickBooksBasePay);
    const billedHoursPay = Math.max(0, totalTechPay - quickBooksBasePay);
    const finalPay = totalTechPay + adjustment.holiday + adjustment.reimbursement + adjustment.other;
    return { name, plan, actual, autoTier, adjustment, tier, rate, progressivePay,
      quickBooksBasePay, billedHoursPay, totalTechPay, finalPay };
  }), [snapshot, inputs.techs]);
  const kodyPosted = posted("Kody"); const andreaPosted = posted("Andrea");
  const combinedPosted = kodyPosted + andreaPosted;
  const afterDeduction = Math.max(0, combinedPosted - inputs.writers.miscDeduction);
  const commissionPool = afterDeduction * .08;
  const andreaHourlyPay = Number(inputs.writers.andrea.baseSalary) || 0;
  const remainingPool = Math.max(0, commissionPool - 1000 - andreaHourlyPay);
  const kodyCommission = remainingPool * .70;
  const andreaCommissionPlaceholder = remainingPool * .30;
  const kodyTotal = 1000 + kodyCommission;
  const andreaTotal = andreaHourlyPay;
  const managerProfit = Math.max(0, (Number(inputs.manager.profitSales) || 0) - (Number(inputs.manager.sublet) || 0));
  const managerRate = MANAGER_BRACKETS.reduce((rate, bracket) => managerProfit >= bracket.minimum ? bracket.rate : rate, 0);
  const managerTotal = managerProfit * managerRate;
  const towingRows = Object.entries(inputs.towing).map(([name, row]) => ({ name, ...row, total: row.jobTotal + row.nightBonus + row.weekdayBonus }));
  const grandTotal = techRows.reduce((sum, row) => sum + row.finalPay, 0) + kodyTotal + andreaTotal + managerTotal + towingRows.reduce((sum, row) => sum + row.total, 0);

  if (!authorized) return <section className="payroll-lock"><div className="payroll-lock-card"><div className="login-mark">$</div><p className="eyebrow">CONFIDENTIAL</p><h2>Payroll Calculator</h2><p>This area requires the separate payroll password.</p>{!configured && <div className="login-error">Payroll secrets have not been configured yet.</div>}<form onSubmit={unlock}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Payroll password" autoFocus required /><button type="submit" disabled={!configured}>Unlock payroll</button>{error && <div className="login-error">{error}</div>}</form></div></section>;

  return <section className="payroll-page">
    <div className="page-heading"><div><p className="panel-kicker">CONFIDENTIAL · CALCULATOR ONLY</p><h2>Weekly Payroll Worksheet</h2><p>Wednesday–Tuesday calculations. Review Thursday; actual payroll is submitted separately.</p></div><div className="payroll-heading-actions"><div className="lead-tabs"><button className={period === "weekly" ? "active" : ""} onClick={() => setPeriod("weekly")}>This week</button><button className={period === "last_week" ? "active" : ""} onClick={() => setPeriod("last_week")}>Last week</button></div><button className="payroll-lock-button" onClick={lock}>Lock payroll</button></div></div>
    <div className="payroll-save-line"><strong>{snapshot ? `${snapshot.startDate} – ${snapshot.endDate}` : "Waiting for live weekly data"}</strong><span>{savedAt ? `Saved ${new Date(savedAt).toLocaleString()}` : "Manual entries autosave"}</span></div>
    <div className="payroll-total"><small>Calculated payroll total</small><strong>{money.format(grandTotal)}</strong><span>Worksheet estimate — does not submit payroll</span></div>
    <h3 className="payroll-section-title">Technicians</h3><div className="payroll-tech-grid">{techRows.map((row) => <article className="payroll-tech" key={row.name}><div className="payroll-card-title"><div><strong>{row.name}</strong><span>{row.actual.toFixed(2)} live billed hours</span></div><b>{money.format(row.finalPay)}</b></div>{row.plan.warning && <div className="payroll-warning">{row.plan.warning}</div>}<div className="payroll-metrics"><span><small>Auto tier</small><strong>{row.plan.thresholds[row.autoTier]} hrs @ {money.format(row.plan.rates[row.autoTier])}</strong></span><span><small>Selected rate</small><strong>{money.format(row.rate)}/hr</strong></span><span><small>Progressive pay</small><strong>{money.format(row.progressivePay)}</strong></span><span><small>QuickBooks base pay</small><strong>{money.format(row.quickBooksBasePay)}</strong></span><span><small>QuickBooks billed hours</small><strong>{money.format(row.billedHoursPay)}</strong></span></div><label>Tier override<select value={row.adjustment.tierOverride ?? ""} onChange={(e) => setTech(row.name, { tierOverride: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Auto ({row.plan.thresholds[row.autoTier]} hrs)</option>{row.plan.thresholds.map((threshold, index) => <option value={index} key={threshold}>{threshold} hrs — {money.format(row.plan.rates[index])}/hr</option>)}</select></label><div className="payroll-input-grid"><label>Holiday<input type="number" step=".01" value={row.adjustment.holiday || ""} onChange={(e) => setTech(row.name, { holiday: numberValue(e.target.value) })} /></label><label>Reimbursement (+)<input type="number" step=".01" value={row.adjustment.reimbursement || ""} onChange={(e) => setTech(row.name, { reimbursement: numberValue(e.target.value) })} /></label><label>Other (+/−)<input type="number" step=".01" value={row.adjustment.other || ""} onChange={(e) => setTech(row.name, { other: numberValue(e.target.value) })} /></label></div><label>Notes<input value={row.adjustment.notes} onChange={(e) => setTech(row.name, { notes: e.target.value })} /></label></article>)}</div>
    <h3 className="payroll-section-title">Service Writers</h3><article className="payroll-wide-card"><div className="payroll-card-title"><div><strong>Kody Whobrey + Andrea Wilson</strong><span>Live Posted sales: {money.format(combinedPosted)} · 8% pool</span></div><b>{money.format(kodyTotal + andreaTotal)}</b></div><div className="payroll-input-grid four"><label>Misc sales deduction<input type="number" step=".01" value={inputs.writers.miscDeduction || ""} onChange={(e) => setInputs({ ...inputs, writers: { ...inputs.writers, miscDeduction: numberValue(e.target.value) } })} /></label><label>Andrea hourly pay this week<input type="number" step=".01" value={inputs.writers.andrea.baseSalary || ""} onChange={(e) => setInputs({ ...inputs, writers: { ...inputs.writers, andrea: { ...inputs.writers.andrea, baseSalary: numberValue(e.target.value) } } })} /></label></div><div className="payroll-result-row"><span>Kody Posted <b>{money.format(kodyPosted)}</b></span><span>Andrea Posted <b>{money.format(andreaPosted)}</b></span><span>8% pool <b>{money.format(commissionPool)}</b></span><span>Pool after base pay <b>{money.format(remainingPool)}</b></span><span>Kody commission (70%) <b>{money.format(kodyCommission)}</b></span><span>Kody total <b>{money.format(kodyTotal)}</b></span><span>Andrea hourly pay <b>{money.format(andreaTotal)}</b></span><span>Andrea future commission (30%) <b>{money.format(andreaCommissionPlaceholder)}</b></span></div><div className="payroll-warning">The remaining pool cannot go below $0. Andrea's 30% is a future placeholder and is not included in payroll yet.</div></article>
    <h3 className="payroll-section-title">Service Manager</h3><article className="payroll-wide-card"><div className="payroll-card-title"><div><strong>{inputs.manager.name || "Service Manager"}</strong><span>Profit sales minus sublet</span></div><b>{money.format(managerTotal)}</b></div><div className="payroll-input-grid four"><label>Name<input value={inputs.manager.name} onChange={(e) => setInputs({ ...inputs, manager: { ...inputs.manager, name: e.target.value } })} /></label><label>Profit sales<input type="number" step=".01" value={inputs.manager.profitSales || ""} onChange={(e) => setInputs({ ...inputs, manager: { ...inputs.manager, profitSales: numberValue(e.target.value) } })} /></label><label>Sublet<input type="number" step=".01" value={inputs.manager.sublet || ""} onChange={(e) => setInputs({ ...inputs, manager: { ...inputs.manager, sublet: numberValue(e.target.value) } })} /></label></div><div className="payroll-result-row"><span>Commission base <b>{money.format(managerProfit)}</b></span><span>Bracket <b>{(managerRate * 100).toFixed(1)}%</b></span><span>Commission <b>{money.format(managerTotal)}</b></span></div><div className="payroll-warning">Manager commission starts at 0.5% at $18,000 and tops out at 3% at $40,000.</div></article>
    <h3 className="payroll-section-title">Towing</h3><div className="payroll-tech-grid">{towingRows.map((row) => <article className="payroll-tech" key={row.name}><div className="payroll-card-title"><strong>{row.name}</strong><b>{money.format(row.total)}</b></div><div className="payroll-input-grid"><label>Job total<input type="number" step=".01" value={row.jobTotal || ""} onChange={(e) => setInputs({ ...inputs, towing: { ...inputs.towing, [row.name]: { ...inputs.towing[row.name], jobTotal: numberValue(e.target.value) } } })} /></label><label>Night bonus<input type="number" step=".01" value={row.nightBonus || ""} onChange={(e) => setInputs({ ...inputs, towing: { ...inputs.towing, [row.name]: { ...inputs.towing[row.name], nightBonus: numberValue(e.target.value) } } })} /></label><label>Weekday bonus<input type="number" step=".01" value={row.weekdayBonus || ""} onChange={(e) => setInputs({ ...inputs, towing: { ...inputs.towing, [row.name]: { ...inputs.towing[row.name], weekdayBonus: numberValue(e.target.value) } } })} /></label></div></article>)}</div>
  </section>;
}
