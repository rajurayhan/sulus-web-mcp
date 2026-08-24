export type AppConfig = {
  host: string;
  port: number;
  path: string;
  sharedSecret: string | undefined;
  allowedHosts: string[] | undefined;
  allowInsecureHttp: boolean;
  allowHosts: string[];
  denyHosts: string[];
  navigationTimeoutMs: number;
  toolTimeoutMs: number;
  maxConcurrent: number;
  rateLimitPerMinute: number;
  maxOutputChars: number;
};

function csv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadAppConfig(): AppConfig {
  const allowedHosts = csv("MCP_ALLOWED_HOSTS");
  return {
    host: process.env.MCP_HOST ?? "0.0.0.0",
    port: Number(process.env.MCP_PORT ?? "3000"),
    path: process.env.MCP_PATH ?? "/mcp",
    sharedSecret: process.env.MCP_SHARED_SECRET?.trim() || undefined,
    allowedHosts: allowedHosts.length ? allowedHosts : undefined,
    allowInsecureHttp: process.env.ALLOW_INSECURE_HTTP === "true",
    allowHosts: csv("ALLOW_HOSTS"),
    denyHosts: csv("DENY_HOSTS"),
    navigationTimeoutMs: intEnv("NAVIGATION_TIMEOUT_MS", 25_000),
    toolTimeoutMs: intEnv("TOOL_TIMEOUT_MS", 45_000),
    maxConcurrent: intEnv("BROWSER_MAX_CONCURRENT", 3),
    rateLimitPerMinute: intEnv("RATE_LIMIT_PER_MINUTE", 30),
    maxOutputChars: intEnv("MAX_OUTPUT_CHARS", 18_000),
  };
}
