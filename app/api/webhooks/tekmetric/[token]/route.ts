import { handleTekmetricWebhook } from "@/app/lib/tekmetric-webhook-handler";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handleTekmetricWebhook(request, decodeURIComponent(token || ""));
}

export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
