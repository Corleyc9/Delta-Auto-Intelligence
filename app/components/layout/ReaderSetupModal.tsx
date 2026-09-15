"use client";

import type { ReaderCredentials, ReaderRevision } from "@/app/lib/types";

export default function ReaderSetupModal({
  credentials,
  credentialError,
  packagedRevision,
  onClose,
  onReveal,
  onCopy,
}: {
  credentials: ReaderCredentials | null;
  credentialError: string;
  packagedRevision: ReaderRevision | null;
  onClose: () => void;
  onReveal: () => void;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="reader-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="panel-kicker">WINDOWS SHOP COMPUTER</p>
        <h2 id="reader-title">Connect the Tekmetric Reader</h2>
        <p className="modal-intro">This computer will remain signed into Tekmetric and securely send read-only report totals to your dashboard.</p>
        {packagedRevision && (
          <p className="reader-hash-line">
            Packaged reader {packagedRevision.version} · hash <code>{packagedRevision.buildHash}</code>
          </p>
        )}
        <ol className="setup-steps">
          <li><span>1</span><div><strong>Install the Delta Reader</strong><p>A small Windows program will run only on the shop computer you approve.</p></div><b>Ready</b></li>
          <li><span>2</span><div><strong>Sign into Tekmetric yourself</strong><p>Your password stays in the browser and is never saved by the dashboard.</p></div><b>Manual</b></li>
          <li><span>3</span><div><strong>Calibrate two reports</strong><p>Sales &amp; gross profit plus technician billed hours.</p></div><b>2 minutes</b></li>
        </ol>
        <div className="security-note"><span>✓</span><p><strong>Read-only by design.</strong> The reader will not edit repair orders, contact customers, issue payments, or change Tekmetric records.</p></div>
        <a className="primary-action" href="/downloads/delta-auto-reader.zip" download>
          Download Windows reader
        </a>
        {packagedRevision && <small className="download-hash">Same hash as source: {packagedRevision.buildHash}</small>}
        {!credentials ? (
          <button className="secondary-action" onClick={onReveal}>Show this computer&apos;s setup keys</button>
        ) : (
          <div className="credential-box">
            <p><strong>Keep these private.</strong> Paste them into the installer when requested.</p>
            {[
              ["Dashboard URL", credentials.dashboardUrl],
              ["Reader key", credentials.readerApiKey],
              ["Machine access token", credentials.sitesMachineToken],
            ].map(([label, value]) => (
              <label key={label}>
                <span>{label}</span>
                <input value={value} readOnly />
                <button onClick={() => onCopy(value)}>Copy</button>
              </label>
            ))}
          </div>
        )}
        {credentialError && <p className="credential-error">{credentialError}</p>}
      </section>
    </div>
  );
}
