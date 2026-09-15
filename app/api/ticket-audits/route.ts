import { requireApiUser } from "@/app/chatgpt-auth";
import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";

type Finding = {
  code: string;
  severity: "critical" | "warning" | "review";
  title: string;
  detail: string;
  estimatedImpact: number;
};


export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(`
    SELECT report_date, audits_json, captured_at FROM ticket_audit_snapshots
    ORDER BY captured_at DESC, id DESC LIMIT 1
  `).first<Record<string, unknown>>();
  const dispositionRows = await env.DB.prepare(`
    SELECT ro_number, status, reason, hide_until, updated_by, updated_at
    FROM ticket_audit_dispositions ORDER BY updated_at DESC
  `).all<Record<string, unknown>>();
  const dispositions = Object.fromEntries(dispositionRows.results.map((item) => [
    String(item.ro_number),
    {
      status: item.status,
      reason: item.reason,
      hideUntil: item.hide_until,
      updatedBy: item.updated_by,
      updatedAt: item.updated_at,
    },
  ]));
  if (!row) return Response.json({ reportDate: null, audits: [], capturedAt: null, dispositions });
  return Response.json({
    reportDate: row.report_date,
    audits: JSON.parse(String(row.audits_json)),
    capturedAt: row.captured_at,
    dispositions,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await ensureSchema(env.DB);
  const body = await request.json() as {
    roNumber?: string;
    status?: "approved" | "hidden" | "open";
    reason?: string;
    hideUntil?: string;
  };
  const roNumber = String(body.roNumber || "").replace(/\D/g, "");
  if (!roNumber || !["approved", "hidden", "open"].includes(String(body.status))) {
    return Response.json({ error: "Invalid disposition" }, { status: 400 });
  }
  if (body.status === "open") {
    await env.DB.prepare("DELETE FROM ticket_audit_dispositions WHERE ro_number = ?")
      .bind(roNumber).run();
    return Response.json({ ok: true, roNumber, disposition: null });
  }
  const reason = String(body.reason || "").trim().slice(0, 600);
  if (!reason) return Response.json({ error: "A reason is required" }, { status: 400 });
  const updatedAt = new Date().toISOString();
  const updatedBy = auth.displayName || auth.email || "Dashboard user";
  const hideUntil = body.status === "hidden" ? String(body.hideUntil || "").trim().slice(0, 10) : "";
  await env.DB.prepare(`
    INSERT INTO ticket_audit_dispositions
      (ro_number, status, reason, hide_until, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(ro_number) DO UPDATE SET
      status = excluded.status, reason = excluded.reason,
      hide_until = excluded.hide_until, updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).bind(roNumber, body.status, reason, hideUntil, updatedBy, updatedAt).run();
  return Response.json({
    ok: true,
    roNumber,
    disposition: { status: body.status, reason, hideUntil, updatedBy, updatedAt },
  });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  const body = await request.json() as { reportDate?: string; audits?: Record<string, unknown>[]; capturedAt?: string };
  if (!body.reportDate || !Array.isArray(body.audits)) {
    return Response.json({ error: "Invalid ticket audit payload" }, { status: 400 });
  }
  const audits = body.audits.slice(0, 500).map((audit) => ({
    roNumber: String(audit.roNumber || ""),
    customer: String(audit.customer || ""),
    vehicle: String(audit.vehicle || ""),
    serviceWriter: String(audit.serviceWriter || "Unassigned"),
    detailUrl: String(audit.detailUrl || ""),
    grossProfitPercent: Number(audit.grossProfitPercent) || 0,
    grossProfitPerHour: Number(audit.grossProfitPerHour) || 0,
    laborGpPercent: Number(audit.laborGpPercent) || 0,
    partsGpPercent: Number(audit.partsGpPercent) || 0,
    status: audit.status === "clear" ? "clear" : "review",
    findings: Array.isArray(audit.findings) ? audit.findings.slice(0, 30).map((finding) => {
      const value = finding as Partial<Finding>;
      return {
        code: String(value.code || "review"),
        severity: ["critical", "warning", "review"].includes(String(value.severity)) ? value.severity : "review",
        title: String(value.title || "Review recommended").slice(0, 200),
        detail: String(value.detail || "").slice(0, 900),
        estimatedImpact: Math.max(0, Number(value.estimatedImpact) || 0),
      };
    }) : [],
  })).filter((audit) => audit.roNumber);
  await ensureSchema(env.DB);
  const capturedAt = body.capturedAt || new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO ticket_audit_snapshots (report_date, audits_json, captured_at)
    VALUES (?, ?, ?)
  `).bind(body.reportDate, JSON.stringify(audits), capturedAt).run();
  return Response.json({ ok: true, count: audits.length, capturedAt }, { status: 201 });
}
