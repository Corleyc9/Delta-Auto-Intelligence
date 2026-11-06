// Tech PIN sessions. Pure Web Crypto (no Cloudflare imports) so the gate is unit-testable.
// PINs are stored only as PBKDF2-SHA256 hashes with a per-tech random salt.

export const TECH_COOKIE = "delta_tech_session";
export const TECH_SESSION_SECONDS = 12 * 60 * 60;
export const PIN_ITERATIONS = 100_000;
const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes as ArrayBuffer), (b) => b.toString(16).padStart(2, "0")).join("");

export function validPin(pin: unknown) { return /^\d{4,8}$/.test(String(pin ?? "")); }

export function newSalt() { return hex(crypto.getRandomValues(new Uint8Array(16))); }

export async function hashPin(pin: string, salt: string, iterations = PIN_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations }, key, 256);
  return hex(bits);
}

export function timingSafeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`tech-session:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

const b64 = (value: string) => btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (value: string) => atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));

/** `version` = the tech's PIN row updated_at, so changing/clearing a PIN signs every old session out. */
export async function createTechCookie(secret: string, initials: string, version: string, now = Date.now()) {
  const encoded = b64(JSON.stringify({ t: initials, v: version, exp: now + TECH_SESSION_SECONDS * 1000 }));
  return `${TECH_COOKIE}=${encoded}.${await hmac(secret, encoded)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TECH_SESSION_SECONDS}`;
}
export const clearTechCookie = () => `${TECH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function cookieFrom(header: string | null, name: string) {
  for (const part of String(header || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export async function readTechSession(cookieHeader: string | null, secret: string, now = Date.now()) {
  if (!secret) return null;
  const [encoded, sig] = cookieFrom(cookieHeader, TECH_COOKIE).split(".");
  if (!encoded || !sig || !timingSafeEqual(sig, await hmac(secret, encoded))) return null;
  try {
    const payload = JSON.parse(unb64(encoded)) as { t?: string; v?: string; exp?: number };
    if (!payload.t || !payload.exp || payload.exp < now) return null;
    return { initials: payload.t, version: String(payload.v || "") };
  } catch { return null; }
}

/** Paths a tech session may reach: the /tech page, its API, and static build assets. Nothing else. */
export function techPathAllowed(pathname: string) {
  if (pathname === "/tech" || pathname === "/tech/" || pathname === "/api/tech" || pathname.startsWith("/api/tech/")) return true;
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/assets/") || pathname.startsWith("/_vinext/") || pathname.startsWith("/icons/")) return true;
  return /^\/[\w./-]+\.(js|mjs|css|png|svg|ico|webmanifest|woff2?|map|json|txt)$/.test(pathname) && !pathname.includes("..");
}

/**
 * Server gate (worker entry): a request carrying a valid tech session and no valid writer session
 * can only reach techPathAllowed() paths. APIs get 403, pages are sent to /tech.
 */
export async function techGate(request: Request, secret: string, hasWriterSession: (cookieHeader: string | null) => Promise<boolean>) {
  const cookie = request.headers.get("cookie");
  if (!cookie || !cookie.includes(`${TECH_COOKIE}=`)) return null;
  const session = await readTechSession(cookie, secret);
  if (!session || await hasWriterSession(cookie)) return null;
  const { pathname } = new URL(request.url);
  if (techPathAllowed(pathname)) return null;
  if (pathname.startsWith("/api/")) return Response.json({ error: "Tech sessions can only use /tech" }, { status: 403 });
  return new Response(null, { status: 303, headers: { Location: "/tech" } });
}

/** Same check as app/chatgpt-auth.ts sharedUser(): a valid, unexpired delta_dashboard_session cookie. */
export async function writerSessionValid(cookieHeader: string | null, sessionSecret: string, now = Date.now()) {
  if (!sessionSecret) return false;
  const [encoded, sig] = cookieFrom(cookieHeader, "delta_dashboard_session").split(".");
  if (!encoded || !sig) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  if (!timingSafeEqual(sig, hex(await crypto.subtle.sign("HMAC", key, enc.encode(encoded))))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(unb64(encoded), (c) => c.charCodeAt(0)))) as { username?: string; expiresAt?: number };
    return payload.username === "delta" && Boolean(payload.expiresAt && payload.expiresAt > now);
  } catch { return false; }
}

export function sessionSecretFrom(env: Record<string, unknown>) {
  const password = typeof env.DASHBOARD_PASSWORD === "string" ? env.DASHBOARD_PASSWORD : "";
  return typeof env.DASHBOARD_SESSION_SECRET === "string" && env.DASHBOARD_SESSION_SECRET ? env.DASHBOARD_SESSION_SECRET : password;
}
