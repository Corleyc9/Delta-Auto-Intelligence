export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function detailFrom(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join(" → ").slice(0, 1500);
}

export function jsonError(error: unknown, fallback = "Server error", status = 500): Response {
  return Response.json({ error: fallback, detail: detailFrom(error) }, { status });
}

export async function handleApi(name: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message, detail: detailFrom(error.cause) }, { status: error.status });
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
