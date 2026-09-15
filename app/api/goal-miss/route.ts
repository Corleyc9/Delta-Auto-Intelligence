import { requireApiUser } from "@/app/chatgpt-auth";

type GoalMissTicketInput = Record<string, unknown>;

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env;
}

async function initialize() {
  const env = await runtimeEnv();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS goal_miss_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      tickets_json TEXT NOT NULL,
      captured_at TEXT NOT NULL
    )
  `).run();
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await initialize();
  const row = await env.DB.prepare(`
    SELECT start_date, end_date, tickets_json, captured_at
    FROM goal_miss_snapshots ORDER BY captured_at DESC, id DESC LIMIT 1
  `).first<Record<string, unknown>>();
  if (!row) return Response.json({ snapshot: null });
  return Response.json({ snapshot: {
    startDate: row.start_date,
    endDate: row.end_date,
    capturedAt: row.captured_at,
    tickets: JSON.parse(String(row.tickets_json)),
  }});
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  const body = await request.json() as { startDate?: string; endDate?: string; capturedAt?: string; tickets?: GoalMissTicketInput[] };
  if (!body.startDate || !body.endDate || !Array.isArray(body.tickets)) {
    return Response.json({ error: "Invalid goal miss payload" }, { status: 400 });
  }
  const tickets = body.tickets.slice(0, 500).map((item) => ({
    roNumber: String(item.roNumber || ""), customer: String(item.customer || ""),
    vehicle: String(item.vehicle || ""), serviceWriter: String(item.serviceWriter || "Unassigned"),
    technicians: Array.isArray(item.technicians) ? item.technicians.map(String).slice(0, 12) : [],
    detailUrl: String(item.detailUrl || ""), sales: Number(item.sales) || 0,
    grossProfit: Number(item.grossProfit) || 0, hoursSold: Number(item.hoursSold) || 0,
    grossProfitPercent: Number(item.grossProfitPercent) || 0,
    grossProfitPerHour: Number(item.grossProfitPerHour) || 0,
    laborGpPercent: Number(item.laborGpPercent) || 0, partsGpPercent: Number(item.partsGpPercent) || 0,
    laborSales: Number(item.laborSales) || 0, laborProfit: Number(item.laborProfit) || 0,
    partsSales: Number(item.partsSales) || 0, partsCost: Number(item.partsCost) || 0,
    partsProfit: Number(item.partsProfit) || 0,
    unbilledParts: Math.max(0, Number(item.unbilledParts) || 0),
    missedLabor: Math.max(0, Number(item.missedLabor) || 0), discount: Math.max(0, Number(item.discount) || 0),
    rootCauses: Array.isArray(item.rootCauses) ? item.rootCauses.map(String).slice(0, 12) : [],
    exceptionType: String(item.exceptionType || ""), controllable: item.controllable !== false,
    dataComplete: item.dataComplete === true, notes: String(item.notes || "").slice(0, 1200),
  })).filter((item) => item.roNumber);
  await initialize();
  const capturedAt = body.capturedAt || new Date().toISOString();
  await env.DB.prepare(`INSERT INTO goal_miss_snapshots (start_date, end_date, tickets_json, captured_at) VALUES (?, ?, ?, ?)`)
    .bind(body.startDate, body.endDate, JSON.stringify(tickets), capturedAt).run();
  return Response.json({ ok: true, count: tickets.length, capturedAt }, { status: 201 });
}
