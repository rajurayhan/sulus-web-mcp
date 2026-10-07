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

  const images: { src: string; alt: string }[] = [];
  const seenImg = new Set<string>();
  const addImage = (raw: string | null | undefined, alt: string) => {
    const src = (raw || "").trim();
    if (!src || src.startsWith("data:") || src.startsWith("javascript:")) return;
    let abs = src;
    try {
      abs = new URL(src, document.baseURI).href;
    } catch {
      return;
    }
    if (!abs.startsWith("http://") && !abs.startsWith("https://")) return;
    if (seenImg.has(abs) || images.length >= 20) return;
    seenImg.add(abs);
    const label = clean(alt).slice(0, 160);
    images.push({ src: abs, alt: label });
  };

  const imageUrl = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string") return record.url;
    if (typeof record.contentUrl === "string") return record.contentUrl;
    return "";
  };

  const facts: string[] = [];
  const seenFacts = new Set<string>();
  const pushFact = (label: string, value: string) => {
    const line = `${label}: ${clean(value).slice(0, 300)}`;
    if (line.endsWith(": ") || seenFacts.has(line) || facts.length >= 40) return;
    seenFacts.add(line);
    facts.push(line);
  };

  const seenLd = new Set<unknown>();
  const visitLd = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 8 || seenLd.has(node)) return;
    seenLd.add(node);
    if (seenLd.size > 200) return;
    if (Array.isArray(node)) {
      for (const item of node) visitLd(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const rawType = record["@type"];
    const types = Array.isArray(rawType)
      ? rawType.map((t) => String(t))
      : rawType
        ? [String(rawType)]
        : [];
    const typeName = (t: string) => t.split(/[/#:]/).filter(Boolean).pop() || t;
    const contentTypes = new Set([
      "Product",
      "Article",
      "NewsArticle",
      "BlogPosting",
      "WebPage",
      "WebSite",
      "Organization",
      "FAQPage",
      "Recipe",
      "Event",
      "Book",
      "Course",
    ]);
    const isContent = types.some((t) => contentTypes.has(typeName(t)));
    if (isContent) {
      if (typeof record.name === "string") pushFact("name", record.name);
      if (typeof record.headline === "string") pushFact("headline", record.headline);
      if (typeof record.sku === "string") pushFact("sku", record.sku);
      if (typeof record.mpn === "string") pushFact("mpn", record.mpn);
      if (typeof record.url === "string") pushFact("url", record.url);
      if (typeof record.datePublished === "string") pushFact("published", record.datePublished);
      if (typeof record.description === "string") pushFact("description", record.description);
      if (typeof record.author === "string") pushFact("author", record.author);
      else if (
        record.author &&
        typeof record.author === "object" &&
        !Array.isArray(record.author) &&
        typeof (record.author as Record<string, unknown>).name === "string"
      ) {
        pushFact("author", (record.author as Record<string, unknown>).name as string);
      }
      const imageList = Array.isArray(record.image)
        ? record.image
        : record.image
          ? [record.image]
          : [];
      for (const image of imageList) addImage(imageUrl(image), "image");
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") visitLd(value, depth + 1);
    }
  };

  addImage(
    document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
      document.querySelector('meta[name="twitter:image"]')?.getAttribute("content"),
    "",
  );

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visitLd(JSON.parse(script.textContent || ""), 0);
    } catch {
      // Ignore malformed product data and keep the visible page text.
    }
  }

  const mainLive =
    document.querySelector("article, main, [role='main']") || document.body;
  const imgNodes = [
    ...Array.from(mainLive?.querySelectorAll("img") ?? []),
    ...Array.from(document.querySelectorAll("img")),
  ];
  for (const img of imgNodes) {
    const el = img as HTMLImageElement;
    if (el.getAttribute("width") === "1" || el.getAttribute("height") === "1") continue;
    const lazy = el.getAttribute("data-src") || "";
    const srcset = (el.getAttribute("srcset") || "").split(",")[0]?.trim().split(/\s+/)[0] || "";
    addImage(lazy || el.currentSrc || el.src || srcset, el.alt || el.getAttribute("alt") || "");
  }

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
    let text = clean(anchor.textContent).slice(0, 160);
    if (!text) {
      text = clean(anchor.querySelector("img")?.getAttribute("alt")).slice(0, 160);
    }
    if (!text) {
      try {
        text = decodeURIComponent(
          new URL(href).pathname.split("/").filter(Boolean).pop() || "",
        ).slice(0, 160);
      } catch {
        text = "";
      }
    }
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

  const body = blocks.join("\n\n") || clean(root.textContent);
  const preface: string[] = [];
  if (images.length) {
    const lines = images.map((image) =>
      image.alt ? `- ${image.alt}: ${image.src}` : `- ${image.src}`,
    );
    preface.push(`## Images\n\n${lines.join("\n")}`);
  }
  if (facts.length) {
    preface.push(`## Page data\n\n${facts.map((fact) => `- ${fact}`).join("\n")}`);
  }
  if (links.length) {
    const lines = links.slice(0, 40).map((link) => `- ${link.text}: ${link.href}`);
    preface.push(`## Links\n\n${lines.join("\n")}`);
  }
  const markdown = [preface.join("\n\n"), body ? `## Page text\n\n${body}` : ""]
    .filter(Boolean)
    .join("\n\n");

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

export const PAGE_TEXT_MARKER = "\n\n## Page text\n\n";

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 24))}\n\n[truncated]`;
}

/** Trim the long body. Title, images, page data, and links stay. */
export function truncateKeepingPreface(text: string, maxChars: number): string {
  const at = text.indexOf(PAGE_TEXT_MARKER);
  if (at === -1) return truncate(text, maxChars);
  const preface = text.slice(0, at);
  const body = text.slice(at);
  if (text.length <= maxChars) return text;
  const room = maxChars - preface.length;
  if (room < 80) return truncate(text, maxChars);
  return preface + truncate(body, room);
}

export function bodyTextOf(markdown: string): string {
  const at = markdown.indexOf(PAGE_TEXT_MARKER);
  if (at === -1) return markdown;
  return markdown.slice(at + PAGE_TEXT_MARKER.length);
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

  return truncateKeepingPreface(
    `${header}\n\n${page.markdown || "(empty page)"}`,
    maxChars,
  );
}
