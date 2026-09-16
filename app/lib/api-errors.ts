import { d1ErrorText, d1QuotaJson, isD1QuotaError, secondsUntilUtcMidnight } from "../../db/d1-errors.ts";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonError(error: unknown, fallback = "Server error", status = 500): Response {
  if (isD1QuotaError(error)) {
    return Response.json(d1QuotaJson(error), {
      status: 503,
      headers: { "Retry-After": String(secondsUntilUtcMidnight()) },
    });
  }
  return Response.json({ error: fallback, detail: d1ErrorText(error) }, { status });
}

export async function handleApi(name: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message, detail: d1ErrorText(error.cause) }, { status: error.status });
    }
    return jsonError(error, `${name} failed`);
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
