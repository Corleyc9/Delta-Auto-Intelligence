// Tech PIN sessions must not reach any other Intelligence route or API (server-side gate in worker/index.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { createTechCookie, hashPin, newSalt, readTechSession, techGate, techPathAllowed, writerSessionValid, validPin } from "../app/lib/tech-session.ts";

const secret = "test-secret";
const cookieOf = (setCookie) => setCookie.split(";")[0];
const writerCookie = async (expiresAt = Date.now() + 60000) => {
  const encoded = Buffer.from(JSON.stringify({ username: "delta", expiresAt })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded))).toString("hex");
  return `delta_dashboard_session=${encoded}.${sig}`;
};
const gate = (path, cookie) => techGate(new Request(`https://deltaintelligence.cc${path}`, { headers: cookie ? { cookie } : {} }), secret, (c) => writerSessionValid(c, secret));

test("PINs are hashed with a salt and checked by value", async () => {
  const salt = newSalt();
  const hash = await hashPin("4821", salt, 1000);
  assert.notEqual(hash, "4821"); assert.equal(hash.length, 64);
  assert.equal(await hashPin("4821", salt, 1000), hash);
  assert.notEqual(await hashPin("4822", salt, 1000), hash);
  assert.ok(validPin("1234")); assert.ok(!validPin("12a4")); assert.ok(!validPin("123"));
});

test("a tech session is blocked from every other page and API", async () => {
  const tech = cookieOf(await createTechCookie(secret, "MC", "v1"));
  assert.deepEqual(await readTechSession(tech, secret), { initials: "MC", version: "v1" });
  for (const path of ["/tech", "/api/tech", "/assets/page-abc.js", "/favicon.svg"]) assert.equal(await gate(path, tech), null, path);
  for (const path of ["/api/tech-board", "/api/job-board", "/api/payroll", "/api/reader-credentials", "/api/ticket-audits", "/api/technician"]) {
    const response = await gate(path, tech);
    assert.equal(response?.status, 403, path);
  }
  for (const path of ["/", "/tech-board", "/payroll", "/techx"]) {
    const response = await gate(path, tech);
    assert.equal(response?.status, 303, path); assert.equal(response.headers.get("Location"), "/tech");
  }
  assert.ok(!techPathAllowed("/api/tech-board"));
});

test("forged or expired tech cookies do not count; writers and anonymous requests are unaffected", async () => {
  const tech = cookieOf(await createTechCookie(secret, "MC", "v1"));
  const forged = tech.replace(/\.[0-9a-f]+$/, ".00");
  assert.equal(await readTechSession(forged, secret), null);
  const expired = cookieOf(await createTechCookie(secret, "MC", "v1", Date.now() - 13 * 3600 * 1000));
  assert.equal(await readTechSession(expired, secret), null);
  assert.equal(await gate("/api/job-board", null), null); // normal auth still applies downstream
  assert.equal(await gate("/api/job-board", `${tech}; ${await writerCookie()}`), null); // a signed-in writer keeps full access
  assert.equal((await gate("/api/job-board", `${tech}; ${await writerCookie(Date.now() - 1)}`))?.status, 403);
});
