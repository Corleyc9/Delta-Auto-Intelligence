import { clearSessionCookie, createSessionCookie, getDashboardUser, sharedLoginConfigured, verifySharedCredentials } from "@/app/chatgpt-auth";

export async function GET() {
  const user = await getDashboardUser();
  return Response.json({ authenticated: Boolean(user), configured: await sharedLoginConfigured(), user: user?.displayName || null });
}

export async function POST(request: Request) {
  const body = await request.json() as { username?: string; password?: string };
  if (!(await verifySharedCredentials(String(body.username || ""), String(body.password || "")))) {
    return Response.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": await createSessionCookie() } });
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
