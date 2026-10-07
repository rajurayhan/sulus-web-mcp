import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFileResponse, visibleTextLength, withBaseHref } from "./fetch-page.js";

describe("isFileResponse", () => {
  it("treats images and pdfs as files", () => {
    assert.equal(isFileResponse("image/jpeg", "https://cdn.example.com/a"), true);
    assert.equal(isFileResponse("application/pdf", "https://example.com/spec"), true);
    assert.equal(isFileResponse("application/octet-stream", "https://example.com/x"), true);
  });

  it("keeps html pages as pages", () => {
    assert.equal(
      isFileResponse("text/html; charset=utf-8", "https://example.com/item"),
      false,
    );
  });

  it("uses the path when the type is missing", () => {
    assert.equal(isFileResponse("", "https://example.com/manual.pdf"), true);
    assert.equal(isFileResponse("", "https://example.com/docs"), false);
  });
});

describe("visibleTextLength", () => {
  it("ignores script and style text", () => {
    const html = "<script>const sku = '15320'</script><style>.x{color:red}</style><p>Hello there</p>";
    assert.equal(visibleTextLength(html), "Hello there".length);
  });
});

describe("withBaseHref", () => {
  it("inserts a base tag once", () => {
    const html = "<head><title>A</title></head><a href='/item'>Item</a>";
    const once = withBaseHref(html, "https://example.com/catalog");
    assert.match(once, /<base href="https:\/\/example.com\/catalog">/);
    assert.equal(withBaseHref(once, "https://example.com/other"), once);
  });
});
