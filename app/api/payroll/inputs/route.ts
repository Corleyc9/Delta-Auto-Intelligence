import { requireApiUser } from "@/app/chatgpt-auth";
import { requirePayroll } from "@/app/payroll-auth";
import { ensureSchema } from "@/db/ensure-schema";

async function db() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

async function guard() {
  const dashboard = await requireApiUser();
  if (dashboard instanceof Response) return dashboard;
  return requirePayroll();
}

export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const database = await db();
  await ensureSchema(database);
  const weekStart = new URL(request.url).searchParams.get("weekStart") || "";
  const row = await database.prepare(
    `SELECT inputs_json, updated_at FROM payroll_week_inputs WHERE week_start = ?`,
  ).bind(weekStart).first<Record<string, unknown>>();
  return Response.json({
    inputs: row ? JSON.parse(String(row.inputs_json)) : null,
    updatedAt: row?.updated_at || null,
  });
}

export async function PUT(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await request.json() as { weekStart?: string; inputs?: unknown };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.weekStart || "")) || !body.inputs) {
    return Response.json({ error: "Invalid payroll worksheet" }, { status: 400 });
  }
  const database = await db();
  await ensureSchema(database);
  const updatedAt = new Date().toISOString();
  await database.prepare(
    `INSERT INTO payroll_week_inputs (week_start, inputs_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET inputs_json = excluded.inputs_json, updated_at = excluded.updated_at`,
  ).bind(body.weekStart, JSON.stringify(body.inputs), updatedAt).run();
  return Response.json({ ok: true, updatedAt });
}
