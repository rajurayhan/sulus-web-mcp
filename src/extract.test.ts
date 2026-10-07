import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findMatches,
  formatBrowseResult,
  sameOrigin,
  truncate,
  truncateKeepingPreface,
} from "./extract.js";

describe("truncate", () => {
  it("leaves short text alone", () => {
    assert.equal(truncate("hello", 10), "hello");
  });

  it("marks overflow", () => {
    const out = truncate("abcdefghij", 8);
    assert.match(out, /truncated/);
  });
});

describe("sameOrigin", () => {
  it("compares origins", () => {
    assert.equal(
      sameOrigin("https://a.com/x", "https://a.com/y"),
      true,
    );
    assert.equal(
      sameOrigin("https://b.com/x", "https://a.com/y"),
      false,
    );
  });
});

describe("findMatches", () => {
  it("returns contextual snippets", () => {
    const md = "The pricing for Pro is $29 per month and Teams is $99.";
    const hits = findMatches(md, "pro", 5, 20);
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.toLowerCase(), /pro/);
  });

  it("returns empty when missing", () => {
    assert.deepEqual(findMatches("hello", "zzz", 5, 10), []);
  });
});

describe("formatBrowseResult", () => {
  const page = {
    title: "Docs",
    description: "About",
    url: "https://example.com/docs",
    markdown: "# Hello\n\nWorld",
    links: [{ href: "https://example.com/a", text: "A" }],
  };

  it("formats markdown extract", () => {
    const text = formatBrowseResult(page, "markdown", 10_000);
    assert.match(text, /title: Docs/);
    assert.match(text, /# Hello/);
  });

  it("formats links extract", () => {
    const text = formatBrowseResult(page, "links", 10_000);
    assert.match(text, /A: https:\/\/example.com\/a/);
  });

  it("keeps images when the body is trimmed", () => {
    const text = truncateKeepingPreface(
      `title: T\n\n## Images\n\n- https://cdn.example.com/a.jpg\n\n## Page text\n\n${"word ".repeat(2000)}`,
      400,
    );
    assert.match(text, /https:\/\/cdn\.example\.com\/a\.jpg/);
    assert.match(text, /\[truncated\]/);
  });
});
