export function d1ErrorText(error: unknown): string {
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
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join(" → ");
}

export function isD1QuotaError(error: unknown): boolean {
  const message = d1ErrorText(error).toLowerCase();
  return /d1'?s free tier|row read limit|row write limit|exceeded d1/.test(message);
}

export function secondsUntilUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

export function d1QuotaJson(error: unknown): Record<string, string> {
  return {
    error: "D1 free-tier daily limit exceeded",
    detail: d1ErrorText(error),
    code: "d1_quota",
    hint: "Upgrade the delta-auto-intelligence D1 database to a paid plan, or wait until midnight UTC. Deploying code cannot restore reader sync while this quota is exhausted.",
  };
}
