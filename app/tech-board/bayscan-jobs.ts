// v1.6.21: one Tekmetric attachment job per Bay Scan report. v1.6.22 adds one job per check-in photo.
// The reader claims either kind, downloads the file, and uploads it onto the existing RO.
// This queue never creates an RO and never approves, authorizes, sends, or pays.
import type { BayScan, OpenRo } from "./bayscan.ts";
import { buildReport, photoFilename, renderReportFile } from "./bayscan-report.ts";
import {
  ackBayScanJobRow, claimableBayScanJobs, ensureBayScanJobShape, failAbandonedBayScanJobs, getBayScanJob, getBayScanJobByPhoto,
  getBayScanJobByScan, getPhoto, getScan, insertBayScanJob, insertBayScanPhotoJob, listPhotosForScan, markBayScanJobClaimed,
  setPhotoAttach, setPhotoFilename, setScanTek, type BayScanJob,
} from "./bayscan-store.ts";

type Db = Parameters<typeof getScan>[0];
type Bucket = { put?: (key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>; get?: (key: string) => Promise<unknown> };

export const MAX_BAYSCAN_ATTACH_ATTEMPTS = 6;
export const STALE_BAYSCAN_CLAIM_MS = 15 * 60 * 1000;
export const DEFAULT_BAYSCAN_CLAIM_LIMIT = 4;

export type BayScanAttachJob = {
  id: number; roNumber: string; scanId: number; filename: string; fileKey: string; contentType: string;
  fileUrl: string; attempts: number; detailUrl: string; customer: string; vehicle: string; vin: string;
  status: string; lastError: string; kind: "report" | "photo"; photoId: number | null;
};

const fileUrl = (id: number) => `/api/bayscan/attach/file?id=${id}`;

export function mapAttachJob(job: BayScanJob): BayScanAttachJob {
  const kind = job.kind === "photo" ? "photo" : "report";
  return {
    id: job.id, roNumber: job.roNumber, scanId: job.scanId, filename: job.filename, fileKey: job.fileKey,
    contentType: job.contentType, fileUrl: fileUrl(job.id), attempts: job.attempts, detailUrl: job.detailUrl,
    customer: job.customer, vehicle: job.vehicle, vin: job.vin, status: job.status, lastError: job.lastError,
    kind, photoId: kind === "photo" && job.photoId ? job.photoId : null,
  };
}

/** Report jobs update the scan. Photo jobs update the photo and leave the report status alone. */
async function syncJobStatus(db: Db, job: BayScanJob, status: "queued" | "attached" | "failed", error: string, now: string) {
  if (job.kind === "photo" && job.photoId) {
    await setPhotoAttach(db, job.photoId, status, error);
    return;
  }
  await setScanTek(db, job.scanId, status, error, job.id, job.filename, now);
}

function isoShift(nowIso: string, ms: number) {
  const now = Date.parse(nowIso);
  return new Date((Number.isFinite(now) ? now : Date.now()) + ms).toISOString();
}

/** 2, 4, 8, 16, 32, then 60 minutes. */
export function retryDelayMs(attempts: number) {
  return Math.min(60, 2 ** Math.max(1, attempts)) * 60 * 1000;
}

async function putFile(bucket: Bucket | null | undefined, key: string, bytes: Uint8Array, contentType: string) {
  if (!bucket?.put) return false;
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
    return true;
  } catch (error) {
    console.error("bayscan report upload failed", error);
    return false;
  }
}

/**
 * Build the report file and enqueue it. A second call for the same scan returns the existing job
 * and does not reset a job that already attached.
 */
export async function publishBayScanAttachment(db: Db, input: { scanId: number; scan: BayScan; ro: OpenRo; now: string }, bucket?: Bucket | null) {
  const scanId = Number(input.scanId);
  if (!scanId || !input.ro?.ro) return null;
  await ensureBayScanJobShape(db);
  const existing = await getBayScanJobByScan(db, scanId);
  if (existing) return { job: existing, reused: true };
  const report = buildReport(input.scan, { scanId, ro: input.ro.ro, customer: input.ro.customer, vehicle: input.ro.vehicle });
  const file = renderReportFile(report);
  const fileKey = `bayscan/${scanId}/${file.filename}`;
  await putFile(bucket, fileKey, file.bytes, file.contentType);
  const job = await insertBayScanJob(db, {
    scanId, roNumber: input.ro.ro, customer: input.ro.customer || "", vehicle: input.ro.vehicle || "", vin: input.scan.vin,
    detailUrl: input.ro.detailUrl || "", fileKey, filename: file.filename, contentType: file.contentType,
  }, input.now);
  if (!job) return null;
  if (job.status !== "done") await syncJobStatus(db, job, job.status === "failed" ? "failed" : "queued", job.lastError, input.now);
  return { job, reused: false };
}

function roNumberOf(ro: string | OpenRo) {
  return String(typeof ro === "string" ? ro : ro?.ro || "").replace(/\D/g, "");
}

/**
 * One attach job per photo. The filename uses the RO number (the reader dedupes by RO|filename).
 * A second call returns the existing job and does not reset one that already attached.
 */
export async function publishBayScanPhotoAttachment(db: Db, input: { photoId: number; scanId: number; ro: string | OpenRo; now: string }) {
  const photoId = Number(input.photoId);
  const number = roNumberOf(input.ro);
  if (!photoId || !number) return null;
  await ensureBayScanJobShape(db);
  const existing = await getBayScanJobByPhoto(db, photoId);
  if (existing) return { job: existing, reused: true };
  const photo = await getPhoto(db, photoId);
  if (!photo) return null;
  const scan = await getScan(db, Number(input.scanId) || photo.scanId);
  const report = await getBayScanJobByScan(db, photo.scanId);
  const open = typeof input.ro === "string" ? null : input.ro;
  const filename = photoFilename(photo.scanId, photo.id, photo.capturedAt, number);
  await setPhotoFilename(db, photo.id, filename);
  const job = await insertBayScanPhotoJob(db, {
    scanId: photo.scanId, photoId: photo.id, roNumber: number,
    customer: open?.customer || report?.customer || "", vehicle: open?.vehicle || report?.vehicle || "",
    vin: scan?.vin || report?.vin || "", detailUrl: open?.detailUrl || report?.detailUrl || "",
    fileKey: photo.fileKey, filename, contentType: "image/jpeg",
  }, input.now);
  if (!job) return null;
  if (job.status !== "done") await syncJobStatus(db, job, job.status === "failed" ? "failed" : "queued", job.lastError, input.now);
  return { job, reused: false };
}

/** Queue a photo job for every photo on this scan that does not have one yet. */
export async function enqueueMatchedPhotoJobs(db: Db, scanId: number, ro: string | OpenRo, now: string) {
  if (!roNumberOf(ro)) return 0;
  const photos = await listPhotosForScan(db, scanId);
  let queued = 0;
  for (const photo of photos) {
    const published = await publishBayScanPhotoAttachment(db, { photoId: photo.id, scanId, ro, now });
    if (published && !published.reused) queued += 1;
  }
  return queued;
}

export async function claimBayScanAttachJobs(db: Db, options?: { nowIso?: string; limit?: number }) {
  const nowIso = options?.nowIso || new Date().toISOString();
  const limit = Math.min(10, Math.max(1, Math.floor(options?.limit || DEFAULT_BAYSCAN_CLAIM_LIMIT)));
  const staleBefore = isoShift(nowIso, -STALE_BAYSCAN_CLAIM_MS);
  await ensureBayScanJobShape(db);
  await failAbandonedBayScanJobs(db, MAX_BAYSCAN_ATTACH_ATTEMPTS, staleBefore, nowIso);
  const ids = await claimableBayScanJobs(db, nowIso, staleBefore, MAX_BAYSCAN_ATTACH_ATTEMPTS, limit);
  const claimed: BayScanAttachJob[] = [];
  for (const id of ids) {
    const current = await getBayScanJob(db, id);
    if (!current || current.attempts >= MAX_BAYSCAN_ATTACH_ATTEMPTS) continue;
    const job = await markBayScanJobClaimed(db, id, nowIso);
    if (!job) continue;
    await syncJobStatus(db, job, "queued", job.lastError, nowIso);
    claimed.push(mapAttachJob(job));
  }
  return claimed;
}

export async function ackBayScanAttachJob(db: Db, options: { id: number; status: "done" | "failed"; error?: string; nowIso?: string }) {
  const nowIso = options.nowIso || new Date().toISOString();
  const id = Math.floor(Number(options.id));
  const existing = id > 0 ? await getBayScanJob(db, id) : null;
  if (!existing) return { ok: false as const, job: null };
  if (existing.status === "done") return { ok: true as const, job: mapAttachJob(existing) };
  const errorText = String(options.error || "").trim().slice(0, 500);
  if (options.status === "done") {
    const job = await ackBayScanJobRow(db, id, "done", "", "", nowIso);
    if (job) await syncJobStatus(db, job, "attached", "", nowIso);
    return { ok: Boolean(job), job: job ? mapAttachJob(job) : null };
  }
  const giveUp = existing.attempts >= MAX_BAYSCAN_ATTACH_ATTEMPTS;
  const nextStatus = giveUp ? "failed" as const : "pending" as const;
  const nextAt = giveUp ? "" : isoShift(nowIso, retryDelayMs(existing.attempts));
  const job = await ackBayScanJobRow(db, id, nextStatus, errorText, nextAt, nowIso);
  if (job) await syncJobStatus(db, job, giveUp ? "failed" : "queued", errorText, nowIso);
  return { ok: Boolean(job), job: job ? mapAttachJob(job) : null };
}

type R2Object = { arrayBuffer?: () => Promise<ArrayBuffer>; body?: ReadableStream | null; httpMetadata?: { contentType?: string } };

export async function readBucketBytes(bucket: Bucket | null | undefined, key: string) {
  if (!bucket?.get || !key) return null;
  try {
    const object = await bucket.get(key) as R2Object | null;
    if (!object) return null;
    const bytes = typeof object.arrayBuffer === "function" ? new Uint8Array(await object.arrayBuffer())
      : object.body ? new Uint8Array(await new Response(object.body).arrayBuffer()) : null;
    if (!bytes?.byteLength) return null;
    return { bytes, contentType: object.httpMetadata?.contentType || "" };
  } catch (error) {
    console.error("bayscan file read failed", error);
    return null;
  }
}

export function bayScanFileResponse(file: { bytes: Uint8Array; contentType: string; filename: string }) {
  const filename = file.filename.replace(/[\r\n"]/g, "");
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

export async function readBayScanFile(db: Db, id: number, bucket?: Bucket | null) {
  const job = await getBayScanJob(db, id);
  if (!job) return null;
  const storedFile = await readBucketBytes(bucket, job.fileKey);
  if (storedFile) return { bytes: storedFile.bytes, contentType: storedFile.contentType || job.contentType, filename: job.filename };
  // A missing photo is a 404. Photos are not rebuilt from the scan.
  if (job.kind === "photo") return null;
  const stored = await getScan(db, job.scanId);
  if (!stored) return null;
  const file = renderReportFile(buildReport(stored.scan, { scanId: stored.id, ro: job.roNumber, customer: job.customer, vehicle: job.vehicle }));
  await putFile(bucket, job.fileKey || `bayscan/${job.scanId}/${file.filename}`, file.bytes, file.contentType);
  return { bytes: file.bytes, contentType: file.contentType, filename: job.filename || file.filename };
}
