"use client";

import { FormEvent, useState } from "react";
import LoginScreen from "@/app/components/layout/LoginScreen";

/** Same shared dashboard login as the Tech Board. */
export default function ReportLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "delta", password }),
    });
    if (!response.ok) {
      setError("Incorrect username or password.");
      setLoading(false);
      return;
    }
    window.location.reload();
  }
  return <LoginScreen loading={loading} password={password} error={error} onPasswordChange={setPassword} onSubmit={onSubmit} />;
}
