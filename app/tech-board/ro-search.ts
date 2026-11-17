// v1.6.21: the RO picker lists every synced RO (open / work-in-progress first, then newest). Search still filters.
import { normalizeVin } from "./bayscan.ts";

export type SearchableRo = {
  ro: string; customer: string; vehicle: string; label?: string; hours?: number; detailUrl?: string;
  vin?: string; section?: string; status?: string; posted?: boolean;
};

/** Full VIN, or the same last 6 characters (the serial). */
export function vinsMatch(scanVin: unknown, roVin: unknown) {
  const scan = normalizeVin(scanVin);
  const ro = normalizeVin(roVin);
  if (scan.length < 6 || ro.length < 6) return false;
  return scan === ro || scan.slice(-6) === ro.slice(-6);
}

/** 0 = open work-in-progress, 1 = other open, 2 = closed / posted / completed. */
export function roListRank(ro: SearchableRo) {
  const blob = `${ro.status ?? ""} ${ro.section ?? ""}`;
  if (ro.posted || /closed|posted|paid|completed/i.test(blob)) return 2;
  if (/work-in-progress/i.test(ro.section ?? "")) return 0;
  return 1;
}

function roNumber(ro: SearchableRo) {
  const digits = Number(String(ro.ro).replace(/\D/g, ""));
  return Number.isFinite(digits) ? digits : 0;
}

/** Open/WIP first, then newest RO number. */
export function compareRos(a: SearchableRo, b: SearchableRo) {
  return roListRank(a) - roListRank(b) || roNumber(b) - roNumber(a);
}

/**
 * Filter synced ROs by RO number, customer, or vehicle.
 * An empty query returns every RO (pass a finite `limit` to cap). `pinVin` floats VIN matches to the top.
 */
export function searchRos<T extends SearchableRo>(ros: T[], query: string, limit = Number.POSITIVE_INFINITY, pinVin = ""): T[] {
  const q = String(query || "").toLowerCase().replace(/^\s*ro\s*#?\s*/, "").replace(/\s+/g, " ").trim();
  let list: T[];
  if (!q) list = [...ros].sort(compareRos);
  else {
    const words = q.split(" ");
    const hay = (item: T) => `${item.ro} ${item.customer} ${item.vehicle}`.toLowerCase();
    list = ros.filter((item) => words.every((word) => hay(item).includes(word)))
      .map((item) => ({ item, score: item.ro === q ? 0 : item.ro.startsWith(q) ? 1 : item.customer.toLowerCase().startsWith(q) ? 2 : 3 }))
      .sort((a, b) => a.score - b.score || compareRos(a.item, b.item))
      .map((entry) => entry.item);
  }
  if (pinVin) {
    const pinned = list.filter((item) => vinsMatch(pinVin, item.vin)).sort(compareRos);
    const rest = list.filter((item) => !vinsMatch(pinVin, item.vin));
    list = [...pinned, ...rest];
  }
  return Number.isFinite(limit) ? list.slice(0, limit) : list;
}
