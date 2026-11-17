import { checkinRo } from "@/app/tech-board/dtc";
import { headers } from "next/headers";
import { runtimeEnv } from "@/app/lib/runtime";
import { APP_VERSION } from "@/app/lib/version";
import {
  clearTechCookie, createTechCookie, hashPin, readTechSession, sessionSecretFrom, timingSafeEqual, validPin,
} from "@/app/lib/tech-session";
import { UNASSIGNED, chicagoDate, hiddenFromTech, shopDays } from "@/app/tech-board/scheduler";
import { newSuggestion } from "@/app/tech-board/suggestions";
import { addSuggestion, loadSuggestions } from "@/app/tech-board/store";
import { recordSuggestionEvent, recordUpdateEvent } from "@/app/tech-board/events";
import { sendInstant } from "@/app/tech-board/teams-notify";
import { applyRipple } from "@/app/tech-board/actions";
import { loadIdentifixRequests, loadCheckins, initializeTechBoard, loadJobs, loadLatestUpdates, loadPoolRequests, loadTechs, loadTimeOff, pinRow, recomputeTechBoard, techBoardDb } from "@/app/tech-board/store";

// /tech API: a tech signed in with their own PIN sees and changes only their own work.
// Board-only (D1). Nothing is ever written to Tekmetric.

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const minutes = (value: unknown) => Math.max(0, Math.min(24 * 60, Math.round((Number(value) || 0) / 15) * 15));
const isDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

async function session(db: Awaited<ReturnType<typeof techBoardDb>>) {
  const secret = sessionSecretFrom(await runtimeEnv().catch(() => ({})));
  const current = await readTechSession((await headers()).get("cookie"), secret);
  if (!current) return null;
  const row = await pinRow(db, current.initials);
  // A changed or cleared PIN invalidates older sessions.
  return row && String(row.updated_at) === current.version ? current.initials : null;
}

async function techPayload(db: Awaited<ReturnType<typeof techBoardDb>>, initials: string) {
  const today = shopDays(chicagoDate(new Date()), 1)[0];
  const [techs, jobs, updates, timeOff, requests] = await Promise.all([loadTechs(db), loadJobs(db), loadLatestUpdates(db), loadTimeOff(db), loadPoolRequests(db, true)]);
  const tech = techs.find((item) => item.initials === initials);
  const visible = jobs.filter((job) => !job.hidden && !hiddenFromTech(job)); // v1.6.14: no front office on /tech
  const mine = visible.filter((job) => job.tech === initials && job.laneDate === today).sort((a, b) => a.startMinute - b.startMinute);
  const pool = visible.filter((job) => !job.custom && job.tech === UNASSIGNED).map((job) => ({
    ro: job.ro, roNumber: job.roNumber, jobName: job.jobName, customer: job.customer, vehicle: job.vehicle, label: job.label, hours: job.laborGuideHours, durationMinutes: job.durationMinutes }));
  const ros = new Set([...mine.map((job) => job.ro), ...pool.map((job) => job.ro)]);
  // v1.6.15: DTC → Identifix + check-in scan are off for techs unless the Worker var IDENTIFIX_FOR_TECHS = "1".
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const identifix = String(env.IDENTIFIX_FOR_TECHS ?? "") === "1";
  const myRos = new Set(mine.map((job) => checkinRo(job)));
  const checkins = identifix ? (await loadCheckins(db)).filter((item) => myRos.has(item.ro)) : [];
  // v1.6.17: Identifix results panel hidden from techs unless the Worker var IDENTIFIX_RESULTS_FOR_TECHS = "1".
  const identifixResults = String(env.IDENTIFIX_RESULTS_FOR_TECHS ?? "") === "1";
  const identifixRequests = identifixResults ? (await loadIdentifixRequests(db)).filter((item) => item.status === "done" && myRos.has(item.ro)) : [];
  return {
    features: { identifix, identifixResults }, checkins, identifixRequests,
    version: APP_VERSION, today, tech: tech ? { initials: tech.initials, name: tech.name, dayStartMinute: tech.dayStartMinute } : { initials, name: initials, dayStartMinute: 480 },
    jobs: mine, pool, updates: updates.filter((update) => ros.has(update.ro)),
    timeOff: timeOff.filter((off) => off.initials === initials),
    suggestions: await loadSuggestions(db, initials),
    requests: requests.filter((request) => request.tech === initials).map((request) => ({ id: request.id, ro: request.ro, status: request.status, createdAt: request.createdAt })),
  };
}

export async function GET() {
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const initials = await session(db);
  if (!initials) {
    const techs = await loadTechs(db);
    return Response.json({ signedIn: false, version: APP_VERSION, techs: techs.filter((tech) => tech.active).map((tech) => ({ initials: tech.initials, name: tech.name })) });
  }
  return Response.json({ signedIn: true, ...(await techPayload(db, initials)) });
}

export async function POST(request: Request) {
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const now = new Date();
  if (body.action === "login") {
    const initials = String(body.initials || "");
    const row = await pinRow(db, initials);
    if (!row) return Response.json({ error: "No PIN is set for this tech yet. Ask a writer." }, { status: 401 });
    if (row.locked_until && Date.parse(String(row.locked_until)) > now.getTime()) {
      return Response.json({ error: "Too many tries. Wait 15 minutes or ask a writer." }, { status: 429 });
    }
    const ok = validPin(body.pin) && timingSafeEqual(await hashPin(String(body.pin), String(row.salt), Number(row.iterations)), String(row.pin_hash));
    if (!ok) {
      const fails = Number(row.failed_attempts || 0) + 1;
      await db.prepare(`UPDATE tech_pins SET failed_attempts = ?, locked_until = ? WHERE initials = ?`)
        .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_MINUTES * 60000).toISOString() : null, initials).run();
      return Response.json({ error: "Wrong PIN" }, { status: 401 });
    }
    await db.prepare(`UPDATE tech_pins SET failed_attempts = 0, locked_until = NULL WHERE initials = ?`).bind(initials).run();
    const secret = sessionSecretFrom(await runtimeEnv().catch(() => ({})));
    if (!secret) return Response.json({ error: "Sign-in is not configured" }, { status: 500 });
    return Response.json({ signedIn: true, ...(await techPayload(db, initials)) },
      { headers: { "Set-Cookie": await createTechCookie(secret, initials, String(row.updated_at)) } });
  }
  if (body.action === "logout") return Response.json({ signedIn: false }, { headers: { "Set-Cookie": clearTechCookie() } });

  const initials = await session(db);
  if (!initials) return Response.json({ error: "Sign in with your PIN" }, { status: 401 });
  const stamp = now.toISOString();
  const today = shopDays(chicagoDate(now), 1)[0];
  const jobs = await loadJobs(db);
  if (body.action === "update") {
    // Only the tech's own jobs.
    const job = jobs.find((item) => item.ro === String(body.ro) && item.tech === initials && !hiddenFromTech(item));
    if (!job) return Response.json({ error: "Not your job" }, { status: 403 });
    const kinds = ["note", "Need parts", "Wrong part", "Need help", "Waiting approval", "Found more work", "Done", "Diag Done"];
    const pct = body.percentComplete === null || body.percentComplete === undefined || String(body.percentComplete) === "" ? null
      : Math.max(0, Math.min(100, Number(body.percentComplete) || 0));
    await db.prepare(`INSERT INTO board_job_updates (ro, kind, percent_complete, comment, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(job.ro, kinds.includes(String(body.kind)) ? String(body.kind) : "note", pct, String(body.comment || "").slice(0, 2000), `Tech ${initials}`, stamp).run();
    // v1.6.12: same ticket controls as the writer card — tech estimate (h) on the tech's own job only.
    if (body.techEstimateHours !== undefined) {
      const est = body.techEstimateHours === null || String(body.techEstimateHours) === "" ? null
        : Math.max(0, Math.min(40, Number(body.techEstimateHours) || 0)) || null;
      await db.prepare(`UPDATE board_jobs SET tech_estimate_hours = ?, updated_at = ? WHERE ro = ? AND tech = ?`).bind(est, stamp, job.ro, initials).run();
    }
    const techName = (await loadTechs(db)).find((tech) => tech.initials === initials)?.name || initials;
    await sendInstant(db, await recordUpdateEvent(db as never, { job, techName, kind: kinds.includes(String(body.kind)) ? String(body.kind) : "note", percent: pct,
      comment: String(body.comment || ""), source: "tech", now: stamp }).catch(() => null)).catch(() => undefined);
  } else if (body.action === "pool-request") {
    const job = jobs.find((item) => item.ro === String(body.ro) && item.tech === UNASSIGNED && !item.custom && !item.hidden);
    if (!job) return Response.json({ error: "That job is no longer open" }, { status: 409 });
    const dup = await db.prepare(`SELECT id FROM board_pool_requests WHERE ro = ? AND tech = ? AND status = 'pending'`).bind(job.ro, initials).first();
    if (!dup) await db.prepare(`INSERT INTO board_pool_requests (ro, tech, status, note, created_at) VALUES (?, ?, 'pending', '', ?)`).bind(job.ro, initials, stamp).run();
  } else if (body.action === "suggest") {
    // Submitter always comes from the PIN session; a typed name is ignored.
    const value = newSuggestion(body, { tech: initials });
    if ("error" in value) return Response.json({ error: value.error }, { status: 400 });
    const sid = await addSuggestion(db, value, stamp);
    await sendInstant(db, await recordSuggestionEvent(db as never, { change: "new", id: sid, submitter: (await loadTechs(db)).find((tech) => tech.initials === initials)?.name || initials, source: "tech", text: value.text, now: stamp }).catch(() => null));
  } else if (body.action === "timeoff") {
    // Applies immediately to the tech's own column and shows in the writers' Requests list.
    if (!isDate(body.date) || String(body.date) < today) return Response.json({ error: "Pick today or a later date" }, { status: 400 });
    const allDay = Boolean(body.allDay);
    const start = allDay ? 0 : minutes(body.startMinute);
    const end = allDay ? 0 : Math.max(start + 15, minutes(body.endMinute));
    await db.prepare(`INSERT INTO tech_time_off (initials, date, start_minute, end_minute, all_day, reason, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(initials, String(body.date), start, end, allDay ? 1 : 0, String(body.reason || "").slice(0, 300), `Tech ${initials}`, stamp).run();
    await recomputeTechBoard(db);
  } else {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  if (body.action === "update") {
    await recomputeTechBoard(db);
    // v1.6.16: the tech's own %/estimate changed their block's length — push their own later blocks (their day only).
    const own = (await loadJobs(db)).find((item) => item.ro === String(body.ro) && item.tech === initials);
    if (own && await applyRipple(db, own.ro, stamp)) await recomputeTechBoard(db);
  }
  return Response.json({ signedIn: true, ...(await techPayload(db, initials)) });
}
