import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import type { AppConfig } from "./config.js";
import {
  bodyTextOf,
  extractFromDocument,
  sameOrigin,
  type ExtractedPage,
  type ExtractedSnapshot,
  type PageLink,
} from "./extract.js";
import {
  HTML_READY_CHARS,
  FETCH_UA,
  probePublicUrl,
  visibleTextLength,
  withBaseHref,
  type ProbeResult,
} from "./fetch-page.js";
import { PageCache } from "./page-cache.js";
import { Semaphore } from "./rate-limit.js";
import { assertSafeUrl, isBlockedRequestUrl, type UrlPolicy } from "./ssrf.js";

export type BrowseOptions = {
  wait?: "load" | "domcontentloaded" | "networkidle";
};

const EXTRA_WAIT_MS = 3_000;
const MIN_BODY_CHARS = 200;

export class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly slots: Semaphore;
  private readonly policy: UrlPolicy;
  private readonly cache = new PageCache();

  constructor(private readonly config: AppConfig) {
    this.slots = new Semaphore(config.maxConcurrent);
    this.policy = {
      allowInsecureHttp: config.allowInsecureHttp,
      allowHosts: config.allowHosts,
      denyHosts: config.denyHosts,
    };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async browse(rawUrl: string, options: BrowseOptions = {}): Promise<ExtractedPage> {
    const started = Date.now();
    const safe = await assertSafeUrl(rawUrl, this.policy);
    if (!safe.ok) {
      throw new BrowseError(safe.reason, 400);
    }

    const requested = cacheUrl(safe.url.toString());
    const cached = this.cache.get(requested);
    if (cached) {
      this.log(requested, cached.url, 200, Date.now() - started, "cache");
      return cached;
    }

    let probed: ProbeResult = { kind: "unavailable" };
    if (options.wait !== "networkidle") {
      probed = await probePublicUrl(requested, this.policy);
    }

    if (probed.kind === "blocked") {
      throw new BrowseError(probed.reason, 400);
    }

    if (probed.kind === "file") {
      const page = filePage(probed);
      if (probed.status < 500) this.remember(requested, page);
      this.log(requested, page.url, probed.status, Date.now() - started, "file");
      return page;
    }

    if (probed.kind === "html" && visibleTextLength(probed.html) >= HTML_READY_CHARS) {
      try {
        const page = await this.readStaticHtml(probed.url, probed.html);
        if (hasUsefulText(page.markdown)) {
          if (probed.status < 500) this.remember(requested, page);
          this.log(requested, page.url, probed.status, Date.now() - started, "html");
          return page;
        }
      } catch (error) {
        if (error instanceof BrowseError && error.status === 400) throw error;
      }
    }

    return this.browseRendered(requested, options, started);
  }

  filterLinks(page: ExtractedPage, sameOriginOnly: boolean, limit: number): PageLink[] {
    const links = sameOriginOnly
      ? page.links.filter((l) => sameOrigin(l.href, page.url))
      : page.links;
    return links.slice(0, limit);
  }

  private remember(requested: string, page: ExtractedPage): void {
    if (!hasUsefulText(page.markdown) && !page.markdown.includes("kind: file")) return;
    this.cache.set(requested, page);
    const finalUrl = cacheUrl(page.url);
    if (finalUrl !== requested) this.cache.set(finalUrl, page);
  }

  private async readStaticHtml(pageUrl: string, html: string): Promise<ExtractedPage> {
    await this.slots.acquire();
    let context: BrowserContext | undefined;
    try {
      const browser = await this.ensureBrowser();
      context = await this.newContext(browser, false);
      const page = await context.newPage();
      await installRoutes(page, this.policy);
      await page.setContent(withBaseHref(html, pageUrl), { waitUntil: "domcontentloaded" });
      const snapshot = (await page.evaluate(extractFromDocument)) as ExtractedSnapshot;
      return toPage(pageUrl, snapshot);
    } finally {
      if (context) await context.close().catch(() => undefined);
      this.slots.release();
    }
  }

  private async browseRendered(
    rawUrl: string,
    options: BrowseOptions,
    started: number,
  ): Promise<ExtractedPage> {
    await this.slots.acquire();
    let context: BrowserContext | undefined;
    try {
      const browser = await this.ensureBrowser();
      context = await this.newContext(browser, true);
      const page = await context.newPage();
      page.setDefaultTimeout(this.config.navigationTimeoutMs);
      page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
      await installRoutes(page, this.policy);

      const waitUntil = options.wait ?? "domcontentloaded";
      const response = await page.goto(rawUrl, {
        waitUntil,
        timeout: this.config.navigationTimeoutMs,
      });

      const finalUrl = page.url();
      const finalSafe = await assertSafeUrl(finalUrl, this.policy);
      if (!finalSafe.ok) {
        throw new BrowseError(`Redirect target blocked: ${finalSafe.reason}`, 400);
      }

      let snapshot = (await page.evaluate(extractFromDocument)) as ExtractedSnapshot;
      if (waitUntil !== "networkidle" && !hasUsefulText(snapshot.markdown ?? "")) {
        await page
          .waitForLoadState("networkidle", { timeout: EXTRA_WAIT_MS })
          .catch(() => undefined);
        snapshot = (await page.evaluate(extractFromDocument)) as ExtractedSnapshot;
      }

      const status = response?.status() ?? 0;
      const result = toPage(finalUrl, snapshot);
      if (status < 400) this.remember(rawUrl, result);
      this.log(rawUrl, finalUrl, status, Date.now() - started, "browser");
      return result;
    } catch (error) {
      if (error instanceof BrowseError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowseError(`Failed to load page: ${message}`, 502);
    } finally {
      if (context) await context.close().catch(() => undefined);
      this.slots.release();
    }
  }

  private newContext(browser: Browser, javaScript: boolean): Promise<BrowserContext> {
    return browser.newContext({
      userAgent: FETCH_UA,
      locale: "en-US",
      viewport: { width: 1280, height: 720 },
      javaScriptEnabled: javaScript,
      ignoreHTTPSErrors: false,
    });
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    this.launching = chromium
      .launch({
        headless: true,
        args: ["--disable-dev-shm-usage", "--no-sandbox"],
      })
      .then((browser) => {
        this.browser = browser;
        browser.on("disconnected", () => {
          this.browser = null;
        });
        return browser;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  private log(url: string, finalUrl: string, status: number, ms: number, path: string): void {
    console.error(
      JSON.stringify({
        event: "browse",
        path,
        url: originPath(url),
        final_origin: originOnly(finalUrl),
        status,
        ms,
      }),
    );
  }
}

const SKIPPED_RESOURCES = new Set(["image", "media", "font", "stylesheet"]);

async function installRoutes(page: Page, policy: UrlPolicy): Promise<void> {
  await page.route("**/*", async (route: Route) => {
    const reqUrl = route.request().url();
    if (
      SKIPPED_RESOURCES.has(route.request().resourceType()) ||
      isBlockedRequestUrl(reqUrl, policy)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

function toPage(url: string, snapshot: ExtractedSnapshot): ExtractedPage {
  return {
    title: snapshot.title ?? "",
    description: snapshot.description ?? "",
    url,
    markdown: snapshot.markdown ?? "",
    links: Array.isArray(snapshot.links) ? snapshot.links : [],
  };
}

function hasUsefulText(markdown: string): boolean {
  return bodyTextOf(markdown).trim().length >= MIN_BODY_CHARS;
}

function filePage(file: Extract<ProbeResult, { kind: "file" }>): ExtractedPage {
  let name = "file";
  try {
    name = decodeURIComponent(new URL(file.url).pathname.split("/").filter(Boolean).pop() || "file");
  } catch {
    name = "file";
  }
  return {
    title: name,
    description: "",
    url: file.url,
    links: [],
    markdown: [
      "kind: file",
      `status: ${file.status}`,
      `content-type: ${file.contentType || "(unknown)"}`,
      "",
      "This URL is a file, not an HTML page.",
    ].join("\n"),
  };
}

function cacheUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  return url.toString();
}

function originPath(raw: string): string {
  try {
    const url = new URL(raw);
    return url.origin + url.pathname;
  } catch {
    return raw;
  }
}

function originOnly(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

export class BrowseError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "BrowseError";
  }
}
