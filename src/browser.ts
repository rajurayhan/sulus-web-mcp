import { chromium, type Browser, type BrowserContext } from "playwright";
import type { AppConfig } from "./config.js";
import {
  extractFromDocument,
  sameOrigin,
  type ExtractedPage,
  type ExtractedSnapshot,
  type PageLink,
} from "./extract.js";
import { Semaphore } from "./rate-limit.js";
import { assertSafeUrl, isBlockedRequestUrl, type UrlPolicy } from "./ssrf.js";

export type BrowseOptions = {
  wait?: "load" | "domcontentloaded" | "networkidle";
};

export class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly slots: Semaphore;
  private readonly policy: UrlPolicy;

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

    await this.slots.acquire();
    let context: BrowserContext | undefined;
    try {
      const browser = await this.ensureBrowser();
      context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        locale: "en-US",
        viewport: { width: 1280, height: 720 },
        javaScriptEnabled: true,
        ignoreHTTPSErrors: false,
      });

      const page = await context.newPage();
      page.setDefaultTimeout(this.config.navigationTimeoutMs);
      page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

      await page.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        if (isBlockedRequestUrl(reqUrl, this.policy)) {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });

      const waitUntil = options.wait ?? "domcontentloaded";
      const response = await page.goto(safe.url.toString(), {
        waitUntil,
        timeout: this.config.navigationTimeoutMs,
      });

      const finalUrl = page.url();
      const finalSafe = await assertSafeUrl(finalUrl, this.policy);
      if (!finalSafe.ok) {
        throw new BrowseError(`Redirect target blocked: ${finalSafe.reason}`, 400);
      }

      if (waitUntil !== "networkidle") {
        await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
      }

      const snapshot = (await page.evaluate(extractFromDocument)) as ExtractedSnapshot;
      const status = response?.status() ?? 0;

      console.error(
        JSON.stringify({
          event: "browse",
          url: safe.url.origin + safe.url.pathname,
          final_origin: new URL(finalUrl).origin,
          status,
          ms: Date.now() - started,
        }),
      );

      return {
        title: snapshot.title ?? "",
        description: snapshot.description ?? "",
        url: finalUrl,
        markdown: snapshot.markdown ?? "",
        links: Array.isArray(snapshot.links) ? snapshot.links : [],
      };
    } catch (error) {
      if (error instanceof BrowseError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new BrowseError(`Failed to load page: ${message}`, 502);
    } finally {
      if (context) await context.close().catch(() => undefined);
      this.slots.release();
    }
  }

  filterLinks(page: ExtractedPage, sameOriginOnly: boolean, limit: number): PageLink[] {
    const links = sameOriginOnly
      ? page.links.filter((l) => sameOrigin(l.href, page.url))
      : page.links;
    return links.slice(0, limit);
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
