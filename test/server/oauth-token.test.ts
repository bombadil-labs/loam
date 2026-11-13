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

const b64url = (buf: Buffer): string => buf.toString("base64url");
const pkce = (): { verifier: string; challenge: string } => {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

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
      bind_new: "journal",
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

    const wrong = await redeem(base, {
      code,
      code_verifier: verifier.slice(0, -1) + (verifier.endsWith("A") ? "B" : "A"),
    });
    expect(wrong.status).toBe(400);
    expect(await errorOf(wrong)).toBe("invalid_grant");

    const after = await redeem(base, { code, code_verifier: verifier });
    expect(after.status).toBe(400);
    expect(await errorOf(after)).toBe("invalid_grant");

    const fresh = pkce();
    const freshCode = await mintCode(base, fresh.challenge);
    const ok = await redeem(base, { code: freshCode, code_verifier: fresh.verifier });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { token_type: string }).token_type).toBe("Bearer");
  });

  it("(2) a code is bound to its client and its redirect_uri", async () => {
    const { base } = await connectorServer();

    const a = pkce();
    const codeA = await mintCode(base, a.challenge);
    const wrongClient = await redeem(base, {
      code: codeA,
      client_id: "connector-someone-else",
      code_verifier: a.verifier,
    });
    expect(wrongClient.status).toBe(400);
    expect(await errorOf(wrongClient)).toBe("invalid_grant");

    const b = pkce();
    const codeB = await mintCode(base, b.challenge);
    const wrongUri = await redeem(base, {
      code: codeB,
      redirect_uri: "https://app.example/other",
      code_verifier: b.verifier,
    });
    expect(wrongUri.status).toBe(400);
    expect(await errorOf(wrongUri)).toBe("invalid_grant");

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
    expect(grant.actorSeed).not.toBe(OPERATOR_SEED);
    expect(grant.actor).toBe(authorForSeed(grant.actorSeed));
    expect(grant.actor).not.toBe(OPERATOR);
    expect(grant.standing).toBe(true);

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

    const pool = gateway.connectionInboxes.get(grant.inbox!)!.gateway!;
    expect(authorsOfHeight(pool, 81)).toEqual([grant.actor]);
    expect(authorsOfHeight(pool, 81)).not.toContain(OPERATOR);
    expect(authorsOfHeight(gateway, 81)).toEqual([]);

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

    const fed = await fetch(`${base}/default/federate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(fed.status, "federate refuses the connector token").toBe(403);

    const root = await fetch(`${base}/default/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        hyperschema: {
          name: "Plant",
          alg: 1,
          body: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
        schema: {
          props: { note: { pick: { order: { byTimestamp: "desc" } } } },
          default: { pick: { order: { byTimestamp: "desc" } } },
        },
        roots: ["plant:1"],
      }),
    });
    expect(root.status, "register refuses a ROOT name from the connector token").toBe(403);

    const asOperator = await fetch(`${base}/default/federate`, {
      method: "POST",
      headers: { authorization: "Bearer op-token" },
    });
    expect(asOperator.status).toBe(200);
  });

  it("(11) an unknown bearer token costs no file read — a bounded index miss", () => {
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
          user: "myk",
          container: "myk:journal",
          inbox: "inbox:myk:journal:direct",
        },
      ],
      tokens: [{ digest, clientId: CLIENT_ID, issuedAt: 1, generation: 1, user: "myk" }],
    });
    let reads = 0;
    const readFile = (h: string): OAuthFile => {
      reads += 1;
      return readOAuthFile(h);
    };
    const door = makeTokenDoor({
      home,
      redeeming: new Map(),
      bind: bindNowhere,
      readFile,
    });
    reads = 0;

    expect(door.resolve("f".repeat(64))).toBeUndefined();
    expect(reads).toBe(0);

    expect(door.resolve(digest)).toEqual({
      actor: seed,
      binding: { user: "myk", container: "myk:journal", inbox: "inbox:myk:journal:direct" },
    });
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

    const containsSecret = (deltas: readonly unknown[], secret: string): boolean =>
      JSON.stringify(deltas).includes(secret);

    expect(containsSecret([{ leaked: grant.actorSeed }], grant.actorSeed)).toBe(true);

    const snapshot = [...gateway.reactor.snapshot()];
    for (const secret of [grant.actorSeed, token, p.verifier, p.challenge]) {
      expect(containsSecret(snapshot, secret)).toBe(false);
    }
  });

  it("(13) a lock fault answers a 503 that says 'lock' and never the home path", async () => {
    const { base, home } = await connectorServer();
    const p = pkce();
    const code = await mintCode(base, p.challenge);

    writeFileSync(oauthLockPath(home), `999999:${randomBytes(8).toString("hex")}\n`);

    const locked = await redeem(base, { code, code_verifier: p.verifier });
    expect(locked.status).toBe(503);
    const body = await locked.text();
    expect(body).toContain("lock");
    expect(body).not.toContain(home);

    rmSync(oauthLockPath(home), { force: true });

    const bad = await redeem(base, { code: "not-a-real-code", code_verifier: p.verifier });
    expect(bad.status).toBe(400);
    expect(await errorOf(bad)).toBe("invalid_grant");
  });
});

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
  user: "myk",
  container: "myk:journal",
});
const bindNowhere = (): Promise<string> => Promise.resolve("inbox:myk:journal:direct");

describe("§37 phase 15 — the eviction pin and the redemption count", () => {
  it("(3) the eviction pin reads three sources: a live code, a redemption in flight, and a grant", () => {
    const home = mkdtempSync(join(tmpdir(), "loam-oauth-pin-"));
    homes.push(home);
    const seed = randomBytes(32).toString("hex");
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

    const { res, captured } = fakeRes();
    doors.handle(
      "/oauth/register",
      fakeReq(JSON.stringify({ client_name: "newcomer", redirect_uris: [REDIRECT] })),
      res,
    );
    return captured.done.then(() => {
      expect(captured.status).toBe(201);
      const after = new Set(readOAuthFile(home).clients.map((c) => c.clientId));
      expect(after.has("has-grant")).toBe(true);
      expect(after.has("has-code")).toBe(true);
      expect(after.has("in-flight")).toBe(true);
      expect(after.has("plain")).toBe(false);
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
    let calls = 0;
    const gates: Array<() => void> = [];
    const bind = (): Promise<string> =>
      new Promise<string>((resolve) => {
        calls += 1;
        gates.push(() => resolve("inbox:myk:journal:direct"));
      });
    const door = makeTokenDoor({ home, redeeming, bind });

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

    const r1 = start("code-one", c1.verifier);
    const r2 = start("code-two", c2.verifier);
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(redeeming.get(CLIENT_ID)).toBe(2);

    gates[0]!();
    await r1.done;
    expect(r1.status).toBe(200);
    expect(redeeming.get(CLIENT_ID)).toBe(1);

    gates[1]!();
    await r2.done;
    expect(r2.status).toBe(200);
    expect(redeeming.get(CLIENT_ID)).toBeUndefined();

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
      bind: () => Promise.reject(new Error("bind failed")),
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
    expect(captured.status).toBe(503);
    expect(redeeming.get("throwing-client")).toBeUndefined();
  });

  it("(5b) the seed is written BEFORE the bind: a failed bind leaves it for the retry to reuse", async () => {
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

    const failing = makeTokenDoor({
      home,
      redeeming,
      bind: () => Promise.reject(new Error("bind failed")),
    });
    const first = run(failing, "seed-code-one", c1.verifier);
    await first.done;
    expect(first.status).toBe(503);
    const afterFail = readOAuthFile(home).grants;
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0]!.standing).toBe(false);
    const seed = afterFail[0]!.actorSeed;
    expect(seed).not.toBe(OPERATOR_SEED);

    const ok = makeTokenDoor({
      home,
      redeeming,
      bind: bindNowhere,
    });
    const second = run(ok, "seed-code-two", c2.verifier);
    await second.done;
    expect(second.status).toBe(200);
    const afterOk = readOAuthFile(home).grants;
    expect(afterOk).toHaveLength(1);
    expect(afterOk[0]!.actorSeed).toBe(seed);
    expect(afterOk[0]!.standing).toBe(true);
  });
});
