"use client";

import { FormEvent } from "react";
import BrandLogo from "@/app/components/BrandLogo";

export default function LoginScreen({
  loading,
  password,
  error,
  onPasswordChange,
  onSubmit,
}: {
  loading: boolean;
  password: string;
  error: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  if (loading) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <BrandLogo variant="login" />
          <h1>Delta Auto Intelligence</h1>
          <p>Checking access…</p>
        </div>
      </main>
    );
  }
  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <BrandLogo variant="login" />
        <p className="eyebrow">DELTA AUTO &amp; TOWING · CANTON, MS</p>
        <h1>Delta Auto Intelligence</h1>
        <p>Sign in to view the shop dashboard.</p>
        <label><span>Username</span><input value="delta" readOnly autoComplete="username" /></label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
