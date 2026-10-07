import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { extractFromDocument } from "./extract.js";
import { findMatches } from "./extract.js";

const html = `<!doctype html>
<html>
<head>
  <title>Aluminum Oxide</title>
  <meta property="og:image" content="https://cdn.example.com/og-15320.jpg">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": "Aluminum Oxide Anti-Slip Aggregate",
    "sku": "15320",
    "image": "https://cdn.example.com/products/15320_46Grit_pouch.jpg",
    "url": "https://www.citadelfloors.com/aluminum-oxide-anti-slip-aggregate/"
  }
  </script>
</head>
<body>
<main>
  <h1>Aluminum Oxide Anti-Slip Aggregate</h1>
  <p>Slip resistant additive for concrete floors.</p>
  <ul>
    <li><a href="https://www.citadelfloors.com/aluminum-oxide-anti-slip-aggregate/">Aluminum Oxide Anti-Slip Aggregate</a></li>
    <li><a href="https://www.citadelfloors.com/pouch.jpg"><img alt="46 grit pouch" src="https://cdn.example.com/products/15320_46Grit_pouch.jpg"></a></li>
  </ul>
  <img alt="46 grit pouch" src="https://cdn.example.com/products/15320_46Grit_pouch.jpg">
  <img alt="" width="1" height="1" src="https://cdn.example.com/pixel.gif">
</main>
</body>
</html>`;

describe("extractFromDocument product pages", () => {
  let browser: Browser;

  after(async () => {
    if (browser) await browser.close();
  });

  it("keeps the product image, sku, and link in the text", async () => {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html);
    // tsx names functions with a __name helper that exists in Node, not in the page.
    await page.evaluate(() => {
      (globalThis as unknown as { __name: (fn: unknown) => unknown }).__name = (fn) => fn;
    });
    const snapshot = await page.evaluate(extractFromDocument);

    assert.match(snapshot.markdown, /## Images/);
    assert.match(
      snapshot.markdown,
      /https:\/\/cdn\.example\.com\/products\/15320_46Grit_pouch\.jpg/,
    );
    assert.match(snapshot.markdown, /https:\/\/cdn\.example\.com\/og-15320\.jpg/);
    assert.doesNotMatch(snapshot.markdown, /pixel\.gif/);
    assert.ok(snapshot.markdown.indexOf("## Images") < snapshot.markdown.indexOf("## Page text"));

    assert.match(snapshot.markdown, /## Page data/);
    assert.match(snapshot.markdown, /sku: 15320/);
    assert.equal(html.includes(">15320<"), false);

    assert.match(snapshot.markdown, /## Links/);
    assert.match(
      snapshot.markdown,
      /Aluminum Oxide Anti-Slip Aggregate: https:\/\/www\.citadelfloors\.com\/aluminum-oxide-anti-slip-aggregate\//,
    );
    assert.match(snapshot.markdown, /46 grit pouch: https:\/\/www\.citadelfloors\.com\/pouch\.jpg/);

    const hits = findMatches(snapshot.markdown, "15320", 5, 40);
    assert.ok(hits.length >= 1);
  });
});
