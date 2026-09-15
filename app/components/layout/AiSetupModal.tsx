"use client";

import { FormEvent } from "react";

export default function AiSetupModal({
  aiConfigured,
  apiKeyInput,
  aiSetupMessage,
  onClose,
  onChange,
  onSubmit,
}: {
  aiConfigured: boolean;
  apiKeyInput: string;
  aiSetupMessage: string;
  onClose: () => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="ai-key-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="panel-kicker">PRIVATE OWNER SETUP</p>
        <h2 id="ai-key-title">Connect OpenAI</h2>
        <p className="modal-intro">Your API key is validated, encrypted, and stored privately. It is never sent to the browser again.</p>
        <form onSubmit={onSubmit} className="ai-form">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(event) => onChange(event.target.value)}
            placeholder={aiConfigured ? "Enter a replacement API key" : "Paste your OpenAI API key"}
            aria-label="OpenAI API key"
            autoComplete="off"
          />
          <button type="submit" aria-label="Save OpenAI API key">Save</button>
        </form>
        <div className="security-note">
          <span>✓</span>
          <p><strong>{aiConfigured ? "OpenAI is connected." : "Encrypted storage."}</strong> Delta AI receives only the summarized shop metrics visible on this dashboard.</p>
        </div>
        {aiSetupMessage && <p className="credential-error">{aiSetupMessage}</p>}
      </section>
    </div>
  );
}
