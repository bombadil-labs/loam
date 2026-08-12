// T145 (b) — the funnel-fixture story rail. REAL Chrome, over CDP, drives the login form through
// a local forwarding proxy in front of the store — the funnel shape (~/.loam's rehearsed recipe
// puts a TLS terminator here). Two-sided by construction:
//   - --public-url names the PROXY address: login through the proxy succeeds.
//   - --public-url names the store's own address instead: the POST through the proxy refuses,
//     and the operator's channel says once that --public-url likely disagrees with the address
//     the browser used, naming both origins (the T145 near-miss fault).
//
// WHY PLAIN HTTP, NOT TLS: the frozen driver (cdp.ts) accepts no extra Chrome flags, so a
// self-signed terminator would need --ignore-certificate-errors and with it a second, hand-rolled
// Chrome spawn beside the frozen one. The mechanism under test is ORIGIN disagreement in scheme
// or port with the host equal, and an http-to-http proxy on its own port exercises exactly that
// class: Chrome sends the proxy's origin, ownOrigins holds another port. What this file therefore
// deliberately does NOT cover: the scheme-only disagreement under a real browser (the unit rail
// in test/server/funnel-fault.test.ts covers scheme at the header level), and certificate
// handling itself, which no Loam code implements.

import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { Browser, type Tab } from "./cdp.js";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

let browser: Browser;
let home: string;
let gateway: Gateway;
const handles: ServerHandle[] = [];
const proxies: Server[] = [];

/**
 * A minimal forwarding proxy: every request to it is replayed against the store byte-for-byte
 * (method, path, headers, body) and the store's answer streamed back. The browser's Origin header
 * passes through untouched — a real terminator forwards it the same way, and that untouched
 * header IS the disagreement under test. Listening on port 0 FIRST is what lets --public-url
 * name the proxy before the store exists, with no reserve-then-reuse race: the proxy learns the
 * store's port later, at first request.
 */
async function openProxy(): Promise<{ origin: string; aim: (storePort: number) => void }> {
  let target: number | undefined;
  const proxy = createServer((req, res) => {
    if (target === undefined) {
      res.writeHead(502).end("the proxy has no store yet");
      return;
    }
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: target,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    req.pipe(upstream);
  });
  proxies.push(proxy);
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as { port: number }).port;
  return { origin: `http://127.0.0.1:${port}`, aim: (storePort) => void (target = storePort) };
}

/** A store behind a fresh proxy, its --public-url set by the caller. */
async function funnel(
  faults: string[],
  publicUrlOf: (proxyOrigin: string, storeOrigin: string) => string,
): Promise<{ proxyOrigin: string; storeOrigin: string }> {
  const proxy = await openProxy();
  // The mismatch side must name the STORE's address before the store listens, so the port is
  // reserved first (the same reserve-then-reuse trade door-smoke.test.ts documents).
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const storePort = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const storeOrigin = `http://127.0.0.1:${storePort}`;
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: storePort,
    host: "127.0.0.1",
    users: {
      home,
      mount: "default",
      publicUrl: publicUrlOf(proxy.origin, storeOrigin),
      onFault: (m: string) => faults.push(m),
    },
  });
  handles.push(handle);
  proxy.aim(storePort);
  return { proxyOrigin: proxy.origin, storeOrigin };
}

beforeAll(async () => {
  gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([signClaims(userClaims("myk", OPERATOR, 9001), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, 9002), OPERATOR_SEED)]);
  home = mkdtempSync(join(tmpdir(), "loam-funnel-home-"));
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  browser = await Browser.launch();
});

afterAll(async () => {
  await browser?.close();
  while (handles.length > 0) await handles.pop()!.close();
  for (const proxy of proxies) await new Promise<void>((resolve) => proxy.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
});

const fill = (tab: Tab, name: string, value: string): Promise<unknown> =>
  tab.eval(`document.querySelector('input[name="${name}"]').value = ${JSON.stringify(value)}`);

/** Submit the login form and wait for the navigation it causes. */
const submitLogin = async (tab: Tab): Promise<void> => {
  const done = tab.loaded("the navigation after submitting /login");
  await tab.eval(`document.querySelector('form[action="/login"]').submit()`);
  await done;
};

const bodyText = (tab: Tab): Promise<string> => tab.eval("document.body.textContent").then(String);

/** Drive the real login form through the given origin; leaves the tab on the response. */
async function loginThrough(tab: Tab, origin: string): Promise<void> {
  await tab.navigate(`${origin}/login`);
  await fill(tab, "user", "myk");
  await fill(tab, "password", PASSWORD);
  await submitLogin(tab);
}

const nearMiss = (faults: string[]): string[] =>
  faults.filter((m) => m.includes("--public-url") && m.includes("Origin"));

describe("T145 — login through a funnel, driven by a real browser", () => {
  it("succeeds when --public-url names the proxy address the browser uses", async () => {
    const faults: string[] = [];
    const { proxyOrigin } = await funnel(faults, (proxy) => proxy);
    const tab = await browser.tab();
    await loginThrough(tab, proxyOrigin);
    const page = await bodyText(tab);
    expect(page).toContain("Signed in.");
    expect(page).toContain("myk");
    expect(nearMiss(faults).length).toBe(0); // agreement holds; the fault has nothing to say
    tab.close();
  });

  it("refuses when --public-url names the store's own address, and the fault names both origins once", async () => {
    const faults: string[] = [];
    const { proxyOrigin, storeOrigin } = await funnel(faults, (_proxy, store) => store);
    const tab = await browser.tab();
    await loginThrough(tab, proxyOrigin);
    // The caller-visible refusal is the ordinary provenance 403 — cure, no diagnosis.
    const refusal = await bodyText(tab);
    expect(refusal).toContain("did not come from this store's own page");
    expect(refusal).toContain("reload");
    expect(refusal).not.toContain("--public-url");
    // The operator's channel carries the diagnosis exactly once, naming both origins.
    const lines = nearMiss(faults);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`"${proxyOrigin}"`);
    expect(lines[0]).toContain(`"${storeOrigin}"`);
    expect(lines[0]).toContain("port");
    // Transition-deduped under the browser too: a second attempt adds no second line.
    await loginThrough(tab, proxyOrigin);
    expect(nearMiss(faults).length).toBe(1);
    tab.close();
  });
});
