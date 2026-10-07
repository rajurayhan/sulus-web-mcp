import type { ExtractedPage } from "./extract.js";

type Entry = {
  page: ExtractedPage;
  storedAt: number;
};

export class PageCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxEntries = 200,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  get(url: string, now = Date.now()): ExtractedPage | undefined {
    const entry = this.entries.get(url);
    if (!entry) return undefined;
    if (now - entry.storedAt > this.ttlMs) {
      this.entries.delete(url);
      return undefined;
    }
    // Refresh order so a hot page is not the first one dropped.
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.page;
  }

  set(url: string, page: ExtractedPage, now = Date.now()): void {
    if (this.entries.has(url)) this.entries.delete(url);
    this.entries.set(url, { page, storedAt: now });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
