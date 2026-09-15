export type Range = "Today" | "This week" | "Last week" | "This month";

export type LiveSnapshot = {
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

export type ReaderCredentials = {
  dashboardUrl: string;
  readerApiKey: string;
  sitesMachineToken: string;
};

export type Opportunity = {
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

export type ServiceWriter = {
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

export type WriterSnapshot = {
  period: "weekly" | "daily" | "last_week";
  startDate: string;
  endDate: string;
  writers: ServiceWriter[];
  capturedAt: string;
};

export type RepairOrder = {
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

export type TicketFinding = {
  code: string;
  severity: "critical" | "warning" | "review";
  title: string;
  detail: string;
  estimatedImpact: number;
};

export type LotWalkSummary = {
  vehiclesSeen?: number;
  matched?: number;
  notCheckedIn?: number;
  activeRoNotFound?: number;
  staleRos?: number;
  labelMismatches?: number;
  completedStillPresent?: number;
  needsManualId?: number;
};

export type LotWalkAudit = {
  id: number;
  status: "uploaded" | "processing" | "complete" | "failed";
  videoFilename: string;
  videoSize: number;
  summary: LotWalkSummary | null;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LotWalkActionItem = {
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

export type LotWalkResult = {
  summary?: LotWalkSummary;
  actionList?: LotWalkActionItem[];
  notes?: string;
};

export type ScheduleAppointment = {
  employee: string;
  startTime: string;
  endTime: string;
  text: string;
  color: string;
};

export type ScheduleSnapshot = {
  id: number;
  scheduleDate: string;
  hourKey: string;
  hourLabel: string;
  employees: string[];
  appointments: ScheduleAppointment[];
  capturedAt: string;
  screenshotAvailable: boolean;
};

export type TicketAudit = {
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

export type DeltaAiReviewItem = { status: "correct" | "review" | "incorrect"; text: string };

export type DeltaAiAudit = {
  roNumber: string;
  customer: string;
  vehicle: string;
  serviceWriter: string;
  detailUrl: string;
  conclusion: "Ready to present" | "Needs correction before presenting";
  summary: string;
  capturedAt: string;
  review: {
    laborReview: DeltaAiReviewItem[];
    partsReview: DeltaAiReviewItem[];
    customerConcerns: DeltaAiReviewItem[];
    clarityReview: DeltaAiReviewItem[];
    recommendations: string[];
  };
};

export type GoalMissTicket = {
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
  laborSales?: number;
  laborProfit?: number;
  partsSales?: number;
  partsCost?: number;
  partsProfit?: number;
};

export type GoalMissSnapshot = {
  startDate: string;
  endDate: string;
  capturedAt: string;
  tickets: GoalMissTicket[];
};

export type GoalDisposition = {
  status: "okay" | "assigned" | "resolved" | "hidden";
  assignedTo?: string;
  reason?: string;
  hideUntil?: string;
};

export type AuditDisposition = {
  status: "approved" | "hidden";
  reason: string;
  hideUntil?: string;
  updatedBy: string;
  updatedAt: string;
};

export type VerificationRecord = {
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

export type WarrantyClaim = {
  roNumber: string;
  customer: string;
  phone: string;
  email: string;
  vehicle: string;
  vin: string;
  currentRoUrl: string;
  originalRoNumber: string;
  originalRoUrl: string;
  currentRepairDate: string;
  currentMileage: string;
  originalRepairDate: string;
  originalMileage: string;
  originalLaborRate: number;
  originalLaborAmount: number;
  partNumbers: string[];
  quantities: string[];
  napaInvoices?: Array<{ partNumber: string; invoiceNumber: string; poNumber: string }>;
  laborHours: number;
  partStore: string;
  customerComplaint: string;
  originalRepair: string;
  failureSymptoms: string;
  diagnosis: string;
  failureDraft: string;
  missingFields: string[];
  candidatePreviousRos: Array<{ roNumber?: string; date?: string; text?: string; url?: string }>;
  evidenceNotes: string;
  serviceWriter: string;
  status: "needs_review" | "ready" | "submitted" | "paid" | "dismissed";
  claimNumber: string;
  paymentAmount: number;
  reviewNote: string;
  originalRoOverride?: string;
  capturedAt: string;
  updatedAt: string;
};

export type ReaderStatus = {
  status: string;
  detail: string;
  updatedAt: string | null;
  version?: string;
  buildHash?: string;
};

export type ReaderRevision = {
  version: string;
  buildHash: string;
};

export type TekmetricLiveSignal = {
  key: string;
  eventName: string;
  roNumber: string;
  detail: string;
  occurredAt: string;
  receivedAt: string;
};

export type TekmetricLiveEvent = {
  id: number;
  family: string;
  eventName: string;
  sourceEvent: string;
  roNumber: string;
  appointmentId: string;
  label: string;
  decision: string;
  hours: number | null;
  occurredAt: string | null;
  receivedAt: string;
  effects: string[];
};

export type TekmetricLiveEvents = {
  lastEventAt: string | null;
  signals: {
    overviewFreshness: TekmetricLiveSignal | null;
    posted: TekmetricLiveSignal | null;
    completed: TekmetricLiveSignal | null;
    ar: TekmetricLiveSignal | null;
    payment: TekmetricLiveSignal | null;
    unposted: TekmetricLiveSignal | null;
    lastApproval: TekmetricLiveSignal | null;
    lastDecline: TekmetricLiveSignal | null;
    scheduleChanged: TekmetricLiveSignal | null;
    warrantyLabel: TekmetricLiveSignal | null;
    labelChange: TekmetricLiveSignal | null;
    orderReceived: TekmetricLiveSignal | null;
    inspection: TekmetricLiveSignal | null;
  };
  recentEvents: TekmetricLiveEvent[];
};
