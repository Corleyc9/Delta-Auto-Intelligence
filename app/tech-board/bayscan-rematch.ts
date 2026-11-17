// v1.6.21: keep trying unmatched Bay Scan scans against synced ROs, then queue the file attach.
// Board D1 only. Does not create a Tekmetric repair order.
import { attachScan } from "./bayscan-attach.ts";
import { matchScanVin, type OpenRo } from "./bayscan.ts";
import { enqueueMatchedPhotoJobs, publishBayScanAttachment, publishBayScanPhotoAttachment } from "./bayscan-jobs.ts";
import {
  claimScanForRo, getScan, loadRematchScans, loadRoVins, photosMissingJobs, releaseScanClaim, scansMissingJobs, setRoVin,
} from "./bayscan-store.ts";

type Db = Parameters<typeof loadRoVins>[0];
type Bucket = Parameters<typeof publishBayScanAttachment>[2];

export const REMATCH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export async function commitScanAttach(db: Db, scanId: number, ro: OpenRo, by: string, now: string, bucket?: Bucket) {
  const scan = await getScan(db, scanId);
  if (!scan || scan.status !== "unmatched") return false;
  const won = await claimScanForRo(db, scan.id, ro.ro, by, now);
  if (!won) return false;
  try {
    await attachScan(db as never, scan.scan, ro, by, now);
  } catch (error) {
    await releaseScanClaim(db, scan.id, now);
    throw error;
  }
  if (!(await loadRoVins(db)).get(ro.ro)) await setRoVin(db, ro.ro, scan.vin, by, now);
  try { await publishBayScanAttachment(db, { scanId: scan.id, scan: scan.scan, ro, now }, bucket); }
  catch (error) { console.error("bayscan report job failed", error); }
  try { await enqueueMatchedPhotoJobs(db, scan.id, ro, now); }
  catch (error) { console.error("bayscan photo jobs failed", error); }
  return true;
}

/** Attach every unmatched scan that now has exactly one open-RO VIN match and is still inside the window. */
export async function rematchUnmatchedScans(db: Db, ros: OpenRo[], writerVins: Map<string, string>, nowIso: string, bucket?: Bucket) {
  const cutoff = new Date(Date.parse(nowIso) - REMATCH_WINDOW_MS).toISOString();
  const scans = await loadRematchScans(db, cutoff);
  let attached = 0;
  for (const scan of scans) {
    const { matches } = matchScanVin(scan.vin, ros, writerVins);
    if (matches.length !== 1) continue;
    const by = `Bay Scan ${scan.deviceId}`;
    const won = await commitScanAttach(db, scan.id, matches[0], by, nowIso, bucket);
    if (!won) continue;
    if (!writerVins.get(matches[0].ro)) writerVins.set(matches[0].ro, scan.vin);
    attached += 1;
  }
  return attached;
}

/** Scans that attached before a report job existed (or whose enqueue failed) get one job, once. */
export async function backfillAttachJobs(db: Db, ros: OpenRo[], nowIso: string, bucket?: Bucket) {
  const byRo = new Map(ros.map((item) => [item.ro, item]));
  let queued = 0;
  for (const id of await scansMissingJobs(db)) {
    const scan = await getScan(db, id);
    if (!scan?.ro) continue;
    const known = byRo.get(scan.ro);
    const ro: OpenRo = known ?? { ro: scan.ro, customer: "", vehicle: "" };
    const published = await publishBayScanAttachment(db, { scanId: scan.id, scan: scan.scan, ro, now: nowIso }, bucket);
    if (published && !published.reused) queued += 1;
  }
  return queued;
}

/** Photos taken before the scan matched (or whose enqueue failed) get one job, once. */
export async function backfillPhotoJobs(db: Db, ros: OpenRo[], nowIso: string) {
  const byRo = new Map(ros.map((item) => [item.ro, item]));
  let queued = 0;
  for (const row of await photosMissingJobs(db)) {
    const scan = await getScan(db, row.scanId);
    if (!scan?.ro) continue;
    const known = byRo.get(scan.ro);
    const ro: OpenRo = known ?? { ro: scan.ro, customer: "", vehicle: "" };
    const published = await publishBayScanPhotoAttachment(db, { photoId: row.photoId, scanId: scan.id, ro, now: nowIso });
    if (published && !published.reused) queued += 1;
  }
  return queued;
}
