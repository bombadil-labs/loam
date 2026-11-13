import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { initHome } from "../../src/cli/config.js";

const OPERATOR_SEED = "4d".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };

const homes: string[] = [];
const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

async function bareStore(): Promise<string> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateways.push(gateway);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  handles.push(handle);
  return handle.url;
}

async function peopledStore(): Promise<string> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateways.push(gateway);
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);
  const home = mkdtempSync(join(tmpdir(), "loam-front-door-"));
  homes.push(home);
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, {
    version: 1,
    users: { myk: await hashPassword("correct horse", CHEAP) },
  });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return handle.url;
}

describe("T104 — the greeting's words and headers", () => {
  it("says what Loam is and names /login as the human door, with a real link", async () => {
    const base = await bareStore();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith("<!doctype html>")).toBe(true);
    expect(text).toContain('<meta charset="utf-8">');
    expect(text).toMatch(/delta/i);
    expect(text).toMatch(/union/i);
    expect(text).toMatch(/order-blind, idempotent, conflict-free/);
    expect(text).toContain('<a href="/login">');
    expect(text).toMatch(/sign in/i);
  });

  it("promises only what the store honours: history is a default an erasure can take back, and federation admits", async () => {
    const base = await bareStore();
    const text = await (await fetch(`${base}/`)).text();
    expect(text).toMatch(/by default/i);
    expect(text).toMatch(/erasure/i);
    expect(text).toMatch(/takes bytes back/i);
    expect(text).toMatch(/agreed to admit/i);
    expect(text).not.toMatch(/nothing is overwritten/i);
    expect(text).not.toMatch(/the ground remembers/i);
    expect(text).not.toMatch(/stores that meet simply merge/i);
    expect(text).not.toMatch(/only ever learns/i);
  });

  it("sends Referrer-Policy: same-origin — the document policy, not the JSON refusals' no-referrer", async () => {
    const base = await bareStore();
    const res = await fetch(`${base}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("is byte-identical whether or not accounts exist — naming /login reveals nothing about people", async () => {
    const bare = await bareStore();
    const peopled = await peopledStore();
    const bareLogin = await fetch(`${bare}/login`);
    const peopledLogin = await fetch(`${peopled}/login`);
    expect(bareLogin.status).toBe(401);
    expect(peopledLogin.status).toBe(200);
    expect(peopledLogin.headers.get("content-type")).toContain("text/html");
    const bareAnswer = await fetch(`${bare}/`);
    const peopledAnswer = await fetch(`${peopled}/`);
    expect(bareAnswer.status).toBe(200);
    const bareText = await bareAnswer.text();
    expect(bareText).toContain("A Loam store serves here.");
    expect(await peopledAnswer.text()).toBe(bareText);
    for (const header of ["referrer-policy", "content-security-policy", "cache-control"]) {
      expect(peopledAnswer.headers.get(header), header).toBe(bareAnswer.headers.get(header));
    }
  });
});
