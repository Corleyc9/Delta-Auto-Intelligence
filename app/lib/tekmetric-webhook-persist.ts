import { weekContext } from "@/app/lib/calendar";
import type { NormalizedTekmetricEvent, PlannedSideEffect } from "@/app/lib/tekmetric-webhook";
import { planWebhookSideEffects, soldHoursDelta } from "@/app/lib/tekmetric-webhook";

export async function persistTekmetricWebhook(options: {
  database: D1Database;
  event: NormalizedTekmetricEvent;
  rawBody: string;
  headersJson: string;
  receivedAt: string;
  truncated: boolean;
}): Promise<{ duplicate: boolean; eventId: number | null; effects: string[] }> {
  const existing = await options.database.prepare(
    "SELECT id FROM tekmetric_webhook_events WHERE delivery_id = ?",
  ).bind(options.event.deliveryId).first<{ id: number }>();
  if (existing?.id) {
    return { duplicate: true, eventId: existing.id, effects: [] };
  }

  let inserted: { id: number } | null = null;
  try {
    inserted = await options.database.prepare(`
      INSERT INTO tekmetric_webhook_events (
        delivery_id, event_family, event_name, source_event, shop_id, shop_matches,
        repair_order_id, repair_order_number, appointment_id, payment_id, inspection_id, order_id,
        customer, vehicle, service_writer, label, status, hours, amount, decision,
        occurred_at, received_at, raw_headers_json, raw_body, payload_json, truncated, side_effects_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
      RETURNING id
    `).bind(
      options.event.deliveryId,
      options.event.family,
      options.event.eventName,
      options.event.sourceEvent,
      options.event.shopId,
      options.event.shopMatches ? 1 : 0,
      options.event.repairOrderId,
      options.event.repairOrderNumber,
      options.event.appointmentId,
      options.event.paymentId,
      options.event.inspectionId,
      options.event.orderId,
      options.event.customer,
      options.event.vehicle,
      options.event.serviceWriter,
      options.event.label,
      options.event.status,
      options.event.hours,
      options.event.amount,
      options.event.decision,
      options.event.occurredAt,
      options.receivedAt,
      options.headersJson,
      options.rawBody,
      JSON.stringify(options.event.payload).slice(0, 100_000),
      options.truncated ? 1 : 0,
    ).first<{ id: number }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) {
      const raced = await options.database.prepare(
        "SELECT id FROM tekmetric_webhook_events WHERE delivery_id = ?",
      ).bind(options.event.deliveryId).first<{ id: number }>();
      return { duplicate: true, eventId: raced?.id || null, effects: [] };
    }
    throw error;
  }

  const eventId = inserted?.id ?? null;
  const planned = planWebhookSideEffects(options.event);
  const applied = await applyWebhookSideEffects(options.database, options.event, planned, options.receivedAt, eventId);
  if (eventId) {
    await options.database.prepare(
      "UPDATE tekmetric_webhook_events SET side_effects_json = ? WHERE id = ?",
    ).bind(JSON.stringify(applied), eventId).run();
  }
  return { duplicate: false, eventId, effects: applied };
}

async function upsertSignal(
  database: D1Database,
  key: string,
  eventName: string,
  roNumber: string,
  detail: string,
  occurredAt: string,
  eventId: number | null,
) {
  await database.prepare(`
    INSERT INTO tekmetric_webhook_signals
      (signal_key, event_id, event_name, repair_order_number, detail, occurred_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signal_key) DO UPDATE SET
      event_id = excluded.event_id,
      event_name = excluded.event_name,
      repair_order_number = excluded.repair_order_number,
      detail = excluded.detail,
      occurred_at = excluded.occurred_at,
      received_at = excluded.received_at
  `).bind(key, eventId, eventName, roNumber, detail.slice(0, 300), occurredAt, occurredAt).run();
}

async function applyWebhookSideEffects(
  database: D1Database,
  event: NormalizedTekmetricEvent,
  planned: PlannedSideEffect[],
  receivedAt: string,
  eventId: number | null,
): Promise<string[]> {
  const applied: string[] = [];
  const occurredAt = event.occurredAt || receivedAt;
  const week = weekContext(occurredAt);

  for (const effect of planned) {
    if (effect.type === "sold_hours_candidate") {
      const prior = await database.prepare(
        "SELECT sold_hours FROM ro_sold_hours_watch_v2 WHERE ro_number = ?",
      ).bind(effect.roNumber).first<{ sold_hours: number }>();
      const priorHours = prior ? Number(prior.sold_hours) || 0 : undefined;
      const hoursDelta = soldHoursDelta(priorHours, effect.hours, 0, 0);
      if (hoursDelta > 0.001) {
        await database.prepare(`
          INSERT INTO ro_sold_hours_events_v2
            (ro_number, customer, vehicle, hours_delta, week_key, captured_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(effect.roNumber, effect.customer, effect.vehicle, hoursDelta, week.weekKey, occurredAt).run();
        applied.push(`sold_hours:+${hoursDelta}`);
      }
      await database.prepare(`
        INSERT INTO ro_sold_hours_watch_v2 (ro_number, sold_hours, last_seen_at)
        VALUES (?, ?, ?)
        ON CONFLICT(ro_number) DO UPDATE SET
          sold_hours = MAX(ro_sold_hours_watch_v2.sold_hours, excluded.sold_hours),
          last_seen_at = excluded.last_seen_at
      `).bind(effect.roNumber, effect.hours, occurredAt).run();
      applied.push("sold_hours_watch");
    }

    if (effect.type === "approval") {
      await database.prepare(`
        INSERT INTO ro_approval_events
          (ro_number, customer, vehicle, decision, hours, occurred_at, received_at, webhook_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        effect.roNumber, effect.customer, effect.vehicle, effect.decision,
        effect.hours, occurredAt, receivedAt, eventId,
      ).run();
      await upsertSignal(
        database,
        effect.decision === "approved" ? "last_approval" : "last_decline",
        event.eventName,
        effect.roNumber,
        `Work ${effect.decision}${effect.hours != null ? ` (${effect.hours} hrs in payload)` : " (hours pending reader)"}`,
        occurredAt,
        eventId,
      );
      applied.push(`approval:${effect.decision}`);
    }

    if (effect.type === "diagnosis_watch") {
      const watch = await database.prepare(
        "SELECT needs_diag_present FROM ro_diagnosis_watch WHERE ro_number = ?",
      ).bind(effect.roNumber).first<{ needs_diag_present: number }>();
      const pending = await database.prepare(
        "SELECT id FROM ro_verification_cycles WHERE ro_number = ? AND status = 'pending'",
      ).bind(effect.roNumber).first<{ id: number }>();
      const wasNeedsDiag = Number(watch?.needs_diag_present) === 1;
      const diagnosisCompleted = wasNeedsDiag && !effect.needsDiag;

      await database.prepare(`
        INSERT INTO ro_diagnosis_watch (ro_number, needs_diag_present, last_label, last_seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(ro_number) DO UPDATE SET
          needs_diag_present = excluded.needs_diag_present,
          last_label = excluded.last_label,
          last_seen_at = excluded.last_seen_at
      `).bind(effect.roNumber, effect.needsDiag ? 1 : 0, effect.label, occurredAt).run();
      applied.push("diagnosis_watch");

      if (!pending && (diagnosisCompleted || effect.verifyTagged)) {
        await database.prepare(`
          INSERT INTO ro_verification_cycles
            (ro_number, customer, vehicle, service_writer, detail_url, amount, section,
             diagnosed_at, verify_label_seen_at, status, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, 'work-in-progress', ?, ?, 'pending', ?)
        `).bind(
          effect.roNumber,
          effect.customer || "Unknown",
          effect.vehicle,
          effect.serviceWriter,
          event.detailUrl,
          effect.amount,
          occurredAt,
          effect.verifyTagged ? occurredAt : null,
          occurredAt,
        ).run();
        applied.push("verification_enroll");
      } else if (pending) {
        await database.prepare(`
          UPDATE ro_verification_cycles SET
            customer = CASE WHEN ? = '' THEN customer ELSE ? END,
            vehicle = CASE WHEN ? = '' THEN vehicle ELSE ? END,
            service_writer = CASE WHEN ? = 'Unassigned' THEN service_writer ELSE ? END,
            amount = CASE WHEN ? = 0 THEN amount ELSE ? END,
            verify_label_seen_at = CASE WHEN ? = 1 THEN COALESCE(verify_label_seen_at, ?) ELSE verify_label_seen_at END,
            last_seen_at = ?
          WHERE id = ?
        `).bind(
          effect.customer, effect.customer,
          effect.vehicle, effect.vehicle,
          effect.serviceWriter, effect.serviceWriter,
          effect.amount, effect.amount,
          effect.verifyTagged ? 1 : 0, occurredAt,
          occurredAt, pending.id,
        ).run();
        applied.push("verification_refresh");
      }
      await upsertSignal(
        database,
        "label_change",
        event.eventName,
        effect.roNumber,
        `Label → ${effect.label}`,
        occurredAt,
        eventId,
      );
    }

    if (effect.type === "warranty_label") {
      await upsertSignal(
        database,
        "warranty_label",
        event.eventName,
        effect.roNumber,
        `Warranty/payment label on RO#${effect.roNumber}: ${effect.label}`,
        occurredAt,
        eventId,
      );
      applied.push("warranty_label");
    }

    if (effect.type === "overview_freshness") {
      await upsertSignal(
        database,
        `overview_${effect.key}`,
        event.eventName,
        effect.roNumber,
        effect.detail,
        occurredAt,
        eventId,
      );
      await upsertSignal(
        database,
        "overview_freshness",
        event.eventName,
        effect.roNumber,
        effect.detail,
        occurredAt,
        eventId,
      );
      applied.push(`freshness:${effect.key}`);
    }

    if (effect.type === "schedule_capture") {
      await database.prepare(`
        INSERT INTO schedule_capture_request (id, status, requested_at, completed_at)
        VALUES (1, 'pending', ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          status = 'pending',
          requested_at = excluded.requested_at,
          completed_at = NULL
      `).bind(occurredAt).run();
      await upsertSignal(
        database,
        "schedule_changed",
        event.eventName,
        "",
        effect.detail,
        occurredAt,
        eventId,
      );
      applied.push("schedule_capture");
    }

    if (effect.type === "signal") {
      await upsertSignal(database, effect.key, event.eventName, effect.roNumber, effect.detail, occurredAt, eventId);
      applied.push(`signal:${effect.key}`);
    }
  }

  return applied;
}
