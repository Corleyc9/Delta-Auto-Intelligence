// v1.6.18: attach a Bay Scan to an RO → check-in codes + an auto Identifix request (writer-only queue; tech visibility
// still follows IDENTIFIX_FOR_TECHS / IDENTIFIX_RESULTS_FOR_TECHS). Board D1 only — never Tekmetric.
import { scanCodes, scanNotes, type BayScan, type OpenRo } from "./bayscan.ts";
import { splitVehicle, webhookBody } from "./identifix.ts";
import { notifyIdentifixWebhook } from "./identifix-notify.ts";
import { addIdentifixRequest, saveCheckin } from "./store";

type Db = Parameters<typeof saveCheckin>[0];
export async function attachScan(db: Db, scan: BayScan, ro: OpenRo, by: string, now: string, notify = true) {
  const codes = scanCodes(scan);
  await saveCheckin(db, ro.ro, codes, scanNotes(scan), by, now);
  if (!codes.length) return 0;
  const value = { ro: ro.ro, customer: ro.customer, codes, symptom: scan.milOn ? "MIL on (Bay Scan check-in scan)" : "",
    vehicle: { ...splitVehicle(ro.vehicle), engine: "", vin: scan.vin, text: ro.vehicle } };
  const id = await addIdentifixRequest(db as never, value, by, now);
  if (notify) await notifyIdentifixWebhook(webhookBody({ id, ...value })).catch(() => false);
  return id;
}
