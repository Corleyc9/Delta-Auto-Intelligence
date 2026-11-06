// v1.6.9: search every reader-synced RO (incl. ones with unapproved / $0-labor jobs) by RO#, customer or vehicle. Pure.
export type SearchableRo = { ro: string; customer: string; vehicle: string; label?: string; hours?: number; detailUrl?: string };

export function searchRos<T extends SearchableRo>(ros: T[], query: string, limit = 8): T[] {
  const q = String(query || "").toLowerCase().replace(/^\s*ro\s*#?\s*/, "").replace(/\s+/g, " ").trim();
  if (!q) return ros.slice(0, limit);
  const words = q.split(" ");
  const hay = (item: T) => `${item.ro} ${item.customer} ${item.vehicle}`.toLowerCase();
  const scored = ros.filter((item) => words.every((word) => hay(item).includes(word)))
    .map((item) => ({ item, score: item.ro === q ? 0 : item.ro.startsWith(q) ? 1 : item.customer.toLowerCase().startsWith(q) ? 2 : 3 }));
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((entry) => entry.item);
}
