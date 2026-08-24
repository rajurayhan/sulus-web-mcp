import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isBlockedHostname,
  isBlockedIp,
  isPrivateIPv4,
  isPrivateIPv6,
  parseBrowseUrl,
} from "./ssrf.js";

const policy = {
  allowInsecureHttp: false,
  allowHosts: [] as string[],
  denyHosts: [] as string[],
};

describe("parseBrowseUrl", () => {
  it("accepts a public HTTPS URL", () => {
    const r = parseBrowseUrl("https://example.com/docs", policy);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.hostname, "example.com");
  });

  it("rejects HTTP unless allowed", () => {
    const r = parseBrowseUrl("http://example.com", policy);
    assert.equal(r.ok, false);
  });

  it("allows HTTP when configured", () => {
    const r = parseBrowseUrl("http://example.com", {
      ...policy,
      allowInsecureHttp: true,
    });
    assert.equal(r.ok, true);
  });

  it("rejects file and other schemes", () => {
    assert.equal(parseBrowseUrl("file:///etc/passwd", policy).ok, false);
    assert.equal(parseBrowseUrl("ftp://example.com", policy).ok, false);
  });

  it("rejects URLs with credentials", () => {
    const r = parseBrowseUrl("https://user:pass@example.com", policy);
    assert.equal(r.ok, false);
  });

  it("rejects loopback and private IPs", () => {
    assert.equal(parseBrowseUrl("https://127.0.0.1/", policy).ok, false);
    assert.equal(parseBrowseUrl("https://10.0.0.5/", policy).ok, false);
    assert.equal(parseBrowseUrl("https://192.168.1.1/", policy).ok, false);
    assert.equal(parseBrowseUrl("https://169.254.169.254/", policy).ok, false);
    assert.equal(parseBrowseUrl("https://[::1]/", policy).ok, false);
  });

  it("rejects localhost hostnames", () => {
    assert.equal(parseBrowseUrl("https://localhost/", policy).ok, false);
    assert.equal(parseBrowseUrl("https://foo.local/", policy).ok, false);
  });

  it("honors allowlist and denylist", () => {
    const allow = { ...policy, allowHosts: ["*.sulus.ai", "example.com"] };
    assert.equal(parseBrowseUrl("https://docs.sulus.ai", allow).ok, true);
    assert.equal(parseBrowseUrl("https://evil.example.org", allow).ok, false);
    const deny = { ...policy, denyHosts: ["blocked.example"] };
    assert.equal(parseBrowseUrl("https://blocked.example", deny).ok, false);
  });
});

describe("IP helpers", () => {
  it("classifies private IPv4", () => {
    assert.equal(isPrivateIPv4("10.1.2.3"), true);
    assert.equal(isPrivateIPv4("172.16.0.1"), true);
    assert.equal(isPrivateIPv4("8.8.8.8"), false);
    assert.equal(isBlockedIp("100.64.0.1"), true);
  });

  it("classifies private IPv6", () => {
    assert.equal(isPrivateIPv6("::1"), true);
    assert.equal(isPrivateIPv6("fe80::1"), true);
    assert.equal(isPrivateIPv6("2001:4860:4860::8888"), false);
  });

  it("blocks metadata-style hostnames", () => {
    assert.equal(isBlockedHostname("metadata.google.internal", []), true);
  });
});
