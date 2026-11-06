import { normalizeDtcs } from "@/app/tech-board/dtc";
import { blockRo, boardStart, isLockedJob, ripple, resizePush, snapSameRo, LUNCH_END, LUNCH_START, UNASSIGNED, chicagoDate, clampStart, dayWallLimit, shopDays, wallEnd } from "@/app/tech-board/scheduler";
import { loadCheckins, saveCheckin, initializeTechBoard, loadJobs, loadLatestUpdates, loadPoolRequests, loadSyncedRos, loadTechs, loadTimeOff, pinStatus, recomputeTechBoard, techBoardDb } from "@/app/tech-board/store";
import { hashPin, newSalt, PIN_ITERATIONS, validPin } from "@/app/lib/tech-session";
import { APP_VERSION } from "@/app/lib/version";
import { newSuggestion, suggestionUpdate } from "@/app/tech-board/suggestions";
import { newScheduleRequest, scheduleRequestAck } from "@/app/tech-board/schedule-requests";
import { addScheduleRequest, addSuggestion, getScheduleRequest, getStartDate, loadScheduleRequests, loadSuggestions, markScheduleRequestDone, setStartDate } from "@/app/tech-board/store";
import { recordScheduleRequestEvent, recordSuggestionEvent, recordUpdateEvent } from "@/app/tech-board/events";
import { sendInstant } from "@/app/tech-board/teams-notify";
import { newIdentifixRequest, webhookBody } from "@/app/tech-board/identifix";
import { notifyIdentifixWebhook } from "@/app/tech-board/identifix-notify";
import { addIdentifixRequest, loadIdentifixRequests, getScan, loadRoVins, loadUnmatchedScans, markScan, setRoVin } from "@/app/tech-board/store";
import { normalizeVin, validVin } from "@/app/tech-board/bayscan";
import { attachScan } from "@/app/tech-board/bayscan-attach";



// Tech Board actions shared by the writer UI and the Teams bot API. Writes only to this app's D1 tables — never to Tekmetric.

export async function boardPayload(db: Awaited<ReturnType<typeof techBoardDb>>, date?: string | null) {
  const today = chicagoDate(new Date());
  const days = shopDays(today, 10);
  const selected = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : days[0];
  const [techs, jobs, updates, timeOff, poolRequests, syncedRos, pins] = await Promise.all([
    loadTechs(db), loadJobs(db), loadLatestUpdates(db), loadTimeOff(db), loadPoolRequests(db), loadSyncedRos(db), pinStatus(db), ]);
  const suggestions = await loadSuggestions(db);
  const scheduleRequests = await loadScheduleRequests(db);
  const checkins = await loadCheckins(db);
  const identifixRequests = await loadIdentifixRequests(db);
  const roVins = Object.fromEntries(await loadRoVins(db)); // v1.6.18 writer-entered VINs
  const unmatchedScans = await loadUnmatchedScans(db);
  return { identifixRequests, roVins, unmatchedScans, today, days, date: selected, techs, jobs: jobs.filter((job) => !job.hidden), updates, timeOff, poolRequests,
    syncedRos, suggestions, scheduleRequests, checkins, pinsSet: pins.map((pin) => pin.initials), version: APP_VERSION, startDate: await getStartDate(db),
    unassigned: UNASSIGNED, lunch: { start: LUNCH_START, end: LUNCH_END } };
}

/**
 * v1.6.16 ripple: after a block on a tech's day is moved or resized (writer, bot, or a tech's own %/estimate), later blocks on
 * that tech's day that now overlap are pushed later in order, hopping over yellow customer appointments and time off.
 * Board D1 only. Returns a short notice ('' when nothing moved).
 */
export async function applyRipple(db: BoardDb, key: string, now: string) {
  const all = await loadJobs(db);
  const self = all.find((job) => job.ro === key);
  if (!self || self.hidden || self.tech === UNASSIGNED || self.startMinute < 0) return "";
  const techs = await loadTechs(db);
  const busy = (await loadTimeOff(db)).filter((off) => off.initials === self.tech && off.date === self.laneDate)
    .map((off) => ({ start: off.allDay ? 0 : off.startMinute, end: off.allDay ? 24 * 60 : off.endMinute }));
  const blocks = all.filter((job) => job.tech === self.tech && job.laneDate === self.laneDate && job.status !== "front-office")
    .map((job) => ({ key: job.ro, tech: job.tech, laneDate: job.laneDate, startMinute: job.startMinute, durationMinutes: job.durationMinutes, locked: isLockedJob(job), hidden: job.hidden }));
  const moves = ripple(blocks, key, { dayMinutes: techs.find((tech) => tech.initials === self.tech)?.dayMinutes ?? 480, busy });
  if (!moves.length) return "";
  const today = chicagoDate(new Date());
  // Today's set schedule keeps stored times (keepToday); on a later day the pushed time is kept as a writer preference.
  await db.batch(moves.map((move) => db.prepare(`UPDATE board_jobs SET start_minute = ?, ${self.laneDate === today ? "" : "pinned = 1, placed_by = 'writer', "}updated_at = ? WHERE ro = ?`)
    .bind(move.startMinute, now, move.key)));
  const label = (ro: string) => { const job = all.find((item) => item.ro === ro); return job ? (job.custom ? job.title || `RO#${job.linkedRo || job.ro}` : `RO#${job.roNumber}${job.customer ? ` ${job.customer}` : ""}`) : ro; };
  const over = moves.filter((move) => move.overflow);
  return `Pushed ${moves.length} later job${moves.length === 1 ? "" : "s"} on ${self.tech}'s day: ${moves.map((move) => label(move.key)).join(", ")}.`
    + (over.length ? ` ⚠ Past 5 PM (overflow): ${over.map((move) => label(move.key)).join(", ")}.` : "");
}

type Action =
  | { action: "recompute" }
  | { action: "move"; ro: string; tech: string; laneDate: string; startMinute: number }
  | { action: "unpin"; ro: string }
  | { action: "update"; ro: string; kind: string; percentComplete: number | null; comment: string; techEstimateHours: number | null };

const isDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const minutes = (value: unknown, max = 24 * 60) => Math.max(0, Math.min(max, Math.round((Number(value) || 0) / 15) * 15));
const text = (value: unknown, max = 500) => String(value ?? "").slice(0, max);

const UPDATE_KINDS = ["note", "Need parts", "Wrong part", "Need help", "Waiting approval", "Found more work", "Done", "Diag Done"];

export type BoardDb = Awaited<ReturnType<typeof techBoardDb>>;
export const MUTATING_ACTIONS = ["move", "unpin", "update", "resize", "edit", "delete", "add-custom", "timeoff-save", "timeoff-delete",
  "pool-request", "pool-decide", "suggest-add", "suggest-update", "schedule-request-add", "schedule-request-ack", "pin-set", "pin-clear", "recompute", "set-start-date", "dedupe-front-office", "remove-mirror-blocks", "add-ro", "checkin-set", "identifix-request", "ro-vin-set", "bayscan-attach", "bayscan-dismiss"];

/** Log a board change (never includes PINs). */
async function logChange(db: BoardDb, source: string, actor: string, body: Record<string, unknown>, now: string) {
  const safe = { ...body }; delete safe.pin;
  await db.prepare(`INSERT INTO board_change_log (source, actor, action, ro, body_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(source, actor.slice(0, 120), String(body.action || ""), String(body.ro ?? "").slice(0, 40), JSON.stringify(safe).slice(0, 4000), now).run()
    .catch(() => undefined);
}

/**
 * Every writer-level board change (UI or Teams bot) runs through here. Board D1 tables only — never Tekmetric.
 * `actor` is shown on updates; `source` is logged ('writer' or 'teams-bot').
 */
export async function boardAction(db: BoardDb, body: Record<string, unknown> & { action?: string }, actor: string, source: string): Promise<Response> {
  const auth = { displayName: actor, source };
  const response = await runBoardAction(db, body, auth);
  if (response.ok && MUTATING_ACTIONS.includes(String(body.action))) await logChange(db, source, actor, body, new Date().toISOString());
  return response;
}

async function runBoardAction(db: BoardDb, body: Record<string, unknown> & { action?: string }, auth: { displayName: string; source?: string }): Promise<Response> {
  const now = new Date().toISOString();
  let notice = "";
  // HARD RULE: two blocks of the same RO (same car) never overlap, on any tech. Snap after the conflicting job.
  const sameCar = async (key: string, laneDate: string, start: number, duration: number | null, tech: string) => {
    const all = await loadJobs(db);
    const self = all.find((job) => job.ro === key);
    if (!self || tech === UNASSIGNED) return start;
    const blocks = all.filter((job) => !job.hidden).map((job) => ({ key: job.ro, ro: job.custom ? (job.linkedRo || job.ro) : job.roNumber,
      laneDate: job.laneDate, startMinute: job.startMinute, durationMinutes: job.durationMinutes, tech: job.tech }));
    const ro = self.custom ? (self.linkedRo || self.ro) : self.roNumber;
    const snapped = snapSameRo(blocks, key, ro, laneDate, start, duration ?? self.durationMinutes);
    if (snapped.conflictWith) {
      const other = all.find((job) => job.ro === snapped.conflictWith);
      notice = `Moved to start after ${other?.jobName || `RO#${ro}`}${other && other.tech !== tech ? ` (${other.tech})` : ""}: jobs on the same RO can't overlap — it's the same car.`;
    }
    return snapped.start;
  };
  // v1.6.13: writers and the bot may move/resize yellow appointments (the lock is against the auto-scheduler and tech sessions).
  if (body.action === "move") {
    const ro = String(body.ro || "");
    const tech = String(body.tech || "");
    const laneDate = String(body.laneDate || "");
    const startMinute = boardStart(body.startMinute);
    const techs = await loadTechs(db);
    if (!ro || !/^\d{4}-\d{2}-\d{2}$/.test(laneDate) || (tech !== UNASSIGNED && !techs.some((item) => item.initials === tech))) {
      return Response.json({ error: "Invalid move" }, { status: 400 });
    }
    // start < 0 = the 6–7 AM Front office row (-120) or the 7–8 AM row (-60): no work time.
    const front = startMinute < 0;
    const safeStart = front ? startMinute : await sameCar(ro, laneDate, startMinute, null, tech);
    await db.prepare(`UPDATE board_jobs SET tech = ?, lane_date = ?, start_minute = ?, pinned = 1, placed_by = 'writer', auto_placed = 0, needs_placing = NULL,
      status = CASE WHEN ? THEN 'front-office' WHEN status = 'front-office' THEN 'ready' ELSE status END,
      updated_at = ? WHERE ro = ?`).bind(tech, laneDate, safeStart, front ? 1 : 0, now, ro).run();
    if (!front && tech !== UNASSIGNED) notice = [notice, await applyRipple(db, ro, now)].filter(Boolean).join(" ");
  } else if (body.action === "unpin") {
    await db.prepare(`UPDATE board_jobs SET pinned = 0, placed_by = 'auto', updated_at = ? WHERE ro = ?`)
      .bind(now, String(body.ro || "")).run();
  } else if (body.action === "update") {
    // Board-only ticket update. Stored in D1; never sent to Tekmetric (and no Teams posts in Phase 1).
    const ro = String(body.ro || "");
    const kind = UPDATE_KINDS.includes(String(body.kind)) ? String(body.kind) : "note";
    const pct = body.percentComplete === null || body.percentComplete === undefined || String(body.percentComplete) === "" ? null
      : Math.max(0, Math.min(100, Number(body.percentComplete) || 0));
    const est = body.techEstimateHours === null || body.techEstimateHours === undefined || String(body.techEstimateHours) === "" ? null
      : Math.max(0, Math.min(40, Number(body.techEstimateHours) || 0)) || null;
    if (!ro) return Response.json({ error: "Missing RO" }, { status: 400 });
    await db.batch([
      db.prepare(`INSERT INTO board_job_updates (ro, kind, percent_complete, comment, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(ro, kind, pct, String(body.comment || "").slice(0, 2000), auth.displayName, now),
      db.prepare(`UPDATE board_jobs SET tech_estimate_hours = ?, updated_at = ? WHERE ro = ?`).bind(est, now, ro),
    ]);
    const [allJobs, techs] = await Promise.all([loadJobs(db), loadTechs(db)]);
    const job = allJobs.find((item) => item.ro === ro);
    if (job) await sendInstant(db, await recordUpdateEvent(db as never, { job, techName: techs.find((tech) => tech.initials === job.tech)?.name || (job.tech === UNASSIGNED ? "Unassigned" : job.tech),
      kind, percent: pct, comment: String(body.comment || ""), source: auth.source || "writer", now }).catch(() => null)).catch(() => undefined);
  } else if (body.action === "resize") {
    // Writer drags a block's bottom edge: sets the scheduled duration (15-min snap) and pins it.
    const duration = Math.max(15, minutes(body.durationMinutes, 16 * 60));
    const self = (await loadJobs(db)).find((job) => job.ro === text(body.ro, 40));
    // Growing a block into a later job of the same RO pushes that job (not this one) to after its new end.
    if (self) {
      const all = (await loadJobs(db)).filter((job) => !job.hidden);
      const blocks = all.map((job) => ({ key: job.ro, ro: job.custom ? (job.linkedRo || job.ro) : job.roNumber, laneDate: job.laneDate,
        startMinute: job.startMinute, durationMinutes: job.durationMinutes, tech: job.tech }));
      const push = resizePush(blocks, self.ro, duration);
      if (push) {
        const hit = all.find((job) => job.ro === push.key)!;
        await db.prepare(`UPDATE board_jobs SET start_minute = ?, pinned = 1, placed_by = 'writer', updated_at = ? WHERE ro = ?`).bind(push.start, now, push.key).run();
        notice = `${hit.jobName || `RO#${hit.roNumber}`}${hit.tech !== self.tech ? ` (${hit.tech})` : ""} now starts after this job: jobs on the same RO can't overlap — it's the same car.`;
      }
    }
    await db.prepare(`UPDATE board_jobs SET duration_override_minutes = ?, duration_minutes = ?, pinned = 1, placed_by = 'writer', updated_at = ? WHERE ro = ?`)
      .bind(duration, duration, now, text(body.ro, 40)).run();
    notice = [notice, await applyRipple(db, text(body.ro, 40), now)].filter(Boolean).join(" ");
  } else if (body.action === "edit") {
    const ro = text(body.ro, 40);
    const techs = await loadTechs(db);
    const tech = String(body.tech || UNASSIGNED);
    if (!ro || !isDate(body.laneDate) || (tech !== UNASSIGNED && !techs.some((item) => item.initials === tech))) {
      return Response.json({ error: "Invalid edit" }, { status: 400 });
    }
    // Length is only overridden when the writer actually changed it; otherwise labor hours keep driving it.
    const changed = body.durationMinutes !== null && body.durationMinutes !== undefined && String(body.durationMinutes) !== "";
    const duration = changed ? Math.max(15, minutes(body.durationMinutes, 16 * 60)) : null;
    const linked = body.linkedRo === undefined ? undefined : (text(body.linkedRo, 40).replace(/\D/g, "") || null);
    await db.prepare(`UPDATE board_jobs SET title = ?, note = ?, duration_override_minutes = COALESCE(?, duration_override_minutes),
      duration_minutes = COALESCE(?, duration_minutes), start_minute = ?, tech = ?, lane_date = ?, pinned = 1, placed_by = 'writer',
      linked_ro = CASE WHEN custom = 1 AND ? = 1 THEN ? ELSE linked_ro END, updated_at = ? WHERE ro = ?`)
      .bind(text(body.title, 120), text(body.note, 1000), duration, duration,
        await sameCar(ro, String(body.laneDate), clampStart(minutes(body.startMinute)), duration, tech), tech,
        String(body.laneDate), linked === undefined ? 0 : 1, linked ?? null, now, ro).run();
  } else if (body.action === "delete") {
    // Custom blocks are deleted; Tekmetric ROs are only hidden from this board (Tekmetric is untouched).
    const ro = text(body.ro, 40);
    await db.batch([
      db.prepare(`DELETE FROM board_jobs WHERE ro = ? AND custom = 1`).bind(ro),
      db.prepare(`UPDATE board_jobs SET hidden = 1, pinned = 0, updated_at = ? WHERE ro = ? AND custom = 0`).bind(now, ro),
    ]);
  } else if (body.action === "identifix-request") {
    // v1.6.17: queue an Identifix lookup for the assistant (writer/admin). Board only.
    const value = newIdentifixRequest(body);
    if ("error" in value) return Response.json({ error: value.error }, { status: 400 });
    const id = await addIdentifixRequest(db, value, auth.displayName, now);
    await notifyIdentifixWebhook(webhookBody({ id, ...value })).catch(() => false);
    notice = `Identifix lookup requested for RO#${value.ro}.`;
  } else if (body.action === "ro-vin-set") {
    // v1.6.18: writer-entered VIN on an RO (used to match Bay Scan scans). Empty clears it.
    const ro = String(body.ro || "").replace(/\D/g, "");
    const vin = normalizeVin(body.vin);
    if (!ro) return Response.json({ error: "ro-vin-set needs ro (RO number)" }, { status: 400 });
    if (vin && !validVin(vin)) return Response.json({ error: "VIN must be 17 characters (no I, O or Q)" }, { status: 400 });
    await setRoVin(db as never, ro, vin, auth.displayName, now);
    notice = vin ? `VIN saved for RO#${ro}.` : `VIN cleared for RO#${ro}.`;
  } else if (body.action === "bayscan-attach" || body.action === "bayscan-dismiss") {
    // v1.6.18: writer resolves an unmatched Bay Scan scan (attach to a picked RO, or dismiss).
    const scan = await getScan(db as never, Number(body.id));
    if (!scan || scan.status !== "unmatched") return Response.json({ error: "That scan is no longer in Unmatched scans" }, { status: 404 });
    if (body.action === "bayscan-dismiss") { await markScan(db as never, scan.id, "dismissed", "", auth.displayName, now); notice = "Scan dismissed."; }
    else {
      const number = String(body.ro || "").replace(/\D/g, "");
      const synced = (await loadSyncedRos(db)).find((item) => item.ro === number);
      if (!synced) return Response.json({ error: `RO#${number || "?"} isn't in the synced Tekmetric data` }, { status: 404 });
      await attachScan(db, scan.scan, synced, auth.displayName, now);
      await markScan(db as never, scan.id, "attached", number, auth.displayName, now);
      if (!(await loadRoVins(db)).get(number)) await setRoVin(db as never, number, scan.vin, auth.displayName, now); // next scan of this car matches by itself
      notice = `Scan attached to RO#${number} as a check-in scan.`;
    }
  } else if (body.action === "checkin-set") {
    // v1.6.15: check-in scan codes for an RO (writer or Teams bot). Board only; triage, not a diagnosis.
    const ro = String(body.ro || "").replace(/\D/g, "");
    if (!ro) return Response.json({ error: "checkin-set needs ro (RO number)" }, { status: 400 });
    await saveCheckin(db, ro, normalizeDtcs(body.codes), text(body.notes, 2000), auth.displayName, now);
    notice = `Check-in scan saved for RO#${ro}.`;
  } else if (body.action === "add-ro") {
    // v1.6.9 search-to-add: any reader-synced RO (incl. unapproved / $0 labor) becomes a writer block linked to it.
    // Custom blocks persist through reader syncs and the start-date cutoff. Board only — Tekmetric untouched.
    const number = text(body.ro, 40).replace(/\D/g, "");
    const synced = (await loadSyncedRos(db)).find((item) => item.ro === number);
    if (!number || !synced) return Response.json({ error: `RO#${number || "?"} isn't in the synced Tekmetric data` }, { status: 404 });
    const given = Number(body.durationMinutes);
    const duration = Number.isFinite(given) && given > 0 ? given : Math.round((synced.hours > 0 ? synced.hours : 1) * 60);
    return runBoardAction(db, { action: "add-custom", tech: body.tech || UNASSIGNED, laneDate: body.laneDate, startMinute: body.startMinute,
      durationMinutes: duration, title: body.title || "", note: body.note || "", linkedRo: number }, auth);
  } else if (body.action === "add-custom") {
    const tech = String(body.tech || UNASSIGNED);
    if (!isDate(body.laneDate)) return Response.json({ error: "Invalid date" }, { status: 400 });
    const duration = Math.max(15, minutes(body.durationMinutes, 16 * 60));
    const linkedRo = text(body.linkedRo, 40).replace(/\D/g, "");
    let addStart = boardStart(body.startMinute);
    if (linkedRo && tech !== UNASSIGNED && addStart >= 0) {
      const all = (await loadJobs(db)).filter((job) => !job.hidden);
      const snapped = snapSameRo(all.map((job) => ({ key: job.ro, ro: job.custom ? (job.linkedRo || job.ro) : job.roNumber, laneDate: job.laneDate,
        startMinute: job.startMinute, durationMinutes: job.durationMinutes, tech: job.tech })), "__new__", linkedRo, String(body.laneDate), addStart, duration);
      if (snapped.conflictWith) notice = `Moved to start after another job on RO#${linkedRo}: jobs on the same RO can't overlap — it's the same car.`;
      addStart = snapped.start;
    }
    await db.prepare(`INSERT INTO board_jobs (ro, tech, lane_date, start_minute, duration_minutes, duration_override_minutes, pinned,
      placed_by, status, title, note, custom, updated_at, linked_ro) VALUES (?, ?, ?, ?, ?, ?, 1, 'writer', 'custom', ?, ?, 1, ?, ?)`)
      .bind(`C-${Date.now().toString(36)}`, tech, String(body.laneDate), addStart, duration, duration,
        text(body.title, 120) || (body.linkedRo ? "" : "Custom block"), text(body.note, 1000), now,
        text(body.linkedRo, 40).replace(/\D/g, "") || null).run();
  } else if (body.action === "schedule-request-add") {
    // Shared writer inbox only. Does not place, move, or sync a job — writers or the schedule bot do that afterward.
    const source = auth.source === "teams-bot" ? "teams-bot" as const : "writer" as const;
    const value = newScheduleRequest(body, { name: text(body.name, 60), source });
    if ("error" in value) return Response.json({ error: value.error }, { status: 400 });
    const id = await addScheduleRequest(db, value, now);
    const request = await getScheduleRequest(db, id);
    await sendInstant(db, await recordScheduleRequestEvent(db as never, { change: "new", id, submitter: value.submitter, text: value.text, source: value.source, now }).catch(() => null));
    return Response.json({ ...(await boardPayload(db, typeof body.laneDate === "string" ? body.laneDate : null)), scheduleRequest: request });
  } else if (body.action === "schedule-request-ack") {
    const current = await getScheduleRequest(db, Number(body.id) || 0);
    const named = String(body.name ?? "").trim();
    const decision = scheduleRequestAck(current, named || (auth.source === "teams-bot" ? auth.displayName : "Writer"));
    if ("error" in decision) return Response.json({ error: decision.error }, { status: decision.status });
    await markScheduleRequestDone(db, decision.id, decision.doneBy, now);
    const request = await getScheduleRequest(db, decision.id);
    await sendInstant(db, await recordScheduleRequestEvent(db as never, { change: "done", id: decision.id, submitter: request?.submitter || "", text: request?.text || "", doneBy: decision.doneBy, source: auth.source, now }).catch(() => null));
    return Response.json({ ...(await boardPayload(db, typeof body.laneDate === "string" ? body.laneDate : null)), scheduleRequest: request });
  } else if (body.action === "suggest-add") {
    const value = newSuggestion(body, { name: text(body.name, 60) });
    if ("error" in value) return Response.json({ error: value.error }, { status: 400 });
    const id = await addSuggestion(db, value, now);
    await sendInstant(db, await recordSuggestionEvent(db as never, { change: "new", id, submitter: value.submitter, source: value.source, text: value.text, now }).catch(() => null));
    return Response.json(await boardPayload(db, typeof body.laneDate === "string" ? body.laneDate : null));
  } else if (body.action === "suggest-update") {
    const value = suggestionUpdate(body);
    if ("error" in value) return Response.json({ error: value.error }, { status: 400 });
    await db.prepare(`UPDATE board_suggestions SET status = ?, reply = ?, updated_at = ? WHERE id = ?`).bind(value.status, value.reply, now, value.id).run();
    const row = await db.prepare(`SELECT text, submitter, source FROM board_suggestions WHERE id = ?`).bind(value.id).first<Record<string, unknown>>();
    if (row) await sendInstant(db, await recordSuggestionEvent(db as never, { change: "update", id: value.id, submitter: String(row.submitter || ""),
      source: String(row.source || "writer"), text: String(row.text || ""), status: value.status, reply: value.reply, now }).catch(() => null));
    return Response.json(await boardPayload(db, typeof body.laneDate === "string" ? body.laneDate : null));
  } else if (body.action === "pin-set") {
    // Writers set a tech's /tech PIN. Stored as a salted PBKDF2 hash only; changing it signs out old tech sessions.
    const techs = await loadTechs(db);
    const initials = String(body.initials || "");
    if (!techs.some((item) => item.initials === initials) || !validPin(body.pin)) return Response.json({ error: "PIN must be 4–8 digits" }, { status: 400 });
    const salt = newSalt();
    await db.prepare(`INSERT INTO tech_pins (initials, salt, pin_hash, iterations, failed_attempts, locked_until, updated_at)
      VALUES (?, ?, ?, ?, 0, NULL, ?) ON CONFLICT(initials) DO UPDATE SET salt = excluded.salt, pin_hash = excluded.pin_hash,
      iterations = excluded.iterations, failed_attempts = 0, locked_until = NULL, updated_at = excluded.updated_at`)
      .bind(initials, salt, await hashPin(String(body.pin), salt), PIN_ITERATIONS, now).run();
    return Response.json(await boardPayload(db, typeof body.laneDate === "string" ? body.laneDate : null));
  } else if (body.action === "pin-clear") {
    await db.prepare(`DELETE FROM tech_pins WHERE initials = ?`).bind(String(body.initials || "")).run();
    return Response.json(await boardPayload(db, typeof body.laneDate === "string" ? body.laneDate : null));
  } else if (body.action === "timeoff-save") {
    // Time off blocks the tech's column immediately (Staff Apt/Vacations blue). Writers can edit or remove it.
    const techs = await loadTechs(db);
    const initials = String(body.initials || "");
    if (!techs.some((item) => item.initials === initials) || !isDate(body.date)) return Response.json({ error: "Invalid time off" }, { status: 400 });
    const allDay = Boolean(body.allDay);
    const start = allDay ? 0 : minutes(body.startMinute);
    const end = allDay ? 0 : Math.max(start + 15, minutes(body.endMinute));
    if (body.id) {
      await db.prepare(`UPDATE tech_time_off SET initials = ?, date = ?, start_minute = ?, end_minute = ?, all_day = ?, reason = ? WHERE id = ?`)
        .bind(initials, String(body.date), start, end, allDay ? 1 : 0, text(body.reason, 300), Number(body.id)).run();
    } else {
      await db.prepare(`INSERT INTO tech_time_off (initials, date, start_minute, end_minute, all_day, reason, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(initials, String(body.date), start, end, allDay ? 1 : 0, text(body.reason, 300), auth.displayName, now).run();
    }
  } else if (body.action === "timeoff-delete") {
    await db.prepare(`DELETE FROM tech_time_off WHERE id = ?`).bind(Number(body.id) || 0).run();
  } else if (body.action === "pool-request") {
    // A tech asks for an open/unassigned job. A writer approves it from the Requests list.
    const techs = await loadTechs(db);
    if (!body.ro || !techs.some((item) => item.initials === String(body.tech))) return Response.json({ error: "Invalid request" }, { status: 400 });
    await db.prepare(`INSERT INTO board_pool_requests (ro, tech, status, note, created_at) VALUES (?, ?, 'pending', ?, ?)`)
      .bind(text(body.ro, 40), String(body.tech), text(body.note, 300), now).run();
  } else if (body.action === "pool-decide") {
    const request = await db.prepare(`SELECT * FROM board_pool_requests WHERE id = ? AND status = 'pending'`).bind(Number(body.id) || 0)
      .first<Record<string, unknown>>();
    if (!request) return Response.json({ error: "Request not found" }, { status: 404 });
    const approve = body.decision === "approve";
    const statements = [db.prepare(`UPDATE board_pool_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?`)
      .bind(approve ? "approved" : "declined", auth.displayName, now, Number(request.id))];
    if (approve) {
      // Place it in the tech's first open slot today (after lunch rules), pinned as a writer placement.
      const day = isDate(body.laneDate) ? String(body.laneDate) : shopDays(chicagoDate(new Date()), 1)[0];
      const jobs = (await loadJobs(db)).filter((job) => job.tech === String(request.tech) && job.laneDate === day && !job.hidden);
      const target = (await loadJobs(db)).find((job) => job.ro === String(request.ro));
      const duration = target?.durationMinutes ?? 60;
      const offs = (await loadTimeOff(db)).filter((off) => off.initials === String(request.tech) && off.date === day)
        .map((off) => ({ start: off.allDay ? 0 : off.startMinute, end: off.allDay ? dayWallLimit(480) : off.endMinute }));
      const busy = [...jobs.map((job) => ({ start: job.startMinute, end: wallEnd(job.startMinute, job.durationMinutes) })), ...offs]
        .sort((a, b) => a.start - b.start);
      let start = 0;
      for (const item of busy) { if (wallEnd(start, duration) <= item.start) break; if (item.end > start) start = clampStart(item.end); }
      statements.push(db.prepare(`UPDATE board_jobs SET tech = ?, lane_date = ?, start_minute = ?, pinned = 1, placed_by = 'writer', updated_at = ? WHERE ro = ?`)
        .bind(String(request.tech), day, start, now, String(request.ro)));
    }
    await db.batch(statements);
  } else if (body.action === "set-start-date") {
    if (!isDate(body.date)) return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    await setStartDate(db, String(body.date), now);
    notice = `Board start date set to ${body.date}. ROs first seen before it are not added.`;
  } else if (body.action === "remove-mirror-blocks") {
    // Delete the hand-made copies of Tekmetric's schedule so the real (mirrored) jobs replace them. Board only.
    const note = "Mirrored from Tekmetric schedule 11/3";
    const rows = (await loadJobs(db)).filter((job) => job.custom && job.note.trim() === note);
    if (rows.length) await db.batch(rows.map((job) => db.prepare(`DELETE FROM board_jobs WHERE ro = ? AND custom = 1`).bind(job.ro)));
    notice = `Removed ${rows.length} mirrored block${rows.length === 1 ? "" : "s"}.`;
  } else if (body.action === "dedupe-front-office") {
    // Hide synced Front office rows whose RO already has a custom block (board only; Tekmetric untouched).
    const all = await loadJobs(db);
    const blockRos = new Set(all.filter((job) => job.custom && !job.hidden).map(blockRo).filter(Boolean));
    const dupes = all.filter((job) => !job.custom && !job.hidden && job.status === "front-office" && blockRos.has(job.roNumber));
    if (dupes.length) await db.batch(dupes.map((job) => db.prepare(`UPDATE board_jobs SET hidden = 1, updated_at = ? WHERE ro = ?`).bind(now, job.ro)));
    notice = `Hid ${dupes.length} duplicate Front office job${dupes.length === 1 ? "" : "s"}${dupes.length ? `: ${dupes.map((job) => job.ro).join(", ")}` : ""}.`;
  } else if (body.action !== "recompute") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  await recomputeTechBoard(db);
  // v1.6.16: a new tech estimate or % changes the block's length — ripple that tech's later blocks.
  if (body.action === "update") {
    const rippled = await applyRipple(db, String(body.ro || ""), now);
    if (rippled) { notice = rippled; await recomputeTechBoard(db); }
  }
  return Response.json({ ...(await boardPayload(db, typeof body.laneDate === "string" ? body.laneDate : null)), notice });
}
