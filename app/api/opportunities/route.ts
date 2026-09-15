import { requireApiUser } from "@/app/chatgpt-auth";

type Opportunity = {
  key: string;
  customer: string;
  vehicle: string;
  phone: string;
  lastVisit: string;
  heat: number;
  signals: string[];
  recommendedServices: string[];
  customerType: "business" | "personal" | "unclassified";
};

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

async function initialize() {
  const env = await runtimeEnv();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS steer_opportunity_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunities_json TEXT NOT NULL,
      captured_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS steer_opportunity_actions (
      opportunity_key TEXT NOT NULL,
      list_date TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (opportunity_key, list_date)
    )
  `).run();
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize();
  const row = await env.DB.prepare(`
    SELECT opportunities_json, captured_at
    FROM steer_opportunity_snapshots
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  `).first<Record<string, unknown>>();
  if (!row) return Response.json({ opportunities: [], capturedAt: null });
  const stored = JSON.parse(String(row.opportunities_json));
  const opportunities = Array.isArray(stored) ? stored : stored.opportunities || [];
  const listDate = Array.isArray(stored)
    ? String(row.captured_at).slice(0, 10)
    : stored.listDate || String(row.captured_at).slice(0, 10);
  const actions = await env.DB.prepare(`
    SELECT opportunity_key, status FROM steer_opportunity_actions WHERE list_date = ?
  `).bind(listDate).all<{ opportunity_key: string; status: string }>();
  const actionMap = Object.fromEntries(actions.results.map((item) => [item.opportunity_key, item.status]));
  return Response.json({
    opportunities: opportunities.map((item: Opportunity) => ({
      ...item,
      status: actionMap[item.key] || "open",
    })),
    listDate,
    capturedAt: row.captured_at,
  });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  const body = await request.json() as {
    opportunities?: Partial<Opportunity>[];
    capturedAt?: string;
    listDate?: string;
    action?: { key?: string; listDate?: string; status?: string };
  };
  if (body.action) {
    // This branch is the dashboard user marking a lead done/skipped/follow-up,
    // not the Windows reader — it must require the same sign-in as reads.
    const auth = await requireApiUser();
    if (auth instanceof Response) return auth;
    const { key, listDate, status } = body.action;
    if (!key || !listDate || !["open", "done", "follow-up", "skipped"].includes(String(status))) {
      return Response.json({ error: "Invalid lead action" }, { status: 400 });
    }
    await initialize();
    await env.DB.prepare(`
      INSERT INTO steer_opportunity_actions (opportunity_key, list_date, status, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(opportunity_key, list_date)
      DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).bind(key, listDate, status, new Date().toISOString()).run();
    return Response.json({ ok: true, key, listDate, status });
  }
  const expected = env.READER_API_KEY;
  const supplied = request.headers.get("x-reader-key");
  if (!expected || supplied !== expected) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  if (!Array.isArray(body.opportunities)) {
    return Response.json({ error: "Invalid opportunity payload" }, { status: 400 });
  }
  const opportunities = body.opportunities.slice(0, 5000).map((item) => ({
    key: String(item.key || "").trim(),
    customer: String(item.customer || "").trim(),
    vehicle: String(item.vehicle || "").trim(),
    phone: String(item.phone || "").trim(),
    lastVisit: String(item.lastVisit || "").trim(),
    heat: Math.max(0, Math.min(5, Number(item.heat) || 0)),
    signals: Array.isArray(item.signals) ? item.signals.map(String).slice(0, 8) : [],
    recommendedServices: Array.isArray(item.recommendedServices)
      ? item.recommendedServices.map(String).slice(0, 8)
      : [],
    customerType: ["business", "personal", "unclassified"].includes(String(item.customerType))
      ? item.customerType
      : "unclassified",
  })).filter((item) => item.key && item.customer && item.vehicle);

  await initialize();
  const capturedAt = body.capturedAt || new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO steer_opportunity_snapshots (opportunities_json, captured_at)
    VALUES (?, ?)
  `).bind(JSON.stringify({
    listDate: body.listDate || capturedAt.slice(0, 10),
    opportunities,
  }), capturedAt).run();
  return Response.json({ ok: true, count: opportunities.length, capturedAt }, { status: 201 });
}
