"use client";

import { useEffect, useState } from "react";

export default function PwaSetup() {
  const [showInstallHelp, setShowInstallHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The dashboard still works normally if service-worker setup is unavailable.
      });
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const dismissed = window.localStorage.getItem("delta-install-help-dismissed");
    setShowInstallHelp(isIos && !isStandalone && dismissed !== "yes");
  }, []);

  if (!showInstallHelp) return null;

  return (
    <aside className="ios-install-card" aria-label="Install Delta Auto Intelligence">
      <div className="ios-install-mark">A</div>
      <div>
        <strong>Install Delta Auto</strong>
        <p>
          Tap the Safari Share button, then <b>Add to Home Screen</b>.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss install instructions"
        onClick={() => {
          window.localStorage.setItem("delta-install-help-dismissed", "yes");
          setShowInstallHelp(false);
        }}
      >
        ×
      </button>
    </aside>
  );
}
