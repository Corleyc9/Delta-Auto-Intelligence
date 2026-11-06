// v1.6.18: Bay Scan scanner boxes (Pi + OBDLink). Pure (no React/Cloudflare) so it is unit-testable.
// Scoped device key BAYSCAN_DEVICE_KEY is accepted ONLY by POST /api/bayscan/scan — it grants nothing else.
// A scan is triage, not a diagnosis. Board D1 only — never Tekmetric.
import { normalizeDtcs } from "./dtc.ts";

export const BAYSCAN_LABEL = "Check-in scan (triage, not a diagnosis)";
export const DEVICE_HEADER = "x-bayscan-device";
const s = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

function timingSafeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * BAYSCAN_DEVICE_KEY formats:
 *  - one shared key: "<key>" (any device id allowed)
 *  - per device: "bay1:<key1>,bay2:<key2>" or JSON {"bay1":"<key1>","bay2":"<key2>"}
 * The device id comes from the x-bayscan-device header (falls back to body deviceId).
 */
export function parseDeviceKeys(secret: unknown): { shared: string; devices: Map<string, string> } {
  const raw = typeof secret === "string" ? secret.trim() : "";
  const devices = new Map<string, string>();
  if (!raw) return { shared: "", devices };
  if (raw.startsWith("{")) {
    try { for (const [id, key] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) if (id && typeof key === "string" && key.trim()) devices.set(id.trim().toLowerCase(), key.trim()); }
    catch { /* invalid JSON → disabled */ }
    return { shared: "", devices };
  }
  if (/^[A-Za-z0-9_.-]{1,40}:[^,]+(,[A-Za-z0-9_.-]{1,40}:[^,]+)*$/.test(raw)) {
    for (const part of raw.split(",")) { const i = part.indexOf(":"); devices.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()); }
    return { shared: "", devices };
  }
  return { shared: raw, devices };
}

/** null = allowed; otherwise an error Response. Never echoes the key. */
export function deviceAuth(authorization: string | null, deviceId: string, secret: unknown): Response | null {
  const { shared, devices } = parseDeviceKeys(secret);
  if (!shared && !devices.size) return Response.json({ error: "Bay Scan is disabled (BAYSCAN_DEVICE_KEY is not set)" }, { status: 503 });
  const match = String(authorization || "").match(/^Bearer\s+(.+)$/i);
  const given = match ? match[1].trim() : "";
  const id = deviceId.trim().toLowerCase();
  const expected = devices.size ? (devices.get(id) ?? "") : shared;
  if (!given || !expected || !timingSafeEqual(given, expected)) return Response.json({ error: "Invalid device key" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  return null;
}

export const normalizeVin = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);

export type ScanCode = { code: string; status: "stored" | "pending" | "permanent"; desc: string };
export type ScanModule = { name: string; addr: string; codes: ScanCode[] };
export type BayScan = { deviceId: string; vin: string; odometer: number | null; protocol: string; scannedAt: string; battery: number | null;
  modules: ScanModule[]; milOn: boolean; readinessSummary: string };

export function parseScan(body: Record<string, unknown>, headerDevice = ""): BayScan | { error: string } {
  const deviceId = s(headerDevice || body.deviceId, 40);
  if (!deviceId) return { error: "deviceId is required" };
  const vin = normalizeVin(body.vin);
  if (!validVin(vin)) return { error: "vin must be a 17-character VIN" };
  const modules = (Array.isArray(body.modules) ? body.modules : []).slice(0, 80).map((item) => {
    const m = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const codes = (Array.isArray(m.codes) ? m.codes : []).slice(0, 60).map((c) => {
      const row = (c && typeof c === "object" ? c : { code: c }) as Record<string, unknown>;
      const status = String(row.status || "stored").toLowerCase();
      return { code: normalizeDtcs(row.code)[0] ?? "", status: (["stored", "pending", "permanent"].includes(status) ? status : "stored") as ScanCode["status"], desc: s(row.desc, 200) };
    }).filter((c) => c.code);
    return { name: s(m.name, 60) || "Module", addr: s(m.addr, 20), codes };
  });
  const odo = Number(body.odometer); const bat = Number(body.battery);
  const scannedAt = s(body.scannedAt, 40);
  return { deviceId, vin, odometer: body.odometer === undefined || body.odometer === null || !Number.isFinite(odo) ? null : Math.max(0, Math.round(odo)),
    protocol: s(body.protocol, 60), scannedAt: scannedAt && !Number.isNaN(Date.parse(scannedAt)) ? scannedAt : new Date().toISOString(),
    battery: body.battery === undefined || body.battery === null || !Number.isFinite(bat) ? null : Math.max(0, Math.min(100, Math.round(bat))),
    modules, milOn: Boolean(body.milOn), readinessSummary: s(body.readinessSummary, 300) };
}

/** Unique codes across modules (board check-in codes). */
export const scanCodes = (scan: Pick<BayScan, "modules">) => normalizeDtcs(scan.modules.flatMap((m) => m.codes.map((c) => c.code)));

/** Check-in notes text: label + per-module codes with status. */
export function scanNotes(scan: BayScan) {
  const lines = [`${BAYSCAN_LABEL} · Bay Scan ${scan.deviceId} · ${scan.scannedAt}`, `VIN ${scan.vin}${scan.odometer !== null ? ` · ${scan.odometer} mi` : ""}${scan.protocol ? ` · ${scan.protocol}` : ""} · MIL ${scan.milOn ? "ON" : "off"}`];
  for (const m of scan.modules) if (m.codes.length) lines.push(`${m.name}${m.addr ? ` (${m.addr})` : ""}: ${m.codes.map((c) => `${c.code} ${c.status}${c.desc ? ` – ${c.desc}` : ""}`).join("; ")}`);
  if (scan.readinessSummary) lines.push(`Readiness: ${scan.readinessSummary}`);
  return lines.join("\n").slice(0, 2000);
}

export type OpenRo = { ro: string; customer: string; vehicle: string; vin?: string; section?: string; status?: string; posted?: boolean };
/** Open = not closed / posted / paid. */
export const isOpenRo = (ro: OpenRo) => !ro.posted && !/closed|posted|paid/i.test(`${ro.status ?? ""} ${ro.section ?? ""}`);

/** VIN → open ROs. Synced (reader/Tekmetric) VIN first; a writer-entered VIN overrides it for that RO. */
export function matchVin(vin: string, ros: OpenRo[], writerVins: Map<string, string>) {
  return matchScanVin(vin, ros, writerVins).matches;
}

/**
 * v1.6.19: full-VIN match first. Only when no open RO has the full VIN, fall back to the last 6 (serial) against
 * known VINs (catches one mis-read character) and against RO vehicle text — accepted only if exactly one RO fits.
 * `unknownVin` = open ROs with no VIN yet (reader hasn't read it) so the writer list can say so.
 */
export function matchScanVin(vin: string, ros: OpenRo[], writerVins: Map<string, string>) {
  const target = normalizeVin(vin);
  const open = ros.filter(isOpenRo);
  const known = (ro: OpenRo) => normalizeVin(writerVins.get(ro.ro) || ro.vin);
  if (!validVin(target)) return { matches: [] as OpenRo[], by: "none" as const, unknownVin: 0 };
  const full = open.filter((ro) => known(ro) === target);
  const unknownVin = open.filter((ro) => !validVin(known(ro))).length;
  if (full.length) return { matches: full, by: "vin" as const, unknownVin };
  const last6 = target.slice(-6);
  const partial = open.filter((ro) => { const k = known(ro); return k ? k.slice(-6) === last6 : normalizeVin(ro.vehicle).includes(last6); });
  return partial.length === 1 ? { matches: partial, by: "last6" as const, unknownVin } : { matches: [] as OpenRo[], by: "none" as const, unknownVin };
}

/** Device screen reply. */
export function scanReply(match: OpenRo | null, scanId: number) {
  const last = (name: string) => name.trim().split(/\s+/).pop() || "";
  return match
    ? { matched: true, ro: match.ro, customer: match.customer, vehicle: match.vehicle, scanId, display: `RO ${match.ro} – ${last(match.customer)}`.trim() }
    : { matched: false, ro: null, customer: null, vehicle: null, scanId, display: "Unmatched – pick on board" };
}
