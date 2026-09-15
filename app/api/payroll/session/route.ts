import { clearPayrollCookie, payrollAuthorized, payrollConfigured, payrollCookie, verifyPayrollPassword } from "@/app/payroll-auth";
import { requireApiUser } from "@/app/chatgpt-auth";

export async function GET() { const dashboard = await requireApiUser(); if (dashboard instanceof Response) return dashboard; return Response.json({ authenticated: await payrollAuthorized(), configured: await payrollConfigured() }); }
export async function POST(request: Request) { const dashboard = await requireApiUser(); if (dashboard instanceof Response) return dashboard; const body = await request.json() as { password?: string }; if (!(await verifyPayrollPassword(String(body.password || "")))) return Response.json({ error: "Incorrect payroll password." }, { status: 401 }); return Response.json({ ok: true }, { headers: { "Set-Cookie": await payrollCookie() } }); }
export async function DELETE() { return Response.json({ ok: true }, { headers: { "Set-Cookie": clearPayrollCookie() } }); }
