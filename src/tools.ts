import type { AppConfig } from "./config.js";
import { BrowserPool, BrowseError } from "./browser.js";
import {
  findMatches,
  formatBrowseResult,
  truncate,
} from "./extract.js";

export const TOOL_DEFINITIONS = [
  {
    name: "browse_page",
    description:
      "Use this when you need the content of a live public web page. It opens the URL in a headless browser, waits for the document, and returns the title, final URL, and cleaned markdown (or links/title only). Returns extracted text, not a screenshot. Does not log in or fill forms.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute HTTPS URL to open.",
        },
        extract: {
          type: "string",
          enum: ["markdown", "links", "title"],
          description: "What to return. Default: markdown.",
        },
        wait: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle"],
          description: "Playwright waitUntil. Default: domcontentloaded.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "extract_links",
    description:
      "Use this when you need outbound links from a public page. It opens the URL and returns unique hrefs with link text. Returns a markdown list. Optionally restrict to the same origin.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute HTTPS URL to open.",
        },
        same_origin: {
          type: "boolean",
          description: "If true, only keep links on the page origin. Default: false.",
        },
        limit: {
          type: "number",
          description: "Max links to return (1–100). Default: 50.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "search_page",
    description:
      "Use this when you need excerpts matching a query on a public page. It opens the URL, extracts text, and returns up to N case-insensitive snippets around the query. Returns markdown snippets.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute HTTPS URL to open.",
        },
        query: {
          type: "string",
          description: "Case-insensitive text to find.",
        },
        max_matches: {
          type: "number",
          description: "Max snippets (1–20). Default: 8.",
        },
        context_chars: {
          type: "number",
          description: "Characters of context on each side. Default: 160.",
        },
      },
      required: ["url", "query"],
    },
  },
] as const;

function asString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function asBool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = args[key];
  return typeof v === "boolean" ? v : fallback;
}

function asNum(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  pool: BrowserPool,
  config: AppConfig,
): Promise<{ text: string; isError: boolean }> {
  const work = async (): Promise<{ text: string; isError: boolean }> => {
    try {
      if (name === "browse_page") {
        const url = asString(rawArgs, "url");
        if (!url) return { text: "url is required.", isError: true };
        const extract = asString(rawArgs, "extract") || "markdown";
        const mode =
          extract === "links" || extract === "title" ? extract : "markdown";
        const waitRaw = asString(rawArgs, "wait");
        const wait =
          waitRaw === "load" || waitRaw === "networkidle" || waitRaw === "domcontentloaded"
            ? waitRaw
            : undefined;
        const page = await pool.browse(url, { wait });
        return {
          text: formatBrowseResult(page, mode, config.maxOutputChars),
          isError: false,
        };
      }

      if (name === "extract_links") {
        const url = asString(rawArgs, "url");
        if (!url) return { text: "url is required.", isError: true };
        const page = await pool.browse(url);
        const links = pool.filterLinks(
          page,
          asBool(rawArgs, "same_origin", false),
          clamp(asNum(rawArgs, "limit", 50), 1, 100),
        );
        const body = links.map((l) => `- ${l.text}: ${l.href}`).join("\n");
        return {
          text: truncate(
            `title: ${page.title || "(none)"}\nurl: ${page.url}\n\nlinks (${links.length}):\n${body || "(none)"}`,
            config.maxOutputChars,
          ),
          isError: false,
        };
      }

      if (name === "search_page") {
        const url = asString(rawArgs, "url");
        const query = asString(rawArgs, "query");
        if (!url) return { text: "url is required.", isError: true };
        if (!query) return { text: "query is required.", isError: true };
        const page = await pool.browse(url);
        const matches = findMatches(
          page.markdown,
          query,
          clamp(asNum(rawArgs, "max_matches", 8), 1, 20),
          clamp(asNum(rawArgs, "context_chars", 160), 40, 400),
        );
        const body =
          matches.length === 0
            ? `(no matches for "${query}")`
            : matches.map((m, i) => `${i + 1}. …${m}…`).join("\n\n");
        return {
          text: truncate(
            `title: ${page.title || "(none)"}\nurl: ${page.url}\nquery: ${query}\n\n${body}`,
            config.maxOutputChars,
          ),
          isError: false,
        };
      }

      return { text: `Unknown tool: ${name}`, isError: true };
    } catch (error) {
      const message =
        error instanceof BrowseError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      return { text: message, isError: true };
    }
  };

  return Promise.race([
    work(),
    new Promise<{ text: string; isError: boolean }>((resolve) => {
      setTimeout(() => {
        resolve({
          text: `Tool timed out after ${config.toolTimeoutMs}ms.`,
          isError: true,
        });
      }, config.toolTimeoutMs);
    }),
  ]);
}
