// Tech Board color map — change colors here only.
// Hex values sampled (PIL) from Devin's Tekmetric appointment color list screenshot, Nov 2 2026.
export const TEK_APPOINTMENT_COLORS = {
  needsScheduled: "#0d4a80",     // Needs Scheduled (navy)
  autoOpsApt: "#7a7bd5",         // AutoOps Apt. (lavender)
  preSetApt: "#fcb70d",          // Pre-Set Apt. (amber)
  diagnosticsNeeded: "#43a96e",  // Diagnostics Needed (medium green) — candidate for Needs Diag
  waiting4Approval: "#8d2b9e",   // Waiting 4 Approval (purple)
  normalPriority: "#d88177",     // Normal Priority (salmon)
  highPriority: "#d01919",       // High PR / Inc. Prev. Day! (red) — alerts only, never a normal card
  waitingOnParts: "#f0572a",     // Waiting on Parts (orange-red)
  workCompleted: "#128743",      // Work Completed (dark green)
  staffAptVacations: "#1786e8",  // Staff Apt/Vacations (bright blue) — Phase 3 time-off blocks
} as const;

// Card colors by scheduler bucket. To switch Needs Diag to Tekmetric's
// "Diagnostics Needed" green, set diag: TEK_APPOINTMENT_COLORS.diagnosticsNeeded.
export const BOARD_COLORS = {
  diag: "#b05ce6",        // Needs Diag = bright violet (Devin, Nov 3), distinct from Waiting 4 Approval #8d2b9e
  ready: "#8bb63a",       // Ready + Part Arrived = Tekmetric green (green means ready)
  partArrived: "#8bb63a",
  timeOff: TEK_APPOINTMENT_COLORS.staffAptVacations,
  fallback: "#6b7280",
} as const;

// Latest tech status from the ticket panel overrides the bucket color.
export const STATUS_COLORS: Record<string, string> = {
  "Waiting approval": TEK_APPOINTMENT_COLORS.waiting4Approval,
  "Need parts": TEK_APPOINTMENT_COLORS.waitingOnParts,
  "Wrong part": TEK_APPOINTMENT_COLORS.waitingOnParts,
  "Done": TEK_APPOINTMENT_COLORS.workCompleted,
};

// Tekmetric job-board label pill colors (shown in the ticket panel label pill).
export const TEK_LABEL_COLORS: Record<string, string> = {
  "needs diag.": "#b05ce6", "needs diag": "#b05ce6",
  "pending authorization": "#6b5bd6",
  "not started": "#6b7280",
  "in-progress": "#2f80ed", "in progress": "#2f80ed",
  "attn technician": "#8a8f98",
  "attn service writer": "#2d2d2d",
  "customer contacted": "#8bb63a",
  "big daddy": "#e5806b",
  "estimate only": "#6b7280",
};

export function tekColor(label: string) {
  return TEK_LABEL_COLORS[String(label || "").toLowerCase().replace(/\s+/g, " ").trim()] ?? BOARD_COLORS.fallback;
}

export function cardColor(job: { status: string; label: string }, latestKind?: string | null) {
  if (latestKind && STATUS_COLORS[latestKind]) return STATUS_COLORS[latestKind];
  if (job.status === "preset") return "#fcb70d"; // Tekmetric Pre-Set Apt amber
  if (job.status === "diag") return BOARD_COLORS.diag;
  if (job.status === "part-arrived") return BOARD_COLORS.partArrived;
  if (job.status === "ready") return BOARD_COLORS.ready;
  if (job.status === "waiting") return tekColor(job.label) || BOARD_COLORS.fallback; // pool-only waiting ticket: its Tekmetric label color
  return BOARD_COLORS.fallback;
}
