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

const OPERATOR_SEED = "0e".repeat(32);
const MYK_SEED = "11".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));

async function tokenServer(doorOptions: Record<string, unknown>): Promise<string> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(userClaims("myk", OPERATOR, 9001), OPERATOR_SEED),
    signClaims(roleClaims("myk", "operator", OPERATOR, 9002), OPERATOR_SEED),
  ]);
  const home = mkdtempSync(join(tmpdir(), "loam-token-expiry-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  writeUserSeed(home, "myk", MYK_SEED);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default", ...doorOptions },
  });
  handles.push(handle);
  return handle.url;
}

async function signIn(base: string): Promise<{ sessionId: string; sessionToken: string }> {
  const form = await fetch(`${base}/login`);
  const nonce = valueOf(
    form.headers.getSetCookie().find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!,
  );
  const formToken = /name="form_token" value="([^"]+)"/.exec(await form.text())?.[1];
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${nonce}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({
      form_token: formToken!,
      user: "myk",
      password: PASSWORD,
    }).toString(),
  });
  expect(res.status).toBe(200);
  const sessionId = valueOf(
    res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!,
  );
  const sessionToken = /name="form_token" value="([^"]+)"/.exec(await res.text())?.[1];
  return { sessionId, sessionToken: sessionToken! };
}

const gql = (base: string, token: string): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: '{"query":"{ __typename }"}',
  });

describe("the lifetime /session/token advertises", () => {
  it("never outruns the deadline the token table recorded", async () => {
    const STEP = 2000;
    let clockMs = 0;
    let stepMs = STEP;
    const base = await tokenServer({
      monotonicNow: (): number => {
        clockMs += stepMs;
        return clockMs;
      },
      tokenTtlMs: 100_000,
      idleMs: 100_000_000,
    });
    const session = await signIn(base);
    const res = await fetch(`${base}/session/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session.sessionId}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({ form_token: session.sessionToken }).toString(),
    });
    expect(res.status).toBe(200);
    const minted = (await res.json()) as { token: string; expiresIn: number };

    stepMs = 0;
    const sent = clockMs;
    expect(minted.expiresIn).toBeGreaterThan(0);
    expect(minted.expiresIn).toBeLessThanOrEqual(100);

    clockMs = sent + minted.expiresIn * 1000 - STEP / 2;
    expect((await gql(base, minted.token)).status).toBe(200);

    clockMs = sent + minted.expiresIn * 1000 + STEP;
    expect((await gql(base, minted.token)).status).toBe(401);
  });
});
