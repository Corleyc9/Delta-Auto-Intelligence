"use client";

import { relativeTime } from "@/app/lib/format";
import type { ReaderRevision, ReaderStatus, TekmetricLiveEvents } from "@/app/lib/types";

export default function StatusBanners({
  live,
  capturedAt,
  readerStatus,
  packagedRevision,
  webhookEvents,
  onOpenReader,
}: {
  live: boolean;
  range: string;
  capturedAt?: string;
  readerStatus: ReaderStatus | null;
  packagedRevision: ReaderRevision | null;
  webhookEvents: TekmetricLiveEvents | null;
  onOpenReader: () => void;
}) {
  const needsAttention = Boolean(readerStatus && readerStatus.status !== "ok");
  const statusLabel =
    readerStatus?.status === "tekmetric_signin_required" ? "TEKMETRIC SIGN-IN NEEDED"
      : readerStatus?.status === "steer_signin_required" ? "STEER SIGN-IN NEEDED"
        : readerStatus?.status === "napa_signin_required" ? "NAPA SIGN-IN NEEDED"
          : "READER NEEDS ATTENTION";
  const hashMismatch = Boolean(
    packagedRevision
      && readerStatus?.buildHash
      && readerStatus.buildHash !== packagedRevision.buildHash,
  );
  const webhookAge = webhookEvents?.lastEventAt
    ? relativeTime(webhookEvents.lastEventAt)
    : "";

  return (
    <>
      <div className={`status-strip ${live ? "connected" : "demo"}`}>
        <span>{live ? "LIVE TEKMETRIC" : "DEMO DATA"}</span>
        <strong>
          {live
            ? `Synced ${capturedAt ? new Date(capturedAt).toLocaleString() : "—"}`
            : "Reader captures Today, this week, and last week — connect the shop PC to replace sample numbers."}
        </strong>
        {webhookAge && <em>Webhooks {webhookAge}</em>}
        {hashMismatch && (
          <em>
            Shop PC is on {readerStatus?.version || "unknown"}/{readerStatus?.buildHash} — reinstall from Download.
          </em>
        )}
        <button onClick={onOpenReader}>{live ? "Reader →" : "Set up reader →"}</button>
      </div>
      {needsAttention && (
        <div className="attention-banner" role="alert">
          <span>{statusLabel}</span>
          {readerStatus?.detail || "Someone needs to sign back in on the shop computer."}
          {readerStatus?.updatedAt && ` (reported ${new Date(readerStatus.updatedAt).toLocaleString()})`}
        </div>
      )}
    </>
  );
}
