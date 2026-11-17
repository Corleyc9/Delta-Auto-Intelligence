import { deliverEvent, type Created } from "./events";

// Instant Teams posting: send new events to TEAMS_SCHEDULE_WEBHOOK_URL in the background (ctx.waitUntil), so a
// button click isn't slowed down. No secret → nothing posts (the backup poll feed still has the events).
export async function sendInstant(db: unknown, created: Created | Created[] | null | undefined) {
  const list = (Array.isArray(created) ? created : created ? [created] : []).filter(Boolean);
  if (!list.length) return;
  const workers = await import("cloudflare:workers").catch(() => null) as { env?: Record<string, unknown>; waitUntil?: (p: Promise<unknown>) => void } | null;
  const url = String(workers?.env?.TEAMS_SCHEDULE_WEBHOOK_URL || "").trim();
  if (!url) return;
  const job = Promise.all(list.map(async (event) => {
    if (event.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, event.delayMs));
    // Retry a failed send twice (Power Automate throttles / cold-starts); still failing → stays for the backup poll.
    for (const wait of [0, 4000, 15000]) {
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (await deliverEvent(db as never, event.id, url, fetch)) break;
    }
  })).catch(() => undefined);
  if (workers?.waitUntil) workers.waitUntil(job); else await job;
}
