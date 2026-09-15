import {
  constantTimeEqual,
  hmacSha256Base64,
  hmacSha256Hex,
  sha256Hex,
} from "./crypto.ts";

export const DEFAULT_TEKMETRIC_SHOP_ID = "4326";
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export const WEBHOOK_SECRET_HEADER_NAMES = [
  "x-tekmetric-webhook-secret",
  "x-webhook-secret",
  "x-tekmetric-secret",
  "x-webhook-token",
] as const;

export const WEBHOOK_SIGNATURE_HEADER_NAMES = [
  "x-tekmetric-signature",
  "x-hub-signature-256",
  "x-hub-signature",
  "x-signature",
  "x-webhook-signature",
] as const;

export const WEBHOOK_DELIVERY_HEADER_NAMES = [
  "x-tekmetric-delivery-id",
  "x-tekmetric-event-id",
  "x-webhook-id",
  "x-webhook-delivery",
  "x-request-id",
  "x-delivery-id",
] as const;

export type WebhookFamily =
  | "repair_order"
  | "appointment"
  | "order"
  | "inspection"
  | "payment"
  | "unknown";

export type NormalizedEventName =
  | "repair_order.create"
  | "repair_order.customer_viewed_estimate"
  | "repair_order.work_approved"
  | "repair_order.work_declined"
  | "repair_order.work_decision"
  | "repair_order.complete"
  | "repair_order.post"
  | "repair_order.send_to_ar"
  | "repair_order.unpost"
  | "repair_order.status_or_label_change"
  | "repair_order.save_for_later"
  | "repair_order.open"
  | "repair_order.delete"
  | "appointment.create"
  | "appointment.update"
  | "appointment.delete"
  | "order.received"
  | "inspection.complete"
  | "inspection.customer_viewed"
  | "payment.received"
  | "unknown";

export type NormalizedTekmetricEvent = {
  deliveryId: string;
  family: WebhookFamily;
  eventName: NormalizedEventName;
  sourceEvent: string;
  shopId: string;
  shopMatches: boolean;
  repairOrderId: string;
  repairOrderNumber: string;
  appointmentId: string;
  paymentId: string;
  inspectionId: string;
  orderId: string;
  customer: string;
  vehicle: string;
  serviceWriter: string;
  label: string;
  status: string;
  hours: number | null;
  amount: number | null;
  decision: "approved" | "declined" | "";
  detailUrl: string;
  occurredAt: string | null;
  payload: Record<string, unknown>;
};

export type WebhookAuthConfig = {
  pathToken?: string;
  sharedSecret?: string;
};

export type PlannedSideEffect =
  | {
    type: "sold_hours_candidate";
    roNumber: string;
    customer: string;
    vehicle: string;
    hours: number;
  }
  | {
    type: "approval";
    roNumber: string;
    customer: string;
    vehicle: string;
    decision: "approved" | "declined";
    hours: number | null;
  }
  | {
    type: "diagnosis_watch";
    roNumber: string;
    customer: string;
    vehicle: string;
    serviceWriter: string;
    amount: number;
    label: string;
    needsDiag: boolean;
    verifyTagged: boolean;
  }
  | {
    type: "warranty_label";
    roNumber: string;
    label: string;
  }
  | {
    type: "overview_freshness";
    key: "posted" | "completed" | "ar" | "payment" | "unposted";
    roNumber: string;
    detail: string;
  }
  | {
    type: "schedule_capture";
    appointmentId: string;
    detail: string;
  }
  | {
    type: "signal";
    key: string;
    detail: string;
    roNumber: string;
  };

const EVENT_RULES: Array<{
  family: WebhookFamily;
  eventName: NormalizedEventName;
  pattern: RegExp;
}> = [
  { family: "repair_order", eventName: "repair_order.customer_viewed_estimate", pattern: /customer[_\s-]*viewed[_\s-]*estimate|estimate[_\s-]*viewed/i },
  { family: "repair_order", eventName: "repair_order.work_decision", pattern: /approved[_\s/-]*declined|authorized[_\s/-]*declined|work[_\s-]*authorized[_\s/-]*declined/i },
  { family: "repair_order", eventName: "repair_order.work_approved", pattern: /work[_\s-]*approved|jobs?[_\s-]*approved|authorized(?![_\s-]*declined)/i },
  { family: "repair_order", eventName: "repair_order.work_declined", pattern: /work[_\s-]*declined|jobs?[_\s-]*declined|(?:^|[_\s.-])declined(?:$|[_\s.-])/i },
  { family: "repair_order", eventName: "repair_order.status_or_label_change", pattern: /status[_\s-]*or[_\s-]*label|label[_\s-]*change|status[_\s-]*change/i },
  { family: "repair_order", eventName: "repair_order.send_to_ar", pattern: /send[_\s-]*to[_\s-]*a\/?r|accounts[_\s-]*receivable|(?:^|[_\s.-])a\/?r(?:$|[_\s.-])/i },
  { family: "repair_order", eventName: "repair_order.open", pattern: /opened[_\s-]*from|reopened/i },
  { family: "repair_order", eventName: "repair_order.save_for_later", pattern: /save[_\s-]*for[_\s-]*later/i },
  { family: "repair_order", eventName: "repair_order.unpost", pattern: /unpost/i },
  { family: "repair_order", eventName: "repair_order.post", pattern: /(?:^|[_\s.-])post(?:ed|ing)?(?:$|[_\s.-])/i },
  { family: "repair_order", eventName: "repair_order.complete", pattern: /complete[d]?/i },
  { family: "repair_order", eventName: "repair_order.delete", pattern: /delete[d]?/i },
  { family: "repair_order", eventName: "repair_order.open", pattern: /(?:^|[_\s.-])open(?:ed)?(?:$|[_\s.-])/i },
  { family: "repair_order", eventName: "repair_order.create", pattern: /create[d]?/i },
  { family: "appointment", eventName: "appointment.create", pattern: /appointment[_\s.-]*(create[d]?|new)/i },
  { family: "appointment", eventName: "appointment.update", pattern: /appointment[_\s.-]*update[d]?/i },
  { family: "appointment", eventName: "appointment.delete", pattern: /appointment[_\s.-]*delete[d]?/i },
  { family: "inspection", eventName: "inspection.customer_viewed", pattern: /customer[_\s-]*viewed[_\s-]*inspection|inspection[_\s-]*viewed/i },
  { family: "inspection", eventName: "inspection.complete", pattern: /inspection[_\s-]*complete[d]?/i },
  { family: "order", eventName: "order.received", pattern: /order[_\s-]*received|parts?[_\s-]*received/i },
  { family: "payment", eventName: "payment.received", pattern: /payment[_\s-]*received|payment[_\s-]*posted/i },
];

const FAMILY_HINTS: Array<{ family: WebhookFamily; pattern: RegExp }> = [
  { family: "appointment", pattern: /appointment/i },
  { family: "inspection", pattern: /inspection/i },
  { family: "payment", pattern: /payment/i },
  { family: "repair_order", pattern: /repair[_\s-]*order|\bro\b/i },
  { family: "order", pattern: /order[_\s-]*received|purchase[_\s-]*order/i },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function flatten(value: unknown, depth = 0, into: Record<string, unknown>[] = []): Record<string, unknown>[] {
  const record = asRecord(value);
  if (!record || depth > 5) return into;
  into.push(record);
  for (const nested of Object.values(record)) {
    if (asRecord(nested)) flatten(nested, depth + 1, into);
    else if (Array.isArray(nested)) {
      for (const item of nested.slice(0, 20)) flatten(item, depth + 1, into);
    }
  }
  return into;
}

function firstString(records: Record<string, unknown>[], keys: string[]): string {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(key.toLowerCase())) continue;
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return "";
}

function firstNumber(records: Record<string, unknown>[], keys: string[]): number | null {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(key.toLowerCase())) continue;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.replace(/[$,]/g, ""));
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return null;
}

function looksLikeIsoDate(value: string): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export function sourceEventString(payload: unknown, headers: Headers): string {
  const records = flatten(payload);
  return firstString(records, [
    "event", "eventType", "event_type", "eventName", "event_name",
    "type", "action", "name", "topic", "trigger",
  ]) || headers.get("x-tekmetric-event") || headers.get("x-event-type") || "";
}

export function classifyTekmetricEvent(sourceEvent: string, payload: unknown): {
  family: WebhookFamily;
  eventName: NormalizedEventName;
} {
  const records = flatten(payload);
  const blob = [
    sourceEvent,
    firstString(records, ["resource", "entity", "object", "model"]),
  ].filter(Boolean).join(" ");

  const familyHint = FAMILY_HINTS.find((item) => item.pattern.test(blob))?.family
    || (firstString(records, ["appointmentId", "appointment_id"]) ? "appointment"
      : firstString(records, ["inspectionId", "inspection_id"]) ? "inspection"
        : firstString(records, ["paymentId", "payment_id"]) ? "payment"
          : firstString(records, ["repairOrderId", "repair_order_id", "repairOrderNumber", "roNumber"]) ? "repair_order"
            : "unknown");

  const scoped = EVENT_RULES.filter((rule) => familyHint === "unknown" || rule.family === familyHint);
  const matched = scoped.find((rule) => rule.pattern.test(blob))
    || EVENT_RULES.find((rule) => rule.pattern.test(blob));
  if (matched) return { family: matched.family, eventName: matched.eventName };

  if (familyHint === "appointment") {
    if (/delete/i.test(blob)) return { family: "appointment", eventName: "appointment.delete" };
    if (/update/i.test(blob)) return { family: "appointment", eventName: "appointment.update" };
    if (/create|new/i.test(blob)) return { family: "appointment", eventName: "appointment.create" };
  }
  if (familyHint === "inspection") {
    if (/view/i.test(blob)) return { family: "inspection", eventName: "inspection.customer_viewed" };
    if (/complete/i.test(blob)) return { family: "inspection", eventName: "inspection.complete" };
  }
  if (familyHint === "payment") {
    return { family: "payment", eventName: "payment.received" };
  }
  if (familyHint === "order") {
    return { family: "order", eventName: "order.received" };
  }
  return { family: familyHint, eventName: "unknown" };
}

function decisionFrom(records: Record<string, unknown>[], eventName: NormalizedEventName): "approved" | "declined" | "" {
  if (eventName === "repair_order.work_approved") return "approved";
  if (eventName === "repair_order.work_declined") return "declined";
  const approved = firstString(records, ["approved", "authorized", "workApproved", "jobsApproved"]);
  const declined = firstString(records, ["declined", "rejected", "workDeclined", "jobsDeclined"]);
  const decision = firstString(records, ["decision", "authorizationStatus", "approvalStatus", "status"]).toLowerCase();
  if (/declin|reject/.test(declined) || /declin|reject/.test(decision)) return "declined";
  if (/approv|authoriz/.test(approved) || /approv|authoriz/.test(decision)) return "approved";
  if (declined && ["true", "1", "yes"].includes(declined.toLowerCase())) return "declined";
  if (approved && ["true", "1", "yes"].includes(approved.toLowerCase())) return "approved";
  return "";
}

export async function deliveryIdFor(
  rawBody: string,
  payload: unknown,
  headers: Headers,
): Promise<string> {
  for (const name of WEBHOOK_DELIVERY_HEADER_NAMES) {
    const value = headers.get(name)?.trim();
    if (value) return `hdr:${name}:${value}`.slice(0, 180);
  }
  const records = flatten(payload);
  const explicit = firstString(records, [
    "deliveryId", "delivery_id", "eventId", "event_id", "webhookId", "webhook_id",
    "uuid", "guid", "messageId", "message_id",
  ]);
  if (explicit) return `body:${explicit}`.slice(0, 180);
  return `sha256:${await sha256Hex(rawBody)}`;
}

export function parseWebhookPayload(rawBody: string, contentType = ""): unknown {
  const trimmed = rawBody.trim();
  if (!trimmed) return {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(trimmed);
    const payloadParam = params.get("payload") || params.get("data") || params.get("json");
    if (payloadParam) {
      try {
        return JSON.parse(payloadParam);
      } catch {
        return Object.fromEntries(params.entries());
      }
    }
    return Object.fromEntries(params.entries());
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { unparsed: true, raw: trimmed.slice(0, 4000) };
  }
}

export async function normalizeTekmetricEvent(options: {
  rawBody: string;
  payload: unknown;
  headers: Headers;
  shopId?: string;
}): Promise<NormalizedTekmetricEvent> {
  const expectedShop = String(options.shopId || DEFAULT_TEKMETRIC_SHOP_ID);
  const payloadRecord = asRecord(options.payload) || { value: options.payload };
  const records = flatten(options.payload);
  const sourceEvent = sourceEventString(options.payload, options.headers);
  const classified = classifyTekmetricEvent(sourceEvent, options.payload);
  const shopId = firstString(records, ["shopId", "shop_id", "shop", "shopNumber"]);
  const repairOrderNumber = firstString(records, [
    "repairOrderNumber", "repair_order_number", "roNumber", "ro_number", "repairOrder", "number",
  ]).replace(/[^\dA-Za-z-]/g, "");
  const repairOrderId = firstString(records, ["repairOrderId", "repair_order_id", "roId", "ro_id"]);
  const occurred = firstString(records, [
    "occurredAt", "occurred_at", "createdDate", "created_date", "createdAt", "created_at",
    "eventDate", "event_date", "timestamp", "time",
  ]);

  return {
    deliveryId: await deliveryIdFor(options.rawBody, options.payload, options.headers),
    family: classified.family,
    eventName: classified.eventName,
    sourceEvent: sourceEvent.slice(0, 200),
    shopId,
    shopMatches: !shopId || shopId === expectedShop || shopId === `shop-${expectedShop}`,
    repairOrderId: repairOrderId.slice(0, 80),
    repairOrderNumber: repairOrderNumber.slice(0, 40),
    appointmentId: firstString(records, ["appointmentId", "appointment_id"]).slice(0, 80),
    paymentId: firstString(records, ["paymentId", "payment_id"]).slice(0, 80),
    inspectionId: firstString(records, ["inspectionId", "inspection_id"]).slice(0, 80),
    orderId: firstString(records, ["orderId", "order_id", "purchaseOrderId"]).slice(0, 80),
    customer: firstString(records, ["customerName", "customer", "customerFullName"]).slice(0, 200),
    vehicle: firstString(records, ["vehicle", "vehicleName", "yearMakeModel"]).slice(0, 200),
    serviceWriter: firstString(records, ["serviceWriter", "service_writer", "writer"]).slice(0, 120),
    label: firstString(records, ["label", "labelName", "repairOrderLabel", "currentLabel"]).slice(0, 160),
    status: firstString(records, ["status", "repairOrderStatus", "workflowStatus"]).slice(0, 120),
    hours: firstNumber(records, ["soldHours", "hoursSold", "authorizedHours", "laborHours", "hours"]),
    amount: firstNumber(records, ["amount", "total", "authorizedAmount", "paymentAmount"]),
    decision: decisionFrom(records, classified.eventName),
    detailUrl: firstString(records, ["detailUrl", "detail_url", "repairOrderUrl", "repair_order_url"]).slice(0, 1000),
    occurredAt: looksLikeIsoDate(occurred) ? new Date(occurred).toISOString() : null,
    payload: payloadRecord,
  };
}

function headerSecret(headers: Headers): string {
  for (const name of WEBHOOK_SECRET_HEADER_NAMES) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  const authorization = headers.get("authorization")?.trim() || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  return bearer?.[1]?.trim() || "";
}

function signatureHeader(headers: Headers): string {
  for (const name of WEBHOOK_SIGNATURE_HEADER_NAMES) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  return "";
}

function normalizeSignature(value: string): string {
  return value.trim().replace(/^(sha256|sha1)=/i, "").trim();
}

export async function webhookAuthorized(options: {
  config: WebhookAuthConfig;
  pathToken?: string;
  request: Request;
  rawBody: string;
}): Promise<{ ok: boolean; reason: string }> {
  const pathExpected = options.config.pathToken?.trim() || "";
  const secret = options.config.sharedSecret?.trim() || "";
  if (!pathExpected && !secret) {
    return { ok: false, reason: "webhook_unconfigured" };
  }
  if (pathExpected && !constantTimeEqual(options.pathToken || "", pathExpected)) {
    return { ok: false, reason: "path_token" };
  }
  if (!secret) return { ok: true, reason: "path_token" };

  const url = new URL(options.request.url);
  const signature = signatureHeader(options.request.headers);
  if (signature) {
    const provided = normalizeSignature(signature);
    const hex = await hmacSha256Hex(secret, options.rawBody);
    const b64 = await hmacSha256Base64(secret, options.rawBody);
    if (constantTimeEqual(provided.toLowerCase(), hex) || constantTimeEqual(provided, b64)) {
      return { ok: true, reason: "hmac" };
    }
    return { ok: false, reason: "signature" };
  }

  const provided = headerSecret(options.request.headers)
    || url.searchParams.get("secret")?.trim()
    || url.searchParams.get("token")?.trim()
    || "";
  if (!provided || !constantTimeEqual(provided, secret)) {
    return { ok: false, reason: "shared_secret" };
  }
  return { ok: true, reason: "shared_secret" };
}

export function isVerifyLabel(label: string): boolean {
  const value = label.toLowerCase();
  return value === "verify"
    || value.includes("verify parts&labor")
    || value.includes("verify parts/labor")
    || value.includes("verify parts and labor");
}

export function isNeedsDiagLabel(label: string): boolean {
  return label.toLowerCase().includes("needs diag");
}

export function isWarrantyPaymentLabel(label: string): boolean {
  return /need(?:s)?\s+(?:ext\.?\s+warr(?:anty)?|warranty)\s+(?:payment|pmt)/i.test(label)
    || /warranty claim done/i.test(label)
    || /ext\.?\s*warranty\/?3rd\s*party/i.test(label);
}

export function usableRoNumber(event: NormalizedTekmetricEvent): string {
  return event.repairOrderNumber || "";
}

export function planWebhookSideEffects(event: NormalizedTekmetricEvent): PlannedSideEffect[] {
  if (!event.shopMatches) return [];
  const effects: PlannedSideEffect[] = [];
  const roNumber = usableRoNumber(event);
  const approvalDecision = event.decision
    || (event.eventName === "repair_order.work_approved" ? "approved"
      : event.eventName === "repair_order.work_declined" ? "declined"
        : "");

  if (roNumber && (event.eventName === "repair_order.work_approved" || approvalDecision === "approved")
    && event.hours != null && event.hours > 0.001) {
    effects.push({
      type: "sold_hours_candidate",
      roNumber,
      customer: event.customer,
      vehicle: event.vehicle,
      hours: event.hours,
    });
  }

  if (roNumber && (event.eventName === "repair_order.work_approved"
    || event.eventName === "repair_order.work_declined"
    || event.eventName === "repair_order.work_decision"
    || approvalDecision)) {
    if (approvalDecision) {
      effects.push({
        type: "approval",
        roNumber,
        customer: event.customer,
        vehicle: event.vehicle,
        decision: approvalDecision,
        hours: event.hours,
      });
    }
  }

  if (event.eventName === "repair_order.status_or_label_change" && roNumber && event.label) {
    effects.push({
      type: "diagnosis_watch",
      roNumber,
      customer: event.customer,
      vehicle: event.vehicle,
      serviceWriter: event.serviceWriter || "Unassigned",
      amount: event.amount || 0,
      label: event.label,
      needsDiag: isNeedsDiagLabel(event.label),
      verifyTagged: isVerifyLabel(event.label),
    });
    if (isWarrantyPaymentLabel(event.label)) {
      effects.push({ type: "warranty_label", roNumber, label: event.label });
    }
  }

  if (event.eventName === "repair_order.post") {
    effects.push({
      type: "overview_freshness",
      key: "posted",
      roNumber,
      detail: roNumber ? `RO#${roNumber} posted` : "Repair order posted",
    });
  }
  if (event.eventName === "repair_order.complete") {
    effects.push({
      type: "overview_freshness",
      key: "completed",
      roNumber,
      detail: roNumber ? `RO#${roNumber} completed` : "Repair order completed",
    });
  }
  if (event.eventName === "repair_order.send_to_ar") {
    effects.push({
      type: "overview_freshness",
      key: "ar",
      roNumber,
      detail: roNumber ? `RO#${roNumber} sent to A/R` : "Repair order sent to A/R",
    });
  }
  if (event.eventName === "repair_order.unpost") {
    effects.push({
      type: "overview_freshness",
      key: "unposted",
      roNumber,
      detail: roNumber ? `RO#${roNumber} unposted` : "Repair order unposted",
    });
  }
  if (event.eventName === "payment.received") {
    effects.push({
      type: "overview_freshness",
      key: "payment",
      roNumber,
      detail: roNumber ? `Payment received for RO#${roNumber}` : "Payment received",
    });
  }

  if (event.family === "appointment") {
    effects.push({
      type: "schedule_capture",
      appointmentId: event.appointmentId,
      detail: `${event.eventName.replace("appointment.", "Appointment ")}${event.appointmentId ? ` #${event.appointmentId}` : ""}`,
    });
  }

  if (event.eventName === "order.received") {
    effects.push({
      type: "signal",
      key: "order_received",
      detail: event.orderId ? `Order ${event.orderId} received` : "Parts order received",
      roNumber,
    });
  }
  if (event.family === "inspection") {
    effects.push({
      type: "signal",
      key: "inspection",
      detail: event.eventName === "inspection.customer_viewed"
        ? "Customer viewed inspection"
        : "Inspection completed",
      roNumber,
    });
  }

  return effects;
}

export function soldHoursDelta(priorHours: number | undefined, nextHours: number, ageDays: number, daysIntoWeek: number): number {
  if (priorHours === undefined) {
    return ageDays <= daysIntoWeek ? nextHours : 0;
  }
  return Math.max(0, nextHours - priorHours);
}

export function sanitizedWebhookHeaders(headers: Headers): Record<string, string> {
  const keep: Record<string, string> = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "authorization" || name.includes("secret") || name.includes("token") || name === "cookie") {
      return;
    }
    if (
      name.startsWith("x-")
      || name === "user-agent"
      || name === "content-type"
      || name === "content-length"
    ) {
      keep[name] = value.slice(0, 300);
    }
  });
  return keep;
}

export function authConfigFromEnv(env: Record<string, unknown>): WebhookAuthConfig {
  return {
    pathToken: typeof env.TEKMETRIC_WEBHOOK_PATH_TOKEN === "string" ? env.TEKMETRIC_WEBHOOK_PATH_TOKEN : "",
    sharedSecret: typeof env.TEKMETRIC_WEBHOOK_SECRET === "string" ? env.TEKMETRIC_WEBHOOK_SECRET : "",
  };
}

export function shopIdFromEnv(env: Record<string, unknown>): string {
  return typeof env.TEKMETRIC_SHOP_ID === "string" && env.TEKMETRIC_SHOP_ID.trim()
    ? env.TEKMETRIC_SHOP_ID.trim()
    : DEFAULT_TEKMETRIC_SHOP_ID;
}
