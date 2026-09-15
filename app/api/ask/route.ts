import { requireApiUser } from "@/app/chatgpt-auth";

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
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64(env.AI_ENCRYPTION_KEY),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(row.iv) },
    key,
    fromBase64(row.encrypted_value),
  );
  return new TextDecoder().decode(decrypted);
}

async function latestSnapshots(env: any) {
  const rows = await env.DB.prepare(`
    SELECT start_date, end_date, total_sales, gross_profit, labor_sales,
           technicians_json, captured_at
    FROM shop_snapshots
    ORDER BY captured_at DESC, id DESC
    LIMIT 100
  `).all() as { results: Array<Record<string, unknown>> };
  const result: Record<string, unknown> = {};
  for (const row of rows.results) {
    const details = JSON.parse(String(row.technicians_json));
    const period = Array.isArray(details) ? "weekly" : details.period || "weekly";
    if (result[period]) continue;
    result[period] = {
      startDate: row.start_date,
      endDate: row.end_date,
      totalSales: row.total_sales,
      grossProfit: row.gross_profit,
      grossProfitPercent: Number(row.total_sales)
        ? Number(row.gross_profit) / Number(row.total_sales) * 100
        : 0,
      laborSales: row.labor_sales,
      ...(Array.isArray(details) ? { technicians: details } : details),
      capturedAt: row.captured_at,
    };
  }
  return result;
}

function outputText(payload: any): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  const body = await request.json() as { question?: string; period?: string };
  const question = body.question?.trim() ?? "";
  if (!question || question.length > 600) {
    return Response.json({ error: "Enter a question up to 600 characters." }, { status: 400 });
  }
  const apiKey = await decryptApiKey(env);
  if (!apiKey) {
    return Response.json({ error: "Connect the OpenAI API key first." }, { status: 503 });
  }
  const snapshots = await latestSnapshots(env);
  if (!snapshots.weekly && !snapshots.daily) {
    return Response.json({ error: "No live Tekmetric data is available yet." }, { status: 503 });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      instructions: `You are Delta Auto Intelligence, a concise operations analyst for an auto repair shop.
Answer only from the supplied live Tekmetric summary. Never invent missing figures or claim access to customer,
vehicle, repair-order, payroll, banking, or employee data beyond the supplied summary. Distinguish Today from the
Wednesday-through-Tuesday reporting week. Technician weekly targets are Stacy 60 hours, Mario 20 hours, and all
other included technicians 40 hours; Devin is intentionally excluded. Show calculations when useful. Use plain,
direct language suitable for a shop owner and keep most answers under 180 words.`,
      input: `Selected dashboard period: ${body.period === "daily" ? "Today" : "This week"}

Live data:
${JSON.stringify(snapshots)}

Question: ${question}`,
      max_output_tokens: 500,
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as any;
    return Response.json(
      { error: detail?.error?.message || "OpenAI could not answer right now." },
      { status: 502 },
    );
  }
  const payload = await response.json();
  const answer = outputText(payload);
  if (!answer) {
    return Response.json({ error: "OpenAI returned an empty answer." }, { status: 502 });
  }
  return Response.json({ answer });
}
