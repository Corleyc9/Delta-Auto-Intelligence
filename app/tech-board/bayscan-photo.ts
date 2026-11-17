// v1.6.22: Bay Scan check-in photos. The Pi asks, the shop Mac claims and uploads a JPEG.
// Photos ride the existing attach queue. This module never creates an RO and never approves, authorizes, sends, or pays.
import { normalizeVin } from "./bayscan.ts";
import { photoFilename } from "./bayscan-report.ts";
import { publishBayScanPhotoAttachment } from "./bayscan-jobs.ts";
import {
  claimPhotoRequestRow, countRecentPhotoRequests, countRequestPhotos, deletePhoto, getPhoto, getPhotoByRequestSeq,
  getPhotoRequest, getPhotoRequestByClient, getScan, insertPhotoRequest, insertPhotoRow, listActivePhotoRequests,
  loadRecentDeviceScans, markPhotoRequest, reclaimPhotoRequest, setPhotoStored, type PhotoRequestRow,
} from "./bayscan-store.ts";

type Db = Parameters<typeof getScan>[0];
type Bucket = { put?: (key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown> };

export const BAYSCAN_PHOTO_SHOTS = 1;
export const PHOTO_MAX_AGE_SEC = 600;
export const PHOTO_SCAN_BEFORE_MS = 30 * 60 * 1000;
export const PHOTO_SCAN_AFTER_MS = 2 * 60 * 1000;
export const PHOTO_RATE_MAX = 10;
export const PHOTO_RATE_WINDOW_MS = 10 * 60 * 1000;
export const PHOTO_PENDING_MS = 3 * 60 * 1000;
export const PHOTO_CLAIM_MS = 2 * 60 * 1000;
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const PHOTO_MISS_ERROR = "Camera computer did not answer";

const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export function photoTiming(body: Record<string, unknown>, serverNow: Date) {
  const requestedRaw = text(body.requestedAt, 40);
  const requestedMs = Date.parse(requestedRaw);
  const requestedAt = Number.isFinite(requestedMs) ? new Date(requestedMs).toISOString() : serverNow.toISOString();
  const hasAge = body.ageSec !== undefined && body.ageSec !== null && body.ageSec !== "";
  if (!hasAge) return { effectiveAt: requestedAt, ageSec: null as number | null, requestedAt };
  const age = Number(body.ageSec);
  if (!Number.isFinite(age)) return { effectiveAt: requestedAt, ageSec: null as number | null, requestedAt };
  if (age > PHOTO_MAX_AGE_SEC) {
    return { expired: true as const, effectiveAt: requestedAt, ageSec: Math.floor(age), requestedAt };
  }
  const clamped = Math.max(0, Math.floor(age));
  return { effectiveAt: new Date(serverNow.getTime() - clamped * 1000).toISOString(), ageSec: Math.floor(age), requestedAt };
}

export async function pickPhotoScan(db: Db, deviceId: string, effectiveAt: string, vin: string) {
  const effective = Date.parse(effectiveAt);
  if (!Number.isFinite(effective)) return null;
  const scans = (await loadRecentDeviceScans(db, deviceId)).filter((scan) => {
    const at = Date.parse(scan.receivedAt);
    return Number.isFinite(at) && at >= effective - PHOTO_SCAN_BEFORE_MS && at <= effective + PHOTO_SCAN_AFTER_MS;
  }).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.id - a.id);
  if (!scans.length) return null;
  const wanted = normalizeVin(vin);
  if (wanted) {
    const match = scans.find((scan) => scan.vin === wanted);
    if (match) return match;
  }
  return scans[0];
}

/** Pending that was never claimed expires after 3 min. A claimed request with no photo returns to pending once, then fails. */
export async function touchPhotoRequest(db: Db, row: PhotoRequestRow, nowIso: string) {
  const photos = await countRequestPhotos(db, row.id);
  if (photos > 0) {
    if (row.status !== "saved") await markPhotoRequest(db, row.id, "saved", "", nowIso);
    return { ...(await getPhotoRequest(db, row.id) || row), status: "saved", photos };
  }
  const now = Date.parse(nowIso);
  if (row.status === "pending" && row.attempts === 0 && !row.claimedAt) {
    const created = Date.parse(row.createdAt);
    if (Number.isFinite(created) && now - created > PHOTO_PENDING_MS) {
      const next = await markPhotoRequest(db, row.id, "expired", row.error, nowIso);
      return { ...(next || row), status: "expired", photos: 0 };
    }
  }
  if (row.status === "claimed" && row.claimedAt) {
    const claimed = Date.parse(row.claimedAt);
    if (Number.isFinite(claimed) && now - claimed > PHOTO_CLAIM_MS) {
      if (row.attempts >= 1) {
        const next = await markPhotoRequest(db, row.id, "failed", PHOTO_MISS_ERROR, nowIso);
        return { ...(next || row), status: "failed", error: PHOTO_MISS_ERROR, photos: 0 };
      }
      const next = await reclaimPhotoRequest(db, row.id, nowIso);
      return { ...(next || row), status: "pending", attempts: row.attempts + 1, claimedAt: "", photos: 0 };
    }
  }
  return { ...row, photos };
}

async function refreshActive(db: Db, nowIso: string) {
  for (const row of await listActivePhotoRequests(db)) await touchPhotoRequest(db, row, nowIso);
}

function postShape(row: { id: number; scanId: number; status: string }, ro: string) {
  return { ok: true as const, requestId: row.id, scanId: row.scanId, ro: ro || "", status: row.status };
}

export async function postPhotoRequest(db: Db, body: Record<string, unknown>, deviceId: string, now = new Date()) {
  const id = text(deviceId, 40);
  if (!id) return Response.json({ error: "deviceId is required" }, { status: 400 });
  const clientId = text(body.clientId, 80);
  if (!clientId) return Response.json({ error: "clientId is required" }, { status: 400 });
  const nowIso = now.toISOString();
  const existing = await getPhotoRequestByClient(db, id, clientId);
  if (existing) {
    const live = await touchPhotoRequest(db, existing, nowIso);
    const scan = await getScan(db, live.scanId);
    return Response.json(postShape(live, scan?.ro || ""));
  }
  const timing = photoTiming(body, now);
  if ("expired" in timing && timing.expired) return Response.json({ error: "Photo request is too old", code: "expired" }, { status: 410 });
  const since = new Date(now.getTime() - PHOTO_RATE_WINDOW_MS).toISOString();
  if (await countRecentPhotoRequests(db, id, since) >= PHOTO_RATE_MAX) return Response.json({ error: "Too many photo requests" }, { status: 429 });
  const vin = normalizeVin(body.vin);
  const scan = await pickPhotoScan(db, id, timing.effectiveAt, vin);
  if (!scan) return Response.json({ error: "No recent scan from this device", code: "no_scan" }, { status: 404 });
  try {
    const created = await insertPhotoRequest(db, { deviceId: id, clientId, requestedAt: timing.requestedAt, effectiveAt: timing.effectiveAt, vin, ageSec: timing.ageSec, scanId: scan.id, now: nowIso });
    if (!created) return Response.json({ error: "Photo request could not be saved" }, { status: 500 });
    return Response.json(postShape(created, scan.ro || ""));
  } catch {
    const raced = await getPhotoRequestByClient(db, id, clientId);
    if (!raced) return Response.json({ error: "Photo request could not be saved" }, { status: 500 });
    return Response.json(postShape(raced, (await getScan(db, raced.scanId))?.ro || ""));
  }
}

export async function getPhotoRequestView(db: Db, requestId: number, deviceId: string, now = new Date()) {
  const row = await getPhotoRequest(db, requestId);
  if (!row || row.deviceId !== deviceId) return Response.json({ error: "Photo request was not found" }, { status: 404 });
  const live = await touchPhotoRequest(db, row, now.toISOString());
  const scan = await getScan(db, live.scanId);
  return Response.json({ requestId: live.id, scanId: live.scanId, ro: scan?.ro || "", status: live.status, photos: live.photos, error: live.error || "" });
}

export async function postPhotoBot(db: Db, body: { action?: string; limit?: number; id?: number; error?: string }, now = new Date()) {
  const action = text(body.action, 40).toLowerCase();
  const nowIso = now.toISOString();
  if (action === "claim") {
    await refreshActive(db, nowIso);
    const limit = Math.min(10, Math.max(1, Math.floor(Number(body.limit) || 2)));
    const pending = (await listActivePhotoRequests(db)).filter((row) => row.status === "pending").slice(0, limit);
    const requests = [];
    for (const row of pending) {
      const claimed = await claimPhotoRequestRow(db, row.id, nowIso);
      if (!claimed) continue;
      const scan = await getScan(db, claimed.scanId);
      requests.push({ id: claimed.id, scanId: claimed.scanId, ro: scan?.ro || "", deviceId: claimed.deviceId, requestedAt: claimed.requestedAt, shots: BAYSCAN_PHOTO_SHOTS });
    }
    return Response.json({ requests });
  }
  if (action === "fail") {
    const id = Math.floor(Number(body.id));
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "id is required" }, { status: 400 });
    const row = await getPhotoRequest(db, id);
    if (!row) return Response.json({ error: "Photo request was not found" }, { status: 404 });
    if ((await countRequestPhotos(db, id)) > 0 || row.status === "saved") return Response.json({ ok: true });
    await markPhotoRequest(db, id, "failed", text(body.error, 200), nowIso);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Unsupported action" }, { status: 400 });
}

function jpeg(bytes: Uint8Array) {
  return bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

async function uploadResult(db: Db, photoId: number, nowIso: string) {
  const photo = await getPhoto(db, photoId);
  if (!photo) return Response.json({ error: "Photo was not found" }, { status: 404 });
  const scan = await getScan(db, photo.scanId);
  const ro = scan?.ro || "";
  let attachQueued = false;
  if (ro) {
    try {
      const published = await publishBayScanPhotoAttachment(db, { photoId: photo.id, scanId: photo.scanId, ro, now: nowIso });
      attachQueued = Boolean(published?.job);
    } catch (error) { console.error("bayscan photo job failed", error); }
  }
  const fresh = await getPhoto(db, photo.id);
  return Response.json({ ok: true, photoId: photo.id, scanId: photo.scanId, ro, filename: fresh?.filename || photo.filename, attachQueued });
}

export async function savePhotoUpload(db: Db, bucket: Bucket | null | undefined, input: { requestId: number; seq: number; bytes: Uint8Array; contentType: string; now?: Date }) {
  const requestId = Math.floor(Number(input.requestId));
  const seq = Math.floor(Number(input.seq));
  if (!Number.isInteger(requestId) || requestId < 1 || !Number.isInteger(seq) || seq < 0) return Response.json({ error: "requestId and seq are required" }, { status: 400 });
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const request = await getPhotoRequest(db, requestId);
  if (!request) return Response.json({ error: "Photo request was not found" }, { status: 409 });
  const live = await touchPhotoRequest(db, request, nowIso);
  if (live.status === "expired" || live.status === "failed") return Response.json({ error: "Photo request is not open" }, { status: 409 });
  const existing = await getPhotoByRequestSeq(db, requestId, seq);
  if (existing) return uploadResult(db, existing.id, nowIso);
  const type = String(input.contentType || "").split(";")[0].trim().toLowerCase();
  if (type !== "image/jpeg") return Response.json({ error: "content-type must be image/jpeg" }, { status: 400 });
  const bytes = input.bytes;
  if (bytes.byteLength > PHOTO_MAX_BYTES) return Response.json({ error: "Photo is too large" }, { status: 413 });
  if (!jpeg(bytes)) return Response.json({ error: "Photo must be a JPEG" }, { status: 400 });
  let photo = await insertPhotoRow(db, { scanId: live.scanId, requestId, seq, capturedAt: nowIso, now: nowIso }).catch(async () => getPhotoByRequestSeq(db, requestId, seq));
  if (!photo) return Response.json({ error: "Photo could not be saved" }, { status: 500 });
  if (!photo.fileKey) {
    const scan = await getScan(db, photo.scanId);
    const filename = photoFilename(photo.scanId, photo.id, photo.capturedAt, scan?.ro || "");
    const fileKey = `bayscan/${photo.scanId}/photos/${photo.id}.jpg`;
    if (!bucket?.put) {
      await deletePhoto(db, photo.id);
      return Response.json({ error: "Photo storage is unavailable" }, { status: 503 });
    }
    try {
      await bucket.put(fileKey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    } catch (error) {
      console.error("bayscan photo upload failed", error);
      await deletePhoto(db, photo.id);
      return Response.json({ error: "Photo storage is unavailable" }, { status: 503 });
    }
    photo = await setPhotoStored(db, photo.id, fileKey, filename, bytes.byteLength) || photo;
  }
  await markPhotoRequest(db, requestId, "saved", "", nowIso);
  return uploadResult(db, photo.id, nowIso);
}
