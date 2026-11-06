// v1.6.16: Delta Auto tech skill chart, used only when Tekmetric has no tech on an approved job (auto-place).
// Pure (no React/Cloudflare) so it is unit-testable.

export type SkillLevel = "master" | "b" | "c";
/** By first name (lower case). Master = Devin, Stacy, Andrew; B = Mike, Beau; C = Mario. Hybrid/EV = Devin only. */
export const SKILL_CHART: Record<string, SkillLevel> = { devin: "master", stacy: "master", andrew: "master", mike: "b", beau: "b", mario: "c" };
export const HYBRID_ONLY = "devin";

export type JobCategory = "hybrid" | "hvac" | "electrical" | "drivability" | "light-diag" | "diag" | "b-work" | "c-work" | "general";

const HYBRID = /hybrid|\bev\b|high.?voltage|\bhv\b|electric vehicle|inverter/i;
const HVAC = /\ba\/?c\b|hvac|air cond|freon|refrigerant|r-?134|1234yf|compressor|evap|condenser|heater core|blend door|climate|no (heat|cold)/i;
const ELECTRICAL = /electric|wiring|harness|short|parasitic|\bdraw\b|module|\b[ebpt]cm\b|no.?comm|communication|u0\d{3}|no.?start|no.?crank|charging system|program/i;
const DRIVABILITY = /drivab|misfire|check engine|\bcel\b|\bmil\b|rough (idle|run)|runs rough|stall|hesitat|lack of power|\bp[0-3]\d{3}\b|surge|emission/i;
const DIAG = /diag|inspect|test|courtesy check|^cc\b|check.?out|evaluate/i;
const LIGHT_DIAG = /leak|pressure|visual|noise|brake|cool|smoke test|fluid/i;
const C_WORK = /oil change|\blof\b|lube|tire|rotat|balance|battery|filter|wiper|check.?in|courtesy|fluid (top|check)|flat|bulb/i;
const B_WORK = /brake|rotor|pad|caliper|cool|radiator|water pump|thermostat|hose|gasket|seal|leak|valve cover|oil pan|timing|belt|suspension|strut|shock|control arm|tie rod|ball joint|bearing|\bhub\b|starter|alternator|exhaust|mount|r ?& ?r|replace|flush/i;

/** Category of one Tekmetric job (job name + RO label). Electrical/drivability matter mostly as diags; HVAC always. */
export function jobCategory(name: string, label = "", diag = false): JobCategory {
  const text = `${name || ""} ${label || ""}`;
  const isDiag = diag || DIAG.test(name || "");
  if (HYBRID.test(text)) return "hybrid";
  if (HVAC.test(text)) return "hvac";
  if (isDiag && DRIVABILITY.test(text)) return "drivability";
  if (isDiag && ELECTRICAL.test(text)) return "electrical";
  if (!isDiag && /wiring|harness|parasitic|program/i.test(text)) return "electrical";
  if (isDiag) return LIGHT_DIAG.test(text) ? "light-diag" : "diag";
  if (C_WORK.test(name || "")) return "c-work";
  if (B_WORK.test(name || "")) return "b-work";
  return "general";
}

/** Skill levels allowed for a category, cheapest first (so masters stay free for the hard work). */
export function levelsFor(category: JobCategory): SkillLevel[] {
  switch (category) {
    case "hvac": case "electrical": case "drivability": case "diag": return ["master"];
    case "light-diag": case "b-work": case "general": return ["b", "master"]; // C-level beyond lube/tires needs Devin's OK
    case "c-work": return ["c", "b", "master"];
    case "hybrid": return ["master"]; // and only Devin — see eligibleTechs
  }
}

export const levelOf = (name: string): SkillLevel | null => SKILL_CHART[String(name || "").trim().split(/\s+/)[0].toLowerCase()] ?? null;

/** Board techs (initials) who may take this job, in preference order (lowest qualified level first). */
export function eligibleTechs(category: JobCategory, techs: { initials: string; name: string }[]): string[] {
  if (category === "hybrid") return techs.filter((tech) => String(tech.name).trim().split(/\s+/)[0].toLowerCase() === HYBRID_ONLY).map((tech) => tech.initials);
  const levels = levelsFor(category);
  return levels.flatMap((level) => techs.filter((tech) => levelOf(tech.name) === level).map((tech) => tech.initials));
}
