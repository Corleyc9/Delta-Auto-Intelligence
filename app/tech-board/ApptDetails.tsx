// v1.6.13: Tekmetric appointment detail (concern, vehicle, phone, notes, drop-off…) on writer and tech cards. Read-only copy.
const parse = (info?: string | null): [string, string][] => {
  if (!info) return [];
  try { return Object.entries(JSON.parse(info) as Record<string, unknown>).filter(([, v]) => String(v ?? "").trim()).map(([k, v]) => [k, String(v)]); }
  catch { return [["Notes", String(info)]]; }
};
const when = (value: string) => /^\d{4}-\d{2}-\d{2}T/.test(value)
  ? new Date(value).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }) : value;

/** One-line summary for the card face: concern first, then vehicle. */
export function apptSummary(info?: string | null) {
  const map = new Map(parse(info));
  return [map.get("Concern / notes") || map.get("Title"), map.get("Vehicle")].filter(Boolean).join(" · ");
}

export function ApptDetails({ info }: { info?: string | null }) {
  const rows = parse(info);
  if (!rows.length) return null;
  return (
    <div className="tb-appt-details" data-testid="appt-details">
      <small>Tekmetric appointment</small>
      <dl className="tb-facts">{rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{label === "Phone" ? <a href={`tel:${value}`}>{value}</a> : /Drop-off|Pick-up/.test(label) ? when(value) : value}</dd></div>))}</dl>
    </div>
  );
}
