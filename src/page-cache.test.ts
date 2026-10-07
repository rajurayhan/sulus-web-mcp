import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PageCache } from "./page-cache.js";
import type { ExtractedPage } from "./extract.js";

function page(url: string): ExtractedPage {
  return { title: url, description: "", url, markdown: "hello", links: [] };
}

describe("PageCache", () => {
  it("expires an entry after the time limit", () => {
    const cache = new PageCache(10, 1_000);
    cache.set("https://example.com/a", page("https://example.com/a"), 0);
    assert.equal(cache.get("https://example.com/a", 500)?.url, "https://example.com/a");
    assert.equal(cache.get("https://example.com/a", 1_001), undefined);
  });

  it("drops the oldest entry when full", () => {
    const cache = new PageCache(2, 10_000);
    cache.set("https://example.com/a", page("https://example.com/a"), 1);
    cache.set("https://example.com/b", page("https://example.com/b"), 2);
    cache.get("https://example.com/a", 3);
    cache.set("https://example.com/c", page("https://example.com/c"), 4);
    assert.equal(cache.get("https://example.com/b", 5), undefined);
    assert.equal(cache.get("https://example.com/a", 5)?.url, "https://example.com/a");
    assert.equal(cache.get("https://example.com/c", 5)?.url, "https://example.com/c");
  });
});
