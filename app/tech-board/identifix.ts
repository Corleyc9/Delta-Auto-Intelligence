// v1.6.17: Identifix lookup requests. The RO button queues a request; the assistant (Teams bot key) claims it, runs Identifix
// Direct-Hit in a browser, and posts results back. Pure (no React/Cloudflare) so it is unit-testable. Board D1 only — never Tekmetric.
import { normalizeDtcs } from "./dtc.ts";

export const IDENTIFIX_RESULTS_LABEL = "Check-in scan — Identifix known fixes (triage, not a diagnosis)";
export const IDENTIFIX_STATUSES = ["queued", "in-progress", "done", "failed"] as const;
export type IdentifixStatus = typeof IDENTIFIX_STATUSES[number];
export type IdentifixVehicle = { year: string; make: string; model: string; engine: string; vin: string; text: string };
export type IdentifixFix = { fix: string; count: number | null; note: string };
export type IdentifixTsb = { id: string; title: string };
export type IdentifixResult = { confirmedFixes: IdentifixFix[]; testSteps: string[]; tsbs: IdentifixTsb[]; source: string; notes: string };
export type IdentifixRequest = {
  id: number; ro: string; customer: string; vehicle: IdentifixVehicle; codes: string[]; symptom: string; status: IdentifixStatus;
  requestedBy: string; requestedAt: string; claimedBy: string; claimedAt: string; finishedAt: string; failReason: string; result: IdentifixResult | null;
};

const s = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
export const roNumber = (value: unknown) => String(value ?? "").replace(/\D/g, "").slice(0, 12);

/** Validate a writer's request body → a new request (or an error). Needs an RO and at least one code or a symptom. */
export function newIdentifixRequest(body: Record<string, unknown>): { ro: string; customer: string; vehicle: IdentifixVehicle; codes: string[]; symptom: string } | { error: string } {
  const ro = roNumber(body.ro);
  if (!ro) return { error: "Identifix lookup needs an RO number" };
  const codes = normalizeDtcs(body.codes);
  const symptom = s(body.symptom, 500);
  if (!codes.length && !symptom) return { error: "Add a code (e.g. P0301) or a symptom note" };
  const v = (body.vehicle && typeof body.vehicle === "object" ? body.vehicle : {}) as Record<string, unknown>;
  const pick = (key: string) => s(v[key] ?? body[key], 80);
  const vehicle = { year: pick("year"), make: pick("make"), model: pick("model"), engine: pick("engine"), vin: pick("vin").toUpperCase().slice(0, 17),
    text: s(v.text ?? (typeof body.vehicle === "string" ? body.vehicle : ""), 200) };
  if (!vehicle.text) vehicle.text = [vehicle.year, vehicle.make, vehicle.model, vehicle.engine].filter(Boolean).join(" ");
  return { ro, customer: s(body.customer, 120), vehicle, codes, symptom };
}

/** Validate the bot's post-identifix-result body. */
export function parseIdentifixResult(body: Record<string, unknown>): IdentifixResult | { error: string } {
  const list = (value: unknown) => (Array.isArray(value) ? value : []).slice(0, 30);
  const confirmedFixes = list(body.confirmedFixes).map((item) => {
    const row = (item && typeof item === "object" ? item : { fix: item }) as Record<string, unknown>;
    const n = Number(row.count);
    return { fix: s(row.fix, 300), count: row.count === undefined || row.count === null || row.count === "" || !Number.isFinite(n) ? null : Math.max(0, Math.round(n)), note: s(row.note, 500) };
  }).filter((item) => item.fix);
  const testSteps = list(body.testSteps).map((step) => s(step, 600)).filter(Boolean);
  const tsbs = list(body.tsbs).map((item) => {
    const row = (item && typeof item === "object" ? item : { title: item }) as Record<string, unknown>;
    return { id: s(row.id, 60), title: s(row.title, 300) };
  }).filter((item) => item.id || item.title);
  const notes = s(body.notes, 2000);
  if (!confirmedFixes.length && !testSteps.length && !tsbs.length && !notes) return { error: "post-identifix-result needs confirmedFixes, testSteps, tsbs or notes" };
  return { confirmedFixes: confirmedFixes.sort((a, b) => (b.count ?? -1) - (a.count ?? -1)), testSteps, tsbs, source: s(body.source, 80) || "Identifix Direct-Hit", notes };
}

/** JSON body POSTed to IDENTIFIX_REQUEST_WEBHOOK_URL when a request is created. */
export const webhookBody = (req: Pick<IdentifixRequest, "id" | "ro" | "codes" | "vehicle">) => ({ id: req.id, ro: req.ro, codes: req.codes, vehicle: req.vehicle });

/** Short card status line. */
export function requestStatusText(req: IdentifixRequest | null | undefined) {
  if (!req) return "";
  if (req.status === "queued") return "Identifix lookup requested… (queued)";
  if (req.status === "in-progress") return "Identifix lookup requested… (in progress)";
  if (req.status === "failed") return `Identifix lookup failed${req.failReason ? `: ${req.failReason}` : ""}`;
  return "Identifix results ready";
}

/** Latest request per RO (by id). */
export function latestByRo(requests: IdentifixRequest[]) {
  const map = new Map<string, IdentifixRequest>();
  for (const req of requests) if (!map.has(req.ro) || map.get(req.ro)!.id < req.id) map.set(req.ro, req);
  return map;
}

/** Split board vehicle text "2012 GMC Sierra 1500 5.3L" → year / make / model (rest). Engine/VIN come from the form. */
export function splitVehicle(text: string) {
  const m = String(text || "").trim().match(/^((?:19|20)\d{2})\s+(\S+)\s*(.*)$/);
  return m ? { year: m[1], make: m[2], model: m[3] } : { year: "", make: "", model: String(text || "").trim() };
}

