import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";
import {
  MAX_WEBHOOK_BODY_BYTES,
  authConfigFromEnv,
  normalizeTekmetricEvent,
  parseWebhookPayload,
  sanitizedWebhookHeaders,
  shopIdFromEnv,
  webhookAuthorized,
} from "@/app/lib/tekmetric-webhook";
import { persistTekmetricWebhook } from "@/app/lib/tekmetric-webhook-persist";

export async function handleTekmetricWebhook(request: Request, pathToken = ""): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const env = await runtimeEnv();
  const rawBuffer = await request.arrayBuffer();
  const truncated = rawBuffer.byteLength > MAX_WEBHOOK_BODY_BYTES;
  const rawBody = new TextDecoder().decode(
    truncated ? rawBuffer.slice(0, MAX_WEBHOOK_BODY_BYTES) : rawBuffer,
  );

  const authorized = await webhookAuthorized({
    config: authConfigFromEnv(env),
    pathToken,
    request,
    rawBody,
  });
  if (!authorized.ok) {
    return Response.json({ error: "Unauthorized webhook" }, { status: 401 });
  }

  await ensureSchema(env.DB);
  const payload = parseWebhookPayload(rawBody, request.headers.get("content-type") || "");
  const event = await normalizeTekmetricEvent({
    rawBody,
    payload,
    headers: request.headers,
    shopId: shopIdFromEnv(env),
  });
  const receivedAt = new Date().toISOString();
  try {
    const result = await persistTekmetricWebhook({
      database: env.DB,
      event,
      rawBody,
      headersJson: JSON.stringify(sanitizedWebhookHeaders(request.headers)),
      receivedAt,
      truncated,
    });
    return Response.json({
      ok: true,
      duplicate: result.duplicate,
      event: event.eventName,
      family: event.family,
      effects: result.effects,
    }, { status: result.duplicate ? 200 : 201 });
  } catch {
    return Response.json({ error: "Webhook event could not be stored" }, { status: 500 });
  }
}
