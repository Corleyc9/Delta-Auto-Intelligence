"use client";

export default function PrintButton() {
  return <button type="button" className="bayscan-print" onClick={() => window.print()}>Print / Save as PDF</button>;
}
