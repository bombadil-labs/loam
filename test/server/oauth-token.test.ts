// §37 phase 15 — the token exchange (T136). Criteria 1–7 and 11–13 of
// .adlc/specs/37-15-the-token-exchange-and-revocation.md, transcribed. `POST /oauth/token` redeems a
// single-use authorization code for a per-connector actor seed and a bearer token. Revocation
// (criteria 8–10) lives in its sibling oauth-revoke.test.ts.
//
// Most criteria run END-TO-END through a live serve(): register → consent → redeem → write, so the
// enforcing code answers rather than a stand-in. The two CONCURRENCY criteria (3, 4) cannot be posed
// through fetch — the in-flight window is a few synchronous statements wide — so they drive the token
// door and the register door directly, sharing the one `redeeming` map serve() wires between them,
// with a grantStanding barrier the test releases by hand.
//
// EVERY AUTHORSHIP ASSERTION READS THE STORE'S OWN DELTAS (session-authorship.test.ts's lesson): a
// view resolves values and says nothing about who signed them, so criterion 6 asserts at BOTH levels.

import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { initHome } from "../../src/cli/config.js";
import {
  EMPTY_OAUTH,
  oauthLockPath,
  readOAuthFile,
  writeOAuthFile,
  type OAuthClient,
  type OAuthCode,
  type OAuthFile,
} from "../../src/server/oauth-file.js";
import { makeOAuthDoors, makeTokenDoor } from "../../src/server/oauth.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "./../gateway/fixtures.js";
import { FERN, GARDENER, SURVEYOR } from "../spike/garden.js";

vi.setConfig({ testTimeout: 25000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = "https://app.example/cb";
const CLIENT_ID = "connector-fixed-0001";
const CLIENT_NAME = "Example Connector";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

// --- PKCE ----------------------------------------------------------------------------------------

const b64url = (buf: Buffer): string => buf.toString("base64url");
/** A fresh PKCE pair: a 43-char verifier and its S256 challenge, both real (RFC 7636). */
const pkce = (): { verifier: string; challenge: string } => {
  const verifier = b64url(randomBytes(32)); // 43 chars, unreserved
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

// --- the end-to-end fixture ----------------------------------------------------------------------

const clientRecord = (over: Partial<OAuthClient> = {}): OAuthClient => ({
  clientId: CLIENT_ID,
  clientName: CLIENT_NAME,
  redirectUris: [REDIRECT],
  registeredAt: 1,
  generation: 1,
  ...over,
});

async function connectorServer(
  opts: { client?: OAuthClient; faults?: string[] } = {},
): Promise<{ base: string; home: string; handle: ServerHandle; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, ts++), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, ts++), OPERATOR_SEED),
  ]);
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

  const home = mkdtempSync(join(tmpdir(), "loam-oauth-token-"));
  homes.push(home);
  // The token door signs the write grant with <home>/operator.seed — the same key the gateway holds.
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  writeOAuthFile(home, { ...EMPTY_OAUTH, clients: [opts.client ?? clientRecord()] });

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: {
      home,
      allowRedirectOrigins: [ALLOW_ORIGIN],
      ...(opts.faults === undefined ? {} : { onFault: (m: string) => opts.faults!.push(m) }),
    },
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, home, handle, gateway };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (h: string): string => h.slice(h.indexOf("=") + 1, h.indexOf(";"));
const fieldOf = (html: string, name: string): string =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

async function signIn(base: string): Promise<string> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${nonce}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token, user: "myk", password: PASSWORD }).toString(),
  });
  return valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
}

/** Sign in, approve the consent page WITH a PKCE challenge, and return the minted code + verifier. */
async function mintCode(
  base: string,
  challenge: string,
  over: { clientId?: string; redirectUri?: string } = {},
): Promise<string> {
  const sessionId = await signIn(base);
  const query = new URLSearchParams({
    client_id: over.clientId ?? CLIENT_ID,
    redirect_uri: over.redirectUri ?? REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-1",
  }).toString();
  const page = await fetch(`${base}/oauth/authorize?${query}`, {
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    redirect: "manual",
  });
  const html = await page.text();
  expect(html).toContain("Approve a connector?");
  const approve = await fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({
      form_token: fieldOf(html, "form_token"),
      client_id: fieldOf(html, "client_id"),
      redirect_uri: fieldOf(html, "redirect_uri"),
      code_challenge: fieldOf(html, "code_challenge"),
      code_challenge_method: "S256",
      state: fieldOf(html, "state"),
    }).toString(),
    redirect: "manual",
  });
  expect(approve.status).toBe(302);
  const location = new URL(approve.headers.get("location")!);
  return location.searchParams.get("code")!;
}

interface TokenBody {
  grant_type?: string;
  code?: string;
  client_id?: string;
  redirect_uri?: string;
  code_verifier?: string;
}

async function redeem(base: string, body: TokenBody): Promise<Response> {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    ...(body as Record<string, string>),
  };
  return fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    redirect: "manual",
  });
}

const errorOf = async (res: Response): Promise<string> =>
  ((await res.json()) as { error?: string }).error ?? "";

const mutate = (base: string, token: string, height: number): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `mutation { plant(entity: "${FERN}", height: ${height}) { height } }`,
    }),
  });

const heightDeltas = (gateway: Gateway, height: number): Delta[] =>
  [...gateway.reactor.snapshot()].filter(
    (d: Delta) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "height",
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "value" && p.target.kind === "primitive" && p.target.value === height,
      ),
  );
const authorsOfHeight = (gateway: Gateway, height: number): string[] =>
  heightDeltas(gateway, height).map((d) => d.claims.author);

describe("§37 phase 15 — the token exchange", () => {
  it("(1) a code is single-use and BURNS on any redemption attempt", async () => {
    const { base } = await connectorServer();
    const { verifier, challenge } = pkce();
    const code = await mintCode(base, challenge);

    // A WRONG verifier is refused — and burns the code.
    const wrong = await redeem(base, {
      code,
      code_verifier: verifier.slice(0, -1) + (verifier.endsWith("A") ? "B" : "A"),
    });
    expect(wrong.status).toBe(400);
    expect(await errorOf(wrong)).toBe("invalid_grant");

    // The RIGHT verifier afterwards is refused too: the code is already gone.
    const after = await redeem(base, { code, code_verifier: verifier });
    expect(after.status).toBe(400);
    expect(await errorOf(after)).toBe("invalid_grant");

    // Positive control: a FRESH code with the correct verifier mints once — so the two refusals are
    // about single-use, not about redemption being broken for everyone.
    const fresh = pkce();
    const freshCode = await mintCode(base, fresh.challenge);
    const ok = await redeem(base, { code: freshCode, code_verifier: fresh.verifier });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { token_type: string }).token_type).toBe("Bearer");
  });

  it("(2) a code is bound to its client and its redirect_uri", async () => {
    const { base } = await connectorServer();

    // Another client's id.
    const a = pkce();
    const codeA = await mintCode(base, a.challenge);
    const wrongClient = await redeem(base, {
      code: codeA,
      client_id: "connector-someone-else",
      code_verifier: a.verifier,
    });
    expect(wrongClient.status).toBe(400);
    expect(await errorOf(wrongClient)).toBe("invalid_grant");

    // A different redirect_uri than it was bound to.
    const b = pkce();
    const codeB = await mintCode(base, b.challenge);
    const wrongUri = await redeem(base, {
      code: codeB,
      redirect_uri: "https://app.example/other",
      code_verifier: b.verifier,
    });
    expect(wrongUri.status).toBe(400);
    expect(await errorOf(wrongUri)).toBe("invalid_grant");

    // Positive control: the exact bound pair mints.
    const c = pkce();
    const codeC = await mintCode(base, c.challenge);
    const ok = await redeem(base, { code: codeC, code_verifier: c.verifier });
    expect(ok.status).toBe(200);
  });

  it("(5) a grant mints a NEW actor seed per client, never the operator's; a retry reuses it", async () => {
    const { base, home } = await connectorServer();
    const p = pkce();
    const code = await mintCode(base, p.challenge);
    const ok = await redeem(base, { code, code_verifier: p.verifier });
    expect(ok.status).toBe(200);

    const file = readOAuthFile(home);
    expect(file.grants).toHaveLength(1);
    const grant = file.grants[0]!;
    // The seed is a fresh key — NOT the operator's, and its own actor is derived from it.
    expect(grant.actorSeed).not.toBe(OPERATOR_SEED);
    expect(grant.actor).toBe(authorForSeed(grant.actorSeed));
    expect(grant.actor).not.toBe(OPERATOR);
    expect(grant.standing).toBe(true);

    // A second redemption (a fresh code for the SAME client) REUSES the seed — no second is minted.
    const p2 = pkce();
    const code2 = await mintCode(base, p2.challenge);
    const ok2 = await redeem(base, { code: code2, code_verifier: p2.verifier });
    expect(ok2.status).toBe(200);
    const after = readOAuthFile(home);
    expect(after.grants).toHaveLength(1);
    expect(after.grants[0]!.actorSeed).toBe(grant.actorSeed);
  });

  it("(6) a delta written through a minted token is authored by the connector's own actor", async () => {
    const { base, home, gateway } = await connectorServer();
    const p = pkce();
    const code = await mintCode(base, p.challenge);
    const token = (
      (await (await redeem(base, { code, code_verifier: p.verifier })).json()) as {
        access_token: string;
      }
    ).access_token;
    const grant = readOAuthFile(home).grants[0]!;

    const wrote = await mutate(base, token, 81);
    expect(wrote.status).toBe(200);

    // The DELTA level: the height delta carries the connector's actor, not the operator's.
    expect(authorsOfHeight(gateway, 81)).toEqual([grant.actor]);
    expect(authorsOfHeight(gateway, 81)).not.toContain(OPERATOR);

    // AND a reading: the resolved plant view holds the value the connector wrote.
    const read = await fetch(`${base}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: `query { plant(entity: "${FERN}") { height } }` }),
    });
    const view = (await read.json()) as { data?: { plant?: { height?: number } } };
    expect(view.data?.plant?.height).toBe(81);
  });

  it("(7) no input mints an operator identity — the connector token opens no operator door", async () => {
    const { base } = await connectorServer();
    const p = pkce();
    const code = await mintCode(base, p.challenge);
    const token = (
      (await (await redeem(base, { code, code_verifier: p.verifier })).json()) as {
        access_token: string;
      }
    ).access_token;

    // The operator-only doors REFUSE the connector token — proof it names no operator identity.
    for (const door of ["register", "federate"]) {
      const res = await fetch(`${base}/default/${door}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      expect(res.status, `${door} refuses the connector token`).toBe(403);
    }

    // Positive control: the operator token opens federate (so the 403s are about the identity, not a
    // door that refuses everyone).
    const asOperator = await fetch(`${base}/default/federate`, {
      method: "POST",
      headers: { authorization: "Bearer op-token" },
    });
    expect(asOperator.status).toBe(200);
  });

  it("(11) an unknown bearer token costs no file read — a bounded index miss", () => {
    // Drive the door directly so the file reader can be COUNTED. The unknown-token path must not read
    // the file (which would derive one author per grant); only a KNOWN digest pays a read.
    const home = mkdtempSync(join(tmpdir(), "loam-oauth-token-11-"));
    homes.push(home);
    const seed = randomBytes(32).toString("hex");
    const digest = createHash("sha256").update("real-token-secret").digest("hex");
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [clientRecord()],
      grants: [
        {
          clientId: CLIENT_ID,
          actorSeed: seed,
          actor: authorForSeed(seed),
          grantedAt: 1,
          standing: true,
        },
      ],
      tokens: [{ digest, clientId: CLIENT_ID, issuedAt: 1, generation: 1 }],
    });
    let reads = 0;
    const readFile = (h: string): OAuthFile => {
      reads += 1;
      return readOAuthFile(h);
    };
    const door = makeTokenDoor({
      home,
      redeeming: new Map(),
      grantStanding: () => Promise.resolve("unused"),
      readFile,
    });
    // One read at construction (to seed the index). Reset the counter for the probe.
    reads = 0;

    // An UNKNOWN digest: no read, and undefined.
    expect(door.resolve("f".repeat(64))).toBeUndefined();
    expect(reads).toBe(0);

    // The KNOWN digest DOES read (to re-check the generation) and resolves to the actor seed.
    expect(door.resolve(digest)).toEqual({ actor: seed });
    expect(reads).toBe(1);
  });

  it("(12) neither the seed, the token nor the PKCE material appears in any delta", async () => {
    const { base, home, gateway } = await connectorServer();
    const p = pkce();
    const code = await mintCode(base, p.challenge);
    const token = (
      (await (await redeem(base, { code, code_verifier: p.verifier })).json()) as {
        access_token: string;
      }
    ).access_token;
    expect((await mutate(base, token, 82)).status).toBe(200);
    const grant = readOAuthFile(home).grants[0]!;

    // The scan: does the store's whole delta-set carry a secret, as a substring anywhere?
    const containsSecret = (deltas: readonly unknown[], secret: string): boolean =>
      JSON.stringify(deltas).includes(secret);

    // INSTRUMENT-MUST-FAIL-FIRST: plant a delta holding the seed and prove the scan catches it —
    // otherwise the clean result below would prove only that the scanner is broken.
    expect(containsSecret([{ leaked: grant.actorSeed }], grant.actorSeed)).toBe(true);

    // Now the real snapshot: none of the four secrets is in any delta.
    const snapshot = [...gateway.reactor.snapshot()];
    for (const secret of [grant.actorSeed, token, p.verifier, p.challenge]) {
      expect(containsSecret(snapshot, secret)).toBe(false);
    }
  });

  it("(13) a lock fault answers a 503 that says 'lock' and never the home path", async () => {
    const { base, home } = await connectorServer();
    const p = pkce();
    const code = await mintCode(base, p.challenge);

    // Hold the connector-records lock as another live process: withOAuthFile times out and throws
    // OAuthFileBusy on the very first (burn) write, so the redemption cannot even read the code.
    writeFileSync(oauthLockPath(home), `999999:${randomBytes(8).toString("hex")}\n`);

    const locked = await redeem(base, { code, code_verifier: p.verifier });
    expect(locked.status).toBe(503);
    const body = await locked.text();
    expect(body).toContain("lock"); // the branch that answered — a 503 about the lock, not a 400
    expect(body).not.toContain(home); // no home path reaches the caller

    rmSync(oauthLockPath(home), { force: true });

    // Positive control naming which branch answered: with the lock gone, an ordinary bad request is a
    // 400 whose body names its own reason — so "503 + lock" genuinely separates the two.
    const bad = await redeem(base, { code: "not-a-real-code", code_verifier: p.verifier });
    expect(bad.status).toBe(400);
    expect(await errorOf(bad)).toBe("invalid_grant");
  });
});

// --- criteria 3 & 4: the in-flight eviction pin and the redemption count -------------------------
//
// Driven at the door layer, sharing the one `redeeming` map serve() wires between the register door
// (which reads it for its eviction pin) and the token door (which counts into it). A grantStanding
// barrier holds redemptions in the in-flight window — code burnt, grant not yet standing — on demand.

/** A fake node req that emits a form body, and a res that captures status + body. */
function fakeReq(body: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
  (req as { method?: string }).method = "POST";
  (req as { headers?: unknown }).headers = {};
  process.nextTick(() => {
    req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}
interface FakeRes {
  status: number;
  body: string;
  done: Promise<void>;
}
function fakeRes(): { res: ServerResponse; captured: FakeRes } {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const captured: FakeRes = { status: 0, body: "", done };
  const res = {
    headersSent: false,
    writeHead(status: number) {
      captured.status = status;
      (this as { headersSent: boolean }).headersSent = true;
      return this;
    },
    end(chunk?: string) {
      if (chunk !== undefined) captured.body += chunk;
      resolve();
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

const directClient = (id: string, registeredAt: number): OAuthClient => ({
  clientId: id,
  clientName: id,
  redirectUris: [REDIRECT],
  registeredAt,
  generation: 1,
});

const codeRecord = (clientId: string, digest: string, challenge: string): OAuthCode => ({
  digest,
  clientId,
  redirectUri: REDIRECT,
  expiresAt: Number.MAX_SAFE_INTEGER,
  issuedAt: 1,
  codeChallenge: challenge,
  generation: 1,
});

describe("§37 phase 15 — the eviction pin and the redemption count", () => {
  it("(3) the eviction pin reads three sources: a live code, a redemption in flight, and a grant", () => {
    const home = mkdtempSync(join(tmpdir(), "loam-oauth-pin-"));
    homes.push(home);
    const seed = randomBytes(32).toString("hex");
    // Four registered clients at cap 4: one with a GRANT, one with a live CODE, one IN FLIGHT
    // (pinned only by the redeeming count), and one plain (evictable). Register door evicts the
    // oldest EVICTABLE to admit a fifth.
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [
        directClient("has-grant", 1),
        directClient("has-code", 2),
        directClient("in-flight", 3),
        directClient("plain", 4),
      ],
      grants: [
        {
          clientId: "has-grant",
          actorSeed: seed,
          actor: authorForSeed(seed),
          grantedAt: 1,
          standing: true,
        },
      ],
      codes: [codeRecord("has-code", "aa".repeat(32), "x")],
    });
    const redeeming = new Map<string, number>([["in-flight", 1]]);
    const doors = makeOAuthDoors({
      publicUrl: "https://store.example",
      registration: { home, allowRedirectOrigins: [ALLOW_ORIGIN], maxClients: 4, redeeming },
    });

    // A fifth registration: someone must be evicted. The only evictable client is "plain".
    const { res, captured } = fakeRes();
    doors.handle(
      "/oauth/register",
      fakeReq(JSON.stringify({ client_name: "newcomer", redirect_uris: [REDIRECT] })),
      res,
    );
    return captured.done.then(() => {
      expect(captured.status).toBe(201);
      const after = new Set(readOAuthFile(home).clients.map((c) => c.clientId));
      // All three pinned survive; only the plain one was evicted.
      expect(after.has("has-grant")).toBe(true);
      expect(after.has("has-code")).toBe(true);
      expect(after.has("in-flight")).toBe(true);
      expect(after.has("plain")).toBe(false); // the positive control: an UNpinned client DID go
    });
  });

  it("(4) `redeeming` is a COUNT: two in flight, one finishes, the pin still holds; a throw cannot leak it", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-oauth-count-"));
    homes.push(home);
    const c1 = pkce();
    const c2 = pkce();
    const d1 = createHash("sha256").update("code-one").digest("hex");
    const d2 = createHash("sha256").update("code-two").digest("hex");
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [directClient(CLIENT_ID, 1)],
      codes: [codeRecord(CLIENT_ID, d1, c1.challenge), codeRecord(CLIENT_ID, d2, c2.challenge)],
    });

    const redeeming = new Map<string, number>();
    // A grantStanding barrier: it blocks until the test releases it, and counts its calls.
    let calls = 0;
    const gates: Array<() => void> = [];
    const grantStanding = (): Promise<string> =>
      new Promise<string>((resolve) => {
        calls += 1;
        gates.push(() => resolve("grant-delta-id"));
      });
    const door = makeTokenDoor({ home, redeeming, grantStanding });

    const start = (codeSecret: string, verifier: string): FakeRes => {
      const { res, captured } = fakeRes();
      void door.handle(
        "/oauth/token",
        fakeReq(
          new URLSearchParams({
            grant_type: "authorization_code",
            code: codeSecret,
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT,
            code_verifier: verifier,
          }).toString(),
        ),
        res,
      );
      return captured;
    };

    // Both redemptions reach the in-flight window and block in grantStanding. The pin counts TWO.
    const r1 = start("code-one", c1.verifier);
    const r2 = start("code-two", c2.verifier);
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(redeeming.get(CLIENT_ID)).toBe(2);

    // Release the FIRST. It finishes and decrements — but the second still needs the pin, so a flag
    // (which the first would have cleared) would be wrong here. The count still holds it.
    gates[0]!();
    await r1.done;
    expect(r1.status).toBe(200);
    expect(redeeming.get(CLIENT_ID)).toBe(1);

    // Release the second: now the pin clears.
    gates[1]!();
    await r2.done;
    expect(r2.status).toBe(200);
    expect(redeeming.get(CLIENT_ID)).toBeUndefined();

    // A THROW in the mint must not leak the count (released in `finally`). A fresh client with NO
    // grant (so grantStanding is actually reached) and a grantStanding that rejects: the redemption
    // fails, and the pin is clean afterwards.
    const c3 = pkce();
    const d3 = createHash("sha256").update("code-three").digest("hex");
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [directClient("throwing-client", 1)],
      codes: [{ ...codeRecord("throwing-client", d3, c3.challenge), redirectUri: REDIRECT }],
    });
    const throwingDoor = makeTokenDoor({
      home,
      redeeming,
      grantStanding: () => Promise.reject(new Error("ground append failed")),
    });
    const { res, captured } = fakeRes();
    void throwingDoor.handle(
      "/oauth/token",
      fakeReq(
        new URLSearchParams({
          grant_type: "authorization_code",
          code: "code-three",
          client_id: "throwing-client",
          redirect_uri: REDIRECT,
          code_verifier: c3.verifier,
        }).toString(),
      ),
      res,
    );
    await captured.done;
    expect(captured.status).toBe(503); // the throw surfaced as a refusal
    expect(redeeming.get("throwing-client")).toBeUndefined(); // and the count did not leak
  });

  it("(5b) the seed is written BEFORE the ground append: a failed append leaves it for the retry to reuse", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-oauth-seed-"));
    homes.push(home);
    const c1 = pkce();
    const c2 = pkce();
    const d1 = createHash("sha256").update("seed-code-one").digest("hex");
    const d2 = createHash("sha256").update("seed-code-two").digest("hex");
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [directClient(CLIENT_ID, 1)],
      codes: [codeRecord(CLIENT_ID, d1, c1.challenge), codeRecord(CLIENT_ID, d2, c2.challenge)],
    });
    const redeeming = new Map<string, number>();

    const run = (
      door: ReturnType<typeof makeTokenDoor>,
      code: string,
      verifier: string,
    ): FakeRes => {
      const { res, captured } = fakeRes();
      void door.handle(
        "/oauth/token",
        fakeReq(
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT,
            code_verifier: verifier,
          }).toString(),
        ),
        res,
      );
      return captured;
    };

    // First attempt: the ground append FAILS. Because the seed is written first, a grant record is
    // left behind (standing false) rather than nothing — this is the ordering criterion 5 names.
    const failing = makeTokenDoor({
      home,
      redeeming,
      grantStanding: () => Promise.reject(new Error("ground append failed")),
    });
    const first = run(failing, "seed-code-one", c1.verifier);
    await first.done;
    expect(first.status).toBe(503);
    const afterFail = readOAuthFile(home).grants;
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0]!.standing).toBe(false);
    const seed = afterFail[0]!.actorSeed;
    expect(seed).not.toBe(OPERATOR_SEED);

    // The retry succeeds and REUSES that seed — no second is minted, none is stranded.
    const ok = makeTokenDoor({
      home,
      redeeming,
      grantStanding: () => Promise.resolve("grant-delta-id"),
    });
    const second = run(ok, "seed-code-two", c2.verifier);
    await second.done;
    expect(second.status).toBe(200);
    const afterOk = readOAuthFile(home).grants;
    expect(afterOk).toHaveLength(1);
    expect(afterOk[0]!.actorSeed).toBe(seed); // the SAME seed, reused
    expect(afterOk[0]!.standing).toBe(true);
  });
});
