// v1.6.23: the Tech Board asks the shop Mac to run the Bay Scan dongle for one RO.
// Board D1 only. Never creates an RO and never approves, authorizes, sends, or pays.
import {
  matchScanVin, normalizeVin, scanCodes, scanReply, validVin, type BayScan, type OpenRo, type ScanRequestStatus, type ScanRequestView,
} from "./bayscan.ts";
import { attachScan } from "./bayscan-attach.ts";
import { enqueueMatchedPhotoJobs, publishBayScanAttachment } from "./bayscan-jobs.ts";
import { getScan, loadRoVins, saveScan, setRoVin, wrote } from "./bayscan-store.ts";

type Bound = { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> };
type Stmt = Bound & { bind(...values: unknown[]): Bound };
type Db = { prepare(sql: string): Stmt };
type Bucket = Parameters<typeof publishBayScanAttachment>[2];

export const SCAN_REQUEST_PENDING_MS = 5 * 60 * 1000;
export const SCAN_REQUEST_CLAIM_MS = 10 * 60 * 1000;
const OPEN = ["pending", "claimed", "scanning"];

const clip = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export type ScanRequestRow = {
  id: number; ro: string; roId: string; vin: string; customer: string; vehicle: string; detailUrl: string;
  requestedBy: string; createdAt: string; updatedAt: string; claimedAt: string; status: string;
  reason: string; message: string; scanId: number; vinMismatch: boolean;
};

export function roIdFromDetailUrl(url: unknown) {
  const match = String(url || "").match(/\/repair-orders\/(\d+)/i);
  return match ? match[1] : "";
}

/** The RO the button was pressed on. It must already be on the board or in the synced snapshot. */
export function scanRequestTarget(
  roValue: unknown,
  syncedRos: { ro: string; customer?: string; vehicle?: string; detailUrl?: string; vin?: string }[],
  jobs: { ro: string; roNumber?: string; custom?: boolean; linkedRo?: string | null; hidden?: boolean; customer?: string; vehicle?: string; detailUrl?: string }[],
  writerVin = "",
) {
  const ro = String(roValue || "").replace(/\D/g, "").slice(0, 20);
  if (!ro) return { error: "Bay Scan needs an RO number", status: 400 as const };
  const synced = syncedRos.find((item) => item.ro === ro);
  const job = jobs.find((item) => !item.hidden && (item.custom ? String(item.linkedRo || "") === ro : String(item.roNumber || item.ro) === ro));
  if (!synced && !job) return { error: `RO#${ro} isn't on the board`, status: 404 as const };
  const writer = normalizeVin(writerVin);
  const syncedVin = normalizeVin(synced?.vin);
  const vin = validVin(writer) ? writer : validVin(syncedVin) ? syncedVin : "";
  const detailUrl = String(synced?.detailUrl || job?.detailUrl || "");
  return {
    ro, roId: roIdFromDetailUrl(detailUrl), vin,
    customer: clip(synced?.customer || job?.customer, 120),
    vehicle: clip(synced?.vehicle || job?.vehicle, 160),
    detailUrl: detailUrl.slice(0, 1000),
  };
}

function mapRow(row: Record<string, unknown>): ScanRequestRow {
  return {
    id: Number(row.id), ro: String(row.ro || ""), roId: String(row.ro_id || ""), vin: String(row.vin || ""),
    customer: String(row.customer || ""), vehicle: String(row.vehicle || ""), detailUrl: String(row.detail_url || ""),
    requestedBy: String(row.requested_by || ""), createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
    claimedAt: String(row.claimed_at || ""), status: String(row.status || ""), reason: String(row.reason || ""),
    message: String(row.message || ""), scanId: Number(row.scan_id || 0), vinMismatch: Number(row.vin_mismatch || 0) === 1,
  };
}

function claimShape(row: ScanRequestRow) {
  return { id: row.id, ro: row.ro, roId: row.roId || null, vin: row.vin || null };
}

function before(nowIso: string, ms: number) {
  const now = Date.parse(nowIso);
  return new Date((Number.isFinite(now) ? now : Date.now()) - ms).toISOString();
}

/** Pending expires after 5 minutes. Claimed or scanning expires 10 minutes after the claim. */
export async function expireScanRequests(db: Db, nowIso: string) {
  await db.prepare(`UPDATE bayscan_scan_requests SET status = 'expired', updated_at = ?
    WHERE (status = 'pending' AND created_at < ?)
       OR (status IN ('claimed', 'scanning') AND claimed_at IS NOT NULL AND claimed_at < ?)`)
    .bind(nowIso, before(nowIso, SCAN_REQUEST_PENDING_MS), before(nowIso, SCAN_REQUEST_CLAIM_MS)).run();
}

export async function getScanRequest(db: Db, id: number) {
  const row = await db.prepare(`SELECT * FROM bayscan_scan_requests WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? mapRow(row) : null;
}

async function activeForRo(db: Db, ro: string) {
  const row = await db.prepare(`SELECT * FROM bayscan_scan_requests WHERE ro = ? AND status IN ('pending', 'claimed', 'scanning') ORDER BY id ASC LIMIT 1`)
    .bind(ro).first<Record<string, unknown>>();
  return row ? mapRow(row) : null;
}

/** A second press for an RO that already has an active request returns that request. */
export async function createScanRequest(db: Db, input: { ro: string; roId?: string; vin?: string; customer?: string; vehicle?: string; detailUrl?: string; requestedBy?: string }, nowIso: string) {
  await expireScanRequests(db, nowIso);
  const ro = String(input.ro || "").replace(/\D/g, "").slice(0, 20);
  if (!ro) return { error: "Bay Scan needs an RO number", status: 400 as const };
  const existing = await activeForRo(db, ro);
  if (existing) return { request: existing, created: false as const };
  const vin = normalizeVin(input.vin || "");
  try {
    await db.prepare(`INSERT INTO bayscan_scan_requests
      (ro, ro_id, vin, customer, vehicle, detail_url, requested_by, created_at, updated_at, status, reason, message, vin_mismatch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', 0)`)
      .bind(ro, String(input.roId || "").replace(/\D/g, "").slice(0, 20), validVin(vin) ? vin : "",
        clip(input.customer, 120), clip(input.vehicle, 160), clip(input.detailUrl, 1000), clip(input.requestedBy, 120), nowIso, nowIso).run();
  } catch {
    const raced = await activeForRo(db, ro);
    if (raced) return { request: raced, created: false as const };
    return { error: "Scan request could not be saved", status: 500 as const };
  }
  const row = await db.prepare(`SELECT * FROM bayscan_scan_requests WHERE ro = ? AND created_at = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`)
    .bind(ro, nowIso).first<Record<string, unknown>>();
  if (!row) return { error: "Scan request could not be saved", status: 500 as const };
  return { request: mapRow(row), created: true as const };
}

/** Oldest pending request, and only when nothing is claimed or scanning. */
export async function claimScanRequest(db: Db, nowIso: string) {
  await expireScanRequests(db, nowIso);
  const result = await db.prepare(`UPDATE bayscan_scan_requests
    SET status = 'claimed', claimed_at = ?, updated_at = ?
    WHERE id = (
      SELECT id FROM bayscan_scan_requests
      WHERE status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM bayscan_scan_requests WHERE status IN ('claimed', 'scanning'))
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    ) AND status = 'pending'`).bind(nowIso, nowIso).run();
  if (!wrote(result)) return null;
  const row = await db.prepare(`SELECT * FROM bayscan_scan_requests WHERE status = 'claimed' AND claimed_at = ? ORDER BY id DESC LIMIT 1`)
    .bind(nowIso).first<Record<string, unknown>>();
  return row ? claimShape(mapRow(row)) : null;
}

function reasonCode(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

export async function postScanRequestStatus(db: Db, body: Record<string, unknown> | null, nowIso: string) {
  const id = Number(body?.id);
  const status = String(body?.status || "").trim().toLowerCase();
  if (!body || !Number.isInteger(id) || id < 1) return Response.json({ error: "id is required" }, { status: 400 });
  if (status !== "scanning" && status !== "failed" && status !== "done") return Response.json({ error: "status must be scanning, failed, or done" }, { status: 400 });
  const row = await getScanRequest(db, id);
  if (!row) return Response.json({ error: "Scan request was not found" }, { status: 404 });
  if (row.status === "done" || row.status === "failed") return Response.json({ ok: true });
  const nowMs = Date.parse(nowIso);
  const pendingStale = row.status === "pending" && Number.isFinite(Date.parse(row.createdAt)) && nowMs - Date.parse(row.createdAt) > SCAN_REQUEST_PENDING_MS;
  if ((row.status === "expired" || pendingStale) && status === "scanning") {
    if (pendingStale) await db.prepare(`UPDATE bayscan_scan_requests SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(nowIso, id).run();
    return Response.json({ ok: true });
  }
  const reason = reasonCode(body.reason);
  const message = clip(body.message, 300);
  if (status === "scanning") {
    await db.prepare(`UPDATE bayscan_scan_requests SET status = 'scanning', claimed_at = COALESCE(claimed_at, ?), reason = ?, message = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'claimed', 'scanning')`)
      .bind(nowIso, reason, message, nowIso, id).run();
    return Response.json({ ok: true });
  }
  await db.prepare(`UPDATE bayscan_scan_requests SET status = ?, reason = ?, message = ?, vin_mismatch = CASE WHEN ? = 'vin_mismatch' THEN 1 ELSE vin_mismatch END, updated_at = ? WHERE id = ? AND status IN ('pending', 'claimed', 'scanning', 'expired')`)
    .bind(status, reason, message, reason, nowIso, id).run();
  return Response.json({ ok: true });
}

export async function loadScanRequestViews(db: Db, nowIso: string): Promise<ScanRequestView[]> {
  await expireScanRequests(db, nowIso);
  const rows = await db.prepare(`SELECT * FROM bayscan_scan_requests ORDER BY id DESC LIMIT 300`).all<Record<string, unknown>>();
  const newest = new Map<string, ScanRequestRow>();
  for (const raw of rows.results) {
    const row = mapRow(raw);
    if (row.ro && !newest.has(row.ro)) newest.set(row.ro, row);
  }
  const views: ScanRequestView[] = [];
  for (const row of newest.values()) {
    let codeCount: number | null = null;
    if (row.status === "done" && row.scanId) {
      const scan = await getScan(db, row.scanId);
      codeCount = scan ? scanCodes(scan.scan).length : null;
    }
    const status = (OPEN.includes(row.status) || row.status === "done" || row.status === "failed" || row.status === "expired" ? row.status : "expired") as ScanRequestStatus;
    views.push({
      id: row.id, ro: row.ro, roId: row.roId || null, vin: row.vin || null, status, reason: row.reason, message: row.message,
      createdAt: row.createdAt, codeCount, vinMismatch: row.vinMismatch,
    });
  }
  return views;
}

/** Absent, a positive id, or "invalid" (present but not a usable id — do not fall through to VIN matching). */
export function scanRequestIdFrom(body: Record<string, unknown>): number | null | "invalid" {
  if (!Object.prototype.hasOwnProperty.call(body, "scanRequestId") || body.scanRequestId === undefined || body.scanRequestId === null || body.scanRequestId === "") return null;
  const raw = body.scanRequestId;
  const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(id) || id < 1) return "invalid";
  return id;
}

export function vinMismatchNote(vin: string, otherRos: string[]) {
  const ros = [...new Set(otherRos.map((ro) => String(ro).replace(/\D/g, "")).filter(Boolean))];
  if (!ros.length) return "";
  return `VIN does not match this RO. The Bay Scan dongle read ${vin}, which matches ${ros.map((ro) => `RO#${ro}`).join(", ")}. This report stays on the RO that was clicked.`;
}

async function setScanVinMismatch(db: Db, id: number, otherRos: string[]) {
  const list = [...new Set(otherRos.map((ro) => String(ro).replace(/\D/g, "")).filter(Boolean))];
  if (!list.length) return;
  await db.prepare(`UPDATE board_bayscan_scans SET vin_mismatch = 1, vin_mismatch_ro = ? WHERE id = ?`).bind(list.join(",").slice(0, 200), id).run();
  const row = await db.prepare(`SELECT scan_json FROM board_bayscan_scans WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) return;
  let scan: Record<string, unknown> = {};
  try { scan = JSON.parse(String(row.scan_json || "{}")) as Record<string, unknown>; } catch { scan = {}; }
  scan.vinMismatch = true;
  scan.vinMismatchRos = list;
  await db.prepare(`UPDATE board_bayscan_scans SET scan_json = ? WHERE id = ?`).bind(JSON.stringify(scan), id).run();
}

async function queueScanOutputs(db: Db, scan: BayScan, ro: OpenRo, scanId: number, now: string, bucket?: Bucket) {
  try { await publishBayScanAttachment(db, { scanId, scan, ro, now }, bucket); }
  catch (error) { console.error("bayscan report job failed", error); }
  try { await enqueueMatchedPhotoJobs(db, scanId, ro, now); }
  catch (error) { console.error("bayscan photo jobs failed", error); }
}

/** VIN / last-6 path. Same side effects as POST /api/bayscan/scan without scanRequestId. */
export async function saveMatchedBayScan(db: Db, scan: BayScan, match: OpenRo | null, matchCount: number, now: string, bucket?: Bucket) {
  const id = await saveScan(db, scan, match?.ro ?? "", matchCount, now);
  if (match) {
    const by = `Bay Scan ${scan.deviceId}`;
    await attachScan(db, scan, match, by, now);
    if (!(await loadRoVins(db)).get(match.ro)) await setRoVin(db, match.ro, scan.vin, by, now);
    await queueScanOutputs(db, scan, match, id, now, bucket);
  }
  return id;
}

/**
 * scanRequestId path. The clicked RO wins. A VIN that belongs to a different open RO is flagged
 * on the saved scan and in the check-in notes, and the RO's stored VIN is left alone.
 */
export async function receiveRequestedScan(db: Db, scan: BayScan, requestId: number, ctx: { ros: OpenRo[]; writerVins: Map<string, string>; now: string; bucket?: Bucket }) {
  await expireScanRequests(db, ctx.now);
  const request = await getScanRequest(db, requestId);
  if (!request) return Response.json({ error: "Scan request was not found" }, { status: 404 });
  if (!OPEN.includes(request.status)) return Response.json({ error: "Scan request is not open" }, { status: 409 });
  const { matches, unknownVin } = matchScanVin(scan.vin, ctx.ros, ctx.writerVins);
  const others = [...new Set(matches.map((item) => item.ro).filter((ro) => ro !== request.ro))];
  const synced = ctx.ros.find((item) => item.ro === request.ro);
  const ro: OpenRo = {
    ro: request.ro,
    customer: synced?.customer || request.customer,
    vehicle: synced?.vehicle || request.vehicle,
    detailUrl: synced?.detailUrl || request.detailUrl,
    vin: request.vin || synced?.vin,
    section: synced?.section,
    status: synced?.status,
  };
  const id = await saveScan(db, scan, request.ro, matches.length, ctx.now);
  if (others.length) await setScanVinMismatch(db, id, others);
  const by = `Bay Scan ${scan.deviceId}`;
  await attachScan(db, scan, ro, by, ctx.now, true, vinMismatchNote(scan.vin, others));
  if (!others.length && !(await loadRoVins(db)).get(request.ro)) await setRoVin(db, request.ro, scan.vin, by, ctx.now);
  await queueScanOutputs(db, scan, ro, id, ctx.now, ctx.bucket);
  await db.prepare(`UPDATE bayscan_scan_requests SET status = 'done', scan_id = ?, vin_mismatch = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'claimed', 'scanning')`)
    .bind(id, others.length ? 1 : 0, ctx.now, request.id).run();
  return Response.json({ ...scanReply(ro, id), matchedBy: "request", openRosWithoutVin: unknownVin, vinMismatch: others.length > 0, scanRequestId: request.id });
}
