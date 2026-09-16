"use client";

import { useEffect, useState } from "react";

export const PRIMARY_NAV: Array<[string, string]> = [
  ["Overview", "Overview"],
  ["Verify Queue", "Verify"],
  ["Job Board", "Board"],
];

export const MORE_NAV: Array<[string, string, string]> = [
  ["Goal Miss", "GP", "shop"],
  ["Ticket Auditor", "WIP", "shop"],
  ["Warranty Claims", "Warranty", "shop"],
  ["Delta AI Review", "AI Review", "shop"],
  ["Leads", "Leads", "front"],
  ["Writers", "Writers", "front"],
  ["Schedule History", "Schedule", "front"],
  ["Lot Walk", "Lot Walk", "front"],
  ["Payroll", "Payroll", "office"],
  ["Reader", "Reader", "office"],
  ["Settings", "Settings", "office"],
];

const MORE_LABELS = new Set(MORE_NAV.map(([label]) => label));
const MORE_GROUPS: Array<[string, string]> = [
  ["shop", "More · shop"],
  ["front", "More · front"],
  ["office", "More · office"],
];

export default function SideRail({
  nav,
  onNavigate,
}: {
  nav: string;
  onNavigate: (label: string) => void;
}) {
  const moreSelected = MORE_LABELS.has(nav);
  const [moreOpen, setMoreOpen] = useState(moreSelected);

  useEffect(() => {
    if (moreSelected) setMoreOpen(true);
  }, [moreSelected]);

  return (
    <aside className="side-rail" aria-label="Primary navigation">
      <div className="brand-mark" title="Delta Auto & Towing">Δ</div>
      <div className="rail-group-label">Shop</div>
      {PRIMARY_NAV.map(([label, short]) => (
        <button
          key={label}
          className={`rail-button ${nav === label ? "active" : ""}`}
          aria-label={label}
          title={label}
          onClick={() => onNavigate(label)}
        >
          <span>{short}</span>
        </button>
      ))}
      <button
        className={`rail-button rail-more-toggle ${moreOpen || moreSelected ? "open" : ""} ${moreSelected ? "active" : ""}`}
        aria-expanded={moreOpen}
        aria-controls="rail-more-items"
        aria-label="More"
        title="Lot Walk, Goal Miss, writers, payroll, and other tools"
        onClick={() => setMoreOpen((open) => !open)}
      >
        <span>More {moreOpen ? "▾" : "▸"}</span>
      </button>
      {moreOpen && (
        <div id="rail-more-items" className="rail-more-items">
          {MORE_GROUPS.map(([group, heading]) => (
            <div key={group} className="rail-more-group">
              <div className="rail-group-label">{heading}</div>
              {MORE_NAV.filter((item) => item[2] === group).map(([label, short]) => (
                <button
                  key={label}
                  className={`rail-button ${nav === label ? "active" : ""}`}
                  aria-label={label}
                  title={label}
                  onClick={() => onNavigate(label)}
                >
                  <span>{short}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
