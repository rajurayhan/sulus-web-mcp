import { isIP, isIPv4 } from "node:net";
import { lookup } from "node:dns/promises";

export type UrlPolicy = {
  allowInsecureHttp: boolean;
  allowHosts: string[];
  denyHosts: string[];
};

export type UrlCheck =
  | { ok: true; url: URL; hostname: string }
  | { ok: false; reason: string };

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.google.com",
]);

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function hostMatches(pattern: string, hostname: string): boolean {
  const p = normalizeHost(pattern);
  const h = normalizeHost(hostname);
  if (p.startsWith("*.")) {
    const suffix = p.slice(1);
    return h.endsWith(suffix) && h !== suffix.slice(1);
  }
  return h === p;
}

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const n = ip.toLowerCase();
  if (n === "::" || n === "::1") return true;
  if (n.startsWith("fe80:") || n.startsWith("fe80::")) return true;
  if (n.startsWith("fc") || n.startsWith("fd")) return true;
  if (n.startsWith("::ffff:")) {
    const v4 = n.slice("::ffff:".length);
    return isIPv4(v4) ? isPrivateIPv4(v4) : false;
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

export function isBlockedHostname(hostname: string, denyHosts: string[]): boolean {
  const h = normalizeHost(hostname);
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  if (h.endsWith(".nip.io") || h.endsWith(".sslip.io")) return true;
  return denyHosts.some((p) => hostMatches(p, h));
}

export function parseBrowseUrl(raw: string, policy: UrlPolicy): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Invalid URL." };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "URLs with credentials are not allowed." };
  }

  const protocol = url.protocol;
  if (protocol === "http:") {
    if (!policy.allowInsecureHttp) {
      return { ok: false, reason: "Only HTTPS URLs are allowed." };
    }
  } else if (protocol !== "https:") {
    return { ok: false, reason: `Blocked scheme: ${protocol.replace(":", "")}.` };
  }

  const hostname = normalizeHost(url.hostname).replace(/^\[|\]$/g, "");
  if (!hostname) {
    return { ok: false, reason: "URL is missing a hostname." };
  }

  if (isBlockedHostname(hostname, policy.denyHosts)) {
    return { ok: false, reason: `Blocked host: ${hostname}.` };
  }

  if (isIP(hostname) && isBlockedIp(hostname)) {
    return { ok: false, reason: "Private or link-local IP addresses are not allowed." };
  }

  if (policy.allowHosts.length > 0) {
    const allowed = policy.allowHosts.some((p) => hostMatches(p, hostname));
    if (!allowed) {
      return { ok: false, reason: `Host is not on the allowlist: ${hostname}.` };
    }
  }

  return { ok: true, url, hostname };
}

export async function resolveAndCheck(
  hostname: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (isIP(hostname)) {
    return isBlockedIp(hostname)
      ? { ok: false, reason: "Private or link-local IP addresses are not allowed." }
      : { ok: true };
  }

  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: `Could not resolve host: ${hostname}.` };
  }

  if (records.length === 0) {
    return { ok: false, reason: `Could not resolve host: ${hostname}.` };
  }

  for (const rec of records) {
    if (isBlockedIp(rec.address)) {
      return {
        ok: false,
        reason: `Host resolves to a private or blocked address (${rec.address}).`,
      };
    }
  }

  return { ok: true };
}

export async function assertSafeUrl(
  raw: string,
  policy: UrlPolicy,
): Promise<UrlCheck> {
  const parsed = parseBrowseUrl(raw, policy);
  if (!parsed.ok) return parsed;
  const resolved = await resolveAndCheck(parsed.hostname);
  if (!resolved.ok) return resolved;
  return parsed;
}

export function isBlockedRequestUrl(raw: string, policy: UrlPolicy): boolean {
  const parsed = parseBrowseUrl(raw, policy);
  return !parsed.ok;
}
