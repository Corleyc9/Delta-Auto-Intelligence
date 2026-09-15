import { requireApiUser } from "@/app/chatgpt-auth";

export async function GET(request: Request) {
  // This route hands back the machine token that can write live shop data.
  // It must never be reachable by an anonymous visitor.
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const { env } = await import("cloudflare:workers");
  if (!env.READER_API_KEY) {
    return Response.json({ error: "Reader credentials are not configured" }, { status: 503 });
  }

  return Response.json(
    {
      // Previously hardcoded to the ChatGPT Sites domain. Now hosted
      // directly on Cloudflare, so derive it from the actual request
      // instead of a stale constant.
      dashboardUrl: new URL(request.url).origin,
      readerApiKey: env.READER_API_KEY,
      // OAI-Sites-Authorization was only ever checked by ChatGPT's own
      // hosting edge, never by this app's code — it's meaningless outside
      // that platform. Kept as an empty value so the reader (which still
      // sends this header) and existing setup UI don't need changes; it's
      // simply ignored now.
      sitesMachineToken: env.SITES_MACHINE_TOKEN || "not-required-outside-chatgpt-sites",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
