import { botAuth, botToBoardAction } from "@/app/lib/bot-auth";
import { runtimeEnv } from "@/app/lib/runtime";
import { boardAction, boardPayload } from "@/app/tech-board/actions";
import { chicagoDate, shopDays } from "@/app/tech-board/scheduler";
import { claimIdentifixRequest, finishIdentifixRequest, getIdentifixRequest, initializeTechBoard, loadIdentifixRequests, loadJobs, loadScheduleRequests, recomputeTechBoard, techBoardDb } from "@/app/tech-board/store";
import { parseIdentifixResult } from "@/app/tech-board/identifix";

const IDENTIFIX_BOT_ACTIONS = ["list-identifix-requests", "claim-identifix-request", "post-identifix-result", "fail-identifix-request"];

/** v1.6.17: the assistant's Identifix queue. Board D1 only. */
async function identifixBotAction(body: Record<string, unknown>, actor: string) {
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const now = new Date().toISOString();
  const action = String(body.action);
  if (action === "list-identifix-requests") {
    const requests = await loadIdentifixRequests(db, "queued");
    return Response.json({ ok: true, requests: requests.map(({ id, ro, customer, vehicle, codes, symptom, requestedBy, requestedAt }) => ({ id, ro, customer, vehicle, codes, symptom, requestedBy, requestedAt })) });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: `${action} needs id` }, { status: 400 });
  const current = await getIdentifixRequest(db, id);
  if (!current) return Response.json({ error: "No such Identifix request" }, { status: 404 });
  if (action === "claim-identifix-request") {
    const claimed = await claimIdentifixRequest(db, id, actor, now);
    if (!claimed) return Response.json({ error: `Request ${id} is ${current.status}, not queued` }, { status: 409 });
    return Response.json({ ok: true, request: claimed });
  }
  if (current.status === "done" || current.status === "failed") return Response.json({ error: `Request ${id} is already ${current.status}` }, { status: 409 });
  if (action === "post-identifix-result") {
    if (body.ro !== undefined && String(body.ro).replace(/\D/g, "") !== current.ro) return Response.json({ error: `ro does not match request ${id} (RO#${current.ro})` }, { status: 400 });
    const result = parseIdentifixResult(body);
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true, request: await finishIdentifixRequest(db, id, { result }, now) });
  }
  return Response.json({ ok: true, request: await finishIdentifixRequest(db, id, { failReason: String(body.reason || "Lookup failed") }, now) });
}

// Teams bot API: writer-level Tech Board changes with a bearer key (Worker secret TECH_BOARD_BOT_KEY).
// Board D1 tables only — never Tekmetric. Every change is logged with source='teams-bot'.
// Tech PIN sessions can't reach this path (server gate in worker/index.ts allows only /tech and /api/tech).

async function authorize(request: Request) {
  const env = await runtimeEnv().catch(() => ({} as Record<string, unknown>));
  return botAuth(request.headers.get("authorization"), env.TECH_BOARD_BOT_KEY);
}

/** GET ?date=YYYY-MM-DD → that day's board (jobs, time off, techs). */
export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const db = await techBoardDb();
  await initializeTechBoard(db);
  if ((await loadJobs(db)).length === 0) await recomputeTechBoard(db);
  const board = await boardPayload(db, new URL(request.url).searchParams.get("date"));
  return Response.json({
    date: board.date, days: board.days, version: board.version, startDate: board.startDate, techs: board.techs.filter((tech) => tech.active).map((tech) => ({ initials: tech.initials, name: tech.name })),
    jobs: board.jobs.filter((job) => job.laneDate === board.date).map((job) => ({ ro: job.ro, roNumber: job.roNumber, jobName: job.jobName,
      customer: job.customer, vehicle: job.vehicle, tech: job.tech, startMinute: job.startMinute, durationMinutes: job.durationMinutes,
      status: job.status, carriedOver: job.carriedOver, custom: job.custom, title: job.title, linkedRo: job.custom ? job.linkedRo : undefined,
      percentComplete: board.updates.find((update) => update.ro === job.ro)?.percentComplete ?? null })),
    timeOff: board.timeOff.filter((off) => off.date === board.date),
    scheduleRequests: (await loadScheduleRequests(db, "open")).map(({ id, text, submitter, source, status, createdAt }) => ({ id, text, submitter, source, status, createdAt })),
  });
}

/** POST { action: move | resize | add-block | add-ro | add-time-off | set-percent, ...; by?: "who asked in Teams" } */
export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (IDENTIFIX_BOT_ACTIONS.includes(String(body.action))) return identifixBotAction(body, `Teams bot${body.by ? ` (${String(body.by).slice(0, 60)})` : ""}`);
  if (String(body.action) === "list-schedule-requests") {
    const db = await techBoardDb();
    await initializeTechBoard(db);
    const requests = await loadScheduleRequests(db, body.includeDone === true ? "inbox" : "open");
    return Response.json({ ok: true, requests });
  }
  const mapped = botToBoardAction(body);
  if ("error" in mapped) return Response.json({ error: mapped.error }, { status: 400 });
  // No date given → today (first shop day, Central).
  const today = shopDays(chicagoDate(new Date()), 1)[0];
  if ("laneDate" in mapped && !mapped.laneDate) mapped.laneDate = today;
  if (mapped.action === "timeoff-save" && !mapped.date) mapped.date = today;
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const actor = `Teams bot${body.by ? ` (${String(body.by).slice(0, 60)})` : ""}`;
  const response = await boardAction(db, mapped as Record<string, unknown> & { action?: string }, actor, "teams-bot");
  if (!response.ok) return response;
  const data = await response.json() as Record<string, unknown>;
  return Response.json({ ok: true, notice: data.notice || "", date: data.date, ...(data.scheduleRequest ? { scheduleRequest: data.scheduleRequest } : {}) });
}
