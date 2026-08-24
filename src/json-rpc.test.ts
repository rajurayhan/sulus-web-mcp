import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadAppConfig } from "./config.js";
import { handleStatelessJsonRpc } from "./json-rpc.js";
import type { BrowserPool } from "./browser.js";

describe("handleStatelessJsonRpc", () => {
  const config = loadAppConfig();
  const pool = {} as BrowserPool;

  it("answers initialize and tools/list without a session", async () => {
    const init = await handleStatelessJsonRpc(
      { method: "initialize", params: {} },
      pool,
      config,
    );
    assert.ok(init.result);
    assert.equal(
      (init.result as { serverInfo: { name: string } }).serverInfo.name,
      "sulus-web-mcp",
    );

    const list = await handleStatelessJsonRpc(
      { method: "tools/list", params: {} },
      pool,
      config,
    );
    const tools = (list.result as { tools: Array<{ name: string }> }).tools;
    assert.deepEqual(
      tools.map((t) => t.name),
      ["browse_page", "extract_links", "search_page"],
    );
  });

  it("rejects unknown methods", async () => {
    const r = await handleStatelessJsonRpc(
      { method: "nope" },
      pool,
      config,
    );
    assert.ok(r.error);
  });
});
