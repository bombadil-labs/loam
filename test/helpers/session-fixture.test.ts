// T152 — the shared fixture's own rail: it signs in against a LIVE door, so it cannot drift
// silently while every consumer mocks around it. The helper is not a mock; the assertions here
// are against real HTTP, exactly what the ~15 copies used to do by hand.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { signIn, cookiesOf, valueOf, SAME_ORIGIN } from "./session-fixture.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const SEED_ADA = "aa".repeat(32);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

async function door(): Promise<string> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([
    signClaims(userClaims("ada", OPERATOR, ts++), OPERATOR_SEED),
    signClaims(roleClaims("ada", "actor", OPERATOR, ts++), OPERATOR_SEED),
  ]);
  const home = mkdtempSync(join(tmpdir(), "loam-fixture-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { ada: hash } });
  writeUserSeed(home, "ada", SEED_ADA);
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

describe("the shared session fixture", () => {
  it("signs in through the real login door and the session opens a gated page", async () => {
    const base = await door();
    const session = await signIn(base, "ada", PASSWORD);
    expect(session.length).toBeGreaterThan(10);
    const res = await fetch(`${base}/admin`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/admin/i);
  });

  it("a wrong password never mints a session cookie — the helper fails loud", async () => {
    const base = await door();
    await expect(signIn(base, "ada", "wrong password")).rejects.toThrow();
  });

  it("cookie helpers read the raw headers a browser sees", async () => {
    const base = await door();
    const form = await fetch(`${base}/login`, { redirect: "manual" });
    const cookies = cookiesOf(form);
    const nonce = cookies.find((c) => c.startsWith(`${PRESESSION_COOKIE}=`));
    expect(nonce).toBeDefined();
    expect(valueOf(nonce!).length).toBeGreaterThan(10);
    expect(SAME_ORIGIN).toEqual({ "sec-fetch-site": "same-origin" });
  });
});
