import { requireApiUser } from "@/app/chatgpt-auth";

type ReviewItem = { status?: string; text?: string };
type SubmittedEstimate = {
  roNumber?: string; customer?: string; vehicle?: string; serviceWriter?: string;
  detailUrl?: string; estimateText?: string;
};

const AUDIT_RULES_VERSION = "2026-08-24-labor-rates-v2";

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

async function decryptApiKey(env: any): Promise<string | null> {
  if (!env.AI_ENCRYPTION_KEY) return null;
  const row = await env.DB.prepare(
    "SELECT encrypted_value, iv FROM app_secrets WHERE name = 'openai_api_key'",
  ).first() as { encrypted_value: string; iv: string } | null;
  if (!row) return null;
  const key = await crypto.subtle.importKey("raw", fromBase64(env.AI_ENCRYPTION_KEY),
    { name: "AES-GCM" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(row.iv) }, key, fromBase64(row.encrypted_value));
  return new TextDecoder().decode(decrypted);
}

async function initialize(env: any) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS delta_ai_audits (
      ro_number TEXT PRIMARY KEY,
      customer TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '',
      service_writer TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '',
      source_hash TEXT NOT NULL, conclusion TEXT NOT NULL, summary TEXT NOT NULL,
      review_json TEXT NOT NULL, captured_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS delta_ai_audits_active_idx
      ON delta_ai_audits (active DESC, captured_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS delta_ai_cleared (
      ro_number TEXT PRIMARY KEY, source_hash TEXT NOT NULL, cleared_at TEXT NOT NULL
    )`),
  ]);
}

function outputText(payload: any): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output ?? []) for (const content of item.content ?? []) {
    if (content.type === "output_text" && content.text) return content.text;
  }
  return "";
}

function cleanItems(value: unknown): ReviewItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    const row = item as ReviewItem;
    const status = ["correct", "review", "incorrect"].includes(String(row.status))
      ? String(row.status) : "review";
    return { status, text: String(row.text || "").slice(0, 900) };
  }).filter((item) => item.text);
}

async function auditEstimate(apiKey: string, estimateText: string) {
  const reviewItemSchema = {
    type: "object", additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["correct", "review", "incorrect"] },
      text: { type: "string" },
    },
    required: ["status", "text"],
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6",
      instructions: `You are Delta Auto's automotive service-writer and repair-estimate auditor.
Review only the supplied Tekmetric estimate text. Never invent unreadable or missing facts, OEM specifications,
part numbers, capacities, test results, or exact Mitchell/ALLDATA/OEM labor times. When labor time cannot be
verified, say it appears reasonable or should be verified in Mitchell/ALLDATA.

Use the exact named Tekmetric labor-rate table below. Match the rate name/customer category shown on the estimate
before deciding that a rate is wrong. Do not substitute the Regular rate for a legitimate special-account rate:
- Regular: $171.28/hr
- General Maintenance: $141.58/hr
- Intensive / Classic Cars: $191.25/hr
- Customer Supplied Parts: $231.44/hr
- Diesel / European: $201.86/hr
- R.V./Camper: $225.12/hr
- Fleet - Gas: $161.68/hr
- Fleet - Diesel: $189.68/hr
- Fleet - European: $201.93/hr
- Ext Warranty - Gas: $191.67/hr
- Ext Warranty - Diesel: $221.68/hr
- Car Shield: $175.00/hr
- LEA General Maintenance: $141.60/hr
- LEA Labor: $158.67/hr
- LEO Personal - Gas: $160.00/hr
- LEO Personal - Diesel: $180.58/hr
- Warranty: $0.00/hr
- Delta Towing: $115.00/hr
- ProTech/DeltaAuto/C.C.: $95.00/hr

Diagnostic labor is $175/hr when the estimate explicitly uses the diagnostic rate; alignment at $149.95 is an
acceptable fixed price. Job supplies must not exceed $161.90. A 0.5-hour
diagnostic is only appropriate for genuinely simple issues or straightforward P0128/P0420/P0430 cases. Driving,
lift inspection, electrical/pressure/noise/suspension/drivability testing normally requires at least 1.0 hour.

Check vehicle category and labor rate; diagnostic time; labor overlap; possible double billing; part correctness
and quantities; missing seals, fluids, hardware, consumables and related components; apparent duplicates (ask why
before declaring wrong); whether every customer concern has a finding and repair, recommendation, deferment, or
next step; whether major repairs have documented justification; and whether descriptions are clear enough for a
customer. Call out programming, relearn, calibration, alignment, bleeding, evacuation/recharge, or special tooling
when the estimate shows it is relevant. Focus on meaningful, actionable issues. Keep every finding to one concise
sentence. Return no more than five items in each review section and no more than eight final recommendations.

Return JSON only with this exact shape:
{"conclusion":"Ready to present|Needs correction before presenting","summary":"short reason","laborReview":[{"status":"correct|review|incorrect","text":"..."}],"partsReview":[],"customerConcerns":[],"clarityReview":[],"recommendations":["..."]}`,
      input: `TEKMETRIC ESTIMATE TEXT:\n${estimateText.slice(0, 60000)}`,
      reasoning: { effort: "low" },
      max_output_tokens: 6000,
      text: { format: {
        type: "json_schema", name: "delta_auto_estimate_audit", strict: true,
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            conclusion: { type: "string", enum: ["Ready to present", "Needs correction before presenting"] },
            summary: { type: "string" },
            laborReview: { type: "array", items: reviewItemSchema },
            partsReview: { type: "array", items: reviewItemSchema },
            customerConcerns: { type: "array", items: reviewItemSchema },
            clarityReview: { type: "array", items: reviewItemSchema },
            recommendations: { type: "array", items: { type: "string" } },
          },
          required: ["conclusion", "summary", "laborReview", "partsReview",
            "customerConcerns", "clarityReview", "recommendations"],
        },
      } },
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as any;
    throw new Error(detail?.error?.message || "OpenAI estimate review failed");
  }
  const payload = await response.json();
  const text = outputText(payload).trim();
  if (!text) throw new Error("OpenAI returned an empty structured estimate review");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    const reason = payload?.incomplete_details?.reason || payload?.status || "invalid JSON";
    throw new Error(`OpenAI returned an incomplete estimate review (${reason})`);
  }
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize(env);
  const rows = await env.DB.prepare(`SELECT * FROM delta_ai_audits
    WHERE active = 1 ORDER BY captured_at DESC LIMIT 100`).all<Record<string, unknown>>();
  return Response.json({ audits: rows.results.map((row) => ({
    roNumber: String(row.ro_number), customer: String(row.customer), vehicle: String(row.vehicle),
    serviceWriter: String(row.service_writer), detailUrl: String(row.detail_url),
    conclusion: String(row.conclusion), summary: String(row.summary),
    review: JSON.parse(String(row.review_json)), capturedAt: String(row.captured_at),
  })) });
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize(env);
  const roNumber = new URL(request.url).searchParams.get("roNumber")?.replace(/\D/g, "") || "";
  if (!roNumber) return Response.json({ error: "A repair order number is required." }, { status: 400 });
  const clearedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO delta_ai_cleared (ro_number, source_hash, cleared_at)
      SELECT ro_number, source_hash, ? FROM delta_ai_audits WHERE ro_number = ?
      ON CONFLICT(ro_number) DO UPDATE SET source_hash=excluded.source_hash, cleared_at=excluded.cleared_at`)
      .bind(clearedAt, roNumber),
    env.DB.prepare("UPDATE delta_ai_audits SET active = 0 WHERE ro_number = ?").bind(roNumber),
  ]);
  return Response.json({ ok: true, roNumber, clearedAt });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  await initialize(env);
  const body = await request.json() as { estimates?: SubmittedEstimate[]; activeRoNumbers?: string[] };
  const estimates = Array.isArray(body.estimates) ? body.estimates.slice(0, 25) : [];
  const active = (Array.isArray(body.activeRoNumbers) ? body.activeRoNumbers : [])
    .map((value) => String(value).replace(/\D/g, "")).filter(Boolean).slice(0, 100);
  const apiKey = estimates.length ? await decryptApiKey(env) : null;
  if (estimates.length && !apiKey) {
    return Response.json({ error: "Connect the OpenAI API key on the dashboard first." }, { status: 503 });
  }
  await env.DB.prepare("UPDATE delta_ai_audits SET active = 0").run();
  let reviewed = 0;
  let unchanged = 0;
  for (const estimate of estimates) {
    const roNumber = String(estimate.roNumber || "").replace(/\D/g, "");
    const estimateText = String(estimate.estimateText || "").trim().slice(0, 60000);
    if (!roNumber || !estimateText) continue;
    const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(`${AUDIT_RULES_VERSION}\n${estimateText}`))))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const old = await env.DB.prepare(`SELECT a.source_hash,
      CASE WHEN c.source_hash = a.source_hash THEN 1 ELSE 0 END AS is_cleared
      FROM delta_ai_audits a LEFT JOIN delta_ai_cleared c ON c.ro_number = a.ro_number
      WHERE a.ro_number = ?`)
      .bind(roNumber).first<Record<string, unknown>>();
    if (old && String(old.source_hash) === sourceHash) {
      if (!Number(old.is_cleared)) {
        await env.DB.prepare("UPDATE delta_ai_audits SET active = 1 WHERE ro_number = ?").bind(roNumber).run();
      }
      unchanged += 1;
      continue;
    }
    let result: Record<string, unknown>;
    try {
      result = await auditEstimate(apiKey!, estimateText);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown AI review error";
      return Response.json({ error: `RO#${roNumber}: ${detail}` }, { status: 502 });
    }
    const conclusion = result.conclusion === "Ready to present" ? "Ready to present" : "Needs correction before presenting";
    const review = {
      laborReview: cleanItems(result.laborReview), partsReview: cleanItems(result.partsReview),
      customerConcerns: cleanItems(result.customerConcerns), clarityReview: cleanItems(result.clarityReview),
      recommendations: Array.isArray(result.recommendations)
        ? result.recommendations.slice(0, 20).map((item) => String(item).slice(0, 900)) : [],
    };
    const capturedAt = new Date().toISOString();
    await env.DB.prepare("DELETE FROM delta_ai_cleared WHERE ro_number = ?").bind(roNumber).run();
    await env.DB.prepare(`INSERT INTO delta_ai_audits
      (ro_number, customer, vehicle, service_writer, detail_url, source_hash, conclusion, summary, review_json, captured_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(ro_number) DO UPDATE SET customer=excluded.customer, vehicle=excluded.vehicle,
      service_writer=excluded.service_writer, detail_url=excluded.detail_url, source_hash=excluded.source_hash,
      conclusion=excluded.conclusion, summary=excluded.summary, review_json=excluded.review_json,
      captured_at=excluded.captured_at, active=1`)
      .bind(roNumber, String(estimate.customer || "").slice(0, 200), String(estimate.vehicle || "").slice(0, 300),
        String(estimate.serviceWriter || "Unassigned").slice(0, 120), String(estimate.detailUrl || "").slice(0, 1000),
        sourceHash, conclusion, String(result.summary || "").slice(0, 1200), JSON.stringify(review), capturedAt).run();
    reviewed += 1;
  }
  if (active.length) {
    const placeholders = active.map(() => "?").join(",");
    await env.DB.prepare(`UPDATE delta_ai_audits SET active = 1
      WHERE ro_number IN (${placeholders})
      AND NOT EXISTS (SELECT 1 FROM delta_ai_cleared c
        WHERE c.ro_number = delta_ai_audits.ro_number AND c.source_hash = delta_ai_audits.source_hash)`)
      .bind(...active).run();
  }
  return Response.json({ ok: true, reviewed, unchanged, active: active.length });
}
