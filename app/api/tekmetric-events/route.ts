import { requireApiUser } from "@/app/chatgpt-auth";
import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";

function signalRecord(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  return {
    key: String(row.signal_key),
    eventName: String(row.event_name || ""),
    roNumber: String(row.repair_order_number || ""),
    detail: String(row.detail || ""),
    occurredAt: String(row.occurred_at || ""),
    receivedAt: String(row.received_at || ""),
  };
}

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await ensureSchema(env.DB);

  const signalRows = await env.DB.prepare(`
    SELECT signal_key, event_name, repair_order_number, detail, occurred_at, received_at
    FROM tekmetric_webhook_signals
  `).all<Record<string, unknown>>();
  const signals = Object.fromEntries(
    signalRows.results.map((row) => [String(row.signal_key), signalRecord(row)]),
  );

  const recent = await env.DB.prepare(`
    SELECT id, event_family, event_name, source_event, repair_order_number, appointment_id,
      label, decision, hours, occurred_at, received_at, side_effects_json
    FROM tekmetric_webhook_events
    ORDER BY received_at DESC, id DESC
    LIMIT 25
  `).all<Record<string, unknown>>();

  const lastRow = recent.results[0];
  return Response.json({
    lastEventAt: lastRow ? String(lastRow.received_at) : null,
    signals: {
      overviewFreshness: signals.overview_freshness || null,
      posted: signals.overview_posted || null,
      completed: signals.overview_completed || null,
      ar: signals.overview_ar || null,
      payment: signals.overview_payment || null,
      unposted: signals.overview_unposted || null,
      lastApproval: signals.last_approval || null,
      lastDecline: signals.last_decline || null,
      scheduleChanged: signals.schedule_changed || null,
      warrantyLabel: signals.warranty_label || null,
      labelChange: signals.label_change || null,
      orderReceived: signals.order_received || null,
      inspection: signals.inspection || null,
    },
    recentEvents: recent.results.map((row) => ({
      id: Number(row.id),
      family: String(row.event_family),
      eventName: String(row.event_name),
      sourceEvent: String(row.source_event || ""),
      roNumber: String(row.repair_order_number || ""),
      appointmentId: String(row.appointment_id || ""),
      label: String(row.label || ""),
      decision: String(row.decision || ""),
      hours: row.hours == null ? null : Number(row.hours),
      occurredAt: row.occurred_at ? String(row.occurred_at) : null,
      receivedAt: String(row.received_at),
      effects: JSON.parse(String(row.side_effects_json || "[]")),
    })),
  });
}
