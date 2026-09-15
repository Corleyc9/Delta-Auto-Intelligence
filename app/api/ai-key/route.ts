import { requireApiUser } from "@/app/chatgpt-auth";

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64(secret),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
}

async function initialize(env: any) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS app_secrets (
      name TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL,
      iv TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize(env);
  const row = await env.DB.prepare(
    "SELECT updated_at FROM app_secrets WHERE name = 'openai_api_key'",
  ).first() as { updated_at: string } | null;
  return Response.json(
    { configured: Boolean(row), updatedAt: row?.updated_at ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  if (!env.AI_ENCRYPTION_KEY) {
    return Response.json({ error: "AI encryption is not configured." }, { status: 503 });
  }
  const body = await request.json() as { apiKey?: string };
  const apiKey = body.apiKey?.trim() ?? "";
  if (!apiKey.startsWith("sk-") || apiKey.length < 20) {
    return Response.json({ error: "Enter a valid OpenAI API key." }, { status: 400 });
  }

  const validation = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!validation.ok) {
    return Response.json(
      { error: "OpenAI rejected that key. Check the key and API billing, then try again." },
      { status: 400 },
    );
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env.AI_ENCRYPTION_KEY);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(apiKey),
  );
  await initialize(env);
  await env.DB.prepare(`
    INSERT INTO app_secrets (name, encrypted_value, iv, updated_at)
    VALUES ('openai_api_key', ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      encrypted_value = excluded.encrypted_value,
      iv = excluded.iv,
      updated_at = excluded.updated_at
  `).bind(
    toBase64(new Uint8Array(encrypted)),
    toBase64(iv),
    new Date().toISOString(),
  ).run();

  return Response.json({ configured: true });
}
