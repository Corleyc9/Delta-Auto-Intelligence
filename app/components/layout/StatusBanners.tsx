"use client";

import { relativeTime } from "@/app/lib/format";
import type { ReaderRevision, ReaderStatus, TekmetricLiveEvents } from "@/app/lib/types";

export default function StatusBanners({
  live,
  range,
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
  const statusLabel =
    readerStatus?.status === "tekmetric_signin_required" ? "TEKMETRIC SIGN-IN NEEDED"
      : readerStatus?.status === "steer_signin_required" ? "STEER SIGN-IN NEEDED"
        : readerStatus?.status === "napa_signin_required" ? "NAPA SIGN-IN NEEDED"
          : "READER NEEDS ATTENTION";
  return (
    <>
      <div className={`demo-banner ${live ? "connected" : ""}`}>
        <span>{live ? "LIVE TEKMETRIC" : "DEMO DATA"}</span>
        {live
          ? `Last synchronized ${new Date(capturedAt || "").toLocaleString()}`
          : range === "This month"
            ? "Monthly view is sample data — the reader only captures Today, this week, and last week."
            : "Connect the Windows reader to replace these sample numbers with live Tekmetric reports."}
        <button onClick={onOpenReader}>{live ? "Reader details →" : "Set up reader →"}</button>
      </div>
      {readerStatus && readerStatus.status !== "ok" && (
        <div className="attention-banner" role="alert">
          <span>{statusLabel}</span>
          {readerStatus.detail || "Someone needs to sign back in on the shop computer."}
          {readerStatus.updatedAt && ` (reported ${new Date(readerStatus.updatedAt).toLocaleString()})`}
        </div>
      )}
      {packagedRevision && (
        <div className="reader-revision-strip">
          <span>Reader build</span>
          <strong>{packagedRevision.version}</strong>
          <code>{packagedRevision.buildHash}</code>
          {readerStatus?.buildHash && readerStatus.buildHash !== packagedRevision.buildHash && (
            <em>Shop PC is on {readerStatus.version || "unknown"}/{readerStatus.buildHash} — reinstall from Download.</em>
          )}
        </div>
      )}
      {webhookEvents?.lastEventAt && (
        <div className="webhook-strip">
          <span>Tekmetric webhooks</span>
          <strong>Last event {relativeTime(webhookEvents.lastEventAt)}</strong>
          {webhookEvents.signals.overviewFreshness && (
            <em>{webhookEvents.signals.overviewFreshness.detail}</em>
          )}
          {webhookEvents.signals.lastApproval && (
            <em>{webhookEvents.signals.lastApproval.detail}</em>
          )}
          {webhookEvents.signals.scheduleChanged && (
            <em>{webhookEvents.signals.scheduleChanged.detail}</em>
          )}
        </div>
      )}
    </>
  );
}
