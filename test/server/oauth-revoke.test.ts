// §37 phase 15 — revocation (T136). Criteria 8–10 and the revoke side of 13 of
// .adlc/specs/37-15-the-token-exchange-and-revocation.md, transcribed. Revocation bumps a client's
// GENERATION and strikes its ground write grant. That makes every live token and in-flight code stop
// matching at once, so a running server refuses the connector on its next request with NO restart —
// and it never touches the connector's past deltas.
//
// Revocation runs IN-PROCESS here (revokeConnector against the same home the live server reads), not
// via a spawned CLI: criterion 9 is precisely "the SAME live process, no restart", and a MemoryBackend
// gateway cannot be shared with a child process anyway. The strike goes through the test's own gateway
// handle — the same seam the CLI and serve() use.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { initHome } from "../../src/cli/config.js";
import {
  EMPTY_OAUTH,
  oauthLockPath,
  readOAuthFile,
  writeOAuthFile,
  type OAuthClient,
  type OAuthGrant,
} from "../../src/server/oauth-file.js";
import { revokeConnector } from "../../src/server/oauth.js";
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

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const b64url = (buf: Buffer): string => buf.toString("base64url");
const pkce = (): { verifier: string; challenge: string } => {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
};

const clientRecord = (): OAuthClient => ({
  clientId: CLIENT_ID,
  clientName: "Example Connector",
  redirectUris: [REDIRECT],
  registeredAt: 1,
  generation: 1,
});

async function connectorServer(): Promise<{
  base: string;
  home: string;
  gateway: Gateway;
}> {
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

  const home = mkdtempSync(join(tmpdir(), "loam-oauth-revoke-"));
  homes.push(home);
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  writeOAuthFile(home, { ...EMPTY_OAUTH, clients: [clientRecord()] });

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: { home, allowRedirectOrigins: [ALLOW_ORIGIN] },
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, home, gateway };
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

async function mintCode(base: string, challenge: string): Promise<string> {
  const sessionId = await signIn(base);
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-1",
  }).toString();
  const page = await fetch(`${base}/oauth/authorize?${query}`, {
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    redirect: "manual",
  });
  const html = await page.text();
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
      bind_new: "journal", // §58: a connection lives in one container under the person's name
    }).toString(),
    redirect: "manual",
  });
  expect(approve.status).toBe(302);
  return new URL(approve.headers.get("location")!).searchParams.get("code")!;
}

async function redeem(base: string, code: string, verifier: string): Promise<Response> {
  return fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }).toString(),
    redirect: "manual",
  });
}

/** The whole path: consent → redeem → the bearer token. */
async function tokenFor(base: string): Promise<string> {
  const p = pkce();
  const code = await mintCode(base, p.challenge);
  const res = await redeem(base, code, p.verifier);
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

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

/** Strike the connector's ground write grant — the seam the CLI and serve() both drive. */
const strikeVia =
  (gateway: Gateway) =>
  async (grant: OAuthGrant): Promise<void> => {
    if (grant.grantDeltaId === undefined) return;
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, Date.now(), grant.grantDeltaId), OPERATOR_SEED),
    ]);
  };

describe("§37 phase 15 — revocation", () => {
  it("(8) revocation bumps a GENERATION: a code issued before a revoke mints nothing after it", async () => {
    const { base, home, gateway } = await connectorServer();
    // Make the connector real first (a standing grant), so the revoke has a grant to strike.
    await tokenFor(base);

    // Issue a code UNDER the current generation, then revoke.
    const p = pkce();
    const staleCode = await mintCode(base, p.challenge);
    const before = readOAuthFile(home).clients[0]!.generation;
    const outcome = await revokeConnector(home, CLIENT_ID, strikeVia(gateway));
    expect(outcome.kind).toBe("revoked");
    expect(readOAuthFile(home).clients[0]!.generation).toBe(before + 1); // the generation bumped

    // The stale code cannot mint: its generation no longer matches the client's.
    const refused = await redeem(base, staleCode, p.verifier);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("invalid_grant");

    // Positive control: a code issued AFTER the revoke (under the new generation) redeems.
    const q = pkce();
    const freshCode = await mintCode(base, q.challenge);
    const ok = await redeem(base, freshCode, q.verifier);
    expect(ok.status).toBe(200);
  });

  it("(9) revocation binds on the very next request of the SAME live process — no restart", async () => {
    const { base, home, gateway } = await connectorServer();
    const token = await tokenFor(base);
    const pool = gateway.connectionInboxes.get(readOAuthFile(home).grants[0]!.inbox!)!.gateway!;

    // Positive control: the token works BEFORE the revoke — into its inbox pool (SPEC §58).
    expect((await mutate(base, token, 90)).status).toBe(200);
    expect(heightDeltas(pool, 90)).toHaveLength(1);
    expect(heightDeltas(gateway, 90)).toEqual([]);

    // Revoke against the same home the live server reads. No serve() restart happens.
    const outcome = await revokeConnector(home, CLIENT_ID, strikeVia(gateway));
    expect(outcome.kind).toBe("revoked");

    // The very next request with the same token is refused — the door is the same live instance.
    const after = await mutate(base, token, 91);
    expect(after.status).toBe(401);
    expect(heightDeltas(gateway, 91)).toEqual([]); // and nothing landed, anywhere
    expect(heightDeltas(pool, 91)).toEqual([]);

    // AND it stays refused across a re-grant: a fresh token (new generation) works, but the OLD
    // token never resurrects — the generation gate, not just the grant record, is what binds. Grant
    // deletion alone would let the old token authenticate as the re-granted identity.
    const fresh = await tokenFor(base);
    expect((await mutate(base, fresh, 94)).status).toBe(200);
    expect((await mutate(base, token, 95)).status).toBe(401);
    expect(heightDeltas(gateway, 95)).toEqual([]);
  });

  it("(10) revocation is two-sided: access is gone AND past deltas still name their author", async () => {
    const { base, home, gateway } = await connectorServer();
    const token = await tokenFor(base);
    const { actor, inbox } = readOAuthFile(home).grants[0]!;
    const pool = gateway.connectionInboxes.get(inbox!)!.gateway!;

    // The connector writes BEFORE revoke — into its inbox pool (SPEC §58). This is the bystander
    // that must survive.
    expect((await mutate(base, token, 92)).status).toBe(200);
    expect(heightDeltas(pool, 92).map((d) => d.claims.author)).toEqual([actor]);

    await revokeConnector(home, CLIENT_ID, strikeVia(gateway));

    // Access is GONE: a new write with the token is refused, and nothing lands.
    expect((await mutate(base, token, 93)).status).toBe(401);
    expect(heightDeltas(gateway, 93)).toEqual([]);
    expect(heightDeltas(pool, 93)).toEqual([]);

    // The BYSTANDER survives: the pre-revoke delta still names the connector's actor AND still
    // resolves through the bound container's reading — revocation removed access, not the
    // connector's history. The operator's own read is the primary's, which the pool never
    // composes into (the other half of §58): it answers the garden's latest height.
    expect(heightDeltas(pool, 92).map((d) => d.claims.author)).toEqual([actor]);
    const bound = { container: "myk:journal", inbox: inbox! };
    expect(gateway.resolvedNode("Plant", FERN, undefined, undefined, bound).view["height"]).toBe(
      92,
    );
    const read = await fetch(`${base}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify({ query: `query { plant(entity: "${FERN}") { height } }` }),
    });
    const view = (await read.json()) as { data?: { plant?: { height?: number } } };
    expect(view.data?.plant?.height).toBe(34);
  });

  it("(13) a locked revoke refuses without leaking the home path; an unknown client is named", async () => {
    const { home, gateway } = await connectorServer();

    // Hold the connector-records lock: revokeConnector cannot take it and returns `locked`, with no
    // home path in any surfaced fault.
    writeFileSync(oauthLockPath(home), `999999:${randomBytes(8).toString("hex")}\n`);
    const faults: string[] = [];
    const locked = await revokeConnector(home, CLIENT_ID, strikeVia(gateway), (m) =>
      faults.push(m),
    );
    expect(locked.kind).toBe("locked");
    // The load-bearing check is the CALLER-facing RESULT. `revoke` is operator-driven (`loam grant
    // revoke`), so `onFault` carries the home path to the operator's own terminal by design and stays
    // empty on this path — asserting the fault channel alone would be vacuous (the review's finding).
    // What must never carry the path is the value the caller receives back: a locked result is a bare
    // `{ kind: "locked" }`, no home path and no internal flag name.
    expect(JSON.stringify(locked)).not.toContain(home);
    expect(JSON.stringify(locked)).not.toContain("operator.seed");
    expect(faults.join("\n")).not.toContain(home); // and the fault channel stayed clean here too
    rmSync(oauthLockPath(home), { force: true });

    // Positive control naming which branch answered: an unknown client is a distinct `no-such-client`
    // outcome, not a lock fault — so "locked" genuinely separates the two.
    const unknown = await revokeConnector(home, "connector-nobody", strikeVia(gateway));
    expect(unknown.kind).toBe("no-such-client");
  });
});
