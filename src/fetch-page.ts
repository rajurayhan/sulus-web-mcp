import type { UrlPolicy } from "./ssrf.js";
import { assertSafeUrl } from "./ssrf.js";

export const HTML_READY_CHARS = 400;
export const PROBE_MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const FILE_EXT = /\.(pdf|png|jpe?g|gif|webp|svg|ico|mp4|mp3|zip|gz|woff2?)$/i;

export const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type ProbeResult =
  | { kind: "file"; url: string; status: number; contentType: string }
  | { kind: "html"; url: string; status: number; html: string }
  | { kind: "blocked"; reason: string }
  | { kind: "unavailable" };

export function mediaType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isFileResponse(contentType: string, url: string): boolean {
  const type = mediaType(contentType);
  if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")) {
    return true;
  }
  if (
    type === "application/pdf" ||
    type === "application/zip" ||
    type === "application/gzip" ||
    type === "application/octet-stream"
  ) {
    return true;
  }
  if (type.startsWith("text/html") || type === "application/xhtml+xml") return false;
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Keep the raw string for the extension check.
  }
  return FILE_EXT.test(path);
}

export function visibleTextLength(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function withBaseHref(html: string, pageUrl: string): string {
  if (/<base\s/i.test(html)) return html;
  const href = pageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}<base href="${href}">`);
  }
  return `<head><base href="${href}"></head>${html}`;
}

async function readText(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = maxBytes - total;
    const slice = value.byteLength > room ? value.slice(0, room) : value;
    parts.push(slice);
    total += slice.byteLength;
    if (value.byteLength > room) break;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export async function probePublicUrl(
  rawUrl: string,
  policy: UrlPolicy,
  timeoutMs = 8_000,
): Promise<ProbeResult> {
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const checked = await assertSafeUrl(current, policy);
      if (!checked.ok) return { kind: "blocked", reason: checked.reason };
      current = checked.url.toString();

      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": FETCH_UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (REDIRECT.has(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location || hop === MAX_REDIRECTS) return { kind: "unavailable" };
        current = new URL(location, current).toString();
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (isFileResponse(contentType, current)) {
        await res.body?.cancel().catch(() => undefined);
        return { kind: "file", url: current, status: res.status, contentType: mediaType(contentType) };
      }

      const html = await readText(res, PROBE_MAX_BYTES);
      return { kind: "html", url: current, status: res.status, html };
    }
  } catch {
    return { kind: "unavailable" };
  }
  return { kind: "unavailable" };
}
