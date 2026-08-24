export type PageLink = {
  href: string;
  text: string;
};

export type ExtractedPage = {
  title: string;
  description: string;
  url: string;
  markdown: string;
  links: PageLink[];
};

export type ExtractedSnapshot = {
  title: string;
  description: string;
  markdown: string;
  links: PageLink[];
};

/** Runs inside the page. Keep this self-contained — Playwright serializes it. */
export function extractFromDocument(): ExtractedSnapshot {
  const clean = (s: string | null | undefined): string =>
    (s || "").replace(/\s+/g, " ").trim();

  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll(
    "script, style, noscript, iframe, svg, canvas, template, link",
  )) {
    el.remove();
  }

  const root =
    clone.querySelector("article, main, [role='main']") ||
    clone.querySelector("body") ||
    clone;

  const links: PageLink[] = [];
  const seen = new Set<string>();
  for (const a of root.querySelectorAll("a[href]")) {
    const anchor = a as HTMLAnchorElement;
    const href = anchor.href;
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const text = clean(anchor.textContent).slice(0, 160);
    if (text) links.push({ href, text });
  }

  const blocks: string[] = [];
  const walk = (node: Element) => {
    const tag = node.tagName.toLowerCase();
    if (["nav", "footer", "aside"].includes(tag)) return;

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = clean(node.textContent);
      if (text) blocks.push(`${"#".repeat(level)} ${text}`);
      return;
    }
    if (tag === "p" || tag === "blockquote") {
      const text = clean(node.textContent);
      if (text) blocks.push(text);
      return;
    }
    if (tag === "pre" || tag === "code") {
      const text = (node.textContent || "").trim();
      if (text) blocks.push("```\n" + text.slice(0, 4000) + "\n```");
      return;
    }
    if (tag === "li") {
      const text = clean(node.textContent);
      if (text) blocks.push(`- ${text}`);
      return;
    }
    if (tag === "a") return;
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(root);

  let markdown = blocks.join("\n\n");
  if (!markdown) markdown = clean(root.textContent);

  const description =
    document.querySelector('meta[name="description"]')?.getAttribute("content") ||
    document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
    "";

  return {
    title: clean(document.title),
    description: clean(description),
    markdown,
    links: links.slice(0, 200),
  };
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 24))}\n\n[truncated]`;
}

export function sameOrigin(href: string, pageUrl: string): boolean {
  try {
    return new URL(href).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

export function findMatches(
  markdown: string,
  query: string,
  maxMatches: number,
  contextChars: number,
): string[] {
  const q = query.trim();
  if (!q) return [];
  const lower = markdown.toLowerCase();
  const needle = q.toLowerCase();
  const out: string[] = [];
  let from = 0;
  while (out.length < maxMatches) {
    const idx = lower.indexOf(needle, from);
    if (idx === -1) break;
    const start = Math.max(0, idx - contextChars);
    const end = Math.min(markdown.length, idx + needle.length + contextChars);
    out.push(markdown.slice(start, end).replace(/\s+/g, " ").trim());
    from = idx + needle.length;
  }
  return out;
}

export function formatBrowseResult(
  page: ExtractedPage,
  extract: "markdown" | "links" | "title",
  maxChars: number,
): string {
  const header = [
    `title: ${page.title || "(none)"}`,
    `url: ${page.url}`,
    page.description ? `description: ${page.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (extract === "title") {
    return truncate(header, maxChars);
  }

  if (extract === "links") {
    const lines = page.links.map((l) => `- ${l.text}: ${l.href}`).join("\n");
    return truncate(
      `${header}\n\nlinks (${page.links.length}):\n${lines || "(none)"}`,
      maxChars,
    );
  }

  return truncate(`${header}\n\n${page.markdown || "(empty page)"}`, maxChars);
}
