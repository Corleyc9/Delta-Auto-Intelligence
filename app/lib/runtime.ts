export async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env as Record<string, any>;
}
