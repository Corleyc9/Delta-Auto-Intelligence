import { headers } from "next/headers";

export type ChatGPTUser = { displayName: string; email: string; fullName: string | null };

const SESSION_COOKIE = "delta_dashboard_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SHARED_USERNAME = "delta";

async function runtimeSecrets() {
  try {
    const { env } = await import("cloudflare:workers");
    const values = env as Record<string, unknown>;
    const password = typeof values.DASHBOARD_PASSWORD === "string" ? values.DASHBOARD_PASSWORD : "";
    const sessionSecret = typeof values.DASHBOARD_SESSION_SECRET === "string"
      ? values.DASHBOARD_SESSION_SECRET : password;
    return { password, sessionSecret };
  } catch {
    return { password: "", sessionSecret: "" };
  }
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function signature(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function cookieValue(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

async function sharedUser(): Promise<ChatGPTUser | null> {
  const { password, sessionSecret } = await runtimeSecrets();
  if (!password || !sessionSecret) return null;
  const requestHeaders = await headers();
  const [encoded, suppliedSignature] = cookieValue(requestHeaders.get("cookie"), SESSION_COOKIE).split(".");
  if (!encoded || !suppliedSignature) return null;
  const expectedSignature = await signature(encoded, sessionSecret);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as { username?: string; expiresAt?: number };
    if (payload.username !== SHARED_USERNAME || !payload.expiresAt || payload.expiresAt < Date.now()) return null;
    return { displayName: "Delta shared login", email: "delta@dashboard.local", fullName: "Delta shared login" };
  } catch {
    return null;
  }
}

async function legacyChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  return email ? { displayName: email, email, fullName: null } : null;
}

export async function getDashboardUser(): Promise<ChatGPTUser | null> {
  return (await sharedLoginConfigured()) ? sharedUser() : legacyChatGPTUser();
}

export async function sharedLoginConfigured(): Promise<boolean> {
  return Boolean((await runtimeSecrets()).password);
}

export async function verifySharedCredentials(username: string, password: string): Promise<boolean> {
  const secrets = await runtimeSecrets();
  return Boolean(secrets.password &&
    constantTimeEqual(username.trim().toLowerCase(), SHARED_USERNAME) &&
    constantTimeEqual(password, secrets.password));
}

export async function createSessionCookie(): Promise<string> {
  const { sessionSecret } = await runtimeSecrets();
  const encoded = base64UrlEncode(JSON.stringify({ username: SHARED_USERNAME, expiresAt: Date.now() + SESSION_SECONDS * 1000 }));
  return `${SESSION_COOKIE}=${encoded}.${await signature(encoded, sessionSecret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function requireApiUser(): Promise<ChatGPTUser | Response> {
  const user = await getDashboardUser();
  return user ?? Response.json({ error: "Sign in required" }, { status: 401 });
}
