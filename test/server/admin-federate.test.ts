// T150 item 5 — the admin federate-in result page counts an IN-PASTE duplicate as a repeat,
// never as "already held": held by the store is not the same fact as repeated in your paste.
// The frozen admin rails (T141) live in admin-*.test.ts; this file is the new-rail home the
// ticket requires.

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
import { containerClaims } from "../../src/gateway/container.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { toWire } from "../../src/federation/wire.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SEED_ADA = "aa".repeat(32);
const ADA = authorForSeed(SEED_ADA);

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const note = (text: string, seed: string, timestamp: number): ReturnType<typeof signClaims> =>
  signClaims(
    {
      timestamp,
      author: authorForSeed(seed),
      pointers: [{ role: "note", target: { kind: "primitive", value: text } }],
    },
    seed,
  );

/** A governed store with one user (ada) and one shared container gathering ada's own deltas. */
async function federateServer(): Promise<{
  base: string;
  gateway: Gateway;
  held: ReturnType<typeof note>;
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Parameters<typeof signClaims>[0]): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  await op(userClaims("ada", OPERATOR, ts++));
  await op(roleClaims("ada", "actor", OPERATOR, ts++));
  await op(
    containerClaims(
      { container: "ada", trust: "curated", posture: "shared", membership: authoredBy(ADA) },
      OPERATOR,
      ts++,
    ),
  );
  await op(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, ts++));
  const held = note("already in the ground", SEED_ADA, ts++);
  await gateway.append([held]);

  const home = mkdtempSync(join(tmpdir(), "loam-admin-federate-"));
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
  return { base: handle.url, gateway, held };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

async function signIn(base: string, user: string): Promise<string> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!;
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie)}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token, user, password: PASSWORD }).toString(),
  });
  return valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
}

const offer = (deltas: ReturnType<typeof note>[]): string =>
  JSON.stringify({ deltas: deltas.map((d) => toWire(d)) });

describe("the admin federate-in result counts repeats honestly", () => {
  it("an oversized federate paste IS refused — by the form gate, never the transport (T153)", async () => {
    // T153 moved the body readers into src/server/body.ts. The lenient reader's contract is
    // `undefined` past the cap, so the FORM speaks its own refusal (the token check fails on an
    // empty field map) instead of the transport's 413 — this rails that boundary through a REAL
    // admin door, past a real 1 MiB cap, with a real session and token. A consolidation that
    // re-wired the federate door to the strict reader would turn this 403 into a 413 and go red.
    const { base } = await federateServer();
    const session = await signIn(base, "ada");
    const detail = await fetch(`${base}/admin/container?name=ada`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    const formToken = /name="form_token" value="([^"]+)"/.exec(await detail.text())![1]!;

    const huge = "x".repeat(1024 * 1024 + 64);
    const res = await fetch(`${base}/admin/federate`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        name: "ada",
        form_token: formToken,
        offer: huge,
      }).toString(),
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/did not come from this store's own page/);
  });
  it("an in-paste duplicate is a repeat, not 'already held'", async () => {
    const { base, held } = await federateServer();
    const session = await signIn(base, "ada");
    const fresh = note("landing new", SEED_ADA, 9500);

    const detail = await fetch(`${base}/admin/container?name=ada`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    const formToken = /name="form_token" value="([^"]+)"/.exec(await detail.text())![1]!;

    const res = await fetch(`${base}/admin/federate`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        name: "ada",
        form_token: formToken,
        offer: offer([held, held, fresh]),
      }).toString(),
    });
    expect(res.status).toBe(200);
    const page = await res.text();
    // 3 offered, 1 of them a repeat; 1 landed newly; the remaining 1 is held by the store — not 2.
    expect(page).toMatch(/Of 3 offered deltas \(1 of them repeats in the paste\)/);

    expect(page).toMatch(/1 landed newly/);
    expect(page).toMatch(/1 was already held/);
    expect(page).not.toMatch(/2 .*already held/);
  });

  it("a refused delta offered twice is two refusals and one repeat — held survives", async () => {
    const { base, held } = await federateServer();
    const session = await signIn(base, "ada");
    // A delta the container's membership does not select is refused at the door; offered twice it
    // is refused twice (the door counts per offer, deliberately), and the store-held delta must
    // still be reported — the naive offered-accepted-rejected remainder would have erased it.
    const foreign = note("not ada's", "ff".repeat(32), 9600);
    const detail = await fetch(`${base}/admin/container?name=ada`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    const formToken = /name="form_token" value="([^"]+)"/.exec(await detail.text())![1]!;

    const res = await fetch(`${base}/admin/federate`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        name: "ada",
        form_token: formToken,
        offer: offer([foreign, foreign, held]),
      }).toString(),
    });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toMatch(/Of 3 offered deltas \(1 of them repeats in the paste\)/);
    expect(page).toMatch(/2 were refused at the door/);
    expect(page).toMatch(/1 was already held/);
  });

  it("two held deltas plus a refused duplicate: both held facts survive the repeat", async () => {
    const { base, gateway, held } = await federateServer();
    const held2 = note("also in the ground", SEED_ADA, 9700);
    await gateway.append([held2]);
    const session = await signIn(base, "ada");
    const foreign = note("not ada's", "ff".repeat(32), 9800);
    const detail = await fetch(`${base}/admin/container?name=ada`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    const formToken = /name="form_token" value="([^"]+)"/.exec(await detail.text())![1]!;

    const res = await fetch(`${base}/admin/federate`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        name: "ada",
        form_token: formToken,
        offer: offer([held, held2, foreign, foreign]),
      }).toString(),
    });
    expect(res.status).toBe(200);
    const page = await res.text();
    // 4 offered, 1 repeat (the refused delta's second copy); 2 refused; BOTH held deltas reported.
    expect(page).toMatch(/Of 4 offered deltas \(1 of them repeats in the paste\)/);
    expect(page).toMatch(/2 were refused at the door/);
    expect(page).toMatch(/2 were already held/);
  });

  it("a paste with no repeats says nothing about repeats, and held stays honest", async () => {
    const { base, held } = await federateServer();
    const session = await signIn(base, "ada");
    const detail = await fetch(`${base}/admin/container?name=ada`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    const formToken = /name="form_token" value="([^"]+)"/.exec(await detail.text())![1]!;

    const res = await fetch(`${base}/admin/federate`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        name: "ada",
        form_token: formToken,
        offer: offer([held]),
      }).toString(),
    });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toMatch(/Of 1 offered delta:/);
    expect(page).not.toMatch(/repeats in the paste/);
    expect(page).toMatch(/1 was already held/);
  });
});
