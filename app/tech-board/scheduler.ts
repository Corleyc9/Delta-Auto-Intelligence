// Tech Board Phase 1 — pure auto-scheduler (no Cloudflare imports, unit-testable).
// Read-only with respect to Tekmetric: this only plans work from job-board snapshots.
import { eligibleTechs, jobCategory } from "./skills.ts";

export type BoardRepairOrder = {
  roNumber: string;
  section?: string;
  /** v1.6.19: vehicle VIN from the reader (2.1.3+). */
  vin?: string;
  label: string;
  vehicle: string;
  customer?: string;
  assignedInitials?: string[];
  ageDays?: number;
  soldHours?: number;
  promisedAt?: string | null;
  /** Fallback labor hours for this RO from other synced sources (webhook / highest hours seen), in hours. */
  knownLaborHours?: number;
  detailUrl?: string;
  /** Tekmetric jobs on this RO (job-level tech + labor hours), when synced. One board block per job. */
  jobs?: RoJob[];
  /** Set on expanded job units: the real RO number, the job's name and its Tekmetric order. */
  parentRo?: string; jobName?: string; jobOrder?: number; loggedSeconds?: number | null;
  /** Tekmetric shows this job with no tech (its Tech Board "Unassigned" lane): it stays in the open pool. */
  tekUnassigned?: boolean;
  /** Set when the RO has job detail: this unit is the diag job of a Needs Diag RO (false = a repair job on it). */
  diagJob?: boolean;
  /** v1.6.5: Tekmetric shows this diag job completed — it goes in the "Diag done" strip, never on the 8–5 grid. */
  diagCompleted?: boolean;
  /** v1.6.9: Tekmetric job ids merged into this one block (same RO, same tech). */
  mergedJobIds?: string[];
};

export type RoJob = { jobId: string; name: string; techInitials?: string | null; hours: number; order: number; completed?: boolean; technician?: string | null; loggedSeconds?: number | null;
  /** Tekmetric job authorized/approved (reader: on Tekmetric's Tech Board, which lists approved jobs only). */
  approved?: boolean };

/** Board key for one job of an RO. ROs with 0–1 jobs keep the plain RO number as their key. */
export const jobKey = (ro: string, jobId: string) => `${ro}-J${jobId}`;
export const parentRoOf = (key: string) => String(key).replace(/-J[^-]+$/, "");

/** One schedulable unit per Tekmetric job (completed jobs dropped); single-job or job-less ROs stay one unit. */
/**
 * Tech for one job. A job Tekmetric shows with no tech (its Tech Board "Unassigned" lane) goes to the open pool —
 * never to the RO card's initials, which also include the service writer. A named tech we can't map keeps the old fallback.
 */
function jobTechs(job: RoJob | undefined, order: BoardRepairOrder) {
  if (!job) return order.assignedInitials;
  if (job.techInitials) return [job.techInitials];
  return job.technician ? order.assignedInitials : [];
}
/** Diagnostic-type job (the diag on a Needs Diag RO). */
export const isDiagJobName = (name: string | undefined) => /diag|courtesy check|^cc\b|inspection/i.test(String(name || ""));

/**
 * approvedOnly (live board): only approved Tekmetric jobs are scheduled or pooled. An RO with no approved job is left
 * off entirely (estimates, declined, pending); a Needs Diag RO is left off unless its diag job is approved.
 */
export function expandJobs(orders: BoardRepairOrder[], approvedOnly = false): BoardRepairOrder[] {
  return orders.flatMap((order) => {
    const all = (order.jobs ?? []).filter((job) => !approvedOnly || job.approved === true);
    if (approvedOnly && all.length === 0) return [];
    // Needs Diag: the diag job must be approved (open) or already done (a finished diag means its repair jobs can go).
    if (approvedOnly && isNeedsDiag(order.label || "") && !all.some((job) => isDiagJobName(job.name))
      && !(order.jobs ?? []).some((job) => job.completed && isDiagJobName(job.name))) return [];
    const jobs = all.filter((job) => !job.completed).sort((a, b) => a.order - b.order);
    const diagFlag = (job: RoJob | undefined) => (job && isNeedsDiag(order.label || "") ? isDiagJobName(job.name) : undefined);
    // v1.6.5: a completed diag job (Tekmetric) stays visible in the "Diag done" strip above the grid.
    const doneDiags = order.section === "completed" ? [] : all.filter((job) => job.completed && /diag/i.test(job.name)).map((job) => ({
      ...order, roNumber: jobKey(order.roNumber, job.jobId), parentRo: order.roNumber, jobName: job.name, jobOrder: job.order,
      soldHours: job.hours, loggedSeconds: job.loggedSeconds ?? null, knownLaborHours: 0, assignedInitials: jobTechs(job, order),
      tekUnassigned: !job.techInitials && !job.technician, diagJob: true, diagCompleted: true }));
    // Tekmetric shows every job on the RO as Completed: the ticket is fully done, so it drops off the board (incl. Front office).
    if (all.length > 0 && jobs.length === 0) return [];
    if (jobs.length <= 1) {
      const job = jobs[0];
      return [...doneDiags, { ...order, parentRo: order.roNumber, jobName: job?.name, jobOrder: job?.order ?? 0, loggedSeconds: job?.loggedSeconds ?? null,
        soldHours: job && job.hours > 0 ? job.hours : order.soldHours,
        assignedInitials: jobTechs(job, order), tekUnassigned: Boolean(job && !job.techInitials && !job.technician), diagJob: diagFlag(job) }];
    }
    // v1.6.9: jobs on the same RO for the same tech (and same diag/repair kind) are ONE block: hours summed, names listed.
    // The block keeps the first job's key so existing drags/percent stay with it.
    const groups = mergeJobGroups(jobs, (job) => (!job.techInitials && !job.technician ? `U|${job.jobId}` // Unassigned-lane jobs stay separate (assigned one by one)
      : `${(jobTechs(job, order) ?? []).join(",")}|${diagFlag(job) ? "D" : ""}`));
    return [...doneDiags, ...groups.map((group) => { const job = group[0];
      const hours = Math.round(group.reduce((sum, item) => sum + (Number(item.hours) || 0), 0) * 100) / 100;
      const logged = group.some((item) => item.loggedSeconds !== null && item.loggedSeconds !== undefined) ? group.reduce((sum, item) => sum + (Number(item.loggedSeconds) || 0), 0) : null;
      return { ...order, roNumber: jobKey(order.roNumber, job.jobId), parentRo: order.roNumber,
        jobName: group.map((item) => item.name).join(" + "), mergedJobIds: group.map((item) => item.jobId),
        jobOrder: job.order, soldHours: hours, loggedSeconds: logged, knownLaborHours: 0,
        assignedInitials: jobTechs(job, order), tekUnassigned: !job.techInitials && !job.technician, diagJob: diagFlag(job) }; })];
  });
}

/** v1.6.9: group jobs (already in Tekmetric order) by key, keeping first-seen group order. */
export function mergeJobGroups<T>(jobs: T[], keyOf: (job: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const job of jobs) { const key = keyOf(job); map.set(key, [...(map.get(key) ?? []), job]); }
  return [...map.values()];
}

type Span = { start: number; end: number };
type SameRoBlock = { key: string; ro: string; laneDate: string; startMinute: number; durationMinutes: number; tech: string };
/** Resizing a block into a later same-RO block pushes that block to start at the new end (it never overlaps). */
export function resizePush(blocks: SameRoBlock[], key: string, duration: number) {
  const self = blocks.find((block) => block.key === key);
  if (!self || self.tech === UNASSIGNED) return null;
  const end = wallEnd(self.startMinute, duration);
  const hit = blocks.find((block) => block.key !== key && block.ro === self.ro && block.laneDate === self.laneDate && block.tech !== UNASSIGNED
    && block.startMinute < end && wallEnd(block.startMinute, block.durationMinutes) > self.startMinute);
  return hit ? { key: hit.key, start: clampStart(end) } : null;
}
/**
 * HARD RULE: blocks of the same RO (same car) never overlap, across techs.
 * Returns the first start >= `start` where [start, wallEnd) clears every other block of `ro` that day.
 */
export function snapSameRo(blocks: { key: string; ro: string; laneDate: string; startMinute: number; durationMinutes: number; tech: string }[],
  key: string, ro: string, laneDate: string, start: number, duration: number) {
  const others = blocks.filter((block) => block.key !== key && block.ro === ro && block.laneDate === laneDate && block.tech !== UNASSIGNED)
    .map((block) => ({ start: block.startMinute, end: wallEnd(block.startMinute, block.durationMinutes), key: block.key }))
    .sort((a, b) => a.start - b.start);
  let next = clampStart(start);
  let conflict: string | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const hit = others.find((other) => next < other.end && wallEnd(next, duration) > other.start);
    if (!hit) break;
    conflict = hit.key; next = clampStart(hit.end);
  }
  return { start: next, conflictWith: conflict };
}

export type TechCapacity = {
  initials: string;
  name: string;
  dayMinutes: number;      // default 480 (8 h)
  diagBlockMinutes: number; // default 120 (first 2 h)
  dayStartMinute: number;  // minutes after local midnight, default 480 (8:00 AM CT)
  active: boolean;
  sortOrder: number;
};

export const UNASSIGNED = "UN";

export const DEFAULT_TECHS: TechCapacity[] = [
  ["MC", "Mike Cook"], ["AN", "Andrew Nelson"], ["BC", "Beau Corley"],
  ["MB", "Mario Butler"], ["SW", "Stacy Williams"],
].map(([initials, name], index) => ({
  initials, name, dayMinutes: 480, diagBlockMinutes: 120, dayStartMinute: 480, active: true, sortOrder: index,
}));

/** "waiting": an approved job in Tekmetric's Unassigned lane on a waiting ticket (parts, customer…): pool-only. */
export type JobKind = "preset" | "diag" | "part-arrived" | "ready" | "custom" | "waiting" | "front-office" | "diag-done";

// Lunch: 12:00–1:00 PM (minutes 240–300 after an 8:00 AM start). Nothing is scheduled there;
// work that crosses it flows around it (its wall-clock span grows by the lunch hour).
export const LUNCH_START = 240;
export const LUNCH_MINUTES = 60;
export const LUNCH_END = LUNCH_START + LUNCH_MINUTES;
/** Move a start out of lunch. */
export const clampStart = (start: number) => (start >= LUNCH_START && start < LUNCH_END ? LUNCH_END : start);
/** v1.6.7: rows above 8 AM — 6–7 AM Front office (-120) and 7–8 AM (-60). Any other start snaps to 15 min, ≥ 0, off lunch. */
export const EARLY_ROWS = [-120, -60] as const;
export function boardStart(value: unknown) {
  const n = Math.round(Number(value) || 0);
  if (n < 0) return n <= -90 ? -120 : -60;
  return clampStart(Math.max(0, Math.min(24 * 60, Math.round(n / 15) * 15)));
}
/** RO a custom block is tied to: its linkedRo, else "RO#12345" in its title. */
export const blockRo = (row: { linkedRo?: string | null; title?: string }) =>
  String(row.linkedRo || "").replace(/\D/g, "") || (String(row.title || "").match(/RO\s*#\s*(\d{3,})/i)?.[1] ?? "");
/** Wall-clock end of `duration` working minutes starting at `start`, skipping lunch. */
export function wallEnd(start: number, duration: number) {
  const s = clampStart(start);
  const end = s + duration;
  return s < LUNCH_START && end > LUNCH_START ? end + LUNCH_MINUTES : end;
}
/**
 * One continuous card span. A job running through lunch keeps going after it (2 h from 11:00 ends 2:00),
 * so the card is one block from start to the adjusted end with the lunch hour shaded inside it.
 * `lunch` is the shaded band as minute offsets from the card start (null when the job doesn't cross lunch).
 */
export function cardSpan(start: number, duration: number) {
  const s = clampStart(start);
  const end = wallEnd(s, duration);
  const crosses = end - s > duration;
  return { start: s, end, lunch: crosses ? { offset: LUNCH_START - s, minutes: LUNCH_MINUTES } : null };
}
/** Expected completion (adjusted for lunch) and the stalled check: past the adjusted end and not done. */
export function expectedEnd(start: number, duration: number) { return wallEnd(start, duration); }
export function isStalled(start: number, duration: number, nowMinute: number, done = false) {
  return !done && nowMinute > wallEnd(start, duration);
}

export type TimeOff = { id: number; initials: string; date: string; startMinute: number; endMinute: number; allDay: boolean; reason: string };

export type BoardJob = {
  ro: string;
  vehicle: string;
  customer: string;
  label: string;
  detailUrl: string;
  tech: string;               // initials or UNASSIGNED
  assignedTech: string | null; // tech read from Tekmetric card
  laborGuideHours: number;
  techEstimateHours: number | null;
  laneDate: string;           // YYYY-MM-DD America/Chicago
  position: number;           // order within lane/day
  startMinute: number;        // minutes from tech day start
  durationMinutes: number;
  pinned: boolean;
  placedBy: "auto" | "writer";
  status: JobKind;
  inDiagBlock: boolean;
  startedAt: string | null;
  updatedAt: string;
  title: string;                    // writer title override / custom block title
  note: string;
  custom: boolean;                  // writer-added block, not a Tekmetric RO
  hidden: boolean;                  // writer removed it from the board
  durationOverrideMinutes: number | null; // writer resized the block
  linkedRo: string | null;          // Tekmetric RO this block is tied to (RO jobs: their own RO)
  roNumber: string;                 // real Tekmetric RO number (ro is the per-job board key)
  jobName: string;                  // Tekmetric job name ('' when the RO has no synced jobs)
  jobOrder: number;                 // Tekmetric job order on the RO
  carriedOver: boolean;             // not finished on an earlier day; carried with its remaining time
  loggedSeconds: number | null;     // tech clock time Tekmetric shows on the job (reader, WIP tab)
  /** v1.6.13: Tekmetric appointment detail (JSON label → text) shown on the card and in the ticket drawer. */
  apptInfo?: string | null;
  apptKey?: string | null;          // v1.6.8: Tekmetric appointment this block mirrors (id|updated|start|end|tech)
  /** v1.6.16: the board put this approved job on a tech's day by itself (shown as "Auto-placed", posted to Teams). */
  autoPlaced?: boolean;
  /** v1.6.16: approved job the board couldn't place (no tech fits / day full): reason shown in the writers' "Needs placing" list. */
  needsPlacing?: string | null;
};

/** Every tech day: 8:00–10:00 AM is diag-only, regular work 10–12 and 1–5. Minutes are from the 8:00 AM day start. */
export const DIAG_START = 0;
export const DIAG_END = 120;
/** v1.6.6: Tekmetric's 6–7 AM front-office slot (minutes from the 8:00 AM start). Uses no work time. */
export const FRONT_OFFICE_MINUTE = -120;

/** Remaining minutes for unfinished work: labor hours × (1 − % complete). 4 h at 50% → 120. */
export function remainingMinutes(hours: number, percentComplete: number | null | undefined) {
  const pct = Math.max(0, Math.min(100, Number(percentComplete) || 0));
  return Math.max(15, Math.round((hours * 60 * (1 - pct / 100)) / 15) * 15);
}

export type JobProgress = { percent: number | null; done: boolean };
/** v1.6.8: one Tekmetric schedule block (Appointments → Day - Employee). Minutes are from 8:00 AM (6 AM = -120). */
export type TekAppointment = { id: string; ro: string; tech: string | null; date: string; startMinute: number; endMinute: number; key: string;
  /** v1.6.12: Tekmetric card color; yellow (#FCB70D) = the customer is coming at that time → locked block. */
  color?: string; yellow?: boolean; customer?: string; title?: string; details?: string };
/** v1.6.12: a locked (yellow / customer-waiting) appointment block: appt_key starts with "Y|". v1.6.13: writers/bot may move it;
 *  the scheduler never re-places it on its own (a writer's move sticks), and tech sessions can't move anything. */
export const isLockedJob = (job: { apptKey?: string | null }) => String(job.apptKey || "").startsWith("Y|");
/** v1.6.13: vehicle text from the appointment detail JSON. */
export const apptVehicle = (appt: { details?: string }) => { try { return String((JSON.parse(appt.details || "{}") as Record<string, string>).Vehicle || ""); } catch { return ""; } };
/** v1.6.14: front-office work techs don't see on /tech — the 6–7 AM row, and anything parked as front-office (incl. in the 7–8 row).
 *  A 7–8 AM Tekmetric appointment block (status not front-office) and any yellow customer appointment stay visible. */
export const hiddenFromTech = (job: { status?: string; startMinute: number; apptKey?: string | null }) =>
  !isLockedJob(job) && (job.status === "front-office" || job.startMinute <= -120);
export const isYellow = (color?: string) => String(color || "").trim().toLowerCase() === PRESET_COLOR;
/** Working minutes between two wall-clock minutes (lunch excluded). */
export const workBetween = (start: number, end: number) => Math.max(0, end - start - Math.max(0, Math.min(end, LUNCH_END) - Math.max(start, LUNCH_START)));
export type Appointment = { date: string; employee: string; startMinute: number | null; endMinute: number | null; text: string; color?: string };
export const PRESET_COLOR = "#fcb70d";

/** "9:30 AM" → minutes from the 8:00 AM day start (null if unreadable). */
export function appointmentMinute(value: string, dayStart = 480) {
  const match = String(value || "").match(/(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M/i);
  if (!match) return null;
  const hour = (Number(match[1]) % 12) + (match[3].toUpperCase() === "P" ? 12 : 0);
  return hour * 60 + Number(match[2] || 0) - dayStart;
}

/** Same normalisation style as app/api/job-board/route.ts, plus whitespace collapse. */
export function normalizeLabel(label: string) {
  return String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
}
export const isNeedsDiag = (label: string) => normalizeLabel(label).includes("needs diag");
export const isPreSet = (label: string) => /pre-?\s?set/.test(normalizeLabel(label));
export const isPartArrived = (label: string) => /parts? arrived/.test(normalizeLabel(label));
const BLOCKED = ["waiting", "on hold", "hold", "parts ordered", "need parts", "verify", "sublet"];
export const isBlocked = (label: string) => {
  const value = normalizeLabel(label);
  return BLOCKED.some((word) => value === word || value.includes(word));
};

/** Decimal labor hours for an RO from synced data (never tenths or minutes). */
export function laborHoursOf(order: BoardRepairOrder) {
  const card = Math.max(0, Number(order.soldHours) || 0);
  const known = Math.max(0, Number(order.knownLaborHours) || 0);
  return Math.round((card > 0 ? card : known) * 100) / 100;
}

export function classify(order: BoardRepairOrder): JobKind | null {
  if (order.section === "completed") return null;
  if (isPreSet(order.label)) return "preset";
  // A repair job on a Needs Diag RO is regular work (after the diag), not an 8–10 diag block.
  if (isNeedsDiag(order.label)) return order.diagJob === false ? (laborHoursOf(order) > 0 ? "ready" : null) : "diag";
  if (isPartArrived(order.label)) return "part-arrived";
  if (order.section === "work-in-progress" && laborHoursOf(order) > 0 && !isBlocked(order.label)) return "ready";
  return null;
}

export function chicagoDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Next N shop days (Mon–Fri) starting at `fromDate` (rolls forward off weekends). */
export function shopDays(fromDate: string, count: number) {
  const days: string[] = [];
  const cursor = new Date(`${fromDate}T12:00:00Z`);
  while (days.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

type Interval = { start: number; end: number };
type Slot = { intervals: Interval[]; cursor: number };

/** First start in [from, windowEnd) where `duration` fits entirely inside the window. */
function firstFitWindow(slot: Slot, from: number, duration: number, windowEnd: number) {
  let start = from;
  for (const busy of [...slot.intervals].sort((a, b) => a.start - b.start)) {
    if (start + duration <= busy.start) break;
    if (busy.end > start) start = busy.end;
  }
  return start + duration <= windowEnd ? start : null;
}

function firstFit(slot: Slot, from: number, duration: number, limit: number, allowOverflow: boolean, regularStart = 0) {
  let start = clampStart(from);
  const sorted = [...slot.intervals].sort((a, b) => a.start - b.start);
  for (const busy of sorted) {
    if (wallEnd(start, duration) <= busy.start) break;
    if (busy.end > start) start = clampStart(busy.end);
  }
  if (wallEnd(start, duration) <= dayWallLimit(limit)) return start;
  // A job longer than a whole day goes at the start of an otherwise empty day.
  if (allowOverflow && start === regularStart && !sorted.some((busy) => busy.end > regularStart)) return regularStart;
  return null;
}

/** The working day (e.g. 480 min) plus the lunch hour, in wall-clock minutes from day start. */
export const dayWallLimit = (dayMinutes: number) => dayMinutes + LUNCH_MINUTES;

export type ExistingRow = {
  ro: string; tech: string; laneDate: string; position: number; startMinute: number;
  pinned: boolean; placedBy: "auto" | "writer"; techEstimateHours: number | null; startedAt: string | null; status?: string;
  title?: string; note?: string; custom?: boolean; hidden?: boolean; durationOverrideMinutes?: number | null;
  linkedRo?: string | null; customer?: string; vehicle?: string; detailUrl?: string; label?: string;
  durationMinutes?: number; carriedOver?: boolean; roNumber?: string; apptKey?: string | null;
  autoPlaced?: boolean; needsPlacing?: string | null;
};

export type ScheduleOptions = {
  today: string; horizonDays?: number; now?: string; defaultDiagHours?: number; timeOff?: TimeOff[];
  /** Live board: schedule/pool only approved Tekmetric jobs (see expandJobs). */
  approvedOnly?: boolean;
  /** v1.6.7: board start date (YYYY-MM-DD). An RO not on the board whose first-seen date is before it is ignored. */
  startDate?: string; firstSeen?: Record<string, string>;
  /** v1.6.11: schedule-archive appointments from earlier days (front-office rows roll forward until the RO is closed). */
  pastAppointments?: Appointment[];
  /** v1.6.7: today's placed blocks (tech + time) are set — never moved or replaced; new work only fills open time. */
  keepToday?: boolean;
  /** v1.6.8: Tekmetric's schedule — the source of truth for every RO it schedules (tech, day, start, end). */
  tekSchedule?: TekAppointment[];
  progress?: Record<string, JobProgress>; appointments?: Appointment[];
  /** v1.6.16 auto-place: a new approved job goes on its Tekmetric tech (else a skill-chart tech) in the first open slot TODAY;
   *  if none fits it waits in "Needs placing" (Unassigned, flagged) instead of spilling to a later day. */
  autoPlace?: boolean;
};

export function schedule(
  orders: BoardRepairOrder[], existing: ExistingRow[], techs: TechCapacity[] = DEFAULT_TECHS,
  options: ScheduleOptions,
): BoardJob[] {
  const rawOrders = orders; // v1.6.9: every synced RO (incl. unapproved) — names/vehicle for RO-linked writer blocks
  orders = expandJobs(orders, Boolean(options.approvedOnly));
  const now = options.now || new Date().toISOString();
  const activeTechs = techs.filter((tech) => tech.active && tech.initials !== UNASSIGNED)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const techSet = new Set(activeTechs.map((tech) => tech.initials));
  const days = shopDays(options.today, options.horizonDays ?? 10);
  const prior = new Map(existing.map((row) => [row.ro, row]));
  // v1.6.8: each RO's first Tekmetric appointment from today on (Tekmetric's schedule wins for that RO).
  const tekByRo = new Map<string, TekAppointment>();
  for (const appt of [...(options.tekSchedule ?? [])].filter((item) => item.ro && item.date >= days[0])
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute)) if (!tekByRo.has(appt.ro)) tekByRo.set(appt.ro, appt);
  const parentOf = (order: BoardRepairOrder) => order.parentRo ?? parentRoOf(order.roNumber);
  const slots = new Map<string, Slot>();
  const slot = (tech: string, day: string) => {
    const key = `${tech}|${day}`;
    if (!slots.has(key)) slots.set(key, { intervals: [], cursor: 0 });
    return slots.get(key)!;
  };
  const capacity = (tech: string) => activeTechs.find((item) => item.initials === tech) ?? DEFAULT_TECHS[0];
  const result: BoardJob[] = [];

  // Open pool = Tekmetric's Unassigned lane exactly: unassigned approved jobs on waiting tickets join it as "waiting".
  const candidates: { order: BoardRepairOrder; kind: JobKind }[] = orders.map((order) => ({ order, kind: order.diagCompleted ? "diag-done" as JobKind : classify(order) ?? (order.tekUnassigned && order.section === "work-in-progress" ? "waiting" as JobKind : null) }))
    .filter((item): item is { order: BoardRepairOrder; kind: JobKind } => item.kind !== null);
  // v1.6.7 board start date: an RO first seen before it (old / dead tickets) is never added unless it's already on the board
  // (as a job row or a custom block linked to it).
  const linkedRos = new Set(existing.filter((row) => row.custom && !row.hidden).map(blockRo).filter(Boolean));
  const onBoardRo = new Set(existing.filter((row) => !row.custom).map((row) => row.roNumber || parentRoOf(row.ro)));
  const beforeStart = (order: BoardRepairOrder) => {
    if (!options.startDate) return false;
    const ro = order.parentRo ?? order.roNumber;
    if (prior.has(order.roNumber) || onBoardRo.has(ro) || linkedRos.has(ro) || tekByRo.has(ro)) return false;
    const seen = options.firstSeen?.[ro];
    return Boolean(seen && seen < options.startDate);
  };
  candidates.splice(0, candidates.length, ...candidates.filter((item) => !beforeStart(item.order)));

  const progress = options.progress ?? {};
  const findTech = (employee: string) => {
    const value = normalizeLabel(employee);
    return activeTechs.find((tech) => value && (normalizeLabel(tech.name) === value || normalizeLabel(tech.name).split(" ")[0] === value.split(" ")[0]
      || value === tech.initials.toLowerCase()))?.initials ?? null;
  };
  // Appointments: an RO booked on a day is not scheduled before that day (and prefers the booked tech);
  // a staff appointment / vacation for a tech blocks that time like time off.
  const apptByRo = new Map<string, { date: string; tech: string | null; startMinute: number | null; preset: boolean }>();
  for (const appt of [...(options.appointments ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    const matched = orders.filter((order) => new RegExp(`(^|\\D)${order.parentRo ?? order.roNumber}(\\D|$)`).test(appt.text));
    if (matched.length) { for (const ro of matched) if (!apptByRo.has(ro.roNumber)) apptByRo.set(ro.roNumber, { date: appt.date, tech: findTech(appt.employee), startMinute: appt.startMinute,
      preset: /pre-?\s?set/i.test(appt.text) || String(appt.color || "").toLowerCase() === PRESET_COLOR }); continue; }
    const tech = findTech(appt.employee);
    if (tech && /staff|vacation|off|apt|appointment|doctor/i.test(appt.text) && appt.startMinute !== null && appt.endMinute !== null && appt.endMinute > appt.startMinute) {
      slot(tech, appt.date).intervals.push({ start: Math.max(0, appt.startMinute), end: appt.endMinute });
    }
  }

  const build = (order: BoardRepairOrder, kind: JobKind) => {
    const old = prior.get(order.roNumber);
    // Labor hours come from the synced job-board card ("clocked / sold" progress, decimal hours, e.g. "0 / 2.4").
    // When the card shows no hours (0), fall back to the highest hours we have seen for the RO (webhooks / earlier syncs).
    const lg = laborHoursOf(order);
    const est = old?.techEstimateHours ?? null;
    const hours = est && est > 0 ? est : lg > 0 ? lg : kind === "diag" ? (options.defaultDiagHours ?? 1) : 1;
    const override = old?.durationOverrideMinutes && old.durationOverrideMinutes > 0 ? old.durationOverrideMinutes : null;
    const assigned = (order.assignedInitials || []).find((initials) => techSet.has(initials)) ?? null;
    return {
      ro: order.roNumber, vehicle: order.vehicle || "", customer: order.customer || "", label: order.label || "",
      detailUrl: order.detailUrl || "", assignedTech: assigned, laborGuideHours: lg, techEstimateHours: est,
      // v1.6.10: length = labor hours of the (merged) open jobs, reduced by the board's % complete (min 15 min).
      durationMinutes: override ?? (progress[order.roNumber]?.percent ? remainingMinutes(hours, progress[order.roNumber]?.percent) : Math.max(15, Math.round(hours * 60))), status: kind,
      startedAt: old?.startedAt ?? (order.section === "work-in-progress" ? now : null), updatedAt: now,
      title: old?.title || "", note: old?.note || "", custom: false, hidden: false, durationOverrideMinutes: override,
      tech: UNASSIGNED, laneDate: days[0], position: 0, startMinute: 0, pinned: false, placedBy: "auto" as const, inDiagBlock: false,
      linkedRo: order.parentRo ?? order.roNumber, carriedOver: false,
      roNumber: order.parentRo ?? order.roNumber, jobName: order.jobName ?? "", jobOrder: order.jobOrder ?? 0,
      loggedSeconds: order.loggedSeconds ?? null,
    };
  };
  // Same car = same RO: busy spans per RO/day so no two of its blocks overlap (any tech), and the
  // latest end of an RO's auto-placed jobs so the next job in Tekmetric order starts after it.
  const roBusy = new Map<string, Interval[]>();
  const roSpans = (ro: string, day: string) => {
    const key = `${ro}|${day}`;
    if (!roBusy.has(key)) roBusy.set(key, []);
    return roBusy.get(key)!;
  };
  const roPlaced = new Map<string, { order: number; day: string; end: number }[]>();
  /** Latest end among this RO's jobs that come earlier in Tekmetric order (null if none placed). */
  const roNext = (ro: string, order: number) => {
    let best: { day: string; end: number } | null = null;
    for (const item of roPlaced.get(ro) ?? []) {
      if (item.order >= order) continue;
      if (!best || item.day > best.day || (item.day === best.day && item.end > best.end)) best = { day: item.day, end: item.end };
    }
    return best;
  };

  // Time off and blocked capacity come first.
  for (const off of options.timeOff ?? []) {
    if (!techSet.has(off.initials)) continue;
    const cap = capacity(off.initials);
    const start = off.allDay ? 0 : Math.max(0, off.startMinute);
    const end = off.allDay ? dayWallLimit(cap.dayMinutes) : Math.min(dayWallLimit(cap.dayMinutes), off.endMinute);
    if (end > start) slot(off.initials, off.date).intervals.push({ start, end });
  }

  // Writer-added custom blocks are always fixed.
  for (const row of existing.filter((item) => item.custom && !item.hidden && !String(item.ro).startsWith("APPT-"))) {
    const duration = row.durationOverrideMinutes ?? row.durationMinutes ?? 60;
    // v1.6.12: an RO-linked block left on an earlier day carries to today (same tech/time) while the RO is still open.
    const linkRo = blockRo(row);
    const open = linkRo && orders.some((order) => (order.parentRo ?? order.roNumber) === linkRo) && !(progress[linkRo]?.done);
    const old = row.laneDate < days[0] && open ? { ...row, laneDate: days[0], carriedOver: true } : row;
    if (old.tech !== UNASSIGNED) slot(old.tech, old.laneDate).intervals.push({ start: old.startMinute, end: wallEnd(old.startMinute, duration) });
    const link = blockRo(old);
    if (old.tech !== UNASSIGNED && link && old.startMinute >= 0) roSpans(link, old.laneDate).push({ start: old.startMinute, end: wallEnd(old.startMinute, duration) });
    const linked = link ? orders.find((order) => (order.parentRo ?? order.roNumber) === link) ?? rawOrders.find((order) => String(order.roNumber) === link) : undefined;
    result.push({ ro: old.ro, vehicle: linked?.vehicle || old.vehicle || "", customer: linked?.customer || old.customer || "",
      label: linked?.label || old.label || "", detailUrl: linked?.detailUrl || old.detailUrl || "", tech: old.tech, assignedTech: null,
      laborGuideHours: 0, techEstimateHours: null, laneDate: old.laneDate, position: old.position, startMinute: old.startMinute,
      durationMinutes: duration, pinned: true, placedBy: "writer", status: "custom", inDiagBlock: false, startedAt: null,
      updatedAt: now, title: old.title || (old.linkedRo ? "" : "Custom block"), note: old.note || "", custom: true, hidden: false,
      durationOverrideMinutes: duration, linkedRo: old.linkedRo || null, carriedOver: Boolean(old.carriedOver && row.laneDate !== old.laneDate),
      roNumber: old.linkedRo || old.ro, jobName: "", jobOrder: 0, loggedSeconds: null });
  }
  // v1.6.12: Tekmetric appointments with no RO yet (a customer booked for a time) → customer-named block at the exact time.
  // Yellow ones are locked. A writer's hand-made block for the same customer/tech/time stands in for it (no duplicate).
  for (const appt of (options.tekSchedule ?? []).filter((item) => !item.ro && days.includes(item.date))) {
    const tech = appt.tech && techSet.has(appt.tech) ? appt.tech : UNASSIGNED;
    const who = String(appt.customer || "").trim();
    const label = [who, appt.title].filter(Boolean).join(" · ") || "Appointment";
    const dupe = result.some((job) => job.custom && job.tech === tech && job.laneDate === appt.date && job.startMinute === appt.startMinute
      && (!who || String(job.title || "").toLowerCase().includes(who.toLowerCase().split(" ")[0])));
    if (dupe) continue;
    const moved = prior.get(`APPT-${appt.id}`);
    const kept = moved && !moved.hidden && moved.placedBy === "writer" && moved.apptKey === appt.key ? moved : null; // v1.6.13: Devin's move sticks
    const start = kept ? kept.startMinute : appt.startMinute < 0 ? (appt.startMinute < -60 ? FRONT_OFFICE_MINUTE : -60) : appt.startMinute;
    const duration = kept?.durationOverrideMinutes ?? Math.max(15, workBetween(Math.max(0, appt.startMinute), Math.max(appt.startMinute + 15, Math.min(appt.endMinute, 540))) || 60);
    const laneTech = kept && (techSet.has(kept.tech) || kept.tech === UNASSIGNED) ? kept.tech : tech;
    const laneDate = kept ? kept.laneDate : appt.date;
    if (laneTech !== UNASSIGNED && start >= 0) slot(laneTech, laneDate).intervals.push({ start, end: wallEnd(start, duration) });
    result.push({ ro: `APPT-${appt.id}`, vehicle: apptVehicle(appt), customer: who, label: appt.yellow ? "Pre-Set" : "", detailUrl: "", tech: laneTech, assignedTech: null,
      laborGuideHours: 0, techEstimateHours: null, laneDate, position: 0, startMinute: laneTech === UNASSIGNED ? 0 : start,
      durationMinutes: duration, pinned: true, placedBy: kept ? "writer" : "auto", apptInfo: appt.details || null, status: "custom", inDiagBlock: false, startedAt: null,
      updatedAt: now, title: `${appt.yellow ? "PRE-SET · customer coming · " : ""}${label}`, note: "From Tekmetric's schedule (no RO yet).", custom: true, hidden: false,
      durationOverrideMinutes: duration, linkedRo: null, carriedOver: false, roNumber: `APPT-${appt.id}`, jobName: "", jobOrder: 0, loggedSeconds: null, apptKey: appt.key });
  }

  // Writer-removed ROs stay off the board (kept as hidden rows so a re-sync does not bring them back).
  // A job whose RO has a Tekmetric appointment today or later is shown again (v1.6.8: the board mirrors Tekmetric).
  const hiddenRos = new Set(existing.filter((row) => row.hidden && !row.custom && !tekByRo.has(row.roNumber || parentRoOf(row.ro))).map((row) => row.ro));
  for (const { order, kind } of candidates) {
    if (!hiddenRos.has(order.roNumber)) continue;
    const old = prior.get(order.roNumber)!;
    result.push({ ...build(order, kind), tech: UNASSIGNED, laneDate: old.laneDate, position: 0, startMinute: 0,
      pinned: false, placedBy: "writer", inDiagBlock: false, hidden: true });
  }

  // Finished work (Done / Diag Done / 100%) leaves the board.
  const isDone = (ro: string) => Boolean(progress[ro]?.done) || (progress[ro]?.percent ?? 0) >= 100;
  // v1.6.6: Front office row (Tekmetric's 6–7 AM slot, above 8 AM). A finished diag (Diag Done / Done / 100% on a diag
  // block, or Tekmetric shows the diag job completed) goes there automatically, off the 8–5 grid, using no work time, and
  // carries to each next shop day until the ticket is fully done. Writers can drag any ticket in (start -120) or out.
  const writerIn = (ro: string) => { const old = prior.get(ro); return Boolean(old?.pinned && old.placedBy === "writer" && old.startMinute < 0); };
  const writerOut = (ro: string) => { const old = prior.get(ro);
    return Boolean(old?.pinned && old.placedBy === "writer" && old.startMinute >= 0 && old.tech !== UNASSIGNED && old.status !== "diag"); };
  const finishedDiag = (item: { order: BoardRepairOrder; kind: JobKind }) => item.kind === "diag-done" || (item.kind === "diag" && isDone(item.order.roNumber));
  // v1.6.11: front-office roll-forward. A ticket parked in the 6–7 AM (-120) or 7–8 AM (-60) row on an earlier day —
  // by a writer, by the board, or by Tekmetric's schedule (stored appointment or schedule archive) — carries to today's
  // same row and tech every day until the RO is closed (leaves WIP) or done/100%. A writer drag out of the row wins;
  // a Tekmetric appointment today or later wins (that ticket is placed from the appointment instead).
  const frontCarry = new Map<string, { date: string; row: number; tech: string | null }>(); // parent RO → latest past front-row parking
  const noteCarry = (ro: string, date: string, startMinute: number | null, tech: string | null) => {
    if (!ro || startMinute === null || startMinute >= 0 || date >= days[0]) return;
    const row = startMinute < -60 ? FRONT_OFFICE_MINUTE : -60;
    const had = frontCarry.get(ro);
    if (!had || date >= had.date) frontCarry.set(ro, { date, row, tech: tech && techSet.has(tech) ? tech : had?.tech ?? null });
  };
  for (const appt of options.pastAppointments ?? []) {
    for (const order of orders) { const ro = parentOf(order);
      if (new RegExp(`(^|\\D)${ro}(\\D|$)`).test(appt.text)) noteCarry(ro, appt.date, appt.startMinute, findTech(appt.employee)); }
  }
  for (const appt of options.tekSchedule ?? []) noteCarry(appt.ro, appt.date, appt.startMinute, appt.tech);
  for (const row of existing) if (!row.hidden && !row.custom) noteCarry(row.roNumber || parentRoOf(row.ro), row.laneDate, row.startMinute, row.tech);
  const movedOutLater = (ro: string) => { const old = prior.get(ro);
    return Boolean(old && !old.hidden && old.placedBy === "writer" && old.startMinute >= 0 && old.laneDate >= days[0]); };
  const carried = (item: { order: BoardRepairOrder }) => frontCarry.has(parentOf(item.order)) && !isDone(item.order.roNumber)
    && !writerOut(item.order.roNumber) && !movedOutLater(item.order.roNumber);
  const frontRow = candidates.filter((item) => !hiddenRos.has(item.order.roNumber) && !tekByRo.has(parentOf(item.order))
    && (writerIn(item.order.roNumber) || carried(item) || (finishedDiag(item) && !writerOut(item.order.roNumber))));
  const diagDoneKeys = new Set(frontRow.map((item) => item.order.roNumber));
  for (const { order } of frontRow) {
    const old = prior.get(order.roNumber);
    const base = build(order, "front-office");
    const carry = frontCarry.get(parentOf(order));
    const tech = old && techSet.has(old.tech) ? old.tech : carry?.tech ? carry.tech : base.assignedTech && techSet.has(base.assignedTech) ? base.assignedTech : UNASSIGNED;
    const row = writerIn(order.roNumber) ? prior.get(order.roNumber)!.startMinute : old && old.startMinute < 0 ? old.startMinute : carry ? carry.row : FRONT_OFFICE_MINUTE;
    result.push({ ...base, tech, laneDate: days[0], position: 0, startMinute: row, pinned: writerIn(order.roNumber), carriedOver: Boolean(carry),
      placedBy: writerIn(order.roNumber) ? "writer" : "auto", inDiagBlock: false });
  }
  const live = candidates.filter((item) => !diagDoneKeys.has(item.order.roNumber) && !hiddenRos.has(item.order.roNumber)
    && (finishedDiag(item) ? writerOut(item.order.roNumber) : !isDone(item.order.roNumber)))
    .map((item) => (finishedDiag(item) ? { ...item, kind: "ready" as JobKind } : item))
    .map((item) => apptByRo.get(item.order.roNumber)?.preset ? { ...item, kind: "preset" as JobKind } : item);
  const today = days[0];
  const placed = new Set<string>();
  // v1.6.16: a writer's hand-made block for the same RO (and job, when its title names one) stands in for a new job — no duplicate.
  if (options.autoPlace) {
    const handBlocks = existing.filter((row) => row.custom && !row.hidden && row.laneDate >= today && blockRo(row));
    const unitsPerRo = new Map<string, number>();
    for (const item of live) unitsPerRo.set(parentOf(item.order), (unitsPerRo.get(parentOf(item.order)) ?? 0) + 1);
    for (const item of live) {
      if (prior.has(item.order.roNumber)) continue;
      const ro = parentOf(item.order);
      const name = String(item.order.jobName || "").toLowerCase();
      if (handBlocks.some((row) => blockRo(row) === ro && (unitsPerRo.get(ro) === 1 || !name || String(row.title || "").toLowerCase().includes(name)))) placed.add(item.order.roNumber);
    }
  }
  const byAge = (a: BoardRepairOrder, b: BoardRepairOrder) => (Number(b.ageDays) || 0) - (Number(a.ageDays) || 0)
    || Number(a.parentRo ?? a.roNumber) - Number(b.parentRo ?? b.roNumber) || (a.jobOrder ?? 0) - (b.jobOrder ?? 0);
  const byPromise = (a: BoardRepairOrder, b: BoardRepairOrder) => {
    const pa = a.promisedAt ? Date.parse(a.promisedAt) : Infinity;
    const pb = b.promisedAt ? Date.parse(b.promisedAt) : Infinity;
    return (pa === pb ? 0 : pa < pb ? -1 : 1) || byAge(a, b);
  };
  const openMinutes = (tech: string, day: string) => {
    const cap = capacity(tech);
    const used = slot(tech, day).intervals.reduce((sum, item) => sum + Math.max(0, Math.min(item.end, dayWallLimit(cap.dayMinutes)) - item.start), 0);
    return dayWallLimit(cap.dayMinutes) - used;
  };
  type Base = ReturnType<typeof build>;
  /**
   * v1.6.10: a block that runs past 5 PM continues on the tech's next shop day(s) from 8 AM (in open time, never on top
   * of another block), as "(cont.)" segments keyed `<key>~2`, `<key>~3`… Lunch is skipped as always.
   */
  const commit = (base: Base, tech: string, day: string, start: number, length: number, extra: Partial<BoardJob> = {}, advance = true) => {
    const dayEnd = tech === UNASSIGNED ? Infinity : dayWallLimit(capacity(tech).dayMinutes || 480);
    if (tech === UNASSIGNED || start < 0 || base.status === "diag" || wallEnd(start, length) <= dayEnd) return commitOne(base, tech, day, start, length, extra, advance);
    const first = Math.max(15, workBetween(clampStart(start), dayEnd));
    commitOne(base, tech, day, start, first, extra, advance);
    let left = length - first;
    let segment = 2;
    for (const next of days.filter((value) => value > day)) {
      if (left <= 0) break;
      const busy = [...slot(tech, next).intervals, ...roSpans(base.roNumber, next)].sort((a, b) => a.start - b.start);
      let at = 0;
      for (let guard = 0; guard < 60 && left > 0 && at < dayEnd; guard += 1) {
        at = clampStart(at);
        const hit = busy.find((item) => item.start <= at && item.end > at);
        if (hit) { at = hit.end; continue; }
        const nextBusy = busy.find((item) => item.start > at)?.start ?? dayEnd;
        const room = workBetween(at, Math.min(nextBusy, dayEnd));
        if (room < 15) { at = Math.min(nextBusy, dayEnd); continue; }
        const piece = Math.min(left, room);
        commitOne({ ...base, ro: `${base.ro}~${segment}`, jobName: `${base.jobName || `RO#${base.roNumber}`} (cont.)` }, tech, next, at, piece,
          { ...extra, carriedOver: true, pinned: false, placedBy: "auto" }, false);
        busy.push({ start: at, end: wallEnd(at, piece) }); busy.sort((a, b) => a.start - b.start);
        left -= piece; segment += 1; at = wallEnd(at, piece);
      }
    }
    if (left > 0) { const last = result[result.length - 1]; last.durationMinutes += left; } // past the 10-day horizon
  };
  const commitOne = (base: Base, tech: string, day: string, start: number, length: number, extra: Partial<BoardJob> = {}, advance = true) => {
    const end = wallEnd(start, length);
    const target = slot(tech, day);
    target.intervals.push({ start, end });
    if (tech !== UNASSIGNED) roSpans(base.roNumber, day).push({ start, end });
    if (tech !== UNASSIGNED) { const list = roPlaced.get(base.roNumber) ?? []; list.push({ order: base.jobOrder, day, end }); roPlaced.set(base.roNumber, list); }
    if (advance && base.status !== "diag") target.cursor = Math.max(target.cursor, end);
    placed.add(base.ro);
    const old = prior.get(base.ro);
    result.push({ ...base, durationMinutes: length, tech, laneDate: day, position: 0, startMinute: start,
      // `pinned` persists the writer's drag as a preference for the next rebuild; it never locks the job.
      pinned: Boolean(old?.pinned), placedBy: old?.pinned ? "writer" : "auto", inDiagBlock: base.status === "diag", ...extra });
  };
  /** Try one tech/day: diag only inside 8–10, everything else from 10 AM (or a later preferred start) to 5 PM. */
  const tryPlace = (base: Base, tech: string, day: string, from: number, extra: Partial<BoardJob> = {}, advance = true) => {
    const own = slot(tech, day);
    const target = { intervals: [...own.intervals, ...roSpans(base.roNumber, day)], cursor: own.cursor };
    const diagJob = base.status === "diag";
    const length = diagJob ? Math.min(base.durationMinutes, DIAG_END - DIAG_START) : base.durationMinutes;
    const limit = capacity(tech).dayMinutes;
    const start = diagJob
      ? firstFitWindow(target, Math.max(DIAG_START, Math.min(from, DIAG_END)), length, DIAG_END) ?? firstFitWindow(target, DIAG_START, length, DIAG_END)
      : firstFit(target, Math.max(DIAG_END, from), length, limit, true, DIAG_END)
        ?? (from > DIAG_END ? firstFit(target, DIAG_END, length, limit, true, DIAG_END) : null);
    if (start === null) return false;
    commit(base, tech, day, start, length, extra, advance);
    return true;
  };
  // v1.6.16 auto-place. Applies to approved jobs the board hasn't placed on a tech yet (new, or waiting in the pool / Needs
  // placing unpinned), never to a writer's parked or dragged block, and not before a later Tekmetric appointment day.
  const autoPlaceable = (order: BoardRepairOrder, old: ExistingRow | undefined) => {
    const appt = apptByRo.get(order.roNumber);
    if (appt && appt.date > today) return false;
    return !old || (!old.pinned && (old.tech === UNASSIGNED || Boolean(old.needsPlacing) || Boolean(old.autoPlaced)));
  };
  const autoPlaceJob = (order: BoardRepairOrder, base: Base, old: ExistingRow | undefined) => {
    const category = jobCategory(order.jobName || "", order.label || "", base.status === "diag");
    const chart = eligibleTechs(category, activeTechs);
    const choices = base.assignedTech ? [base.assignedTech]
      : [...chart].sort((a, b) => chart.indexOf(a) - chart.indexOf(b) || openMinutes(b, today) - openMinutes(a, today));
    const seq = roNext(base.roNumber, base.jobOrder);
    if (choices.length && !(seq && seq.day > today)) {
      const after = seq && seq.day === today ? seq.end : 0;
      // An auto block that was already on a tech today keeps that tech first (no hopping between syncs).
      const ordered = old?.autoPlaced && old.laneDate === today && choices.includes(old.tech) ? [old.tech, ...choices.filter((t) => t !== old.tech)] : choices;
      for (const tech of ordered) if (tryPlace(base, tech, today, Math.max(slot(tech, today).cursor, after), { autoPlaced: true, needsPlacing: null }, after <= slot(tech, today).cursor)) return;
    }
    const why = !choices.length ? (category === "hybrid" ? "Hybrid/EV — Devin only, not on the board" : `No tech on the skill chart for ${category} work`)
      : base.assignedTech ? `${base.assignedTech}'s day is full` : `No open slot today for ${category} work`;
    result.push({ ...base, tech: UNASSIGNED, laneDate: today, position: 0, startMinute: 0, pinned: false, placedBy: "auto", inDiagBlock: false, needsPlacing: why });
    placed.add(order.roNumber);
  };
  /** Writer drag = a preference (tech, day, order), never a lock: try there first, then reflow like any job. */
  const place = (order: BoardRepairOrder, kind: JobKind) => {
    const base = build(order, kind);
    const old = prior.get(order.roNumber);
    const appt = apptByRo.get(order.roNumber);
    if (kind === "waiting") { // pool-only until its Tekmetric status changes; never auto-scheduled (nor kept on a tech by a drag)
      result.push({ ...base, tech: UNASSIGNED, laneDate: today, position: 0, startMinute: 0, pinned: false, placedBy: "auto", inDiagBlock: false });
      placed.add(order.roNumber); return;
    }
    if (old?.pinned && old.tech === UNASSIGNED) { // a writer parked it in Unassigned (open pool): it stays there
      result.push({ ...base, tech: UNASSIGNED, laneDate: old.laneDate >= today ? old.laneDate : today, position: 0, startMinute: 0,
        pinned: true, placedBy: "writer", inDiagBlock: false });
      placed.add(order.roNumber); return;
    }
    if (old?.pinned && old.tech !== UNASSIGNED && techSet.has(old.tech) && old.laneDate >= today
      && tryPlace(base, old.tech, old.laneDate, old.startMinute, {}, false)) return;
    if (options.autoPlace && autoPlaceable(order, old)) { autoPlaceJob(order, base, old); return; }
    // Open pool = Tekmetric's Unassigned jobs: not auto-given to a tech (a writer drag or approved request still can).
    if (order.tekUnassigned && !(old?.pinned && techSet.has(old.tech))) {
      result.push({ ...base, tech: UNASSIGNED, laneDate: today, position: 0, startMinute: 0, pinned: false, placedBy: "auto", inDiagBlock: false });
      placed.add(order.roNumber); return;
    }
    // A writer's chosen tech (drag or approved request) beats the Tekmetric card's tech.
    const preferredTech = (old?.pinned && techSet.has(old.tech) ? old.tech : null) ?? base.assignedTech
      ?? (appt?.tech && techSet.has(appt.tech) ? appt.tech : null);
    for (const day of days) {
      if (appt && day < appt.date) continue; // not before the vehicle's appointment day
      const choices = preferredTech ? [preferredTech] : [...activeTechs.map((tech) => tech.initials)]
        .sort((a, b) => openMinutes(b, day) - openMinutes(a, day));
      // Same RO: this job starts after the RO's earlier job ends (Tekmetric job order).
      const seq = roNext(base.roNumber, base.jobOrder);
      if (seq && day < seq.day) continue;
      const after = seq && day === seq.day ? seq.end : 0;
      // When the same-car rule pushes it later, the tech's earlier gap stays open for other work.
      for (const tech of choices) if (tryPlace(base, tech, day, Math.max(slot(tech, day).cursor, after), {}, after <= slot(tech, day).cursor)) return;
    }
    result.push({ ...base, tech: UNASSIGNED, laneDate: days[days.length - 1], position: 0, startMinute: 0,
      pinned: false, placedBy: "auto", inDiagBlock: false });
    placed.add(order.roNumber);
  };

  // Build order, every day: 1) Pre-Set appointments at their set time/tech (a writer's drag of one becomes its
  // new set time), 2) Needs Diag in 8–10, 3) carry-over, 4) Part Arrived, 5) other ready work.
  // T) v1.6.8 Tekmetric schedule: each appointed RO's approved jobs go on the appointment's tech/day, from its start to its
  // end (jobs stacked in Tekmetric order, the block's work time shared by labor hours). 6–7 AM → -120, 7–8 AM → -60,
  // Unassigned → pool. The auto-scheduler never moves these. A writer drag sticks until the appointment changes in Tekmetric.
  const appointed = new Map<string, { order: BoardRepairOrder; kind: JobKind }[]>();
  for (const item of live) { const ro = parentOf(item.order); if (tekByRo.has(ro)) appointed.set(ro, [...(appointed.get(ro) ?? []), item]); }
  // v1.6.9: an RO with appointments for several techs that day: each tech's merged block goes on that tech's appointment.
  const apptGroups: [TekAppointment, { order: BoardRepairOrder; kind: JobKind }[]][] = [];
  for (const [ro, items] of appointed) {
    const first = tekByRo.get(ro)!;
    const sameDay = (options.tekSchedule ?? []).filter((item) => item.ro === ro && item.date === first.date);
    const byAppt = new Map<TekAppointment, { order: BoardRepairOrder; kind: JobKind }[]>();
    for (const item of items) {
      const assigned = (item.order.assignedInitials || []).find((initials) => techSet.has(initials));
      const own = sameDay.length > 1 && assigned ? sameDay.find((appt) => appt.tech === assigned) : undefined;
      const appt = own ?? first;
      byAppt.set(appt, [...(byAppt.get(appt) ?? []), item]);
    }
    for (const entry of byAppt) apptGroups.push(entry);
  }
  for (const [appt, items] of apptGroups) {
    items.sort((a, b) => (a.order.jobOrder ?? 0) - (b.order.jobOrder ?? 0));
    const tech = appt.tech && techSet.has(appt.tech) ? appt.tech : UNASSIGNED;
    const bases = items.map((item) => build(item.order, appt.yellow ? "preset" : item.kind === "preset" ? "ready" : item.kind));
    let cursor = appt.startMinute;
    bases.forEach((base, index) => {
      const old = prior.get(base.ro);
      const extra = { apptKey: appt.key, apptInfo: appt.details || null } as Partial<BoardJob>;
      if (old?.pinned && old.placedBy === "writer" && old.apptKey === appt.key && !old.hidden) { // writer drag, appointment unchanged (v1.6.13: yellow too — Devin's move sticks)
        if (old.startMinute < 0 || old.tech === UNASSIGNED) { result.push({ ...base, tech: old.tech, laneDate: old.laneDate, position: 0, startMinute: old.startMinute,
          pinned: true, placedBy: "writer", inDiagBlock: false, ...extra }); placed.add(base.ro); }
        else commit(base, old.tech, old.laneDate, old.startMinute, old.durationOverrideMinutes ?? base.durationMinutes, { pinned: true, placedBy: "writer", ...extra });
        return;
      }
      if (tech === UNASSIGNED || appt.startMinute < 0) {
        const row = tech === UNASSIGNED ? 0 : appt.startMinute < -60 ? -120 : -60;
        result.push({ ...base, tech, laneDate: appt.date, position: index, startMinute: row, pinned: false, placedBy: "auto", inDiagBlock: false, ...extra });
        placed.add(base.ro); return;
      }
      // v1.6.10: the appointment sets only the tech and start; the length follows the ticket's labor (minus completed work).
      const length = base.durationMinutes;
      commit(base, tech, appt.date, cursor, length, { pinned: Boolean(appt.yellow), placedBy: "auto", ...extra }, false);
      cursor = clampStart(wallEnd(cursor, length));
    });
  }
  // 0) v1.6.7 keepToday: today's placed blocks are the set schedule — same tech, time and length; status/label refresh.
  if (options.keepToday) {
    for (const { order, kind } of live) {
      const old = prior.get(order.roNumber);
      if (placed.has(order.roNumber) || !old || old.hidden || old.custom || old.laneDate !== today || !techSet.has(old.tech) || old.startMinute < 0) continue;
      const base = build(order, kind);
      commit(base, old.tech, today, old.startMinute, old.durationOverrideMinutes ?? base.durationMinutes, // v1.6.10: length follows labor
        { pinned: old.pinned, placedBy: old.placedBy, carriedOver: Boolean(old.carriedOver), autoPlaced: Boolean(old.autoPlaced && old.placedBy === "auto") });
    }
  }
  // 1) Pre-Set appointments are the only fixed blocks.
  for (const { order, kind } of live.filter((item) => item.kind === "preset" && !placed.has(item.order.roNumber))) {
    const old = prior.get(order.roNumber);
    const appt = apptByRo.get(order.roNumber);
    const base = build(order, kind);
    const set = old?.pinned && techSet.has(old.tech) ? { tech: old.tech, day: old.laneDate, start: old.startMinute }
      : appt?.tech && appt.startMinute !== null ? { tech: appt.tech, day: appt.date, start: appt.startMinute } : null;
    if (!set) continue; // no set time: scheduled as ready work below
    let at = clampStart(Math.max(0, set.start));
    for (let guard = 0; guard < 50; guard += 1) { // never on top of another job of the same car
      const hit = roSpans(base.roNumber, set.day).find((span) => at < span.end && wallEnd(at, base.durationMinutes) > span.start);
      if (!hit) break; at = clampStart(hit.end);
    }
    commit(base, set.tech, set.day, at, base.durationMinutes,
      { pinned: true, placedBy: old?.pinned ? "writer" : "auto", inDiagBlock: false }, false);
  }
  const isCarry = (ro: string) => {
    const old = prior.get(ro);
    return Boolean(old && old.tech !== UNASSIGNED && techSet.has(old.tech) && (old.laneDate < today || (old.carriedOver && old.laneDate === today)));
  };
  // Carry-over: same tech, first in line, remaining = hours × (1 − % complete).
  const carryPlace = (order: BoardRepairOrder, kind: JobKind) => {
    const old = prior.get(order.roNumber)!;
    const base = build(order, kind);
    const job = base; // v1.6.10: build() already takes % complete off
    for (const day of days) if (tryPlace(job, old.tech, day, day === today ? 0 : slot(old.tech, day).cursor, { carriedOver: true })) return;
    result.push({ ...job, tech: old.tech, laneDate: today, position: 0, startMinute: kind === "diag" ? 0 : DIAG_END,
      pinned: false, placedBy: "auto", inDiagBlock: kind === "diag", carriedOver: true });
    placed.add(order.roNumber);
  };
  const remaining = () => live.filter((item) => !placed.has(item.order.roNumber));
  // 2) Needs Diag: only 8–10; overflow goes to the next day's 8–10 (carried diags first in line).
  const diag = remaining().filter((item) => item.kind === "diag");
  for (const item of diag.filter((entry) => isCarry(entry.order.roNumber))) carryPlace(item.order, item.kind);
  for (const item of diag.filter((entry) => !placed.has(entry.order.roNumber)).sort((a, b) => byAge(a.order, b.order))) place(item.order, item.kind);
  // 3) Carry-over regular work, oldest first.
  for (const item of remaining().filter((entry) => entry.kind !== "preset" && isCarry(entry.order.roNumber))
    .sort((a, b) => prior.get(a.order.roNumber)!.laneDate.localeCompare(prior.get(b.order.roNumber)!.laneDate)
      || prior.get(a.order.roNumber)!.startMinute - prior.get(b.order.roNumber)!.startMinute)) carryPlace(item.order, item.kind);
  // 4) Part Arrived, then 5) other ready work (incl. Pre-Set with no set time). Writer-moved jobs go first in their group.
  const writerFirst = (a: { order: BoardRepairOrder }, b: { order: BoardRepairOrder }) => {
    const pa = prior.get(a.order.roNumber), pb = prior.get(b.order.roNumber);
    return Number(Boolean(pb?.pinned)) - Number(Boolean(pa?.pinned)) || (pa?.pinned && pb?.pinned ? pa.startMinute - pb.startMinute : 0);
  };
  for (const item of remaining().filter((entry) => entry.kind === "part-arrived").sort((a, b) => writerFirst(a, b) || byAge(a.order, b.order))) place(item.order, item.kind);
  for (const item of remaining().sort((a, b) => writerFirst(a, b) || byPromise(a.order, b.order))) place(item.order, item.kind === "preset" ? "ready" : item.kind);

  // Positions: order within each lane/day by start minute.
  const lanes = new Map<string, BoardJob[]>();
  for (const job of result.filter((item) => !item.hidden && item.status !== "front-office")) {
    const key = `${job.tech}|${job.laneDate}`;
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key)!.push(job);
  }
  for (const jobs of lanes.values()) jobs.sort((a, b) => a.startMinute - b.startMinute).forEach((job, index) => { job.position = index; });
  return result;
}

/** Chicago wall-clock minutes from 8:00 AM for an ISO time (6 AM = -120). */
export function chicagoMinute(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return get("hour") * 60 + get("minute") - 480;
}
/** Map stored appointments to board techs (employee name → tech by full or first name, like the schedule archive). */
export function toTekSchedule(rows: { id: string; roNumber: string; employeeId: string | null; employeeName: string | null; start: string; end: string; updated: string;
  color?: string; customer?: string; title?: string; details?: string }[], techs: { initials: string; name: string }[]): TekAppointment[] {
  const norm = (value: string) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  // v1.6.12: no-RO appointments are kept (they become customer-named blocks).
  return rows.filter((row) => row.roNumber || row.customer || row.title).map((row) => {
    const name = norm(row.employeeName || "");
    const tech = name ? techs.find((item) => norm(item.name) === name || norm(item.name).split(" ")[0] === name.split(" ")[0])?.initials ?? null : null;
    return { id: row.id, ro: row.roNumber, tech, date: chicagoDate(new Date(row.start)), startMinute: chicagoMinute(row.start), endMinute: chicagoMinute(row.end),
      key: `${isYellow(row.color) ? "Y|" : ""}${[row.id, row.updated, row.start, row.end, row.employeeId ?? ""].join("|")}`,
      color: row.color || "", yellow: isYellow(row.color), customer: row.customer || "", title: row.title || "", details: row.details || "" };
  });
}

/** v1.6.16: one block on a tech's day, for the ripple. `locked` = a yellow Tekmetric appointment (never pushed). */
export type LaneBlock = { key: string; tech: string; laneDate: string; startMinute: number; durationMinutes: number; locked?: boolean; hidden?: boolean };
export type RippleMove = { key: string; from: number; startMinute: number; overflow: boolean };
/**
 * v1.6.16 ripple: after `movedKey` was moved/resized, push the later blocks on the same tech's day that now overlap it
 * (or each other) later, keeping their order and hopping over locked yellow appointments and `busy` time (time off).
 * Only pushes — never pulls work earlier. A block that ends past the day (5 PM + lunch) is flagged `overflow`, never dropped.
 */
export function ripple(blocks: LaneBlock[], movedKey: string, options: { dayMinutes?: number; busy?: { start: number; end: number }[] } = {}): RippleMove[] {
  const moved = blocks.find((block) => block.key === movedKey);
  if (!moved || moved.hidden || moved.tech === UNASSIGNED || moved.startMinute < 0) return [];
  const lane = blocks.filter((block) => block.key !== movedKey && !block.hidden && block.tech === moved.tech && block.laneDate === moved.laneDate && block.startMinute >= 0);
  const fixed = [...lane.filter((block) => block.locked).map((block) => ({ start: block.startMinute, end: wallEnd(block.startMinute, block.durationMinutes) })), ...(options.busy ?? [])]
    .sort((a, b) => a.start - b.start);
  const fit = (from: number, duration: number) => {
    let at = clampStart(from);
    for (let guard = 0; guard < 100; guard += 1) {
      const hit = fixed.find((item) => at < item.end && wallEnd(at, duration) > item.start);
      if (!hit) break;
      at = clampStart(hit.end);
    }
    return at;
  };
  const limit = dayWallLimit(options.dayMinutes ?? 480);
  const movers = lane.filter((block) => !block.locked && block.startMinute >= moved.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute || a.key.localeCompare(b.key));
  const changes: RippleMove[] = [];
  let cursor = wallEnd(moved.startMinute, moved.durationMinutes);
  for (const block of movers) {
    if (block.startMinute >= cursor) { cursor = Math.max(cursor, wallEnd(block.startMinute, block.durationMinutes)); continue; }
    const start = fit(cursor, block.durationMinutes);
    const end = wallEnd(start, block.durationMinutes);
    if (start !== block.startMinute) changes.push({ key: block.key, from: block.startMinute, startMinute: start, overflow: end > limit });
    cursor = end;
  }
  return changes;
}
