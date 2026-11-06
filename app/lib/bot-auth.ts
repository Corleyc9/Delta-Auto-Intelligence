// Bearer-key auth for the Teams bot Tech Board API. Pure (no Cloudflare imports) so it is unit-testable.
// The key lives only in the Worker secret TECH_BOARD_BOT_KEY — never in code or the repo.

/** Constant-time string compare (no early exit on the first differing character). */
function timingSafeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function botAuth(authorization: string | null, secret: unknown): Response | null {
  const key = typeof secret === "string" ? secret.trim() : "";
  if (!key) return Response.json({ error: "Tech Board bot API is disabled (TECH_BOARD_BOT_KEY is not set)" }, { status: 503 });
  const match = String(authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match || !timingSafeEqual(match[1].trim(), key)) {
    return Response.json({ error: "Invalid bot key" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  return null;
}

/** Map a bot request onto a writer board action. Only these bot actions exist. */
export function botToBoardAction(body: Record<string, unknown>): Record<string, unknown> | { error: string } {
  const action = String(body.action || "");
  const ro = body.ro === undefined ? undefined : String(body.ro);
  switch (action) {
    case "move": return { action: "move", ro, tech: body.tech, laneDate: body.date ?? body.laneDate, startMinute: body.startMinute };
    case "resize": return { action: "resize", ro, durationMinutes: body.durationMinutes, laneDate: body.date ?? body.laneDate };
    case "add-block": return { action: "add-custom", tech: body.tech, laneDate: body.date ?? body.laneDate, startMinute: body.startMinute,
      durationMinutes: body.durationMinutes, title: body.title, note: body.note, linkedRo: body.linkedRo ?? "" };
    case "add-time-off": return { action: "timeoff-save", initials: body.tech ?? body.initials, date: body.date, allDay: Boolean(body.allDay),
      startMinute: body.startMinute, endMinute: body.endMinute, reason: body.reason };
    case "set-percent": {
      const pct = Number(body.percent ?? body.percentComplete);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "percent must be 0–100" };
      return { action: "update", ro, kind: pct >= 100 ? "Done" : "note", percentComplete: pct, comment: String(body.comment ?? ""), techEstimateHours: null };
    }
    case "set-start-date": return { action: "set-start-date", date: body.date };
    case "dedupe-front-office": return { action: "dedupe-front-office" };
    case "remove-mirror-blocks": return { action: "remove-mirror-blocks" };
    // v1.6.15: check-in scan findings on an RO: { ro, codes: ["P0300"] | "P0300 P0171", notes? }. Empty codes + notes clears it.
    case "set-checkin": {
      const number = String(body.ro ?? "").replace(/\D/g, "");
      if (!number) return { error: "set-checkin needs ro (RO number)" };
      return { action: "checkin-set", ro: number, codes: body.codes ?? "", notes: String(body.notes ?? body.freezeFrame ?? "") };
    }
    // Writer schedule inbox. These do not move a block; they collect the request for a person or this bot to act on.
    case "add-schedule-request": {
      const requestText = String(body.text ?? "").trim().slice(0, 2000);
      if (requestText.length < 3) return { error: "add-schedule-request needs text" };
      return { action: "schedule-request-add", text: requestText, name: String(body.by ?? body.name ?? "").trim().slice(0, 60) };
    }
    case "ack-schedule-request":
    case "done-schedule-request": {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return { error: "ack-schedule-request needs id" };
      return { action: "schedule-request-ack", id, name: String(body.by ?? body.name ?? "").trim().slice(0, 60) };
    }
    // v1.6.9: put any synced RO on the board (even with no approved / $0-labor jobs) as a persistent RO-linked block.
    case "add-ro": {
      const number = String(body.ro ?? body.linkedRo ?? "").replace(/\D/g, "");
      if (!number) return { error: "add-ro needs ro (RO number)" };
      return { action: "add-ro", ro: number, tech: body.tech ?? "UN", laneDate: body.date ?? body.laneDate, startMinute: body.startMinute ?? 120,
        durationMinutes: body.durationMinutes, title: body.title, note: body.note };
    }
    default: return { error: "Unknown bot action. Use move, resize, add-block, add-time-off, set-percent, set-start-date, dedupe-front-office, remove-mirror-blocks, add-ro, set-checkin, list-schedule-requests, add-schedule-request, ack-schedule-request, list-identifix-requests, claim-identifix-request, post-identifix-result or fail-identifix-request." };
  }
}
