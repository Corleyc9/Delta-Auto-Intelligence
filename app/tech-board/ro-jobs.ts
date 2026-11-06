// Job-level data (tech + labor hours per Tekmetric job). Pure, unit-testable.
// Sources, read-only: (1) `jobs` sent by the reader with each job-board RO, (2) Tekmetric webhook payloads
// (repair-order objects carry jobs[] with name, technicianId/technician, laborHours and labor[].hours).
import type { RoJob } from "./scheduler";

type Tech = { initials: string; name: string };
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function techFrom(job: Record<string, unknown>, techs: Tech[], employees: Record<string, string>) {
  const direct = String(job.techInitials ?? job.technicianInitials ?? "").toUpperCase();
  const person = (job.technician ?? job.tech) as Record<string, unknown> | string | undefined;
  let name = typeof person === "string" ? person
    : person ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || String(person.name ?? "") : "";
  if (!name && job.technicianId !== undefined && job.technicianId !== null) name = employees[String(job.technicianId)] ?? "";
  if (!name) {
    const labor = Array.isArray(job.labor) ? job.labor as Record<string, unknown>[] : [];
    const id = labor.find((row) => row.technicianId)?.technicianId;
    if (id !== undefined) name = employees[String(id)] ?? "";
  }
  const value = name.toLowerCase().replace(/\s+/g, " ").trim();
  // The roster match by Tekmetric name wins; reader-derived initials are only a fallback.
  const byName = value ? techs.find((tech) => tech.name.toLowerCase() === value)?.initials : undefined;
  if (byName) return byName;
  if (direct && techs.some((tech) => tech.initials === direct)) return direct;
  if (!value) return null;
  return techs.find((tech) => tech.name.toLowerCase() === value || tech.initials.toLowerCase() === value
    || tech.name.toLowerCase().split(" ")[0] === value.split(" ")[0])?.initials ?? null;
}

/** The job's tech name as given (null = no tech on the job, i.e. Tekmetric's Unassigned). */
function techName(job: Record<string, unknown>): string | null {
  const person = (job.technician ?? job.tech) as Record<string, unknown> | string | null | undefined;
  if (typeof person === "string") return person.trim() || null;
  if (person && typeof person === "object") return `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || String(person.name ?? "") || null;
  if (job.technicianId !== undefined && job.technicianId !== null) return `#${job.technicianId}`;
  const labor = Array.isArray(job.labor) ? job.labor as Record<string, unknown>[] : [];
  const id = labor.find((row) => row.technicianId)?.technicianId;
  return id !== undefined && id !== null ? `#${id}` : (job.techInitials ? String(job.techInitials) : null);
}

/** Normalise a jobs[] array (reader or Tekmetric API shape). Declined/unauthorized jobs are dropped. */
export function normalizeJobs(raw: unknown, techs: Tech[], employees: Record<string, string> = {}): RoJob[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => item as Record<string, unknown>)
    .filter((job) => job && job.authorized !== false && String(job.status ?? "").toLowerCase() !== "declined")
    .map((job, index) => {
      const labor = Array.isArray(job.labor) ? job.labor as Record<string, unknown>[] : [];
      const laborHours = labor.reduce((sum, row) => sum + num(row.hours), 0);
      // Hours are decimal hours in both sources (Tekmetric laborHours / labor[].hours), never tenths or minutes.
      const hours = num(job.hours) || num(job.laborHours) || laborHours;
      return {
        jobId: String(job.jobId ?? job.id ?? index + 1), name: String(job.name ?? job.jobName ?? `Job ${index + 1}`).slice(0, 80),
        techInitials: techFrom(job, techs, employees), hours: Math.round(hours * 100) / 100,
        order: num(job.order ?? job.sort ?? job.sortOrder ?? job.jobOrder) || index + 1,
        completed: Boolean(job.completed) || String(job.status ?? "").toLowerCase() === "completed",
        technician: techName(job),
        // Approved: Tekmetric authorized=true, or reader jobs from Tekmetric's Tech Board (approved jobs only).
        approved: job.authorized === true || job.approved === true,
        loggedSeconds: job.loggedSeconds === null || job.loggedSeconds === undefined || !Number.isFinite(Number(job.loggedSeconds)) ? null : Number(job.loggedSeconds),
      };
    });
}

/** Find the jobs[] array inside a webhook payload (top level, data, repairOrder…). */
export function jobsFromPayload(payload: unknown): unknown[] | null {
  const queue: unknown[] = [payload];
  for (let guard = 0; queue.length && guard < 40; guard += 1) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.jobs) && record.jobs.some((job) => job && typeof job === "object")) return record.jobs;
    for (const key of ["data", "repairOrder", "repair_order", "payload", "body"]) if (record[key]) queue.push(record[key]);
  }
  return null;
}
