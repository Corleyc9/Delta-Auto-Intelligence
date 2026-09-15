import assert from "node:assert/strict";
import test from "node:test";
import { hmacSha256Hex } from "../app/lib/crypto.ts";
import {
  classifyTekmetricEvent,
  isNeedsDiagLabel,
  isVerifyLabel,
  isWarrantyPaymentLabel,
  normalizeTekmetricEvent,
  parseWebhookPayload,
  planWebhookSideEffects,
  webhookAuthorized,
} from "../app/lib/tekmetric-webhook.ts";

test("classifies the Custom Integration checkbox events", () => {
  const cases = [
    ["Repair Order Create", "repair_order.create"],
    ["Customer Viewed Estimate", "repair_order.customer_viewed_estimate"],
    ["Work Approved", "repair_order.work_approved"],
    ["Work Declined", "repair_order.work_declined"],
    ["Work Approved/Declined", "repair_order.work_decision"],
    ["Complete", "repair_order.complete"],
    ["Post", "repair_order.post"],
    ["Send to A/R", "repair_order.send_to_ar"],
    ["Unpost", "repair_order.unpost"],
    ["Status or Label Change", "repair_order.status_or_label_change"],
    ["Save for Later", "repair_order.save_for_later"],
    ["RO opened from Saved for later", "repair_order.open"],
    ["Delete", "repair_order.delete"],
    ["Appointment Create", "appointment.create"],
    ["Appointment Update", "appointment.update"],
    ["Appointment Delete", "appointment.delete"],
    ["Order Received", "order.received"],
    ["Inspection Complete", "inspection.complete"],
    ["Customer Viewed Inspection", "inspection.customer_viewed"],
    ["Payment Received", "payment.received"],
  ];
  for (const [source, expected] of cases) {
    assert.equal(classifyTekmetricEvent(source, {}).eventName, expected, source);
  }
});

test("does not treat a repair-order create as a parts order", () => {
  assert.equal(classifyTekmetricEvent("Repair Order Create", {}).family, "repair_order");
});

test("work approved without hours is an approval-timing signal only", async () => {
  const event = await normalizeTekmetricEvent({
    rawBody: JSON.stringify({ event: "Work Approved", repairOrderNumber: "4412", shopId: "4326" }),
    payload: { event: "Work Approved", repairOrderNumber: "4412", shopId: "4326" },
    headers: new Headers(),
  });
  const effects = planWebhookSideEffects(event);
  assert.equal(effects.some((item) => item.type === "sold_hours_candidate"), false);
  assert.equal(effects.some((item) => item.type === "approval" && item.decision === "approved"), true);
});

test("work approved with hours plans a sold-hours candidate from payload hours only", async () => {
  const event = await normalizeTekmetricEvent({
    rawBody: JSON.stringify({ event: "Work Approved", repairOrderNumber: "4412", soldHours: 2.5, shopId: 4326 }),
    payload: { event: "Work Approved", repairOrderNumber: "4412", soldHours: 2.5, shopId: 4326 },
    headers: new Headers(),
  });
  const sold = planWebhookSideEffects(event).find((item) => item.type === "sold_hours_candidate");
  assert.ok(sold && sold.type === "sold_hours_candidate");
  assert.equal(sold.hours, 2.5);
  assert.equal(sold.roNumber, "4412");
});

test("label change to Verify enrolls a verification watch without inventing customer data", async () => {
  const event = await normalizeTekmetricEvent({
    rawBody: JSON.stringify({
      eventType: "Status or Label Change",
      repairOrderNumber: "8801",
      label: "Verify Parts&Labor",
      shopId: "4326",
    }),
    payload: {
      eventType: "Status or Label Change",
      repairOrderNumber: "8801",
      label: "Verify Parts&Labor",
      shopId: "4326",
    },
    headers: new Headers(),
  });
  const watch = planWebhookSideEffects(event).find((item) => item.type === "diagnosis_watch");
  assert.ok(watch && watch.type === "diagnosis_watch");
  assert.equal(watch.verifyTagged, true);
  assert.equal(watch.needsDiag, false);
  assert.equal(watch.customer, "");
});

test("warranty payment labels are recognized from Job Board wording", () => {
  assert.equal(isWarrantyPaymentLabel("Need Warranty Pmt"), true);
  assert.equal(isWarrantyPaymentLabel("Needs Ext Warr Payment"), true);
  assert.equal(isVerifyLabel("Verify"), true);
  assert.equal(isNeedsDiagLabel("Needs Diag."), true);
  assert.equal(isWarrantyPaymentLabel("In-Progress"), false);
});

test("post, complete, A/R, and payment become overview freshness signals", async () => {
  for (const [eventName, key] of [
    ["Post", "posted"],
    ["Complete", "completed"],
    ["Send to A/R", "ar"],
    ["Payment Received", "payment"],
  ]) {
    const event = await normalizeTekmetricEvent({
      rawBody: JSON.stringify({ event: eventName, repairOrderNumber: "12", shopId: "4326" }),
      payload: { event: eventName, repairOrderNumber: "12", shopId: "4326" },
      headers: new Headers(),
    });
    const freshness = planWebhookSideEffects(event).find((item) => item.type === "overview_freshness");
    assert.ok(freshness && freshness.type === "overview_freshness", eventName);
    assert.equal(freshness.key, key);
  }
});

test("appointment events request a schedule recapture", async () => {
  const event = await normalizeTekmetricEvent({
    rawBody: JSON.stringify({ event: "Appointment Update", appointmentId: 99, shopId: "4326" }),
    payload: { event: "Appointment Update", appointmentId: 99, shopId: "4326" },
    headers: new Headers(),
  });
  assert.equal(event.family, "appointment");
  assert.equal(planWebhookSideEffects(event).some((item) => item.type === "schedule_capture"), true);
});

test("events for another shop are stored as normalized but do not plan shop side effects", async () => {
  const event = await normalizeTekmetricEvent({
    rawBody: JSON.stringify({ event: "Post", repairOrderNumber: "12", shopId: "9999" }),
    payload: { event: "Post", repairOrderNumber: "12", shopId: "9999" },
    headers: new Headers(),
  });
  assert.equal(event.shopMatches, false);
  assert.deepEqual(planWebhookSideEffects(event), []);
});

test("delivery id prefers Tekmetric delivery headers", async () => {
  const event = await normalizeTekmetricEvent({
    rawBody: JSON.stringify({ event: "Post" }),
    payload: { event: "Post" },
    headers: new Headers({ "x-tekmetric-delivery-id": "abc-123" }),
  });
  assert.equal(event.deliveryId, "hdr:x-tekmetric-delivery-id:abc-123");
});

test("webhook auth fails closed when no secret is configured", async () => {
  const result = await webhookAuthorized({
    config: {},
    request: new Request("https://example.test/api/webhooks/tekmetric", { method: "POST" }),
    rawBody: "{}",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "webhook_unconfigured");
});

test("webhook auth accepts the unguessable path token", async () => {
  const result = await webhookAuthorized({
    config: { pathToken: "path-secret-value" },
    pathToken: "path-secret-value",
    request: new Request("https://example.test/api/webhooks/tekmetric/path-secret-value", { method: "POST" }),
    rawBody: "{}",
  });
  assert.equal(result.ok, true);
});

test("webhook auth accepts a query or header shared secret", async () => {
  const query = await webhookAuthorized({
    config: { sharedSecret: "shared-secret" },
    request: new Request("https://example.test/api/webhooks/tekmetric?secret=shared-secret", { method: "POST" }),
    rawBody: "{}",
  });
  assert.equal(query.ok, true);
  const header = await webhookAuthorized({
    config: { sharedSecret: "shared-secret" },
    request: new Request("https://example.test/api/webhooks/tekmetric", {
      method: "POST",
      headers: { "x-tekmetric-webhook-secret": "shared-secret" },
    }),
    rawBody: "{}",
  });
  assert.equal(header.ok, true);
});

test("webhook auth verifies HMAC signatures when Tekmetric sends one", async () => {
  const body = "{\"event\":\"Post\"}";
  const hex = await hmacSha256Hex("shared-secret", body);
  const result = await webhookAuthorized({
    config: { sharedSecret: "shared-secret" },
    request: new Request("https://example.test/api/webhooks/tekmetric", {
      method: "POST",
      headers: { "x-tekmetric-signature": `sha256=${hex}` },
    }),
    rawBody: body,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "hmac");
});

test("path token and shared secret can both be required", async () => {
  const missingSecret = await webhookAuthorized({
    config: { pathToken: "path-secret-value", sharedSecret: "shared-secret" },
    pathToken: "path-secret-value",
    request: new Request("https://example.test/api/webhooks/tekmetric/path-secret-value", { method: "POST" }),
    rawBody: "{}",
  });
  assert.equal(missingSecret.ok, false);
  const both = await webhookAuthorized({
    config: { pathToken: "path-secret-value", sharedSecret: "shared-secret" },
    pathToken: "path-secret-value",
    request: new Request("https://example.test/api/webhooks/tekmetric/path-secret-value?secret=shared-secret", {
      method: "POST",
    }),
    rawBody: "{}",
  });
  assert.equal(both.ok, true);
});

test("form-encoded payloads still parse", () => {
  const payload = parseWebhookPayload(
    "payload=%7B%22event%22%3A%22Post%22%7D",
    "application/x-www-form-urlencoded",
  );
  assert.deepEqual(payload, { event: "Post" });
});
