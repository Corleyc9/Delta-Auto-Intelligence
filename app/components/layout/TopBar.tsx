"use client";

import BrandLogo from "@/app/components/BrandLogo";
import type { Range } from "@/app/lib/types";

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
        <button className="signout-button" onClick={onSignOut}>Sign out</button>
        <label className="range-picker">
          <span aria-hidden="true">▣</span>
          <select value={range} onChange={(event) => onRangeChange(event.target.value as Range)}>
            <option>Today</option>
            <option>This week</option>
            <option>Last week</option>
            <option>This month</option>
          </select>
          <strong>{rangeLabel}</strong>
        </label>
      </div>
    </header>
  );
}
