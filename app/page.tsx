"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import PayrollPanel from "./payroll/PayrollPanel";

type Range = "Today" | "This week" | "Last week" | "This month";
type LiveSnapshot = {
  period: "weekly" | "daily" | "last_week";
  startDate: string;
  endDate: string;
  totalSales: number;
  grossProfit: number;
  laborSales: number;
  lessAR: number;
  clearedFromAR: number;
  totalROs: number;
  hoursSold: number;
  aro: number;
  carCount: number;
  technicians: Array<{ name: string; billedHours: number; laborSales: number }>;
  capturedAt: string;
};
type ReaderCredentials = {
  dashboardUrl: string;
  readerApiKey: string;
  sitesMachineToken: string;
};
type Opportunity = {
  key: string;
  customer: string;
  vehicle: string;
  phone: string;
  lastVisit: string;
  heat: number;
  signals: string[];
  recommendedServices: string[];
  customerType: "business" | "personal" | "unclassified";
  status: "open" | "done" | "follow-up" | "skipped";
};
type ServiceWriter = {
  name: string;
  totalSold: number;
  soldCount: number;
  totalWritten: number;
  writtenCount: number;
  closeRatio: number;
  carCount: number;
  aro: number;
  awro: number;
  statuses: Record<string, { amount: number; count: number }>;
};
type WriterSnapshot = {
  period: "weekly" | "daily" | "last_week";
  startDate: string;
  endDate: string;
  writers: ServiceWriter[];
  capturedAt: string;
};
type RepairOrder = {
  roNumber: string;
  section: "estimates" | "work-in-progress" | "completed";
  label: string;
  category: string;
  customer: string;
  phone: string;
  vehicle: string;
  serviceWriter: string;
  serviceWriterInitials: string;
  assignedInitials: string[];
  ageDays: number;
  daysSinceActivity: number;
  amount: number;
  soldHours: number;
  balanceDue: boolean;
  customerComplaint: string;
  detailUrl: string;
};
type TicketFinding = {
  code: string;
  severity: "critical" | "warning" | "review";
  title: string;
  detail: string;
  estimatedImpact: number;
};
type LotWalkSummary = {
  vehiclesSeen?: number;
  matched?: number;
  notCheckedIn?: number;
  activeRoNotFound?: number;
  staleRos?: number;
  labelMismatches?: number;
  completedStillPresent?: number;
  needsManualId?: number;
};
type LotWalkAudit = {
  id: number;
  status: "uploaded" | "processing" | "complete" | "failed";
  videoFilename: string;
  videoSize: number;
  summary: LotWalkSummary | null;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
};
type LotWalkActionItem = {
  priority: "critical" | "warning" | "review" | "good";
  roNumber?: string;
  customer?: string;
  vehicle?: string;
  serviceWriter?: string;
  problem: string;
  recommendedAction: string;
  detailUrl?: string;
  assignedManually?: boolean;
};
type LotWalkResult = {
  summary?: LotWalkSummary;
  actionList?: LotWalkActionItem[];
  notes?: string;
};
type ScheduleAppointment = {
  employee: string;
  startTime: string;
  endTime: string;
  text: string;
  color: string;
};
type ScheduleSnapshot = {
  id: number;
  scheduleDate: string;
  hourKey: string;
  hourLabel: string;
  employees: string[];
  appointments: ScheduleAppointment[];
  capturedAt: string;
  screenshotAvailable: boolean;
};
type TicketAudit = {
  roNumber: string;
  customer: string;
  vehicle: string;
  serviceWriter: string;
  detailUrl: string;
  grossProfitPercent: number;
  grossProfitPerHour: number;
  laborGpPercent: number;
  partsGpPercent: number;
  laborSales: number;
  laborProfit: number;
  partsSales: number;
  partsCost: number;
  partsProfit: number;
  status: "clear" | "review";
  findings: TicketFinding[];
};
type DeltaAiReviewItem = { status: "correct" | "review" | "incorrect"; text: string };
type DeltaAiAudit = {
  roNumber: string; customer: string; vehicle: string; serviceWriter: string;
  detailUrl: string; conclusion: "Ready to present" | "Needs correction before presenting";
  summary: string; capturedAt: string;
  review: {
    laborReview: DeltaAiReviewItem[]; partsReview: DeltaAiReviewItem[];
    customerConcerns: DeltaAiReviewItem[]; clarityReview: DeltaAiReviewItem[];
    recommendations: string[];
  };
};
type GoalMissTicket = {
  roNumber: string;
  customer: string;
  vehicle: string;
  serviceWriter: string;
  technicians: string[];
  detailUrl: string;
  sales: number;
  grossProfit: number;
  hoursSold: number;
  grossProfitPercent: number;
  grossProfitPerHour: number;
  laborGpPercent: number;
  partsGpPercent: number;
  unbilledParts: number;
  missedLabor: number;
  discount: number;
  rootCauses: string[];
  exceptionType: string;
  controllable: boolean;
  dataComplete: boolean;
  notes: string;
};
type GoalMissSnapshot = {
  startDate: string;
  endDate: string;
  capturedAt: string;
  tickets: GoalMissTicket[];
};
type GoalDisposition = {
  status: "okay" | "assigned" | "resolved" | "hidden";
  assignedTo?: string;
  reason?: string;
  hideUntil?: string;
};
type AuditDisposition = {
  status: "approved" | "hidden";
  reason: string;
  hideUntil?: string;
  updatedBy: string;
  updatedAt: string;
};
type VerificationRecord = {
  id: number;
  roNumber: string;
  customer: string;
  vehicle: string;
  serviceWriter: string;
  detailUrl: string;
  amount: number;
  section: string;
  diagnosedAt: string;
  verifyLabelSeenAt: string | null;
  status: "pending" | "verified";
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNote: string;
  lastSeenAt: string;
};
type WarrantyClaim = {
  roNumber: string; customer: string; phone: string; email: string; vehicle: string; vin: string;
  currentRoUrl: string; originalRoNumber: string; originalRoUrl: string;
  currentRepairDate: string; currentMileage: string; originalRepairDate: string; originalMileage: string;
  originalLaborRate: number; originalLaborAmount: number; partNumbers: string[]; quantities: string[];
  napaInvoices?: Array<{ partNumber: string; invoiceNumber: string; poNumber: string }>;
  laborHours: number; partStore: string; customerComplaint: string; originalRepair: string;
  failureSymptoms: string; diagnosis: string; failureDraft: string; missingFields: string[];
  candidatePreviousRos: Array<{ roNumber?: string; date?: string; text?: string; url?: string }>;
  evidenceNotes: string; serviceWriter: string;
  status: "needs_review" | "ready" | "submitted" | "paid" | "dismissed";
  claimNumber: string; paymentAmount: number; reviewNote: string; originalRoOverride?: string; capturedAt: string; updatedAt: string;
};

const rangeData = {
  "This week": {
    label: "",
    comparison: "vs last Wednesday–Tuesday",
    sales: 86420,
    grossProfit: 42180,
    laborSales: 31760,
    salesChange: 12.4,
    gpChange: 9.7,
    laborChange: 8.3,
    techs: [
      { name: "Beau", hours: 42.8, target: 40 },
      { name: "Technician 2", hours: 37.4, target: 40 },
      { name: "Technician 3", hours: 31.6, target: 40 },
    ],
    trend: [9.6, 11.8, 13.9, 14.2, 15.7, 10.1, 17.6, 18.4],
  },
  "Last week": {
    label: "",
    comparison: "previous Wednesday–Tuesday",
    sales: 76890,
    grossProfit: 38450,
    laborSales: 29320,
    salesChange: 6.1,
    gpChange: 5.3,
    laborChange: 4.9,
    techs: [
      { name: "Beau", hours: 39.1, target: 40 },
      { name: "Technician 2", hours: 35.8, target: 40 },
      { name: "Technician 3", hours: 30.2, target: 40 },
    ],
    trend: [8.8, 10.4, 12.7, 11.9, 14.1, 9.4, 15.2, 16.1],
  },
  "This month": {
    label: "",
    comparison: "current calendar month",
    sales: 322870,
    grossProfit: 157640,
    laborSales: 119430,
    salesChange: 10.2,
    gpChange: 8.8,
    laborChange: 7.4,
    techs: [
      { name: "Beau", hours: 166.2, target: 160 },
      { name: "Technician 2", hours: 149.7, target: 160 },
      { name: "Technician 3", hours: 131.4, target: 160 },
    ],
    trend: [35.2, 39.8, 37.1, 43.6, 40.2, 45.8, 42.1, 39.1],
  },
} as const;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function CopyValue({ value, label = "Copy" }: { value: string | number; label?: string }) {
  const textValue = String(value || "").trim();
  return <button className="copy-value" type="button" disabled={!textValue} onClick={() => navigator.clipboard.writeText(textValue)}>{label}</button>;
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="kpi-icon" aria-hidden="true">{children}</span>;
}

function businessDaysInclusive(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  let days = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return Math.max(days, 1);
}

function centralDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")) };
}

function isoDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function dashboardRanges() {
  const central = centralDateParts();
  const today = new Date(Date.UTC(central.year, central.month - 1, central.day));
  const daysSinceWednesday = (today.getUTCDay() - 3 + 7) % 7;
  const thisStart = new Date(today);
  thisStart.setUTCDate(today.getUTCDate() - daysSinceWednesday);
  const thisEnd = new Date(thisStart);
  thisEnd.setUTCDate(thisStart.getUTCDate() + 6);
  const lastStart = new Date(thisStart);
  lastStart.setUTCDate(thisStart.getUTCDate() - 7);
  const lastEnd = new Date(thisStart);
  lastEnd.setUTCDate(thisStart.getUTCDate() - 1);
  const monthStart = isoDate(central.year, central.month, 1);
  const monthEnd = isoDate(central.year, central.month + 1, 0);
  return {
    today: isoDate(central.year, central.month, central.day),
    thisWeek: { start: thisStart.toISOString().slice(0, 10), end: thisEnd.toISOString().slice(0, 10) },
    lastWeek: { start: lastStart.toISOString().slice(0, 10), end: lastEnd.toISOString().slice(0, 10) },
    month: { start: monthStart, end: monthEnd },
  };
}

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
  const [readerStatus, setReaderStatus] = useState<{ status: string; detail: string; updatedAt: string | null } | null>(null);
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
  const [jobBoardCapturedAt, setJobBoardCapturedAt] = useState<string | null>(null);
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
  const selectedData = range === "Today" ? rangeData["This week"] : rangeData[range];
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
              : (tech.name.toLowerCase().includes("stacy")
                  ? 60
                  : tech.name.toLowerCase().includes("mario")
                    ? 20
                    : 40) / (range === "Today" ? 5 : 1),
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
  const weeklySalesGoal = 60000;
  const weeklyHoursSoldGoal = 175;
  const weeklyCarGoal = 60;
  const isToday = range === "Today";
  const showsOperatingGoal = range !== "This month";
  const currentSalesGoal = isToday ? weeklySalesGoal / 5 : weeklySalesGoal;
  const currentCarGoal = isToday ? weeklyCarGoal / 5 : weeklyCarGoal;
  const aroGoal = 1000;
  const hoursPerROGoal = 3;
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

  async function markVerified(record: VerificationRecord) {
    const note = window.prompt("Optional verification note (leave blank if none):")?.trim();
    if (note === undefined) return;
    const response = await fetch("/api/verifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: record.id, note }),
    });
    const payload = await response.json();
    if (!response.ok) {
      window.alert(payload?.error || "The verification could not be saved.");
      return;
    }
    setVerificationRecords((current) => current.map((item) => item.id === record.id ? payload.record : item));
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshJobBoard();
      refreshVerifications();
      refreshDeltaAiAudits();
      refreshWarrantyClaims();
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

  if (authLoading) return <main className="login-shell"><div className="login-card"><div className="login-mark">Δ</div><h1>Delta Auto Intelligence</h1><p>Checking access…</p></div></main>;

  if (!authenticated) return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submitLogin}>
        <div className="login-mark">Δ</div>
        <p className="eyebrow">DELTA AUTO &amp; TOWING</p>
        <h1>Delta Auto Intelligence</h1>
        <p>Sign in to view the shop dashboard.</p>
        <label><span>Username</span><input value="delta" readOnly autoComplete="username" /></label>
        <label><span>Password</span><input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" autoFocus required /></label>
        {loginError && <div className="login-error">{loginError}</div>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );

  return (
    <main className="app-shell">
      <aside className="side-rail" aria-label="Primary navigation">
        <div className="brand-mark">Δ</div>
        {[
          ["Overview", "◴"],
          ["Verify Queue", "✓"],
          ["Job Board", "▦"],
          ["Goal Miss", "$"],
          ["Ticket Auditor", "✓"],
          ["Warranty Claims", "W"],
          ["Delta AI Review", "AI"],
          ["Leads", "☏"],
          ["Writers", "★"],
          ["Schedule History", "▣"],
          ["Lot Walk", "🅿"],
          ["Payroll", "$"],
          ["Reports", "▤"],
          ["Technicians", "♙"],
          ["Reader", "⌁"],
          ["Settings", "⚙"],
        ].map(([label, glyph]) => (
          <button
            key={label}
            className={`rail-button ${nav === label ? "active" : ""}`}
            aria-label={label}
            title={label}
            onClick={() => {
              setNav(label);
              if (label === "Reader") setConnectionOpen(true);
              if (label === "Settings") setAiSetupOpen(true);
            }}
          >
            <span>{glyph}</span>
          </button>
        ))}
        <div className="rail-spacer" />
        <button className="rail-button" aria-label="Notifications"><span>●</span></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">DELTA AUTO &amp; TOWING</p>
            <h1>Delta Auto Intelligence</h1>
          </div>
          <div className="topbar-actions">
            <button className="status-pill" onClick={() => setConnectionOpen(true)}>
              <span className={`status-dot ${liveSnapshot ? "" : "warning"}`} />
              {liveSnapshot ? "Reader connected" : "Reader setup required"}
            </button>
            <button className="signout-button" onClick={signOut}>Sign out</button>
            <label className="range-picker">
              <span aria-hidden="true">▣</span>
              <select value={range} onChange={(event) => setRange(event.target.value as Range)}>
                <option>Today</option>
                <option>This week</option>
                <option>Last week</option>
                <option>This month</option>
              </select>
              <strong>{data.label}</strong>
            </label>
          </div>
        </header>

        <div className={`demo-banner ${selectedLive ? "connected" : ""}`}>
          {/* Previously this always checked the weekly snapshot, so picking
              "This month" (which has no live source at all — the reader and
              API only ever capture weekly/daily/last-week) still showed
              "LIVE TEKMETRIC" while every number on the page was actually
              the hardcoded sample data. It now reflects whichever range is
              selected. */}
          <span>{selectedLive ? "LIVE TEKMETRIC" : "DEMO DATA"}</span>
          {selectedLive
            ? `Last synchronized ${new Date(selectedLive.capturedAt).toLocaleString()}`
            : range === "This month"
              ? "Monthly view is sample data — the reader only captures Today, this week, and last week."
              : "Connect the Windows reader to replace these sample numbers with live Tekmetric reports."}
          <button onClick={() => setConnectionOpen(true)}>{selectedLive ? "Reader details →" : "Set up reader →"}</button>
        </div>

        {readerStatus && readerStatus.status !== "ok" && (
          <div className="demo-banner" style={{ borderColor: "var(--red-hot)" }}>
            <span style={{ color: "var(--red-hot)" }}>
              {readerStatus.status === "tekmetric_signin_required"
                ? "TEKMETRIC SIGN-IN NEEDED"
                : readerStatus.status === "steer_signin_required"
                  ? "STEER SIGN-IN NEEDED"
                  : "READER NEEDS ATTENTION"}
            </span>
            {readerStatus.detail || "Someone needs to sign back in on the shop computer."}
            {readerStatus.updatedAt && ` (reported ${new Date(readerStatus.updatedAt).toLocaleString()})`}
          </div>
        )}

        {nav === "Payroll" ? (
          <PayrollPanel weekly={liveSnapshot} lastWeek={lastWeekSnapshot} weeklyWriters={weeklyWriters} lastWeekWriters={lastWeekWriters} />
        ) : nav === "Verify Queue" ? (
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
                    {item.status === "pending" && <button className="verify-complete" onClick={() => markVerified(item)}>✓ Verified</button>}
                  </div>
                  {item.verificationNote && <p className="verification-note">Note: {item.verificationNote}</p>}
                </article>
              ))}
              {!visibleVerificationRecords.length && <div className="empty-leads"><strong>{verificationView === "pending" ? "No repair orders need verification" : "No verified repair orders yet"}</strong><p>{verificationView === "pending" ? "A record will be created when the reader sees a Needs Diag label removed." : "Completed verifications will remain here permanently."}</p></div>}
            </div>
          </section>
        ) : nav === "Goal Miss" ? (
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
        ) : nav === "Warranty Claims" ? (
          <section className="warranty-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">NAPA WARRANTY WORKFLOW</p>
                <h2>Warranty Claims</h2>
                <p>Completed Tekmetric tickets tagged <strong>Need Warranty Payment</strong>, matched to the most likely original paid RO.</p>
              </div>
              <div className="lead-summary"><strong>{warrantyClaims.filter((claim) => claim.status !== "paid" && claim.status !== "dismissed").length}</strong><span>open claims</span></div>
            </div>
            <div className="warranty-warning"><strong>Review before filing</strong><span>The reader only uses documented RO information. A failure draft marked incomplete must be corrected with the technician&apos;s actual findings before it is submitted.</span></div>
            <div className="lead-tabs warranty-tabs">
              {([['open','Open'],['submitted','Submitted'],['paid','Paid'],['all','All']] as const).map(([value,label]) => <button key={value} className={warrantyView === value ? "active" : ""} onClick={() => setWarrantyView(value)}>{label}</button>)}
            </div>
            <div className="warranty-list">
              {warrantyClaims.filter((claim) => warrantyView === "all" || (warrantyView === "open" ? ["needs_review","ready"].includes(claim.status) : claim.status === warrantyView)).map((claim) => {
                const claimText = [
                  `CURRENT RO: #${claim.roNumber}`, `ORIGINAL RO: #${claim.originalRoNumber || "NOT MATCHED"}`,
                  `CUSTOMER: ${claim.customer}`, `PHONE: ${claim.phone}`, `EMAIL: ${claim.email || "Not read"}`,
                  `VEHICLE: ${claim.vehicle}`, `VIN: ${claim.vin || "Not read"}`,
                  `ORIGINAL REPAIR DATE: ${claim.originalRepairDate || "Not read"}`, `ORIGINAL MILEAGE: ${claim.originalMileage || "Not read"}`,
                  `SUBSEQUENT REPAIR DATE: ${claim.currentRepairDate || "Not read"}`, `SUBSEQUENT MILEAGE: ${claim.currentMileage || "Not read"}`,
                  `ORIGINAL LABOR RATE: ${claim.originalLaborRate ? money.format(claim.originalLaborRate) : "Not read"}`,
                  `ORIGINAL LABOR AMOUNT: ${claim.originalLaborAmount ? money.format(claim.originalLaborAmount) : "Not read"}`,
                  `PART NUMBER(S): ${claim.partNumbers.join(", ") || "Not read"}`, `QUANTITY: ${claim.quantities.join(", ") || "Not read"}`,
                  `NAPA INVOICE(S): ${(claim.napaInvoices || []).map((item) => `${item.partNumber}: ${item.invoiceNumber}`).join(", ") || "Not read"}`,
                  `LABOR HOURS: ${claim.laborHours || "Not read"}`, `PART STORE: ${claim.partStore || "Not read"}`,
                  `CUSTOMER COMPLAINT: ${claim.customerComplaint || "Not documented"}`,
                  `ORIGINAL REPAIR: ${claim.originalRepair || "Not read"}`,
                  `FAILURE SYMPTOMS: ${claim.failureSymptoms || "Not documented"}`,
                  `DIAGNOSIS: ${claim.diagnosis || "Not documented"}`,
                  `CLAIM DESCRIPTION DRAFT: ${claim.failureDraft || "Technician findings required"}`,
                ].join("\n");
                return <article className={`warranty-card ${claim.status}`} key={claim.roNumber}>
                  <header><div><a href={claim.currentRoUrl} target="_blank" rel="noreferrer">RO#{claim.roNumber}</a><strong>{claim.customer}</strong><span>{claim.vehicle}</span></div><div><small>Service writer</small><strong>{claim.serviceWriter}</strong></div><b>{claim.status.replace("_", " ")}</b></header>
                  {!!claim.missingFields.length && <div className="warranty-missing"><strong>Missing before filing:</strong> {claim.missingFields.join(" · ")}</div>}
                  <div className="warranty-ro-links"><a href={claim.currentRoUrl} target="_blank" rel="noreferrer">Open current RO #{claim.roNumber}</a>{claim.originalRoUrl ? <a href={claim.originalRoUrl} target="_blank" rel="noreferrer">Open original paid RO #{claim.originalRoNumber}</a> : <span>Original paid RO needs to be selected</span>}<button onClick={() => chooseWarrantyOriginal(claim)}>{claim.originalRoOverride ? `Change selected RO #${claim.originalRoOverride}` : "Select original RO"}</button></div>
                  <div className="warranty-fields">
                    <section><h3>Vehicle &amp; owner</h3><dl><dt>VIN</dt><dd><span>{claim.vin || "Not read"}</span><CopyValue value={claim.vin} /></dd><dt>Phone</dt><dd><span>{claim.phone || "Not read"}</span><CopyValue value={claim.phone} /></dd><dt>Email</dt><dd><span>{claim.email || "Not read"}</span><CopyValue value={claim.email} /></dd></dl></section>
                    <section><h3>Original repair</h3><dl><dt>Original RO</dt><dd><span>RO#{claim.originalRoNumber || "Not matched"}</span><CopyValue value={claim.originalRoNumber} /></dd><dt>Date</dt><dd><span>{claim.originalRepairDate || "—"}</span><CopyValue value={claim.originalRepairDate} /></dd><dt>Miles</dt><dd><span>{claim.originalMileage || "—"}</span><CopyValue value={claim.originalMileage} /></dd><dt>Labor rate</dt><dd><span>{claim.originalLaborRate ? money.format(claim.originalLaborRate) : "—"}</span><CopyValue value={claim.originalLaborRate} /></dd><dt>Labor amount</dt><dd><span>{claim.originalLaborAmount ? money.format(claim.originalLaborAmount) : "—"}</span><CopyValue value={claim.originalLaborAmount} /></dd></dl></section>
                    <section><h3>Subsequent repair</h3><dl><dt>Invoice</dt><dd><span>RO#{claim.roNumber}</span><CopyValue value={claim.roNumber} /></dd><dt>Date</dt><dd><span>{claim.currentRepairDate || "—"}</span><CopyValue value={claim.currentRepairDate} /></dd><dt>Miles</dt><dd><span>{claim.currentMileage || "—"}</span><CopyValue value={claim.currentMileage} /></dd><dt>Parts</dt><dd><span>{claim.partNumbers.join(", ") || "Not read"}</span><CopyValue value={claim.partNumbers.join(", ")} /></dd></dl></section>
                    <section><h3>NAPA line information</h3><dl><dt>Part number</dt><dd><span>{claim.partNumbers.join(", ") || "—"}</span><CopyValue value={claim.partNumbers.join(", ")} /></dd><dt>NAPA invoice</dt><dd><span>{(claim.napaInvoices || []).map((item) => item.invoiceNumber).join(", ") || "—"}</span><CopyValue value={(claim.napaInvoices || []).map((item) => item.invoiceNumber).join(", ")} /></dd><dt>Quantity</dt><dd><span>{claim.quantities.join(", ") || "—"}</span><CopyValue value={claim.quantities.join(", ")} /></dd><dt>Labor hours</dt><dd><span>{claim.laborHours || "—"}</span><CopyValue value={claim.laborHours} /></dd><dt>Part store</dt><dd><span>{claim.partStore || "Not read"}</span><CopyValue value={claim.partStore} /></dd></dl></section>
                  </div>
                  <div className="warranty-narrative"><section><h3>Customer complaint <CopyValue value={claim.customerComplaint} /></h3><p>{claim.customerComplaint || "Not documented on the current RO."}</p></section><section><h3>Original repair <CopyValue value={claim.originalRepair} /></h3><p>{claim.originalRepair || "Original repair description was not read."}</p></section><section><h3>Failure symptoms <CopyValue value={claim.failureSymptoms} /></h3><p>{claim.failureSymptoms || "Failure symptoms are not documented."}</p><h3>Diagnosis <CopyValue value={claim.diagnosis} /></h3><p>{claim.diagnosis || "Technician diagnosis is required before filing."}</p></section><section className={claim.diagnosis ? "draft" : "draft incomplete"}><h3>Claim description draft <CopyValue value={claim.failureDraft} label="Copy draft" /></h3><p>{claim.failureDraft || "No claim description was created because documented diagnosis is missing."}</p></section></div>
                  {!!claim.candidatePreviousRos?.length && <details><summary>Possible previous ROs</summary>{claim.candidatePreviousRos.map((candidate, index) => <p key={index}>{candidate.url ? <a href={candidate.url} target="_blank" rel="noreferrer">RO#{candidate.roNumber || "?"}</a> : `RO#${candidate.roNumber || "?"}`} · {candidate.date || "date not read"} · {candidate.text || ""}<button onClick={() => chooseWarrantyOriginal(claim, candidate.roNumber || "")}>Use this RO</button></p>)}</details>}
                  <footer><span>Read {new Date(claim.capturedAt).toLocaleString()}{claim.claimNumber ? ` · Claim #${claim.claimNumber}` : ""}{claim.paymentAmount ? ` · Paid ${money.format(claim.paymentAmount)}` : ""}</span><div><button onClick={() => navigator.clipboard.writeText(claimText)}>Copy claim information</button>{claim.status !== "ready" && claim.status !== "submitted" && claim.status !== "paid" && <button onClick={() => updateWarrantyClaim(claim, "ready")}>Mark ready</button>}{claim.status !== "submitted" && claim.status !== "paid" && <button className="primary" onClick={() => updateWarrantyClaim(claim, "submitted")}>Mark submitted</button>}{claim.status === "submitted" && <button className="paid" onClick={() => updateWarrantyClaim(claim, "paid")}>Mark paid</button>}<button onClick={() => updateWarrantyClaim(claim, "dismissed")}>Remove</button></div></footer>
                </article>;
              })}
              {!warrantyClaims.filter((claim) => warrantyView === "all" || (warrantyView === "open" ? ["needs_review","ready"].includes(claim.status) : claim.status === warrantyView)).length && <div className="empty-leads"><strong>No warranty claims in this view</strong><p>When the reader finds a Completed RO tagged Need Warranty Payment, it will appear here with its previous-RO match.</p></div>}
            </div>
          </section>
        ) : nav === "Delta AI Review" ? (
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
        ) : nav === "Ticket Auditor" ? (
          <section className="audit-page">
            <div className="page-heading">
              <div>
                <p className="panel-kicker">CURRENT WORK-IN-PROGRESS</p>
                <h2>WIP Ticket Auditor</h2>
                <p>All current WIP repair orders, refreshed about every 20 minutes.</p>
              </div>
              <div className="lead-summary">
                <strong>{ticketAudits.length}</strong>
                <span>tickets scanned</span>
                <small>{ticketAuditCapturedAt ? `Updated ${new Date(ticketAuditCapturedAt).toLocaleString()}` : "Waiting for updated reader"}</small>
              </div>
            </div>
            <div className="job-alert-grid audit-summary-grid">
              <article className="danger"><small>Critical</small><strong>{auditCritical}</strong><span>Fix before posting</span></article>
              <article><small>Warnings</small><strong>{auditWarnings}</strong><span>Pricing or margin review</span></article>
              <article><small>Review items</small><strong>{auditReviews}</strong><span>Confirm with advisor or technician</span></article>
              <article><small>Good / approved</small><strong>{ticketAudits.filter(auditIsGood).length}</strong><span>Clear or manually reviewed</span></article>
            </div>
            <div className="audit-note">
              <strong>How to read this page</strong>
              <span>Overall GP/hr must be at least $170. Diagnostic-test lines do not trigger the GP/hr rule. Overall GP under 58% is red; 58–59.9% is acceptable; 60% is the target. Mark intentional exceptions Okay or Hide them.</span>
            </div>
            <div className="audit-toolbar">
              <div className="lead-tabs">
                <button className={auditFilter === "attention" ? "active" : ""} onClick={() => setAuditFilter("attention")}>Needs Attention <span>{ticketAudits.filter((audit) => !auditIsGood(audit) && !auditIsHidden(audit)).length}</span></button>
                <button className={auditFilter === "good" ? "active" : ""} onClick={() => setAuditFilter("good")}>Good <span>{ticketAudits.filter((audit) => auditIsGood(audit) && !auditIsHidden(audit)).length}</span></button>
                <button className={auditFilter === "all" ? "active" : ""} onClick={() => setAuditFilter("all")}>All visible <span>{ticketAudits.filter((audit) => !auditIsHidden(audit)).length}</span></button>
                <button className={auditFilter === "hidden" ? "active" : ""} onClick={() => setAuditFilter("hidden")}>Hidden <span>{ticketAudits.filter(auditIsHidden).length}</span></button>
              </div>
            </div>
            <div className="audit-list">
              {visibleTicketAudits.map((audit) => (
                <article className={`audit-card ${audit.findings.some((finding) => finding.severity === "critical") ? "critical" : ""}`} key={audit.roNumber}>
                  <div className="audit-card-head">
                    <div>
                      <a href={audit.detailUrl} target="_blank" rel="noreferrer">RO#{audit.roNumber}</a>
                      <strong>{audit.customer}</strong><span>{audit.vehicle}</span>
                    </div>
                    <div><small>Service writer</small><strong>{audit.serviceWriter}</strong></div>
                    <div className="audit-margins">
                      <span><small>Overall GP</small><b>{audit.grossProfitPercent ? `${audit.grossProfitPercent.toFixed(1)}%` : "Not read"}</b></span>
                      <span><small>GP / hour</small><b>{audit.grossProfitPerHour ? `$${audit.grossProfitPerHour.toFixed(2)}` : "Not read"}</b></span>
                      <span><small>Labor GP</small><b>{audit.laborGpPercent ? `${audit.laborGpPercent.toFixed(1)}%` : "Not read"}</b></span>
                      <span><small>Parts GP</small><b>{audit.partsGpPercent ? `${audit.partsGpPercent.toFixed(1)}%` : "Not read"}</b></span>
                    </div>
                    <div className="audit-actions">
                      {auditDisposition[audit.roNumber] ? (
                        <button onClick={() => updateAuditDisposition(audit.roNumber)}>Reopen</button>
                      ) : (
                        <>
                          <button className="approve" onClick={() => updateAuditDisposition(audit.roNumber, "approved")}>✓ Mark okay</button>
                          <button className="large-job" onClick={() => updateAuditDisposition(audit.roNumber, "approved", "Large job")}>Large Job</button>
                          <button className="quick-exception" onClick={() => updateAuditDisposition(audit.roNumber, "approved", "No labor overlap — operations verified")}>No Overlap</button>
                          <button className="quick-exception" onClick={() => updateAuditDisposition(audit.roNumber, "approved", "Warranty pricing")}>Warranty</button>
                          <button onClick={() => updateAuditDisposition(audit.roNumber, "hidden", "Hidden for one week", new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))}>Hide 1 Week</button>
                        </>
                      )}
                    </div>
                  </div>
                  {auditDisposition[audit.roNumber] && (
                    <div className="audit-decision">
                      <strong>{auditDisposition[audit.roNumber].status === "approved" ? "Marked okay" : "Hidden"}</strong>
                      <span>{auditDisposition[audit.roNumber].reason}</span>
                      <small>{auditDisposition[audit.roNumber].updatedBy} · {new Date(auditDisposition[audit.roNumber].updatedAt).toLocaleString()}{auditDisposition[audit.roNumber].hideUntil ? ` · Recheck ${auditDisposition[audit.roNumber].hideUntil}` : ""}</small>
                    </div>
                  )}
                  <div className="finding-list">
                    {audit.findings.map((finding, index) => (
                      <div className={`finding ${finding.severity}`} key={`${finding.code}-${index}`}>
                        <span>{finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.detail}</p></div>
                      </div>
                    ))}
                    {!audit.findings.length && <div className="audit-clear"><strong>✓ No audit rule triggered</strong><span>Review complete based on data Tekmetric exposed.</span></div>}
                  </div>
                </article>
              ))}
              {!visibleTicketAudits.length && <div className="empty-leads"><strong>{ticketAudits.length ? `No ${auditFilter === "good" ? "good" : "matching"} tickets in this view` : "Waiting for the WIP ticket audit"}</strong><p>{ticketAudits.length ? "Choose another filter to see the other tickets." : "Replace reader.py and leave the Windows reader running. All current Work-In-Progress tickets will appear after the next scan."}</p></div>}
            </div>
            {ticketAuditDate && <p className="audit-date">Audit date: {ticketAuditDate}</p>}
          </section>
        ) : nav === "Job Board" ? (
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
                <small>{jobBoardCapturedAt ? `Updated ${new Date(jobBoardCapturedAt).toLocaleString()}` : "Waiting for reader version 29"}</small>
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
              {!visibleRepairOrders.length && <div className="empty-leads"><strong>Waiting for Job Board data</strong><p>Run reader version 29 to populate this page.</p></div>}
            </div>
          </section>
        ) : nav === "Leads" ? (
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
        ) : nav === "Writers" ? (
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
        ) : nav === "Schedule History" ? (
          <section className="schedule-history-page">
            <div className="page-heading schedule-history-heading">
              <div>
                <p className="panel-kicker">HOURLY RECORD</p>
                <h2>Schedule History</h2>
                <p>Archived from Tekmetric every hour from 7:00 AM through 7:00 PM. Records are retained for 30 days.</p>
              </div>
              <div className="schedule-history-actions">
                <label>Date
                  <select value={activeScheduleDate} onChange={(event) => {
                    setScheduleDate(event.target.value);
                    const first = scheduleSnapshots.find((item) => item.scheduleDate === event.target.value);
                    setScheduleSnapshotId(first?.id ?? null);
                  }}>
                    {scheduleDates.map((date) => <option value={date} key={date}>{new Date(`${date}T12:00:00`).toLocaleDateString()}</option>)}
                  </select>
                </label>
                <button className="schedule-capture-now" disabled={scheduleCaptureBusy} onClick={requestScheduleCapture}>
                  {scheduleCaptureBusy ? "Sending…" : "Take Snapshot Now"}
                </button>
                <button onClick={() => refreshScheduleHistory()}>Refresh records</button>
              </div>
            </div>
            {scheduleCaptureMessage && <p className="schedule-capture-message">{scheduleCaptureMessage}</p>}
            {dayScheduleSnapshots.length ? (
              <>
                <div className="schedule-hour-picker" aria-label="Archived schedule times">
                  {dayScheduleSnapshots.slice().reverse().map((snapshot) => (
                    <button className={selectedScheduleSnapshot?.id === snapshot.id ? "active" : ""} key={snapshot.id} onClick={() => setScheduleSnapshotId(snapshot.id)}>
                      {snapshot.hourLabel}
                    </button>
                  ))}
                </div>
                {selectedScheduleSnapshot && (
                  <>
                    <div className="schedule-record-meta">
                      <strong>{new Date(`${selectedScheduleSnapshot.scheduleDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {selectedScheduleSnapshot.hourLabel}</strong>
                      <span>{selectedScheduleSnapshot.appointments.length} scheduled item{selectedScheduleSnapshot.appointments.length === 1 ? "" : "s"} · captured {new Date(selectedScheduleSnapshot.capturedAt).toLocaleString()}</span>
                      {selectedScheduleSnapshot.screenshotAvailable && <a className="schedule-view-image" target="_blank" rel="noreferrer" href={`/api/schedule-history/image?date=${encodeURIComponent(selectedScheduleSnapshot.scheduleDate)}&hour=${encodeURIComponent(selectedScheduleSnapshot.hourKey)}`}>View Screenshot</a>}
                    </div>
                    <div className="schedule-record-grid">
                      {(selectedScheduleSnapshot.employees.length ? selectedScheduleSnapshot.employees : Array.from(new Set(selectedScheduleSnapshot.appointments.map((item) => item.employee)))).map((employee) => {
                        const employeeAppointments = selectedScheduleSnapshot.appointments
                          .filter((item) => item.employee === employee)
                          .sort((a, b) => a.startTime.localeCompare(b.startTime));
                        return <section className="schedule-employee" key={employee}>
                          <header><strong>{employee}</strong><span>{employeeAppointments.length}</span></header>
                          <div>
                            {employeeAppointments.map((item, index) => <article key={`${item.startTime}-${index}`} style={{ borderLeftColor: item.color || undefined }}>
                              <time>{item.startTime}{item.endTime ? ` – ${item.endTime}` : ""}</time>
                              <p>{item.text.replace(new RegExp(`${item.startTime}\\s*-\\s*${item.endTime}`, "i"), "").trim()}</p>
                            </article>)}
                            {!employeeAppointments.length && <p className="schedule-empty">Nothing scheduled</p>}
                          </div>
                        </section>;
                      })}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="empty-leads schedule-no-records"><strong>No schedule records yet</strong><p>The reader will create the first record during the next hourly scan between 7:00 AM and 7:00 PM.</p></div>
            )}
          </section>
        ) : nav === "Lot Walk" ? (
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
        ) : (
        <>
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

        <section className="kpi-grid" aria-label="Shop performance summary">
          <article className={`kpi-card ${showsOperatingGoal ? `gp-card ${data.sales >= currentSalesGoal ? "gp-target" : "gp-critical"}` : ""}`}>
            <Icon>◇</Icon>
            <div><p>Total Sales</p><strong>{money.format(data.sales)}</strong><small className={showsOperatingGoal ? "" : "positive"}>{showsOperatingGoal ? (data.sales >= currentSalesGoal ? `● ${money.format(currentSalesGoal)} ${isToday ? "daily pace" : "weekly goal"} achieved` : `● ${money.format(salesGoalGap)} below ${money.format(currentSalesGoal)} ${isToday ? "daily pace" : "goal"}`) : `↑ ${data.salesChange}%`} <em>{showsOperatingGoal && weeklySalesPace ? `${money.format(weeklySalesPace)} projected weekly` : data.comparison}</em></small></div>
          </article>
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
          <article className={`kpi-card gp-card ${gpStatus.className}`}>
            <Icon>%</Icon>
            <div><p>GP %</p><strong>{gpPercent.toFixed(1)}%</strong><small>{gpStatus.label} <em>calculated</em></small></div>
          </article>
          <article className="kpi-card">
            <Icon>⌕</Icon>
            <div><p>Labor Sales</p><strong>{money.format(data.laborSales)}</strong>
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
          <article
            className={`kpi-card verify-kpi ${verifyQueue.length ? "has-items" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setNav("Verify Queue")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setNav("Verify Queue");
            }}
          >
            <Icon>!</Icon>
            <div><p>Needs Verification</p><strong>{verifyQueue.length}</strong><small>{verifyQueue.length ? "Open Verify Queue" : "All caught up"} <em>Estimates + WIP</em></small></div>
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

        <section className="analysis-grid">
          <article className="panel tech-panel">
            <div className="panel-heading">
              <div><p className="panel-kicker">PRODUCTION</p><h2>Technician Billed Hours</h2></div>
              <span className="target-badge">{isToday ? "Daily target tracking" : "Target tracking"}</span>
            </div>
            <div className="tech-list">
              {data.techs.map((tech) => {
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
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d71920" stopOpacity=".34" /><stop offset="100%" stopColor="#d71920" stopOpacity="0" /></linearGradient>
                </defs>
                <polygon points={`3,88 ${chartPoints} 97,88`} fill="url(#salesFill)" />
                <polyline points={chartPoints} fill="none" stroke="#ef252d" strokeWidth="2.3" vectorEffect="non-scaling-stroke" />
                {chartPoints.split(" ").map((point, index) => {
                  const [cx, cy] = point.split(",");
                  return <circle key={point} cx={cx} cy={cy} r="1.6" fill="#ef252d"><title>{`Day ${index + 1}: $${data.trend[index]}K`}</title></circle>;
                })}
              </svg>
              <div className="date-labels">{data.trend.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
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
        </>
        )}
      </section>

      {connectionOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConnectionOpen(false)}>
          <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="reader-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setConnectionOpen(false)} aria-label="Close">×</button>
            <p className="panel-kicker">WINDOWS SHOP COMPUTER</p>
            <h2 id="reader-title">Connect the Tekmetric Reader</h2>
            <p className="modal-intro">This computer will remain signed into Tekmetric and securely send read-only report totals to your dashboard.</p>
            <ol className="setup-steps">
              <li><span>1</span><div><strong>Install the Delta Reader</strong><p>A small Windows program will run only on the shop computer you approve.</p></div><b>Ready</b></li>
              <li><span>2</span><div><strong>Sign into Tekmetric yourself</strong><p>Your password stays in the browser and is never saved by the dashboard.</p></div><b>Manual</b></li>
              <li><span>3</span><div><strong>Calibrate two reports</strong><p>Sales &amp; gross profit plus technician billed hours.</p></div><b>2 minutes</b></li>
            </ol>
            <div className="security-note"><span>✓</span><p><strong>Read-only by design.</strong> The reader will not edit repair orders, contact customers, issue payments, or change Tekmetric records.</p></div>
            <a className="primary-action" href="/downloads/delta-auto-reader.zip" download>
              Download Windows reader
            </a>
            {!readerCredentials ? (
              <button className="secondary-action" onClick={revealReaderCredentials}>Show this computer&apos;s setup keys</button>
            ) : (
              <div className="credential-box">
                <p><strong>Keep these private.</strong> Paste them into the installer when requested.</p>
                {[
                  ["Dashboard URL", readerCredentials.dashboardUrl],
                  ["Reader key", readerCredentials.readerApiKey],
                  ["Machine access token", readerCredentials.sitesMachineToken],
                ].map(([label, value]) => (
                  <label key={label}>
                    <span>{label}</span>
                    <input value={value} readOnly />
                    <button onClick={() => copyValue(value)}>Copy</button>
                  </label>
                ))}
              </div>
            )}
            {credentialError && <p className="credential-error">{credentialError}</p>}
          </section>
        </div>
      )}
      {aiSetupOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAiSetupOpen(false)}>
          <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="ai-key-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setAiSetupOpen(false)} aria-label="Close">×</button>
            <p className="panel-kicker">PRIVATE OWNER SETUP</p>
            <h2 id="ai-key-title">Connect OpenAI</h2>
            <p className="modal-intro">Your API key is validated, encrypted, and stored privately. It is never sent to the browser again.</p>
            <form onSubmit={saveApiKey} className="ai-form">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder={aiConfigured ? "Enter a replacement API key" : "Paste your OpenAI API key"}
                aria-label="OpenAI API key"
                autoComplete="off"
              />
              <button type="submit" aria-label="Save OpenAI API key">Save</button>
            </form>
            <div className="security-note">
              <span>✓</span>
              <p><strong>{aiConfigured ? "OpenAI is connected." : "Encrypted storage."}</strong> Delta AI receives only the summarized shop metrics visible on this dashboard.</p>
            </div>
            {aiSetupMessage && <p className="credential-error">{aiSetupMessage}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
