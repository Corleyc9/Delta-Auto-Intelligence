"use client";

import BrandLogo from "@/app/components/BrandLogo";
import type { Range } from "@/app/lib/types";

/** Opens the Grok Bot desktop app to Devin's shop GM backup agent. App must be installed. */
export const GM_BACKUP_GROK_BOT_URL =
  "grokbot://app/v1/sidebar?agent=47aebd1e-10f2-46e6-a17c-d16671bd23f2";

const GM_BACKUP_TITLE =
  "Opens Grok Bot to your shop GM backup chat (app must be installed).";

export default function TopBar({
  range,
  rangeLabel,
  readerConnected,
  onRangeChange,
  onOpenReader,
  onSignOut,
}: {
  range: Range;
  rangeLabel: string;
  readerConnected: boolean;
  onRangeChange: (range: Range) => void;
  onOpenReader: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <BrandLogo variant="header" />
        <div>
          <p className="eyebrow">DELTA AUTO &amp; TOWING · CANTON, MS</p>
          <h1>Delta Auto Intelligence</h1>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="status-pill" onClick={onOpenReader}>
          <span className={`status-dot ${readerConnected ? "" : "warning"}`} />
          {readerConnected ? "Reader connected" : "Reader setup required"}
        </button>
        <a
          className="gm-backup-button"
          href={GM_BACKUP_GROK_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          title={GM_BACKUP_TITLE}
        >
          Ask GM backup
        </a>
        <button className="signout-button" onClick={onSignOut}>Sign out</button>
        <label className="range-picker">
          <span aria-hidden="true">▣</span>
          <select value={range === "This month" ? "This week" : range} onChange={(event) => onRangeChange(event.target.value as Range)}>
            <option>Today</option>
            <option>This week</option>
            <option>Last week</option>
          </select>
          <strong>{rangeLabel}</strong>
        </label>
      </div>
    </header>
  );
}
