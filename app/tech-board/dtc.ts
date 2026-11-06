// v1.6.15 (preview): DTC helpers + Identifix Direct-Hit lookup. Pure (no React/Cloudflare) so it is unit-testable.
// Identifix publishes no deep-link / URL format for a code or vehicle search (dh.identifix.com is a login-only web app),
// so the lookup opens Direct-Hit and copies "CODE · vehicle" to the clipboard for pasting into its search.
export const IDENTIFIX_URL = "https://dh.identifix.com/";
export const normalizeDtcs = (value: unknown) => [...new Set((Array.isArray(value) ? value.join(" ") : String(value ?? ""))
  .toUpperCase().split(/[^A-Z0-9]+/).filter((code) => /^[PBCU][0-9A-F]{4}$/.test(code)))].slice(0, 40);
export const dtcClipboardText = (codes: string[], vehicle: string) => [codes.join(" "), vehicle].filter(Boolean).join(" · ");
export type Checkin = { ro: string; codes: string[]; notes: string; updatedBy: string; updatedAt: string };
export const CHECKIN_LABEL = "Check-in scan (triage only — not a diagnosis; sell diag, no parts from codes)";
/** Parent RO number for a board job key ("38528-J2~2" → "38528"). */
export const checkinRo = (job: { ro: string; roNumber?: string; linkedRo?: string | null; custom?: boolean }) =>
  String((job.custom ? job.linkedRo : job.roNumber) || job.ro).replace(/^(\d+).*$/, "$1");
