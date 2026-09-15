import { headers } from "next/headers";

const COOKIE = "delta_payroll_session";
const HOURS = 12;

async function secrets() {
  const { env } = await import("cloudflare:workers");
  const values = env as Record<string, unknown>;
  const password = typeof values.PAYROLL_PASSWORD === "string" ? values.PAYROLL_PASSWORD : "";
  const secret = typeof values.PAYROLL_SESSION_SECRET === "string" ? values.PAYROLL_SESSION_SECRET : "";
  return { password, secret };
}

function equal(a: string, b: string) {
  const length = Math.max(a.length, b.length); let difference = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(raw: string | null) {
  return raw?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
}

export async function payrollConfigured() { const value = await secrets(); return Boolean(value.password && value.secret); }
export async function verifyPayrollPassword(password: string) { const value = await secrets(); return Boolean(value.password && value.secret && equal(password, value.password)); }
export async function payrollAuthorized() {
  const value = await secrets(); if (!value.password || !value.secret) return false;
  const [expires, supplied] = cookieValue((await headers()).get("cookie")).split(".");
  if (!expires || !supplied || Number(expires) < Date.now()) return false;
  return equal(supplied, await sign(expires, value.secret));
}
export async function payrollCookie() {
  const value = await secrets(); const expires = String(Date.now() + HOURS * 60 * 60 * 1000);
  return `${COOKIE}=${expires}.${await sign(expires, value.secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${HOURS * 3600}`;
}
export function clearPayrollCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
export async function requirePayroll() { return (await payrollAuthorized()) ? null : Response.json({ error: "Payroll password required" }, { status: 401 }); }
