import type { IncomingHttpHeaders } from "node:http";

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export function bearerToken(headers: IncomingHttpHeaders): string {
  const auth = headerValue(headers, "authorization");
  if (!auth?.startsWith("Bearer ")) return "";
  return auth.slice("Bearer ".length).trim();
}

export function verifySharedSecret(
  headers: IncomingHttpHeaders,
  sharedSecret: string | undefined,
): boolean {
  if (!sharedSecret) return true;
  return bearerToken(headers) === sharedSecret;
}

export function rateLimitKey(headers: IncomingHttpHeaders): string {
  return bearerToken(headers) || "anonymous";
}
