// v1.6.17: server-only webhook for new Identifix lookup requests.
import type { webhookBody } from "./identifix.ts";

/** POST {id, ro, codes, vehicle} to the optional Worker var IDENTIFIX_REQUEST_WEBHOOK_URL. Unset or failing → false, never throws. */
export async function notifyIdentifixWebhook(payload: ReturnType<typeof webhookBody>, fetcher: typeof fetch = fetch, urlOverride?: string): Promise<boolean> {
  let url = urlOverride;
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;
  if (url === undefined) {
    const workers = await import("cloudflare:workers").catch(() => null) as { env?: Record<string, unknown>; waitUntil?: (p: Promise<unknown>) => void } | null;
    url = String(workers?.env?.IDENTIFIX_REQUEST_WEBHOOK_URL || "").trim(); waitUntil = workers?.waitUntil;
  }
  if (!url) return false;
  const job = Promise.resolve().then(() => fetcher(url!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }))
    .then((res) => Boolean(res.ok)).catch(() => false);
  if (waitUntil) { waitUntil(job); return true; }
  return job;
}
