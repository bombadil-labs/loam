// T145 (a) — the near-miss provenance fault. When a POST is refused because its Origin matches
// one of the store's own origins on HOST but not on scheme or port, the door tells the operator
// once — onFault — that --public-url likely disagrees with the address the browser uses, naming
// both origins. The refusal the CALLER sees is byte-identical to the ordinary provenance 403
// (the frozen phase-6 rails in login-csrf.test.ts pin it; this file re-asserts the body only to
// bind fault and refusal in one place).
//
// What this file deliberately does not cover: the fault under a REAL browser through a real
// proxy — that is test/browser/funnel.test.ts, the two-sided funnel story rail.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE } from "../../src/server/session.js";
import { cookiesOf, formTokenOf, valueOf } from "../helpers/session-fixture.js";

vi.setConfig({ testTimeout: 20000 }); // real listening servers

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

async function doorServer(
  faults: string[],
  publicUrl?: string,
): Promise<{ base: string; ownPort: string }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([signClaims(userClaims("myk", OPERATOR, 9001), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, 9002), OPERATOR_SEED)]);
  const home = mkdtempSync(join(tmpdir(), "loam-funnel-fault-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: {
      home,
      mount: "default",
      onFault: (m: string) => faults.push(m),
      ...(publicUrl === undefined ? {} : { publicUrl }),
    },
  });
  handles.push(handle);
  return { base: handle.url, ownPort: new URL(handle.url).port };
}

/** POST /login with a valid pre-session pair and the given Origin; return the response. */
async function attempt(base: string, origin: string): Promise<Response> {
  const form = await fetch(`${base}/login`);
  const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
  return fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${nonce}`,
      origin,
    },
    body: new URLSearchParams({
      form_token: formTokenOf(await form.text()),
      user: "myk",
      password: PASSWORD,
    }).toString(),
  });
}

const nearMiss = (faults: string[]): string[] =>
  faults.filter((m) => m.includes("--public-url") && m.includes("Origin"));

describe("T145 — the near-miss provenance fault", () => {
  it("a host-equal Origin on the wrong port refuses unchanged AND says the fault once, naming both origins", async () => {
    const faults: string[] = [];
    const { base, ownPort } = await doorServer(faults);
    const wrongPort = String(Number(ownPort) + 1);
    const foreign = `http://127.0.0.1:${wrongPort}`;

    const refused = await attempt(base, foreign);
    // The caller-visible refusal is the ordinary provenance 403, cure and all — unchanged.
    expect(refused.status).toBe(403);
    const body = await refused.text();
    expect(body).toContain("did not come from this store's own page");
    expect(body).toContain("reload");
    expect(body).not.toContain("--public-url"); // the diagnosis is the operator's, never the caller's

    // The operator's channel names both origins and the flag, exactly once.
    const lines = nearMiss(faults);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`"${foreign}"`);
    expect(lines[0]).toContain(`"http://127.0.0.1:${ownPort}"`);
    expect(lines[0]).toContain("port");

    // TRANSITION-deduped: more near-miss attempts — same origin, a different port, even after an
    // agreeing POST — add nothing. The state (--public-url vs the browser's address) cannot
    // change without a restart, so one line per process is one line per state change, and a
    // stranger alternating origins by hand cannot pump the operator's channel.
    await attempt(base, foreign);
    await attempt(base, `http://127.0.0.1:${Number(ownPort) + 2}`);
    expect((await attempt(base, `http://127.0.0.1:${ownPort}`)).status).toBe(200);
    await attempt(base, foreign);
    expect(nearMiss(faults).length).toBe(1);
  });

  it("a scheme-only disagreement (the TLS-terminator shape) is named as scheme", async () => {
    const faults: string[] = [];
    const { base } = await doorServer(faults, "https://loam.example");
    expect((await attempt(base, "http://loam.example")).status).toBe(403);
    const lines = nearMiss(faults);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('"http://loam.example"');
    expect(lines[0]).toContain('"https://loam.example"');
    expect(lines[0]).toContain("scheme");
  });

  it("a near-miss against a loopback SIBLING spelling is still a near-miss", async () => {
    // ownOrigins widens loopback across spellings on the same port; a browser at localhost on
    // the proxy's port is host-equal to the widened localhost member, not to the bound address.
    const faults: string[] = [];
    const { base, ownPort } = await doorServer(faults);
    expect((await attempt(base, `http://localhost:${Number(ownPort) + 1}`)).status).toBe(403);
    const lines = nearMiss(faults);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`"http://localhost:${ownPort}"`);
  });

  it("a foreign HOST, Origin: null, and a hint-only refusal say nothing — the fault fires only on the funnel shape", async () => {
    const faults: string[] = [];
    const { base, ownPort } = await doorServer(faults);
    expect((await attempt(base, "http://evil.example")).status).toBe(403);
    expect((await attempt(base, `http://evil.example:${ownPort}`)).status).toBe(403);
    expect((await attempt(base, "null")).status).toBe(403);
    expect(nearMiss(faults).length).toBe(0);
  });
});
