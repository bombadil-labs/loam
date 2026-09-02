// §58 S1b (T262, criteria c and the exchange half of a): the token exchange honors the binding
// consent recorded. A code that carries a container redeems into a key minted for THIS (client,
// user) pair, spawns — or resumes — the connection's inbox pool inside that container, and mints a
// token that names the person; a code that carries no container mints nothing. One client consented
// by two people holds two keys, each pooled under its own person's container. The inbox is
// forward-only: a delta the key authored in the primary before the binding is not the pool's, at the
// bytes. A token or grant minted before §58 names no user and fails closed.
//
// What this file deliberately does NOT assert, and where each gap closes:
//   - Where a bound connection's WRITES land (the pool, never the primary) and the retirement of the
//     store-wide write grant — the next slice's rail. In this slice the store-wide grant still
//     lands beside the binding, so every path a connection walks today keeps working.
//   - Reads scoped to the binding — `test/server/read-scope.test.ts` (S1c).
//   - The exchange's pre-§58 behaviour (burn-first, PKCE, generation, the eviction pin) — the frozen
//     phase-15 rail (`oauth-token.test.ts`), revised only where its consents now name a container.
//
// Erasure standing rule: every store here is this file's own mkdtemp/memory fixture.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { initHome, userSeedPath } from "../../src/cli/config.js";
import { holdsGrant } from "../../src/gateway/accounts.js";
import { inboxName } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import {
  EMPTY_OAUTH,
  readOAuthFile,
  writeOAuthFile,
  type OAuthFile,
} from "../../src/server/oauth-file.js";
import { AUTHORIZE_PATH } from "../../src/server/oauth.js";
import { SAME_ORIGIN, signIn } from "../helpers/session-fixture.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = "https://app.example/cb";
const CLIENT_ID = "connector-fixed-0001";

const b64url = (buf: Buffer): string => buf.toString("base64url");
const pkce = (): { verifier: string; challenge: string } => {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};
const digestHex = (s: string): string => createHash("sha256").update(s).digest("hex");

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

/**
 * A served store with two login users, ada and bea, neither with a container or a seed yet, one
 * registered connector, and the token exchange OPEN (the connectors' home holds the operator seed).
 * The connectors' home and the users' home are distinct on purpose, as in the consent rail.
 */
async function exchangeServer(preWritten: Partial<OAuthFile> = {}): Promise<{
  base: string;
  usersHome: string;
  connectorsHome: string;
  gateway: Gateway;
  faults: string[];
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  for (const name of ["ada", "bea"]) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, "actor", OPERATOR, ts++));
  }
  const usersHome = mkdtempSync(join(tmpdir(), "loam-s1b-users-"));
  const connectorsHome = mkdtempSync(join(tmpdir(), "loam-s1b-connectors-"));
  homes.push(usersHome, connectorsHome);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(usersHome, { version: 1, users: { ada: hash, bea: hash } });
  initHome(connectorsHome, OPERATOR_SEED);
  writeOAuthFile(connectorsHome, {
    ...EMPTY_OAUTH,
    clients: [
      {
        clientId: CLIENT_ID,
        clientName: "Example Connector",
        redirectUris: [REDIRECT],
        registeredAt: 1,
        generation: 1,
      },
    ],
    ...preWritten,
  });
  const faults: string[] = [];
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: {
      home: connectorsHome,
      allowRedirectOrigins: [ALLOW_ORIGIN],
      onFault: (m) => faults.push(m),
    },
    users: { home: usersHome, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, usersHome, connectorsHome, gateway, faults };
}

const fieldOf = (html: string, name: string): string =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

/** Sign in as `user`, approve the connector with `bind` (or nothing), and return the code. */
async function consent(
  base: string,
  user: string,
  challenge: string,
  bind: Record<string, string>,
): Promise<{ code: string; status: number }> {
  const session = await signIn(base, user, PASSWORD);
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state: "st-1",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const page = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
    redirect: "manual",
  });
  const html = await page.text();
  const res = await fetch(`${base}${AUTHORIZE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${session}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({
      form_token: fieldOf(html, "form_token"),
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-1",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...bind,
    }).toString(),
    redirect: "manual",
  });
  const location = res.headers.get("location");
  const code = location === null ? "" : (new URL(location).searchParams.get("code") ?? "");
  return { code, status: res.status };
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
  });
}

/** The whole path for one person into one leaf: consent, redeem, and the bearer token. */
async function connect(base: string, user: string, leaf: string): Promise<string> {
  const p = pkce();
  const { code, status } = await consent(base, user, p.challenge, { bind_new: leaf });
  expect(status).toBe(302);
  const res = await redeem(base, code, p.verifier);
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

const noteClaims = (author: string, id: string, text: string, timestamp: number): Claims => ({
  author,
  timestamp,
  pointers: [
    { role: "note", target: { kind: "entity", entity: { id, context: "text" } } },
    { role: "value", target: { kind: "primitive", value: text } },
  ],
});

const whoami = (base: string, token: string): Promise<Response> =>
  fetch(`${base}/default/whoami`, { headers: { authorization: `Bearer ${token}` } });

describe("§58 S1b — the exchange honors the binding", () => {
  it("a bound code redeems into a key for the pair, an inbox in the container, and a token naming the person", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    const token = await connect(base, "ada", "journal");
    expect(token).not.toBe("");

    const file = readOAuthFile(connectorsHome);
    expect(file.grants).toHaveLength(1);
    const grant = file.grants[0]!;
    const inbox = inboxName("ada:journal", grant.actor);
    expect(grant).toMatchObject({
      clientId: CLIENT_ID,
      user: "ada",
      container: "ada:journal",
      inbox,
      standing: true,
    });
    expect(file.tokens).toHaveLength(1);
    expect(file.tokens[0]).toMatchObject({ clientId: CLIENT_ID, user: "ada" });
    expect(file.tokens[0]!.digest).toBe(digestHex(token));

    // The pool stands in the tree, receiving into the bound container, and its own ground holds
    // the connection's write standing through the owner — ada's key, provisioned at consent.
    const table = gateway.containers().containers;
    expect(table.get(inbox)?.inboxOf).toBe("ada:journal");
    const pool = gateway.connectionInboxes.get(inbox)?.gateway;
    expect(pool).toBeDefined();
    expect(holdsGrant(pool!.reactor, STORE_ENTITY, grant.actor, "write", OPERATOR)).toBe(true);
    // The token acts — the door knows who it is.
    expect((await whoami(base, token)).status).toBe(200);
  });

  it("a code that carries no container mints nothing: no token, no key, no pool", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    const p = pkce();
    // A hand-built consent POST that sends no binding field mints an unbound code (the consent
    // rail pins that shape); here is where it is refused.
    const { code, status } = await consent(base, "ada", p.challenge, {});
    expect(status).toBe(302);
    const res = await redeem(base, code, p.verifier);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; error_description: string };
    expect(body.error).toBe("invalid_grant");
    expect(body.error_description).toContain("never bound nowhere");
    const file = readOAuthFile(connectorsHome);
    expect(file.grants).toHaveLength(0);
    expect(file.tokens).toHaveLength(0);
    expect(file.codes ?? []).toHaveLength(0); // burnt: a code is single-use on any attempt
    expect(gateway.connectionInboxes.size).toBe(0);
  });

  it("one client consented by two people holds two keys, each pooled under its own person's container", async () => {
    const { base, connectorsHome, gateway, faults } = await exchangeServer();
    await connect(base, "ada", "journal");
    {
      const p = pkce();
      const { code, status } = await consent(base, "bea", p.challenge, { bind_new: "notes" });
      expect(status, faults.join("\n")).toBe(302);
      const res = await redeem(base, code, p.verifier);
      expect(res.status, `${await res.text()}\n${faults.join("\n")}`).toBe(200);
    }
    const file = readOAuthFile(connectorsHome);
    expect(file.grants).toHaveLength(2);
    const ada = file.grants.find((g) => g.user === "ada")!;
    const bea = file.grants.find((g) => g.user === "bea")!;
    expect(ada.actor).not.toBe(bea.actor);
    expect(ada.actorSeed).not.toBe(bea.actorSeed);
    expect(ada.container).toBe("ada:journal");
    expect(bea.container).toBe("bea:notes");
    const table = gateway.containers().containers;
    expect(table.get(ada.inbox!)?.inboxOf).toBe("ada:journal");
    expect(table.get(bea.inbox!)?.inboxOf).toBe("bea:notes");

    // Neither pool gathers the other's work: a note written through each pool lives in that pool's
    // ground and in no other — at the bytes.
    const adaPool = gateway.connectionInboxes.get(ada.inbox!)!.gateway!;
    const beaPool = gateway.connectionInboxes.get(bea.inbox!)!.gateway!;
    const adaNote = signClaims(
      noteClaims(ada.actor, "note:ada", "ada's note", adaPool.nextTimestamp()),
      ada.actorSeed,
    );
    const beaNote = signClaims(
      noteClaims(bea.actor, "note:bea", "bea's note", beaPool.nextTimestamp()),
      bea.actorSeed,
    );
    await adaPool.append([adaNote]);
    await beaPool.append([beaNote]);
    expect(adaPool.reactor.get(adaNote.id)).toBeDefined();
    expect(adaPool.reactor.get(beaNote.id)).toBeUndefined();
    expect(beaPool.reactor.get(beaNote.id)).toBeDefined();
    expect(beaPool.reactor.get(adaNote.id)).toBeUndefined();
    expect(gateway.reactor.get(adaNote.id)).toBeUndefined();
    expect(gateway.reactor.get(beaNote.id)).toBeUndefined();
  });

  it("re-consenting into the same container resumes the same key and the same pool", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    const first = await connect(base, "ada", "journal");
    const before = readOAuthFile(connectorsHome).grants[0]!;
    const second = await connect(base, "ada", "journal");
    expect(second).not.toBe(first); // a fresh bearer each time
    const file = readOAuthFile(connectorsHome);
    expect(file.grants).toHaveLength(1);
    expect(file.grants[0]).toMatchObject({ actor: before.actor, inbox: before.inbox });
    expect(file.tokens).toHaveLength(2);
    expect(gateway.connectionInboxes.size).toBe(1);
    expect((await whoami(base, first)).status).toBe(200);
    expect((await whoami(base, second)).status).toBe(200);
  });

  it("the inbox is forward-only: what the key wrote in the primary before a binding is not the pool's, at the bytes", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    await connect(base, "ada", "journal");
    const grant = readOAuthFile(connectorsHome).grants[0]!;
    // The key writes into the PRIMARY under the store-wide grant this slice still lands — the
    // pre-§58 shape a pre-binding delta takes.
    const early = signClaims(
      noteClaims(grant.actor, "note:early", "before the second binding", gateway.nextTimestamp()),
      grant.actorSeed,
    );
    await gateway.append([early]);
    expect(gateway.reactor.get(early.id)).toBeDefined();

    // ada binds the SAME connector into a second container: a second pool, same key.
    await connect(base, "ada", "other");
    const after = readOAuthFile(connectorsHome).grants[0]!;
    expect(after.actor).toBe(grant.actor);
    expect(after.container).toBe("ada:other");
    const otherInbox = inboxName("ada:other", grant.actor);
    expect(after.inbox).toBe(otherInbox);
    expect(gateway.connectionInboxes.size).toBe(2); // the first pool stands; nothing is dropped

    // The early delta is in neither pool's ground, and neither pool gathers it.
    for (const name of [grant.inbox!, otherInbox]) {
      const pool = gateway.connectionInboxes.get(name)!.gateway!;
      const ids = (await pool.backend.deltasSince(new Set())).map((d) => d.id);
      expect(ids, name).not.toContain(early.id);
      expect(pool.reactor.get(early.id), name).toBeUndefined();
    }
  });

  it("a token or a grant minted before §58 names no user and fails closed", async () => {
    // Written BEFORE boot, so the door's token index holds the digest and the refusal is the
    // grant's absence, not an unknown token.
    const seed = "ab".repeat(32);
    const bearer = "pre-58-bearer-secret";
    const { base } = await exchangeServer({
      grants: [
        {
          clientId: CLIENT_ID,
          actorSeed: seed,
          actor: authorForSeed(seed),
          grantedAt: 1,
          standing: true,
        },
      ],
      tokens: [{ digest: digestHex(bearer), clientId: CLIENT_ID, issuedAt: 1, generation: 1 }],
    });
    expect((await whoami(base, bearer)).status).toBe(401);
  });

  it("a binding whose person holds no key on this store refuses, names the path only to the operator, and mints no token", async () => {
    const { base, connectorsHome, usersHome, faults } = await exchangeServer();
    const p = pkce();
    const secret = "hand-written-code";
    writeOAuthFile(connectorsHome, {
      ...readOAuthFile(connectorsHome),
      codes: [
        {
          digest: digestHex(secret),
          clientId: CLIENT_ID,
          redirectUri: REDIRECT,
          expiresAt: Number.MAX_SAFE_INTEGER,
          issuedAt: 1,
          codeChallenge: p.challenge,
          generation: 1,
          user: "zed",
          container: "zed:journal",
        },
      ],
    });
    expect(existsSync(userSeedPath(usersHome, "zed"))).toBe(false);
    const res = await redeem(base, secret, p.verifier);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(usersHome);
    expect(faults.join("\n")).toContain(userSeedPath(usersHome, "zed"));
    const file = readOAuthFile(connectorsHome);
    expect(file.tokens).toHaveLength(0);
    // The seed was written first and the store-wide grant landed (this slice's window); the pool
    // never stood, so the grant carries no inbox and the resolver would confer nothing on it.
    expect(file.grants).toHaveLength(1);
    expect(file.grants[0]!.inbox).toBeUndefined();
  });
});
