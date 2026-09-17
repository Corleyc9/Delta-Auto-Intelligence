"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import PayrollPanel from "./payroll/PayrollPanel";
import { businessDaysInclusive, dashboardRanges } from "./lib/calendar";
import { SAMPLE_RANGE_DATA, WEEKLY_CAR_GOAL, WEEKLY_HOURS_SOLD_GOAL, WEEKLY_SALES_GOAL, ARO_GOAL, HOURS_PER_RO_GOAL, technicianWeeklyTarget } from "./lib/goals";
import type {
  AuditDisposition,
  DeltaAiAudit,
  GoalDisposition,
  GoalMissSnapshot,
  LiveSnapshot,
  LotWalkActionItem,
  LotWalkAudit,
  LotWalkResult,
  Opportunity,
  Range,
  ReaderCredentials,
  ReaderRevision,
  ReaderStatus,
  RepairOrder,
  ScheduleSnapshot,
  TekmetricLiveEvents,
  TicketAudit,
  VerificationRecord,
  WarrantyClaim,
  WriterSnapshot,
} from "./lib/types";
import LoginScreen from "./components/layout/LoginScreen";
import SideRail from "./components/layout/SideRail";
import TopBar from "./components/layout/TopBar";
import StatusBanners from "./components/layout/StatusBanners";
import ReaderSetupModal from "./components/layout/ReaderSetupModal";
import AiSetupModal from "./components/layout/AiSetupModal";
import OverviewView from "./components/views/OverviewView";
import VerifyQueueView from "./components/views/VerifyQueueView";
import JobBoardView from "./components/views/JobBoardView";
import GoalMissView from "./components/views/GoalMissView";
import TicketAuditorView from "./components/views/TicketAuditorView";
import WarrantyClaimsView from "./components/views/WarrantyClaimsView";
import DeltaAiReviewView from "./components/views/DeltaAiReviewView";
import LeadsView from "./components/views/LeadsView";
import WritersView from "./components/views/WritersView";
import ScheduleHistoryView from "./components/views/ScheduleHistoryView";
import LotWalkView from "./components/views/LotWalkView";
import { DashboardContext } from "./dashboard-context";

export default function Home() {
  const expectedRanges = dashboardRanges();
  const [range, setRange] = useState<Range>("This week");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSetupOpen, setAiSetupOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [aiSetupMessage, setAiSetupMessage] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [nav, setNav] = useState("Overview");
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(null);
  const [dailySnapshot, setDailySnapshot] = useState<LiveSnapshot | null>(null);
  const [lastWeekSnapshot, setLastWeekSnapshot] = useState<LiveSnapshot | null>(null);
  const [readerCredentials, setReaderCredentials] = useState<ReaderCredentials | null>(null);
  const [credentialError, setCredentialError] = useState("");
  const [readerStatus, setReaderStatus] = useState<ReaderStatus | null>(null);
  const [readerRevision, setReaderRevision] = useState<ReaderRevision | null>(null);
  const [lotWalkAudits, setLotWalkAudits] = useState<LotWalkAudit[]>([]);
  const [lotWalkUploading, setLotWalkUploading] = useState(false);
  const [lotWalkProgress, setLotWalkProgress] = useState(0);
  const [lotWalkTransferred, setLotWalkTransferred] = useState(0);
  const [lotWalkUploadSize, setLotWalkUploadSize] = useState(0);
  const [lotWalkUploadName, setLotWalkUploadName] = useState("");
  const [lotWalkUploadComplete, setLotWalkUploadComplete] = useState(false);
  const [lotWalkError, setLotWalkError] = useState("");
  const [lotWalkSelectedId, setLotWalkSelectedId] = useState<number | null>(null);
  const [lotWalkDetail, setLotWalkDetail] = useState<LotWalkResult | null>(null);
  const [lotWalkResultInput, setLotWalkResultInput] = useState("");
  const [lotWalkResultMessage, setLotWalkResultMessage] = useState("");
  const [lotWalkRoInputs, setLotWalkRoInputs] = useState<Record<number, string>>({});
  const [lotWalkAssigningIndex, setLotWalkAssigningIndex] = useState<number | null>(null);
  const [scheduleSnapshots, setScheduleSnapshots] = useState<ScheduleSnapshot[]>([]);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleSnapshotId, setScheduleSnapshotId] = useState<number | null>(null);
  const [scheduleCaptureBusy, setScheduleCaptureBusy] = useState(false);
  const [scheduleCaptureMessage, setScheduleCaptureMessage] = useState("");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [opportunitiesCapturedAt, setOpportunitiesCapturedAt] = useState<string | null>(null);
  const [opportunityListDate, setOpportunityListDate] = useState<string | null>(null);
  const [leadType, setLeadType] = useState<"all" | "business" | "personal" | "unclassified">("all");
  const [leadSearch, setLeadSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [weeklyWriters, setWeeklyWriters] = useState<WriterSnapshot | null>(null);
  const [dailyWriters, setDailyWriters] = useState<WriterSnapshot | null>(null);
  const [lastWeekWriters, setLastWeekWriters] = useState<WriterSnapshot | null>(null);
  const [repairOrders, setRepairOrders] = useState<RepairOrder[]>([]);
  const [soldHoursThisWeek, setSoldHoursThisWeek] = useState(0);
  const [verificationRecords, setVerificationRecords] = useState<VerificationRecord[]>([]);
  const [warrantyClaims, setWarrantyClaims] = useState<WarrantyClaim[]>([]);
  const [warrantyView, setWarrantyView] = useState<"open" | "submitted" | "paid" | "all">("open");
  const [warrantySaving, setWarrantySaving] = useState<string | null>(null);
  const [verificationView, setVerificationView] = useState<"pending" | "history">("pending");
  const [verificationSavingId, setVerificationSavingId] = useState<number | null>(null);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [verificationMessageError, setVerificationMessageError] = useState(false);
  const verificationSavingRef = useRef<number | null>(null);
  const [jobBoardCapturedAt, setJobBoardCapturedAt] = useState<string | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<TekmetricLiveEvents | null>(null);
  const [jobSection, setJobSection] = useState<"all" | RepairOrder["section"]>("work-in-progress");
  const [jobCategory, setJobCategory] = useState("all");
  const [jobWriter, setJobWriter] = useState("all");
  const [jobSearch, setJobSearch] = useState("");
  const [ticketAudits, setTicketAudits] = useState<TicketAudit[]>([]);
  const [deltaAiAudits, setDeltaAiAudits] = useState<DeltaAiAudit[]>([]);
  const [deltaAiClearingRo, setDeltaAiClearingRo] = useState<string | null>(null);
  const [ticketAuditDate, setTicketAuditDate] = useState<string | null>(null);
  const [ticketAuditCapturedAt, setTicketAuditCapturedAt] = useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState<"attention" | "good" | "all" | "hidden">("attention");
  const [auditDisposition, setAuditDisposition] = useState<Record<string, AuditDisposition>>({});
  const [goalMissSnapshot, setGoalMissSnapshot] = useState<GoalMissSnapshot | null>(null);
  const [goalDisposition, setGoalDisposition] = useState<Record<string, GoalDisposition>>({});
  const [goalView, setGoalView] = useState<"controllable" | "exceptions" | "all" | "hidden">("controllable");
  const scheduleDates = Array.from(new Set(scheduleSnapshots.map((item) => item.scheduleDate)));
  const activeScheduleDate = scheduleDate || scheduleDates[0] || "";
  const dayScheduleSnapshots = scheduleSnapshots.filter((item) => item.scheduleDate === activeScheduleDate);
  const selectedScheduleSnapshot = dayScheduleSnapshots.find((item) => item.id === scheduleSnapshotId)
    || dayScheduleSnapshots[0] || null;
  const selectedData = range === "Today" ? SAMPLE_RANGE_DATA["This week"] : SAMPLE_RANGE_DATA[range];
  const fallbackLabel = range === "Today"
    ? expectedRanges.today
    : range === "This week"
      ? `${expectedRanges.thisWeek.start} – ${expectedRanges.thisWeek.end}`
      : range === "Last week"
        ? `${expectedRanges.lastWeek.start} – ${expectedRanges.lastWeek.end}`
        : `${expectedRanges.month.start} – ${expectedRanges.month.end}`;
  const validWeeklySnapshot = liveSnapshot?.startDate === expectedRanges.thisWeek.start && liveSnapshot?.endDate === expectedRanges.thisWeek.end
    ? liveSnapshot : null;
  const validDailySnapshot = dailySnapshot?.startDate === expectedRanges.today && dailySnapshot?.endDate === expectedRanges.today
    ? dailySnapshot : null;
  const validLastWeekSnapshot = lastWeekSnapshot?.startDate === expectedRanges.lastWeek.start && lastWeekSnapshot?.endDate === expectedRanges.lastWeek.end
    ? lastWeekSnapshot : null;
  const selectedLive = range === "Today"
    ? validDailySnapshot
    : range === "This week"
      ? validWeeklySnapshot
      : range === "Last week"
        ? validLastWeekSnapshot
        : null;
  // Real week-over-week change, computed only from data we actually have
  // (the live "This week" snapshot vs. the live "last week" snapshot). This
  // replaces the old behavior of showing a hardcoded sample percentage
  // (from the demo dataset) next to a real live dollar figure — that paired
  // a fabricated "↑ 9.7%" with the real Gross Profit number regardless of
  // whether GP was actually up, down, or by how much.
  const comparisonBase = range === "This week" ? validLastWeekSnapshot : null;
  const pctChange = (current: number, base: number) =>
    base > 0 ? ((current - base) / base) * 100 : null;
  const realChange = selectedLive && comparisonBase
    ? {
        label: "vs last week",
        sales: pctChange(selectedLive.totalSales, comparisonBase.totalSales),
        grossProfit: pctChange(selectedLive.grossProfit, comparisonBase.grossProfit),
        laborSales: pctChange(selectedLive.laborSales, comparisonBase.laborSales),
      }
    : null;
  const data = selectedLive
    ? {
        ...selectedData,
        label: range === "Today"
          ? selectedLive.startDate
          : `${selectedLive.startDate} – ${selectedLive.endDate}`,
        comparison: range === "Today" ? "today" : selectedData.comparison,
        sales: selectedLive.totalSales,
        grossProfit: selectedLive.grossProfit,
        laborSales: selectedLive.laborSales,
        techs: selectedLive.technicians
          .filter((tech) => !tech.name.toLowerCase().includes("devin") || tech.billedHours > 0)
          .map((tech) => ({
            name: tech.name,
            hours: tech.billedHours,
            target: tech.name.toLowerCase().includes("devin")
              ? 0
              : technicianWeeklyTarget(tech.name) / (range === "Today" ? 5 : 1),
          })),
      }
    : range === "Today"
      ? {
          ...selectedData,
          label: "Today",
          comparison: "today",
          sales: selectedData.sales / 5,
          grossProfit: selectedData.grossProfit / 5,
          laborSales: selectedData.laborSales / 5,
          techs: selectedData.techs.map((tech) => ({
            ...tech,
            hours: tech.hours / 5,
            target: tech.target / 5,
          })),
        }
      : { ...selectedData, label: fallbackLabel };
  const gpPercent = data.sales ? (data.grossProfit / data.sales) * 100 : 0;
  const gpStatus = gpPercent >= 60
    ? { className: "gp-target", label: "● Target achieved" }
    : gpPercent >= 58
      ? { className: "gp-acceptable", label: "● Acceptable — 60% target" }
      : { className: "gp-critical", label: "● Below 58% minimum" };
  const teamHours = data.techs.reduce((sum, tech) => sum + tech.hours, 0);
  const teamTarget = data.techs.reduce((sum, tech) => sum + tech.target, 0);
  // Calculate both averages from the same live snapshot and the same RO count.
  // This keeps the dashboard math transparent and prevents an older report
  // value from being paired with a newer car count.
  const roCount = selectedLive?.totalROs ?? 0;
  const calculatedAro = roCount && selectedLive
    ? selectedLive.totalSales / roCount
    : 0;
  const hoursPerRO = roCount && selectedLive
    ? selectedLive.hoursSold / roCount
    : 0;
  const weeklySalesGoal = WEEKLY_SALES_GOAL;
  const weeklyHoursSoldGoal = WEEKLY_HOURS_SOLD_GOAL;
  const weeklyCarGoal = WEEKLY_CAR_GOAL;
  const isToday = range === "Today";
  const showsOperatingGoal = range !== "This month";
  const currentSalesGoal = isToday ? weeklySalesGoal / 5 : weeklySalesGoal;
  const currentCarGoal = isToday ? weeklyCarGoal / 5 : weeklyCarGoal;
  const aroGoal = ARO_GOAL;
  const hoursPerROGoal = HOURS_PER_RO_GOAL;
  const aroMet = calculatedAro >= aroGoal;
  const hoursPerROMet = hoursPerRO >= hoursPerROGoal;
  const paceEndDate = selectedLive
    ? (selectedLive.endDate < expectedRanges.today ? selectedLive.endDate : expectedRanges.today)
    : expectedRanges.today;
  const elapsedBusinessDays = selectedLive
    ? businessDaysInclusive(selectedLive.startDate, paceEndDate)
    : 1;
  const weeklySalesPace = selectedLive
    ? (selectedLive.totalSales / elapsedBusinessDays) * 5
    : 0;
  const weeklyCarPace = selectedLive
    ? (selectedLive.totalROs / elapsedBusinessDays) * 5
    : 0;
  const salesGoalGap = Math.max(currentSalesGoal - data.sales, 0);
  const carGoalGap = Math.max(currentCarGoal - roCount, 0);
  const projectedWeeklySalesGap = Math.max(weeklySalesGoal - weeklySalesPace, 0);
  const projectedWeeklyCarGap = Math.max(weeklyCarGoal - weeklyCarPace, 0);
  const aroDollarGap = calculatedAro
    ? Math.max((aroGoal - calculatedAro) * roCount, 0)
    : 0;
  const hoursSoldGap = selectedLive
    ? Math.max(hoursPerROGoal * roCount - selectedLive.hoursSold, 0)
    : 0;
  const gpPointGap = Math.max(60 - gpPercent, 0);
  const gpDollarGap = Math.max(data.sales * 0.6 - data.grossProfit, 0);
  const teamHoursGap = Math.max(teamTarget - teamHours, 0);
  const activeSoldHours = repairOrders
    .filter((order) => order.section === "estimates" || order.section === "work-in-progress")
    .reduce((total, order) => total + (Number(order.soldHours) || 0), 0);
  const activeSoldHourRos = repairOrders.filter((order) =>
    order.section === "estimates" || order.section === "work-in-progress"
  ).length;

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setAuthenticated(Boolean(payload?.authenticated)))
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (range === "This month") setRange("This week");
  }, [range]);

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "delta", password: loginPassword }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setLoginError(payload?.error || "Sign in failed.");
      return;
    }
    window.location.reload();
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.reload();
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/snapshot?period=weekly").then((response) => response.ok ? response.json() : null),
      fetch("/api/snapshot?period=daily").then((response) => response.ok ? response.json() : null),
      fetch("/api/snapshot?period=last_week").then((response) => response.ok ? response.json() : null),
    ])
      .then(([weekly, daily, lastWeek]) => {
        setLiveSnapshot(weekly?.snapshot ?? null);
        setDailySnapshot(daily?.snapshot ?? null);
        setLastWeekSnapshot(lastWeek?.snapshot ?? null);
      })
      .catch(() => {
        setLiveSnapshot(null);
        setDailySnapshot(null);
        setLastWeekSnapshot(null);
      });
    refreshLotWalkAudits();
    refreshScheduleHistory();
    fetch("/api/reader-status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setReaderStatus(payload?.status ? payload : null))
      .catch(() => setReaderStatus(null));
    fetch("/reader-version.json", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setReaderRevision(payload?.buildHash ? payload : null))
      .catch(() => setReaderRevision(null));
    fetch("/api/ai-key", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setAiConfigured(Boolean(payload?.configured)))
      .catch(() => setAiConfigured(false));
    fetch("/api/opportunities", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        setOpportunities(payload?.opportunities ?? []);
        setOpportunitiesCapturedAt(payload?.capturedAt ?? null);
        setOpportunityListDate(payload?.listDate ?? null);
      })
      .catch(() => setOpportunities([]));
    refreshJobBoard();
    refreshVerifications();
    refreshWarrantyClaims();
    refreshWebhookEvents();
    fetch("/api/ticket-audits", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        setTicketAudits(payload?.audits ?? []);
        setTicketAuditDate(payload?.reportDate ?? null);
        setTicketAuditCapturedAt(payload?.capturedAt ?? null);
        setAuditDisposition(payload?.dispositions ?? {});
      })
      .catch(() => setTicketAudits([]));
    refreshDeltaAiAudits();
    fetch("/api/goal-miss", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setGoalMissSnapshot(payload?.snapshot ?? null))
      .catch(() => setGoalMissSnapshot(null));
    Promise.all([
      fetch("/api/service-writers?period=weekly", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch("/api/service-writers?period=daily", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch("/api/service-writers?period=last_week", { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
    ]).then(([weekly, daily, lastWeek]) => {
      setWeeklyWriters(weekly?.snapshot ?? null);
      setDailyWriters(daily?.snapshot ?? null);
      setLastWeekWriters(lastWeek?.snapshot ?? null);
    }).catch(() => {
      setWeeklyWriters(null);
      setDailyWriters(null);
      setLastWeekWriters(null);
    });
  }, []);

  function refreshWebhookEvents() {
    return fetch("/api/tekmetric-events", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setWebhookEvents(payload?.lastEventAt || payload?.signals ? payload : null))
      .catch(() => setWebhookEvents(null));
  }

  function refreshJobBoard() {
    return fetch("/api/job-board", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        setRepairOrders(payload?.repairOrders ?? []);
        setJobBoardCapturedAt(payload?.capturedAt ?? null);
        setSoldHoursThisWeek(Number(payload?.soldHoursThisWeek) || 0);
      })
      .catch(() => setRepairOrders([]));
  }

  function refreshVerifications() {
    return fetch("/api/verifications", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setVerificationRecords(payload?.records ?? []))
      .catch(() => setVerificationRecords([]));
  }

  function refreshWarrantyClaims() {
    return fetch("/api/warranty-claims", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setWarrantyClaims(payload?.claims ?? []))
      .catch(() => setWarrantyClaims([]));
  }

  async function updateWarrantyClaim(claim: WarrantyClaim, status: WarrantyClaim["status"]) {
    let claimNumber = claim.claimNumber || "";
    let paymentAmount = claim.paymentAmount || 0;
    let reviewNote = claim.reviewNote || "";
    if (status === "submitted") {
      const value = window.prompt("NAPA claim number (leave blank if not assigned yet):", claimNumber);
      if (value === null) return;
      claimNumber = value.trim();
    }
    if (status === "paid") {
      const value = window.prompt("Warranty payment amount:", paymentAmount ? String(paymentAmount) : "");
      if (value === null) return;
      paymentAmount = Number(value.replace(/[$,]/g, "")) || 0;
    }
    if (status === "needs_review" || status === "dismissed") {
      const value = window.prompt(status === "dismissed" ? "Why are you removing this claim?" : "What still needs attention?", reviewNote);
      if (value === null) return;
      reviewNote = value.trim();
    }
    setWarrantySaving(claim.roNumber);
    const response = await fetch("/api/warranty-claims", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roNumber: claim.roNumber, status, claimNumber, paymentAmount, reviewNote }),
    });
    setWarrantySaving(null);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      window.alert(payload?.error || "The warranty claim could not be updated.");
      return;
    }
    refreshWarrantyClaims();
  }

  async function chooseWarrantyOriginal(claim: WarrantyClaim, suggested = "") {
    const value = window.prompt(
      `Enter the ORIGINAL RO number for current RO#${claim.roNumber}. It must be a lower number:`,
      suggested || claim.originalRoOverride || claim.originalRoNumber || "",
    );
    if (value === null) return;
    const originalRoNumber = value.replace(/\D/g, "");
    if (!originalRoNumber) return;
    const response = await fetch("/api/warranty-claims", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roNumber: claim.roNumber, originalRoNumber }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(payload?.error || "The original RO could not be saved.");
      return;
    }
    window.alert(`Original RO#${originalRoNumber} saved. The reader will rebuild this claim on its next scan.`);
    refreshWarrantyClaims();
  }

  function refreshScheduleHistory() {
    return fetch("/api/schedule-history", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const snapshots = payload?.snapshots ?? [];
        setScheduleSnapshots(snapshots);
        if (snapshots.length) {
          setScheduleDate((current) => current || snapshots[0].scheduleDate);
          setScheduleSnapshotId((current) => current || snapshots[0].id);
        }
      })
      .catch(() => setScheduleSnapshots([]));
  }

  function refreshDeltaAiAudits() {
    return fetch("/api/delta-ai-audits", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setDeltaAiAudits(payload?.audits ?? []))
      .catch(() => setDeltaAiAudits([]));
  }

  async function clearDeltaAiAudit(roNumber: string) {
    setDeltaAiClearingRo(roNumber);
    try {
      const response = await fetch(`/api/delta-ai-audits?roNumber=${encodeURIComponent(roNumber)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "This Delta AI review could not be cleared.");
      setDeltaAiAudits((current) => current.filter((audit) => audit.roNumber !== roNumber));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "This Delta AI review could not be cleared.");
    } finally {
      setDeltaAiClearingRo(null);
    }
  }

  async function requestScheduleCapture() {
    setScheduleCaptureBusy(true);
    setScheduleCaptureMessage("");
    try {
      const response = await fetch("/api/schedule-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request-capture" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "The request could not be sent.");
      setScheduleCaptureMessage("Request sent. The shop reader will take it shortly.");
      window.setTimeout(() => refreshScheduleHistory(), 120000);
    } catch (error) {
      setScheduleCaptureMessage(error instanceof Error ? error.message : "The request could not be sent.");
    } finally {
      setScheduleCaptureBusy(false);
    }
  }

  async function markVerified(record: VerificationRecord, note = "") {
    if (verificationSavingRef.current === record.id) return;
    verificationSavingRef.current = record.id;
    setVerificationSavingId(record.id);
    setVerificationMessage("");
    setVerificationMessageError(false);
    try {
      const response = await fetch("/api/verifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, note: String(note || "").trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.record) {
        setVerificationMessageError(true);
        setVerificationMessage(payload?.error || "The verification could not be saved.");
        return;
      }
      setVerificationRecords((current) => current.map((item) => item.id === record.id ? payload.record : item));
      setVerificationMessage(`RO#${record.roNumber} marked verified.`);
    } catch (error) {
      setVerificationMessageError(true);
      setVerificationMessage(error instanceof Error ? error.message : "The verification could not be saved.");
    } finally {
      verificationSavingRef.current = null;
      setVerificationSavingId(null);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshJobBoard();
      refreshVerifications();
      refreshDeltaAiAudits();
      refreshWarrantyClaims();
      refreshWebhookEvents();
    }, 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      setGoalDisposition(JSON.parse(window.localStorage.getItem("delta-goal-miss-disposition") || "{}"));
    } catch {
      setAuditDisposition({});
    }
    const timer = window.setInterval(() => window.location.reload(), 20 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function updateAuditDisposition(roNumber: string, status?: "approved" | "hidden", reasonOverride?: string, hideUntilOverride?: string) {
    let reason = reasonOverride || "";
    let hideUntil = hideUntilOverride || "";
    if (status && !reason) {
      reason = window.prompt(status === "approved" ? "Why is this ticket okay?" : "Why are you hiding this ticket?")?.trim() || "";
      if (!reason) return;
      if (status === "hidden") hideUntil = window.prompt("Hide until (YYYY-MM-DD), or leave blank")?.trim() || "";
    }
    const response = await fetch("/api/ticket-audits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roNumber, status: status || "open", reason, hideUntil }),
    });
    const payload = await response.json();
    if (!response.ok) {
      window.alert(payload.error || "The review decision could not be saved.");
      return;
    }
    setAuditDisposition((current) => {
      const next = { ...current };
      if (payload.disposition) next[roNumber] = payload.disposition;
      else delete next[roNumber];
      return next;
    });
  }

  function updateGoalDisposition(roNumber: string, disposition?: GoalDisposition) {
    setGoalDisposition((current) => {
      const next = { ...current };
      if (disposition) next[roNumber] = disposition;
      else delete next[roNumber];
      window.localStorage.setItem("delta-goal-miss-disposition", JSON.stringify(next));
      return next;
    });
  }

  const businessQueue = opportunities.filter((item) => item.customerType === "business").slice(0, 30);
  const personalQueue = opportunities.filter((item) => item.customerType === "personal").slice(0, 30);
  const dailyCallQueue = [...businessQueue, ...personalQueue];
  const visibleOpportunities = dailyCallQueue.filter((item) => {
    if (leadType !== "all" && item.customerType !== leadType) return false;
    if (!showCompleted && ["done", "skipped"].includes(item.status)) return false;
    const query = leadSearch.trim().toLowerCase();
    return !query || `${item.customer} ${item.vehicle} ${item.phone} ${item.signals.join(" ")}`
      .toLowerCase().includes(query);
  });
  const completedLeads = dailyCallQueue.filter((item) => ["done", "skipped"].includes(item.status)).length;

  async function updateOpportunityStatus(item: Opportunity, status: Opportunity["status"]) {
    if (!opportunityListDate) return;
    const previous = item.status;
    setOpportunities((current) => current.map((entry) => entry.key === item.key ? { ...entry, status } : entry));
    const response = await fetch("/api/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: { key: item.key, listDate: opportunityListDate, status } }),
    });
    if (!response.ok) {
      setOpportunities((current) => current.map((entry) => entry.key === item.key ? { ...entry, status: previous } : entry));
    }
  }
  const writerSnapshot = range === "Today"
    ? dailyWriters
    : range === "Last week"
      ? lastWeekWriters
      : weeklyWriters;
  const visibleRepairOrders = repairOrders
    .filter((item) => jobSection === "all" || item.section === jobSection)
    .filter((item) => jobCategory === "all" || item.category === jobCategory)
    .filter((item) => jobWriter === "all" || item.serviceWriter === jobWriter)
    .filter((item) => {
      const query = jobSearch.trim().toLowerCase();
      return !query || `${item.roNumber} ${item.customer} ${item.vehicle} ${item.label} ${item.serviceWriter} ${item.customerComplaint || ""}`
        .toLowerCase().includes(query);
    })
    .sort((a, b) => b.ageDays - a.ageDays);
  const jobCategories = Array.from(new Set(repairOrders.map((item) => item.category))).sort();
  const jobWriters = Array.from(new Set(repairOrders.map((item) => item.serviceWriter))).sort();
  const verifyQueue = verificationRecords.filter((item) => item.status === "pending");
  const verificationHistory = verificationRecords.filter((item) => item.status === "verified");
  const visibleVerificationRecords = verificationView === "pending" ? verifyQueue : verificationHistory;
  const criticalJobs = repairOrders.filter((item) => item.section === "work-in-progress" && item.ageDays >= 7).length;
  const warningJobs = repairOrders.filter((item) => item.section === "work-in-progress" && item.ageDays >= 2).length;
  const completedProblems = repairOrders.filter((item) =>
    item.section === "completed" && (
      item.balanceDue ||
      ["production", "parts", "authorization", "attention"].includes(item.category)
    )
  ).length;
  const auditFindings = ticketAudits.flatMap((audit) => audit.findings);
  const auditCritical = auditFindings.filter((finding) => finding.severity === "critical").length;
  const auditWarnings = auditFindings.filter((finding) => finding.severity === "warning").length;
  const auditReviews = auditFindings.filter((finding) => finding.severity === "review").length;
  const auditIsGood = (audit: TicketAudit) => !audit.findings.length || auditDisposition[audit.roNumber]?.status === "approved";
  const auditIsHidden = (audit: TicketAudit) => auditDisposition[audit.roNumber]?.status === "hidden";
  const visibleTicketAudits = ticketAudits.filter((audit) => {
    if (auditFilter === "hidden") return auditIsHidden(audit);
    if (auditIsHidden(audit)) return false;
    if (auditFilter === "good") return auditIsGood(audit);
    if (auditFilter === "attention") return !auditIsGood(audit);
    return true;
  });
  const goalTickets = (goalMissSnapshot?.tickets ?? []).map((ticket) => {
    const laborSales = Number(ticket.laborSales) || 0;
    const laborProfit = Number(ticket.laborProfit) || 0;
    const partsSales = Number(ticket.partsSales) || 0;
    const partsCost = Number(ticket.partsCost) || 0;
    const partsProfit = Number(ticket.partsProfit) || 0;
    const targetSales = Math.max(ticket.sales, 1000);
    const hasHourDetail = ticket.hoursSold > 0 && ticket.grossProfitPerHour > 0;
    const targetHours = hasHourDetail ? Math.max(ticket.hoursSold, 3) : ticket.hoursSold;
    const targetGp = Math.max(ticket.grossProfit, targetSales * 0.6, hasHourDetail ? targetHours * 170 : 0);
    return {
      ...ticket,
      laborSales, laborProfit, partsSales, partsCost, partsProfit,
      lostGpAt60: Math.max(ticket.sales * 0.6 - ticket.grossProfit, 0),
      lostGpAt170: hasHourDetail ? Math.max(ticket.hoursSold * 170 - ticket.grossProfit, 0) : 0,
      partsProfitGap: partsSales > 0 ? Math.max(partsSales * 0.4 - partsProfit, 0) : 0,
      laborProfitGap: laborSales > 0 ? Math.max(laborSales * 0.6 - laborProfit, 0) : 0,
      salesShort: Math.max(1000 - ticket.sales, 0),
      hoursShort: hasHourDetail ? Math.max(3 - ticket.hoursSold, 0) : 0,
      hasHourDetail,
      recoverableGp: Math.max(targetGp - ticket.grossProfit, 0),
      targetSales,
      targetHours,
      targetGp,
    };
  }).sort((a, b) => (b.partsProfitGap - a.partsProfitGap) || (b.recoverableGp - a.recoverableGp));
  const hiddenGoalTicket = (roNumber: string) => goalDisposition[roNumber]?.status === "hidden";
  const visibleGoalTickets = goalTickets.filter((ticket) => {
    if (goalView === "hidden") return hiddenGoalTicket(ticket.roNumber);
    if (hiddenGoalTicket(ticket.roNumber)) return false;
    if (goalView === "controllable") return ticket.controllable;
    if (goalView === "exceptions") return !ticket.controllable;
    return true;
  });
  const goalTotals = goalTickets.reduce((total, ticket) => ({
    sales: total.sales + ticket.sales,
    gp: total.gp + ticket.grossProfit,
    hours: total.hours + ticket.hoursSold,
    recoverableGp: total.recoverableGp + (ticket.controllable ? ticket.recoverableGp : 0),
    targetSales: total.targetSales + (ticket.controllable ? ticket.targetSales : ticket.sales),
    targetHours: total.targetHours + (ticket.controllable ? ticket.targetHours : ticket.hoursSold),
    partsSales: total.partsSales + ticket.partsSales,
    partsProfit: total.partsProfit + ticket.partsProfit,
    partsGap: total.partsGap + ticket.partsProfitGap,
    laborSales: total.laborSales + ticket.laborSales,
    laborProfit: total.laborProfit + ticket.laborProfit,
  }), { sales: 0, gp: 0, hours: 0, recoverableGp: 0, targetSales: 0, targetHours: 0, partsSales: 0, partsProfit: 0, partsGap: 0, laborSales: 0, laborProfit: 0 });

  const chartPoints = useMemo(() => {
    const max = Math.max(...data.trend);
    const min = Math.min(...data.trend);
    return data.trend.map((value, index) => {
      const x = 3 + (index / (data.trend.length - 1)) * 94;
      const y = 84 - ((value - min) / Math.max(max - min, 1)) * 62;
      return `${x},${y}`;
    }).join(" ");
  }, [data]);

  async function askAI(event?: FormEvent) {
    event?.preventDefault();
    if (!question.trim()) return;
    if (!aiConfigured) {
      setAiSetupOpen(true);
      return;
    }
    setAiLoading(true);
    setAnswer("");
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          period: range === "Today" ? "daily" : "weekly",
        }),
      });
      const payload = await response.json();
      setAnswer(response.ok ? payload.answer : `AI error: ${payload.error}`);
    } catch {
      setAnswer("AI error: The dashboard could not reach OpenAI.");
    } finally {
      setAiLoading(false);
    }
  }

  async function saveApiKey(event: FormEvent) {
    event.preventDefault();
    setAiSetupMessage("Checking key…");
    const response = await fetch("/api/ai-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKeyInput }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setAiSetupMessage(payload.error || "The key could not be saved.");
      return;
    }
    setApiKeyInput("");
    setAiConfigured(true);
    setAiSetupMessage("Connected securely.");
    window.setTimeout(() => setAiSetupOpen(false), 700);
  }

  function usePrompt(prompt: string) {
    setQuestion(prompt);
    window.setTimeout(() => {
      const form = document.querySelector<HTMLFormElement>("#ai-form");
      form?.requestSubmit();
    }, 0);
  }

  async function revealReaderCredentials() {
    setCredentialError("");
    const response = await fetch("/api/reader-credentials", { cache: "no-store" });
    if (!response.ok) {
      setCredentialError("The machine keys are not ready yet. Refresh this page in a minute and try again.");
      return;
    }
    setReaderCredentials(await response.json());
  }

  async function copyValue(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function refreshLotWalkAudits() {
    try {
      const response = await fetch("/api/lot-walk", { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      setLotWalkAudits(payload?.audits ?? []);
    } catch {
      setLotWalkAudits([]);
    }
  }

  async function uploadLotWalkVideo(file: File) {
    setLotWalkUploading(true);
    setLotWalkProgress(0);
    setLotWalkTransferred(0);
    setLotWalkUploadSize(file.size);
    setLotWalkUploadName(file.name);
    setLotWalkUploadComplete(false);
    setLotWalkError("");
    try {
      const startResponse = await fetch("/api/lot-walk/multipart", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", filename: file.name, contentType: file.type || "application/octet-stream", size: file.size }),
      });
      const start = await startResponse.json();
      if (!startResponse.ok) throw new Error(start?.error || "Could not start upload.");
      const chunkSize = 8 * 1024 * 1024;
      const parts: { partNumber: number; etag: string }[] = [];
      let completedBytes = 0;
      for (let offset = 0, partNumber = 1; offset < file.size; offset += chunkSize, partNumber += 1) {
        const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
        const uploadedPart = await new Promise<{ partNumber: number; etag: string }>((resolve, reject) => {
          const request = new XMLHttpRequest();
          const query = new URLSearchParams({ key: start.key, uploadId: start.uploadId, part: String(partNumber) });
          request.open("PUT", `/api/lot-walk/multipart?${query}`);
          request.setRequestHeader("Content-Type", "application/octet-stream");
          request.upload.onprogress = (event) => {
            const sent = completedBytes + (event.lengthComputable ? event.loaded : 0);
            setLotWalkTransferred(Math.min(sent, file.size));
            setLotWalkProgress(Math.min(99, Math.floor((sent / file.size) * 100)));
          };
          request.onload = () => {
            let payload: Record<string, unknown> = {};
            try { payload = JSON.parse(request.responseText); } catch { /* handled below */ }
            if (request.status >= 200 && request.status < 300)
              resolve({ partNumber: Number(payload.partNumber), etag: String(payload.etag || "") });
            else reject(new Error(String(payload.error || `Upload part ${partNumber} failed.`)));
          };
          request.onerror = () => reject(new Error(`Upload part ${partNumber} lost connection.`));
          request.send(chunk);
        });
        parts.push(uploadedPart);
        completedBytes += chunk.size;
        setLotWalkTransferred(completedBytes);
        setLotWalkProgress(Math.min(99, Math.floor((completedBytes / file.size) * 100)));
      }
      const completeResponse = await fetch("/api/lot-walk/multipart", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", key: start.key, uploadId: start.uploadId, filename: file.name, size: file.size, parts }),
      });
      const completed = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(completed?.error || "Video uploaded but could not be finalized.");
      setLotWalkProgress(100);
      setLotWalkTransferred(file.size);
      setLotWalkUploadComplete(true);
      await refreshLotWalkAudits();
    } catch (error) {
      setLotWalkError(error instanceof Error ? error.message : "Upload failed — check your connection and try again.");
    } finally {
      setLotWalkUploading(false);
    }
  }

  async function openLotWalkDetail(id: number) {
    setLotWalkSelectedId(id);
    setLotWalkDetail(null);
    setLotWalkResultInput("");
    setLotWalkResultMessage("");
    setLotWalkRoInputs({});
    const response = await fetch(`/api/lot-walk/${id}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setLotWalkDetail(payload?.result ?? null);
  }

  async function saveLotWalkResult() {
    if (!lotWalkSelectedId) return;
    setLotWalkResultMessage("Saving analysis…");
    try {
      const result = JSON.parse(lotWalkResultInput) as LotWalkResult;
      const response = await fetch(`/api/lot-walk/${lotWalkSelectedId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "complete", result }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Could not save analysis.");
      setLotWalkDetail(result);
      setLotWalkResultInput("");
      setLotWalkResultMessage("Analysis saved.");
      await refreshLotWalkAudits();
    } catch (error) {
      setLotWalkResultMessage(error instanceof SyntaxError ? "The analysis JSON is not valid." : error instanceof Error ? error.message : "Could not save analysis.");
    }
  }

  async function assignLotWalkRo(itemIndex: number) {
    if (!lotWalkSelectedId || !lotWalkDetail?.actionList) return;
    const entered = (lotWalkRoInputs[itemIndex] || "").replace(/[^0-9]/g, "");
    const repairOrder = repairOrders.find((item) => item.roNumber.replace(/[^0-9]/g, "") === entered);
    if (!repairOrder) {
      setLotWalkResultMessage(`RO #${entered || "—"} is not on the current Job Board.`);
      return;
    }

    setLotWalkAssigningIndex(itemIndex);
    setLotWalkResultMessage(`Assigning RO #${repairOrder.roNumber}…`);
    const existing = lotWalkDetail.actionList[itemIndex];
    const updated: LotWalkResult = {
      ...lotWalkDetail,
      summary: {
        ...lotWalkDetail.summary,
        matched: (lotWalkDetail.summary?.matched ?? 0) + (existing.roNumber ? 0 : 1),
        needsManualId: Math.max(0, (lotWalkDetail.summary?.needsManualId ?? 0) - (existing.roNumber ? 0 : 1)),
        activeRoNotFound: Math.max(0, (lotWalkDetail.summary?.activeRoNotFound ?? 0) - (existing.roNumber ? 0 : 1)),
      },
      actionList: lotWalkDetail.actionList.map((item, index) => index === itemIndex ? {
        ...item,
        priority: "good",
        roNumber: repairOrder.roNumber,
        customer: repairOrder.customer,
        vehicle: repairOrder.vehicle,
        serviceWriter: repairOrder.serviceWriter,
        detailUrl: repairOrder.detailUrl,
        assignedManually: true,
        recommendedAction: `Manually matched to RO #${repairOrder.roNumber}.`,
      } : item),
    };

    try {
      const response = await fetch(`/api/lot-walk/${lotWalkSelectedId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "complete", result: updated }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Could not assign the RO.");
      setLotWalkDetail(updated);
      setLotWalkRoInputs((current) => ({ ...current, [itemIndex]: "" }));
      setLotWalkResultMessage(`Assigned to RO #${repairOrder.roNumber}.`);
      await refreshLotWalkAudits();
    } catch (error) {
      setLotWalkResultMessage(error instanceof Error ? error.message : "Could not assign the RO.");
    } finally {
      setLotWalkAssigningIndex(null);
    }
  }

  async function markLotWalkFixed(itemIndex: number) {
    if (!lotWalkSelectedId || !lotWalkDetail?.actionList) return;
    const existing = lotWalkDetail.actionList[itemIndex];
    setLotWalkAssigningIndex(itemIndex);
    setLotWalkResultMessage("Saving correction…");
    const wasStale = existing.priority === "critical" || existing.priority === "warning";
    const neededManualId = existing.priority === "review" && !existing.roNumber;
    const updated: LotWalkResult = {
      ...lotWalkDetail,
      summary: {
        ...lotWalkDetail.summary,
        staleRos: Math.max(0, (lotWalkDetail.summary?.staleRos ?? 0) - (wasStale ? 1 : 0)),
        needsManualId: Math.max(0, (lotWalkDetail.summary?.needsManualId ?? 0) - (neededManualId ? 1 : 0)),
        activeRoNotFound: Math.max(0, (lotWalkDetail.summary?.activeRoNotFound ?? 0) - (neededManualId ? 1 : 0)),
      },
      actionList: lotWalkDetail.actionList.map((item, index) => index === itemIndex ? {
        ...item,
        priority: "good",
        recommendedAction: "Marked fixed on the dashboard.",
      } : item),
    };

    try {
      const response = await fetch(`/api/lot-walk/${lotWalkSelectedId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "complete", result: updated }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Could not mark this item fixed.");
      setLotWalkDetail(updated);
      setLotWalkResultMessage("Marked fixed.");
      await refreshLotWalkAudits();
    } catch (error) {
      setLotWalkResultMessage(error instanceof Error ? error.message : "Could not mark this item fixed.");
    } finally {
      setLotWalkAssigningIndex(null);
    }
  }

  function lotWalkRoLink(item: LotWalkActionItem) {
    if (item.detailUrl) return item.detailUrl;
    if (!item.roNumber) return "";
    return repairOrders.find((order) => order.roNumber.replace(/[^0-9]/g, "") === item.roNumber?.replace(/[^0-9]/g, ""))?.detailUrl || "";
  }

  if (authLoading || !authenticated) {
    return (
      <LoginScreen
        loading={authLoading}
        password={loginPassword}
        error={loginError}
        onPasswordChange={setLoginPassword}
        onSubmit={submitLogin}
      />
    );
  }

  return (
    <DashboardContext.Provider value={{
      expectedRanges,
      range,
      setRange,
      question,
      setQuestion,
      answer,
      setAnswer,
      aiConfigured,
      setAiConfigured,
      aiLoading,
      setAiLoading,
      aiSetupOpen,
      setAiSetupOpen,
      apiKeyInput,
      setApiKeyInput,
      aiSetupMessage,
      setAiSetupMessage,
      connectionOpen,
      setConnectionOpen,
      authLoading,
      setAuthLoading,
      authenticated,
      setAuthenticated,
      loginPassword,
      setLoginPassword,
      loginError,
      setLoginError,
      nav,
      setNav,
      liveSnapshot,
      setLiveSnapshot,
      dailySnapshot,
      setDailySnapshot,
      lastWeekSnapshot,
      setLastWeekSnapshot,
      readerCredentials,
      setReaderCredentials,
      credentialError,
      setCredentialError,
      readerStatus,
      setReaderStatus,
      lotWalkAudits,
      setLotWalkAudits,
      lotWalkUploading,
      setLotWalkUploading,
      lotWalkProgress,
      setLotWalkProgress,
      lotWalkTransferred,
      setLotWalkTransferred,
      lotWalkUploadSize,
      setLotWalkUploadSize,
      lotWalkUploadName,
      setLotWalkUploadName,
      lotWalkUploadComplete,
      setLotWalkUploadComplete,
      lotWalkError,
      setLotWalkError,
      lotWalkSelectedId,
      setLotWalkSelectedId,
      lotWalkDetail,
      setLotWalkDetail,
      lotWalkResultInput,
      setLotWalkResultInput,
      lotWalkResultMessage,
      setLotWalkResultMessage,
      lotWalkRoInputs,
      setLotWalkRoInputs,
      lotWalkAssigningIndex,
      setLotWalkAssigningIndex,
      scheduleSnapshots,
      setScheduleSnapshots,
      scheduleDate,
      setScheduleDate,
      scheduleSnapshotId,
      setScheduleSnapshotId,
      scheduleCaptureBusy,
      setScheduleCaptureBusy,
      scheduleCaptureMessage,
      setScheduleCaptureMessage,
      opportunities,
      setOpportunities,
      opportunitiesCapturedAt,
      setOpportunitiesCapturedAt,
      opportunityListDate,
      setOpportunityListDate,
      leadType,
      setLeadType,
      leadSearch,
      setLeadSearch,
      showCompleted,
      setShowCompleted,
      weeklyWriters,
      setWeeklyWriters,
      dailyWriters,
      setDailyWriters,
      lastWeekWriters,
      setLastWeekWriters,
      repairOrders,
      setRepairOrders,
      soldHoursThisWeek,
      setSoldHoursThisWeek,
      verificationRecords,
      setVerificationRecords,
      warrantyClaims,
      setWarrantyClaims,
      warrantyView,
      setWarrantyView,
      warrantySaving,
      setWarrantySaving,
      verificationView,
      setVerificationView,
      verificationSavingId,
      verificationMessage,
      verificationMessageError,
      markVerified,
      jobBoardCapturedAt,
      setJobBoardCapturedAt,
      jobSection,
      setJobSection,
      jobCategory,
      setJobCategory,
      jobWriter,
      setJobWriter,
      jobSearch,
      setJobSearch,
      ticketAudits,
      setTicketAudits,
      deltaAiAudits,
      setDeltaAiAudits,
      deltaAiClearingRo,
      setDeltaAiClearingRo,
      ticketAuditDate,
      setTicketAuditDate,
      ticketAuditCapturedAt,
      setTicketAuditCapturedAt,
      auditFilter,
      setAuditFilter,
      auditDisposition,
      setAuditDisposition,
      goalMissSnapshot,
      setGoalMissSnapshot,
      goalDisposition,
      setGoalDisposition,
      goalView,
      setGoalView,
      scheduleDates,
      activeScheduleDate,
      dayScheduleSnapshots,
      selectedScheduleSnapshot,
      selectedData,
      fallbackLabel,
      validWeeklySnapshot,
      validDailySnapshot,
      validLastWeekSnapshot,
      selectedLive,
      comparisonBase,
      pctChange,
      realChange,
      data,
      gpPercent,
      gpStatus,
      teamHours,
      teamTarget,
      roCount,
      calculatedAro,
      hoursPerRO,
      weeklySalesGoal,
      weeklyHoursSoldGoal,
      weeklyCarGoal,
      isToday,
      showsOperatingGoal,
      currentSalesGoal,
      currentCarGoal,
      aroGoal,
      hoursPerROGoal,
      aroMet,
      hoursPerROMet,
      paceEndDate,
      elapsedBusinessDays,
      weeklySalesPace,
      weeklyCarPace,
      salesGoalGap,
      carGoalGap,
      projectedWeeklySalesGap,
      projectedWeeklyCarGap,
      aroDollarGap,
      hoursSoldGap,
      gpPointGap,
      gpDollarGap,
      teamHoursGap,
      activeSoldHours,
      activeSoldHourRos,
      refreshJobBoard,
      refreshVerifications,
      refreshWarrantyClaims,
      refreshScheduleHistory,
      refreshDeltaAiAudits,
      refreshWebhookEvents,
      webhookEvents,
      updateGoalDisposition,
      updateAuditDisposition,
      updateWarrantyClaim,
      chooseWarrantyOriginal,
      requestScheduleCapture,
      clearDeltaAiAudit,
      updateOpportunityStatus,
      refreshLotWalkAudits,
      uploadLotWalkVideo,
      openLotWalkDetail,
      saveLotWalkResult,
      assignLotWalkRo,
      markLotWalkFixed,
      businessQueue,
      personalQueue,
      dailyCallQueue,
      visibleOpportunities,
      completedLeads,
      writerSnapshot,
      visibleRepairOrders,
      jobCategories,
      jobWriters,
      verifyQueue,
      verificationHistory,
      visibleVerificationRecords,
      criticalJobs,
      warningJobs,
      completedProblems,
      auditFindings,
      auditCritical,
      auditWarnings,
      auditReviews,
      auditIsGood,
      auditIsHidden,
      visibleTicketAudits,
      goalTickets,
      hiddenGoalTicket,
      visibleGoalTickets,
      goalTotals,
      chartPoints,
      usePrompt,
      lotWalkRoLink,
      readerRevision,
      setReaderRevision
    }}>
    <main className="app-shell">
      <SideRail nav={nav} onNavigate={(label) => {
        setNav(label);
        if (label === "Reader") setConnectionOpen(true);
        if (label === "Settings") setAiSetupOpen(true);
      }} />
      <section className="workspace">
        <TopBar
          range={range}
          rangeLabel={data.label}
          readerConnected={Boolean(liveSnapshot)}
          onRangeChange={(next) => setRange(next === "This month" ? "This week" : next)}
          onOpenReader={() => setConnectionOpen(true)}
          onSignOut={signOut}
        />
        <StatusBanners
          live={Boolean(selectedLive)}
          range={range}
          capturedAt={selectedLive?.capturedAt}
          readerStatus={readerStatus as any}
          packagedRevision={readerRevision}
          webhookEvents={webhookEvents}
          onOpenReader={() => setConnectionOpen(true)}
        />
        {nav === "Payroll" ? (
          <PayrollPanel weekly={liveSnapshot} lastWeek={lastWeekSnapshot} weeklyWriters={weeklyWriters} lastWeekWriters={lastWeekWriters} />
        ) : nav === "Verify Queue" ? (
          <VerifyQueueView />
        ) : nav === "Goal Miss" ? (
          <GoalMissView />
        ) : nav === "Warranty Claims" ? (
          <WarrantyClaimsView />
        ) : nav === "Delta AI Review" ? (
          <DeltaAiReviewView />
        ) : nav === "Ticket Auditor" ? (
          <TicketAuditorView />
        ) : nav === "Job Board" ? (
          <JobBoardView />
        ) : nav === "Leads" ? (
          <LeadsView />
        ) : nav === "Writers" ? (
          <WritersView />
        ) : nav === "Schedule History" ? (
          <ScheduleHistoryView />
        ) : nav === "Lot Walk" ? (
          <LotWalkView />
        ) : (
          <OverviewView />
        )}
      </section>
      {connectionOpen && (
        <ReaderSetupModal
          credentials={readerCredentials}
          credentialError={credentialError}
          packagedRevision={readerRevision}
          onClose={() => setConnectionOpen(false)}
          onReveal={revealReaderCredentials}
          onCopy={copyValue}
        />
      )}
      {aiSetupOpen && (
        <AiSetupModal
          aiConfigured={aiConfigured}
          apiKeyInput={apiKeyInput}
          aiSetupMessage={aiSetupMessage}
          onClose={() => setAiSetupOpen(false)}
          onChange={setApiKeyInput}
          onSubmit={saveApiKey}
        />
      )}
    </main>
    </DashboardContext.Provider>
  );
}
