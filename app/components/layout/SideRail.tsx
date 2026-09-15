"use client";

const NAV_ITEMS: Array<[string, string, string]> = [
  ["Overview", "Overview", "operations"],
  ["Verify Queue", "Verify", "operations"],
  ["Job Board", "Board", "operations"],
  ["Goal Miss", "GP", "operations"],
  ["Ticket Auditor", "WIP", "operations"],
  ["Warranty Claims", "Warranty", "operations"],
  ["Delta AI Review", "AI Review", "operations"],
  ["Leads", "Leads", "sales"],
  ["Writers", "Writers", "sales"],
  ["Schedule History", "Schedule", "sales"],
  ["Lot Walk", "Lot Walk", "sales"],
  ["Payroll", "Payroll", "admin"],
  ["Reader", "Reader", "admin"],
  ["Settings", "Settings", "admin"],
];

export default function SideRail({
  nav,
  onNavigate,
}: {
  nav: string;
  onNavigate: (label: string) => void;
}) {
  return (
    <aside className="side-rail" aria-label="Primary navigation">
      <div className="brand-mark" title="Delta Auto & Towing">Δ</div>
      <div className="rail-group-label">Shop</div>
      {NAV_ITEMS.filter((item) => item[2] === "operations").map(([label, short]) => (
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
      <div className="rail-group-label">Front</div>
      {NAV_ITEMS.filter((item) => item[2] === "sales").map(([label, short]) => (
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
      <div className="rail-group-label">Office</div>
      {NAV_ITEMS.filter((item) => item[2] === "admin").map(([label, short]) => (
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
    </aside>
  );
}
