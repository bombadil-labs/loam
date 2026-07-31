// `POST /session/token` reports `expiresIn`. This file asks whether that number is TRUE.
//
// It lives beside test/server/session-token.test.ts rather than inside it because that suite is
// T128's frozen rail set: §36 phase 7's contract, landed and closed. This is a different question
// — not what the bearer bridge promises, but whether the door's own arithmetic about time can
// lie — and it arrived from a P5 lens rather than from a phase.
//
// BOTH LEVELS, and the disagreement between them IS the bug. The response's `expiresIn` is the
// CLAIM. The row in the token table (`sessionTokens` in http.ts) is the FACT. A door that dates
// the lifetime from its own clock read, rather than from the deadline `mint` recorded, advertises
// a window that outlives the row: the token is refused inside the life the response promised. A
// rail that only read the response body could never see that, which is why the assertion here is
// a real request to a real data door.
//
// THE BEHAVIOUR IS ALREADY CORRECT — phase 8 made `mint` hand back the deadline it recorded. What
// was missing is a test that can tell. The only prior assertion on the field was that it exceeded
// zero, which the wrong answer satisfies too. This is the rail, arriving after the fix.

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
const MYK_SEED = "11".repeat(32); // phase 8: a session signs as its user, so the user needs a key
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

/** One operator user, no garden: `{ __typename }` needs no registered schema. */
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
    // The clock STEPS on every read. That makes the gap deterministic rather than a race on real
    // request latency: the moment `mint` recorded is now strictly earlier than any moment the
    // door can read after it, so a door dating the lifetime from after the mint overshoots by a
    // fixed, visible amount instead of by however long the process happened to take.
    const STEP = 2000;
    let clockMs = 0;
    let stepMs = STEP;
    const base = await tokenServer({
      monotonicNow: (): number => {
        clockMs += stepMs;
        return clockMs;
      },
      tokenTtlMs: 100_000,
      idleMs: 100_000_000, // the SESSION must not be what expires here
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

    // Freeze the clock. From here the test drives it by hand, and `sent` is the moment the
    // response left — the anchor the advertised lifetime counts from.
    stepMs = 0;
    const sent = clockMs;
    expect(minted.expiresIn).toBeGreaterThan(0);
    expect(minted.expiresIn).toBeLessThanOrEqual(100); // never more than the configured TTL

    // Inside the promised window, by HALF a step. The margin has to be smaller than the smallest
    // overshoot a wrong answer can carry, and the smallest is one STEP: a door that dates the
    // lifetime from its own next clock read is exactly one read late. A margin of a full step or
    // more would swallow that and pass on the bug — this rail did, before it was measured.
    //
    // The cost of a margin that tight: `sent` is the last clock the SERVER read, and the rail
    // assumes that read is the one `expiresIn` was measured against. A future door that reads the
    // clock again between computing `expiresIn` and writing the response turns this red. That red
    // is not noise — it means the response's own arithmetic moved — but the fix is there, not here.
    clockMs = sent + minted.expiresIn * 1000 - STEP / 2;
    expect((await gql(base, minted.token)).status).toBe(200);

    // The other side, so the assertion above cannot be satisfied by a token that never dies:
    // past the advertised expiry the same token is refused.
    clockMs = sent + minted.expiresIn * 1000 + STEP;
    expect((await gql(base, minted.token)).status).toBe(401);
  });
});
