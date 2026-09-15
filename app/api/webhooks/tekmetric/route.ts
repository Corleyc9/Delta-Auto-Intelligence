import { handleTekmetricWebhook } from "@/app/lib/tekmetric-webhook-handler";

export async function POST(request: Request) {
  return handleTekmetricWebhook(request);
}

export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
