import { requireApiUser } from "@/app/chatgpt-auth";
import { isEmptyCriticalSnapshot } from "@/app/lib/snapshot-guards";
import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";

type Snapshot = {
  period: "weekly" | "daily" | "last_week";
  startDate: string;
  endDate: string;
  totalSales: number;
  grossProfit: number;
  laborSales: number;
  lessAR: number;
  clearedFromAR: number;
  totalROs: number;
  hoursSold: number;
  aro: number;
  carCount: number;
  technicians: Array<{ name: string; billedHours: number; laborSales: number }>;
  capturedAt: string;
};


function validFinancialNumber(value: unknown): value is number {
  // Credits, refunds and an unprofitable day can legitimately make Tekmetric
  // sales or profit figures negative. Reject only missing/non-numeric values.
  return typeof value === "number" && Number.isFinite(value);
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await ensureSchema(env.DB);
  const requested = new URL(request.url).searchParams.get("period");
  const requestedPeriod = requested === "daily"
    ? "daily"
    : requested === "last_week"
      ? "last_week"
      : "weekly";
  const rows = await env.DB.prepare(`
    SELECT start_date, end_date, total_sales, gross_profit, labor_sales,
           technicians_json, captured_at
    FROM shop_snapshots
    ORDER BY captured_at DESC, id DESC
    LIMIT 100
  `).all<Record<string, unknown>>();

  const match = rows.results.find((row) => {
    const stored = JSON.parse(String(row.technicians_json));
    const period = Array.isArray(stored) ? "weekly" : stored.period || "weekly";
    return period === requestedPeriod;
  });
  if (!match) return Response.json({ snapshot: null });
  const row = match;
  const stored = JSON.parse(String(row.technicians_json));

  return Response.json({
    snapshot: {
      startDate: row.start_date,
      endDate: row.end_date,
      totalSales: row.total_sales,
      grossProfit: row.gross_profit,
      laborSales: row.labor_sales,
      ...(Array.isArray(stored)
        ? { technicians: stored, totalROs: 0, hoursSold: 0, aro: 0, carCount: 0, period: "weekly" }
        : stored),
      capturedAt: row.captured_at,
    },
  });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  const expected = env.READER_API_KEY;
  const supplied = request.headers.get("x-reader-key");
  if (!expected || !supplied || supplied !== expected) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }

  const payload = (await request.json()) as Partial<Snapshot>;
  if (
    !payload.startDate ||
    !payload.endDate ||
    !validFinancialNumber(payload.totalSales) ||
    !validFinancialNumber(payload.grossProfit) ||
    !validFinancialNumber(payload.laborSales) ||
    !Array.isArray(payload.technicians)
  ) {
    const invalidFields = [
      !payload.startDate && "startDate",
      !payload.endDate && "endDate",
      !validFinancialNumber(payload.totalSales) && "totalSales",
      !validFinancialNumber(payload.grossProfit) && "grossProfit",
      !validFinancialNumber(payload.laborSales) && "laborSales",
      !Array.isArray(payload.technicians) && "technicians",
    ].filter(Boolean);
    return Response.json(
      { error: "Invalid report payload", invalidFields },
      { status: 400 },
    );
  }

  const technicians = payload.technicians
    .filter((item) => item && typeof item.name === "string")
    .map((item) => ({
      name: item.name.trim(),
      billedHours: Number(item.billedHours) || 0,
      laborSales: Number(item.laborSales) || 0,
    }))
    .filter((item) =>
      item.name &&
      item.name.toLowerCase() !== "unassigned"
    );
  if (isEmptyCriticalSnapshot({
    technicians,
    totalSales: Number(payload.totalSales) || 0,
    totalROs: Number(payload.totalROs) || 0,
  })) {
    return Response.json({
      error: "Empty shop snapshot rejected; last valid snapshot preserved.",
    }, { status: 422 });
  }
  const snapshotDetails = {
    period: payload.period === "daily"
      ? "daily"
      : payload.period === "last_week"
        ? "last_week"
        : "weekly",
    technicians,
    totalROs: Number(payload.totalROs) || 0,
    hoursSold: Number(payload.hoursSold) || 0,
    aro: Number(payload.aro) || 0,
    carCount: Number(payload.carCount) || 0,
    lessAR: Number(payload.lessAR) || 0,
    clearedFromAR: Number(payload.clearedFromAR) || 0,
  };

  await ensureSchema(env.DB);
  const capturedAt = payload.capturedAt || new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO shop_snapshots
      (start_date, end_date, total_sales, gross_profit, labor_sales, technicians_json, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    payload.startDate,
    payload.endDate,
    payload.totalSales,
    payload.grossProfit,
    payload.laborSales,
    JSON.stringify(snapshotDetails),
    capturedAt,
  ).run();

  return Response.json({ ok: true, capturedAt }, { status: 201 });
}
