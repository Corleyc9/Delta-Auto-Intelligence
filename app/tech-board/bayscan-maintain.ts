// v1.6.21: reader-sync and cron entry. Re-match lives in bayscan-rematch.ts so tests can run it without the scheduler.
import { r2Bucket } from "../lib/r2.ts";
import { backfillAttachJobs, backfillPhotoJobs, rematchUnmatchedScans } from "./bayscan-rematch.ts";
import { loadRoVins } from "./bayscan-store.ts";
import type { OpenRo } from "./bayscan.ts";
import { initializeTechBoard, loadSyncedRos, techBoardDb } from "./store.ts";

type Db = Parameters<typeof loadRoVins>[0];
type Bucket = Parameters<typeof backfillAttachJobs>[3];

export async function runBayScanMaintenance(db: Db, bucket?: Bucket, nowIso = new Date().toISOString()) {
  await initializeTechBoard(db as never);
  const ros = await loadSyncedRos(db as never) as OpenRo[];
  const vins = await loadRoVins(db);
  const attached = await rematchUnmatchedScans(db, ros, vins, nowIso, bucket);
  const queued = await backfillAttachJobs(db, ros, nowIso, bucket);
  const photos = await backfillPhotoJobs(db, ros, nowIso);
  return { attached, queued, photos };
}

/** Cron entry. Reader syncs also call runBayScanMaintenance directly. */
export async function runBayScanCron(env: { DB?: unknown; BUCKET?: unknown; delta_auto_lot_walks?: unknown }) {
  if (!env?.DB) return { attached: 0, queued: 0 };
  const db = env.DB as Awaited<ReturnType<typeof techBoardDb>>;
  return runBayScanMaintenance(db, r2Bucket(env as Record<string, unknown>) as Bucket);
}
