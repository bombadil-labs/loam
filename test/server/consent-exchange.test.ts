import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { initHome, readUserSeed, userSeedPath } from "../../src/cli/config.js";
import { holdsGrant } from "../../src/gateway/accounts.js";
import { inboxName } from "../../src/gateway/container-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { memoryPoolKeysFor } from "../../src/gateway/pool-keys.js";
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
import { AUTHORIZE_PATH, revokeConnector } from "../../src/server/oauth.js";
import { FaultableBackend } from "../helpers/faultable-backend.js";
import { SAME_ORIGIN, signIn } from "../helpers/session-fixture.js";
import { withStamp } from "../../src/gateway/stamp.js";

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

async function exchangeServer(
  opts: {
    preWritten?: Partial<OAuthFile>;
    primary?: MemoryBackend;
    pools?: Map<string, MemoryBackend>;
    sticky?: boolean;
  } = {},
): Promise<{
  base: string;
  usersHome: string;
  connectorsHome: string;
  gateway: Gateway;
  faults: string[];
}> {
  const primary = opts.primary ?? new MemoryBackend();
  const gateway = await Gateway.open(primary, {
    seed: OPERATOR_SEED,
    peerStore: primary.journalStore(),
    poolKeys: memoryPoolKeysFor(primary),
    ...(opts.sticky === true
      ? { channelBackend: (): MemoryBackend => new StickyBackend() }
      : opts.pools === undefined
        ? {}
        : { channelBackend: poolFactory(opts.pools) }),
  });
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
    ...(opts.preWritten ?? {}),
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
    users: { home: usersHome, mount: "default", onFault: (m) => faults.push(m) },
  });
  handles.push(handle);
  return { base: handle.url, usersHome, connectorsHome, gateway, faults };
}

class StickyBackend extends MemoryBackend {
  override purge(): Promise<number> {
    return Promise.resolve(0);
  }
}

class RefusingBackend extends FaultableBackend {
  refuse = false;
  override checkWrite(): Promise<void> {
    if (this.refuse) return Promise.reject(new Error("the pool's store refused the append"));
    return Promise.resolve();
  }
}

const poolFactory =
  (pools: Map<string, MemoryBackend>) =>
  (name: string): MemoryBackend => {
    const held = pools.get(name);
    if (held !== undefined) return held;
    const fresh = new RefusingBackend();
    pools.set(name, fresh);
    return fresh;
  };

const fieldOf = (html: string, name: string): string =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

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

async function connect(base: string, user: string, leaf: string): Promise<string> {
  const p = pkce();
  const { code, status } = await consent(base, user, p.challenge, { bind_new: leaf });
  expect(status).toBe(302);
  const res = await redeem(base, code, p.verifier);
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

const withoutKeys = (html: string): string => html.replace(/[0-9a-f]{16,}/g, "<key>");

const noteClaims = (author: string, id: string, text: string, timestamp: number): Claims => ({
  author,
  timestamp,
  validFrom: timestamp,
  pointers: [
    { role: "note", target: { kind: "entity", entity: { id, context: "text" } } },
    { role: "value", target: { kind: "primitive", value: text } },
  ],
});

const getAdmin = (base: string, sessionId: string): Promise<Response> =>
  fetch(`${base}/admin`, {
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    redirect: "manual",
  });
const postAdmin = (
  base: string,
  path: string,
  sessionId: string,
  fields: Record<string, string>,
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams(fields).toString(),
  });
const formTokenOf = (html: string): string =>
  /name="form_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
const confirmTokenOf = (html: string): string =>
  /name="confirm_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
async function revokeViaPanel(
  base: string,
  sessionId: string,
  name: string,
): Promise<{ dashboard: string; confirmHtml: string; done: Response }> {
  const dashboard = await (await getAdmin(base, sessionId)).text();
  const formToken = formTokenOf(dashboard);
  const confirm = await postAdmin(base, "/admin/revoke", sessionId, {
    form_token: formToken,
    name,
  });
  expect(confirm.status).toBe(200);
  const confirmHtml = await confirm.text();
  const confirmToken = confirmTokenOf(confirmHtml);
  expect(confirmToken).not.toBe("");
  const done = await postAdmin(base, "/admin/revoke-confirm", sessionId, {
    form_token: formToken,
    name,
    confirm_token: confirmToken,
  });
  return { dashboard, confirmHtml, done };
}

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

    const table = gateway.containers().containers;
    expect(table.get(inbox)?.inboxOf).toBe("ada:journal");
    const pool = gateway.connectionInboxes.get(inbox)?.gateway;
    expect(pool).toBeDefined();
    expect(
      holdsGrant(
        pool!.reactor,
        pool!.validityNow(),
        STORE_ENTITY,
        grant.actor,
        "write",
        pool!.operatorAuthor,
      ),
    ).toBe(true);
    expect((await whoami(base, token)).status).toBe(200);
  });

  it("a code that carries no container mints nothing: no token, no key, no pool", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    const p = pkce();
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
    expect(file.codes ?? []).toHaveLength(0);
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

    const adaPool = gateway.connectionInboxes.get(ada.inbox!)!.gateway!;
    const beaPool = gateway.connectionInboxes.get(bea.inbox!)!.gateway!;
    const adaNote = signClaims(
      withStamp(adaPool.stamp(ada.actor), (t) =>
        noteClaims(ada.actor, "note:ada", "ada's note", t),
      ),
      ada.actorSeed,
    );
    const beaNote = signClaims(
      withStamp(beaPool.stamp(bea.actor), (t) =>
        noteClaims(bea.actor, "note:bea", "bea's note", t),
      ),
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
    const adaScope = gateway.containerScope({ containers: ["ada:journal"] }).map((d) => d.id);
    const beaScope = gateway.containerScope({ containers: ["bea:notes"] }).map((d) => d.id);
    expect(adaScope).toContain(adaNote.id);
    expect(adaScope).not.toContain(beaNote.id);
    expect(beaScope).toContain(beaNote.id);
    expect(beaScope).not.toContain(adaNote.id);
  });

  it("re-consenting into the same container resumes the same key and the same pool", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    const first = await connect(base, "ada", "journal");
    const before = readOAuthFile(connectorsHome).grants[0]!;
    const second = await connect(base, "ada", "journal");
    expect(second).not.toBe(first);
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
    const early = signClaims(
      withStamp(gateway.stamp(grant.actor), (t) =>
        noteClaims(grant.actor, "note:early", "before the second binding", t),
      ),
      grant.actorSeed,
    );
    await expect(gateway.append([early])).rejects.toThrow(/not permitted/);
    await gateway.federate([early], { admit: () => true });
    expect(gateway.reactor.get(early.id)).toBeDefined();

    await connect(base, "ada", "other");
    const after = readOAuthFile(connectorsHome).grants[0]!;
    expect(after.actor).toBe(grant.actor);
    expect(after.container).toBe("ada:other");
    const otherInbox = inboxName("ada:other", grant.actor);
    expect(after.inbox).toBe(otherInbox);
    expect(gateway.connectionInboxes.size).toBe(2);

    const second = gateway.connectionInboxes.get(otherInbox)!;
    await second.reseed();
    const ids = (await second.gateway!.backend.deltasSince(new Set())).map((d) => d.id);
    expect(ids).not.toContain(early.id);
    expect(second.gateway!.reactor.get(early.id)).toBeUndefined();
    const later = signClaims(
      withStamp(gateway.stamp(grant.actor), (t) =>
        noteClaims(grant.actor, "note:later", "after the second binding", t),
      ),
      grant.actorSeed,
    );
    await gateway.federate([later], { admit: () => true });
    await second.reseed();
    const afterPulse = (await second.gateway!.backend.deltasSince(new Set())).map((d) => d.id);
    expect(afterPulse).toContain(later.id);
    expect(afterPulse).not.toContain(early.id);
  });

  it("a token or a grant minted before §58 names no user and fails closed", async () => {
    const seed = "ab".repeat(32);
    const preSection58 = "pre-58-bearer";
    const { base } = await exchangeServer({
      preWritten: {
        grants: [
          {
            clientId: CLIENT_ID,
            actorSeed: seed,
            actor: authorForSeed(seed),
            grantedAt: 1,
            standing: true,
          },
        ],
        tokens: [
          { digest: digestHex(preSection58), clientId: CLIENT_ID, issuedAt: 1, generation: 1 },
        ],
      },
    });
    expect((await whoami(base, preSection58)).status).toBe(401);
  });

  it("a binding whose person holds no key on this store refuses, names the path only to the operator, and mints no token", async () => {
    const { base, connectorsHome, usersHome, faults } = await exchangeServer();
    const p = pkce();
    const handWritten = "hand-written-code";
    writeOAuthFile(connectorsHome, {
      ...readOAuthFile(connectorsHome),
      codes: [
        {
          digest: digestHex(handWritten),
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
    const res = await redeem(base, handWritten, p.verifier);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(usersHome);
    expect(faults.join("\n")).toContain(userSeedPath(usersHome, "zed"));
    const file = readOAuthFile(connectorsHome);
    expect(file.tokens).toHaveLength(0);
    expect(file.grants).toHaveLength(1);
    expect(file.grants[0]!.inbox).toBeUndefined();
    expect(file.grants[0]!.standing).toBe(false);
  });

  it("a grant whose pool never stood confers nothing, even on a token that names its person", async () => {
    const seed = "cd".repeat(32);
    const tokenNeverStood = "pool-never-stood";
    const { base } = await exchangeServer({
      preWritten: {
        grants: [
          {
            clientId: CLIENT_ID,
            actorSeed: seed,
            actor: authorForSeed(seed),
            grantedAt: 1,
            standing: true,
            user: "ada",
            container: "ada:journal",
          },
        ],
        tokens: [
          {
            digest: digestHex(tokenNeverStood),
            clientId: CLIENT_ID,
            issuedAt: 1,
            generation: 1,
            user: "ada",
          },
        ],
      },
    });
    expect((await whoami(base, tokenNeverStood)).status).toBe(401);
  });

  it("revoking one person's binding leaves every other person's binding of the connector standing", async () => {
    const { base, connectorsHome, faults } = await exchangeServer();
    const adaToken = await connect(base, "ada", "journal");
    const beaToken = await connect(base, "bea", "notes");
    const pending = pkce();
    const { code: pendingCode } = await consent(base, "ada", pending.challenge, {
      bind_new: "journal",
    });
    const struck: string[] = [];
    const outcome = await revokeConnector(
      connectorsHome,
      CLIENT_ID,
      (g) => {
        struck.push(g.actor);
        return Promise.resolve();
      },
      (m) => faults.push(m),
      { kind: "pair", user: "ada" },
    );
    expect(outcome).toMatchObject({ kind: "revoked", clientId: CLIENT_ID, generation: 1 });
    const file = readOAuthFile(connectorsHome);
    expect(file.grants.map((g) => g.user)).toEqual(["bea"]);
    expect(file.tokens.map((t) => t.user)).toEqual(["bea"]);
    expect(file.revoked?.map((r) => r.clientId)).toEqual([CLIENT_ID]);
    expect(struck).toHaveLength(1);
    expect((file.codes ?? []).some((c) => c.user === "ada")).toBe(false);
    expect((await redeem(base, pendingCode, pending.verifier)).status).toBe(400);
    expect((await whoami(base, adaToken)).status).toBe(401);
    expect((await whoami(base, beaToken)).status).toBe(200);
    expect(readOAuthFile(connectorsHome).grants.map((g) => g.user)).toEqual(["bea"]);
  });

  it("a binding outlives the process that made it: the pool re-attaches at the next boot", async () => {
    const primary = new MemoryBackend();
    const pools = new Map<string, MemoryBackend>();
    const { base, connectorsHome, gateway } = await exchangeServer({ primary, pools });
    await connect(base, "ada", "journal");
    const grant = readOAuthFile(connectorsHome).grants[0]!;
    const pool = gateway.connectionInboxes.get(grant.inbox!)!.gateway!;
    const note = signClaims(
      withStamp(pool.stamp(grant.actor), (t) =>
        noteClaims(grant.actor, "note:durable", "written before the restart", t),
      ),
      grant.actorSeed,
    );
    await pool.append([note]);

    const reopened = await Gateway.boot(
      primary,
      { operatorSeed: OPERATOR_SEED, deltas: [] },
      { channelBackend: poolFactory(pools) },
    );
    expect(reopened.connectionInboxes.has(grant.inbox!)).toBe(true);
    const scope = reopened.containerScope({ containers: ["ada:journal"] }).map((d) => d.id);
    expect(scope).toContain(note.id);
    const reattached = reopened.connectionInboxes.get(grant.inbox!)!.gateway!;
    expect(
      holdsGrant(
        reattached.reactor,
        reattached.validityNow(),
        STORE_ENTITY,
        grant.actor,
        "write",
        reattached.operatorAuthor,
      ),
    ).toBe(true);
    const handle = reopened.connectionInboxes.get(grant.inbox!)!;
    await expect(handle.detach()).rejects.toThrow(/durable/);
    await handle.drop();
    expect(reopened.connectionInboxes.has(grant.inbox!)).toBe(false);
  });

  it("a re-consent after the inbox was dropped binds a fresh pool, never the negated one", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    await connect(base, "ada", "journal");
    const first = readOAuthFile(connectorsHome).grants[0]!;
    await gateway.connectionInboxes.get(first.inbox!)!.drop();
    expect(gateway.containers().containers.has(first.inbox!)).toBe(false);
    const token = await connect(base, "ada", "journal");
    const again = readOAuthFile(connectorsHome).grants[0]!;
    expect(again.actor).toBe(first.actor);
    expect(again.inbox).toBe(first.inbox);
    expect(gateway.containers().containers.get(first.inbox!)?.inboxOf).toBe("ada:journal");
    const pool = gateway.connectionInboxes.get(first.inbox!)?.gateway;
    expect(pool).toBeDefined();
    expect(
      holdsGrant(
        pool!.reactor,
        pool!.validityNow(),
        STORE_ENTITY,
        first.actor,
        "write",
        pool!.operatorAuthor,
      ),
    ).toBe(true);
    expect((await whoami(base, token)).status).toBe(200);
  });

  it("revoking one inbox from the admin page negates every pool the same key holds, and only that person's", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    const beaToken = await connect(base, "bea", "notes");
    await connect(base, "ada", "journal");
    await connect(base, "ada", "other");
    const ada = readOAuthFile(connectorsHome).grants.find((g) => g.user === "ada")!;
    const bea = readOAuthFile(connectorsHome).grants.find((g) => g.user === "bea")!;
    const journalInbox = inboxName("ada:journal", ada.actor);
    const otherInbox = inboxName("ada:other", ada.actor);
    const poolOf = (name: string) => gateway.connectionInboxes.get(name)!.gateway!;
    expect(
      holdsGrant(
        poolOf(journalInbox).reactor,
        poolOf(journalInbox).validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        poolOf(journalInbox).operatorAuthor,
      ),
    ).toBe(true);
    expect(
      holdsGrant(
        poolOf(otherInbox).reactor,
        poolOf(otherInbox).validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        poolOf(otherInbox).operatorAuthor,
      ),
    ).toBe(true);

    const session = await signIn(base, "ada", PASSWORD);
    const { dashboard, confirmHtml, done } = await revokeViaPanel(base, session, journalInbox);
    expect(dashboard).toContain("2 live tokens");
    expect(dashboard).not.toContain("3 live tokens");
    expect(confirmHtml).toContain("for <code>ada</code>");
    expect(confirmHtml).toContain(`<code>${otherInbox}</code>`);
    expect(confirmHtml).toContain("negated with this one");
    expect(done.status).toBe(200);
    const doneHtml = await done.text();
    expect(doneHtml).toContain("for <code>ada</code>");
    expect(doneHtml).toContain("Other people's bindings of this connector stand");
    expect(doneHtml).toContain(`<code>${otherInbox}</code>`);
    expect(doneHtml).not.toContain("every other connection is untouched");
    expect(confirmHtml).not.toContain(`<code>${bea.inbox!}</code>`);
    expect(doneHtml).not.toContain(`<code>${bea.inbox!}</code>`);
    expect(
      holdsGrant(
        poolOf(bea.inbox!).reactor,
        poolOf(bea.inbox!).validityNow(),
        STORE_ENTITY,
        bea.actor,
        "write",
        poolOf(bea.inbox!).operatorAuthor,
      ),
    ).toBe(true);
    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        gateway.operatorAuthor,
      ),
    ).toBe(false);
    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        bea.actor,
        "write",
        gateway.operatorAuthor,
      ),
    ).toBe(false);
    expect(
      holdsGrant(
        poolOf(journalInbox).reactor,
        poolOf(journalInbox).validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        poolOf(journalInbox).operatorAuthor,
      ),
    ).toBe(false);
    expect(
      holdsGrant(
        poolOf(otherInbox).reactor,
        poolOf(otherInbox).validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        poolOf(otherInbox).operatorAuthor,
      ),
    ).toBe(false);
    const file = readOAuthFile(connectorsHome);
    expect(file.grants.map((g) => g.user)).toEqual(["bea"]);
    expect(file.clients[0]!.generation).toBe(1);
    expect((await whoami(base, beaToken)).status).toBe(200);
  });

  it("a drop the store refuses keeps the binding's handle: the connection stays revocable and re-bindable", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer({ sticky: true });
    await connect(base, "ada", "journal");
    const grant = readOAuthFile(connectorsHome).grants[0]!;
    const handle = gateway.connectionInboxes.get(grant.inbox!)!;
    await expect(handle.drop()).rejects.toThrow(/drop refused/);
    expect((await handle.gateway!.backend.deltasSince(new Set())).length).toBeGreaterThan(0);
    expect(gateway.connectionInboxes.get(grant.inbox!)).toBe(handle);
    expect(gateway.attachedContainers.has(grant.inbox!)).toBe(true);
    expect(
      holdsGrant(
        handle.gateway!.reactor,
        handle.gateway!.validityNow(),
        STORE_ENTITY,
        grant.actor,
        "write",
        handle.gateway!.operatorAuthor,
      ),
    ).toBe(true);
    const again = await connect(base, "ada", "journal");
    expect((await whoami(base, again)).status).toBe(200);
    expect(gateway.connectionInboxes.get(grant.inbox!)).toBe(handle);
  });

  it("revoking a pre-§58 key's inbox from the admin page is that key's alone: the person's own binding stands", async () => {
    const oldSeed = "ef".repeat(32);
    const oldKey = authorForSeed(oldSeed);
    const oldToken = "pre-58-token-two";
    const { base, connectorsHome, gateway, usersHome } = await exchangeServer({
      preWritten: {
        grants: [
          { clientId: CLIENT_ID, actorSeed: oldSeed, actor: oldKey, grantedAt: 1, standing: true },
        ],
        tokens: [{ digest: digestHex(oldToken), clientId: CLIENT_ID, issuedAt: 1, generation: 1 }],
      },
    });
    const adaToken = await connect(base, "ada", "journal");
    const owner = readUserSeed(usersHome, "ada");
    expect(owner.kind).toBe("present");
    await gateway.bindConnection({
      container: "ada",
      connectionKey: oldKey,
      ownerSeed: (owner as { seed: string }).seed,
    });
    const oldInbox = inboxName("ada", oldKey);
    const session = await signIn(base, "ada", PASSWORD);
    const { confirmHtml, done } = await revokeViaPanel(base, session, oldInbox);
    expect(confirmHtml).toContain("before §58");
    expect(done.status).toBe(200);
    const file = readOAuthFile(connectorsHome);
    expect(file.clients[0]!.generation).toBe(1);
    expect(file.grants.map((g) => g.user)).toEqual(["ada"]);
    expect(file.tokens.every((t) => t.user === "ada")).toBe(true);
    expect((await whoami(base, adaToken)).status).toBe(200);
    const oldPool = gateway.connectionInboxes.get(oldInbox)!.gateway!;
    expect(
      holdsGrant(
        oldPool.reactor,
        oldPool.validityNow(),
        STORE_ENTITY,
        oldKey,
        "write",
        oldPool.operatorAuthor,
      ),
    ).toBe(false);
  });

  it("a pair nobody holds is its own answer, and the records are untouched", async () => {
    const { base, connectorsHome, faults } = await exchangeServer();
    await connect(base, "ada", "journal");
    const before = JSON.stringify(readOAuthFile(connectorsHome));
    const struck: string[] = [];
    const outcome = await revokeConnector(
      connectorsHome,
      CLIENT_ID,
      (g) => {
        struck.push(g.actor);
        return Promise.resolve();
      },
      (m) => faults.push(m),
      { kind: "pair", user: "zed" },
    );
    expect(outcome).toEqual({ kind: "no-such-pair" });
    expect(struck).toEqual([]);
    expect(JSON.stringify(readOAuthFile(connectorsHome))).toBe(before);
  });

  it("a sibling pool of the same key under ANOTHER person is neither named nor negated from this page", async () => {
    const { base, connectorsHome, gateway, usersHome } = await exchangeServer();
    await connect(base, "bea", "notes");
    await connect(base, "ada", "journal");
    const ada = readOAuthFile(connectorsHome).grants.find((g) => g.user === "ada")!;
    const beaSeed = readUserSeed(usersHome, "bea");
    expect(beaSeed.kind).toBe("present");
    await gateway.bindConnection({
      container: "bea:notes",
      connectionKey: ada.actor,
      ownerSeed: (beaSeed as { seed: string }).seed,
    });
    const foreign = inboxName("bea:notes", ada.actor);
    const foreignPool = gateway.connectionInboxes.get(foreign)!.gateway!;
    expect(
      holdsGrant(
        foreignPool.reactor,
        foreignPool.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        foreignPool.operatorAuthor,
      ),
    ).toBe(true);

    const session = await signIn(base, "ada", PASSWORD);
    const { confirmHtml, done } = await revokeViaPanel(base, session, ada.inbox!);
    expect(done.status).toBe(200);
    expect(confirmHtml).not.toContain(foreign);
    expect(await done.text()).not.toContain(foreign);
    expect(
      holdsGrant(
        foreignPool.reactor,
        foreignPool.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        foreignPool.operatorAuthor,
      ),
    ).toBe(true);
  });

  it("a row whose own pool is not attached refuses, naming the sibling rows where the act can be done", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    const adaToken = await connect(base, "ada", "journal");
    await connect(base, "ada", "other");
    const ada = readOAuthFile(connectorsHome).grants.find((g) => g.user === "ada")!;
    const journalInbox = inboxName("ada:journal", ada.actor);
    const otherInbox = inboxName("ada:other", ada.actor);
    gateway.attachedContainers.delete(journalInbox);
    gateway.connectionInboxes.delete(journalInbox);

    const session = await signIn(base, "ada", PASSWORD);
    const dashboard = await (await getAdmin(base, session)).text();
    const confirm = await postAdmin(base, "/admin/revoke", session, {
      form_token: formTokenOf(dashboard),
      name: journalInbox,
    });
    expect(confirm.status).toBe(409);
    const text = await confirm.text();
    expect(text).toContain("not attached here");
    expect(text).toContain(otherInbox);
    expect(text).toContain("Nothing was revoked");
    const otherPool = gateway.connectionInboxes.get(otherInbox)!.gateway!;
    expect(
      holdsGrant(
        otherPool.reactor,
        otherPool.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        otherPool.operatorAuthor,
      ),
    ).toBe(true);
    expect((await whoami(base, adaToken)).status).toBe(200);
  });

  it("a row that loses its pool between the confirm page and the act refuses at the act, negating nothing", async () => {
    const { base, connectorsHome, gateway } = await exchangeServer();
    const adaToken = await connect(base, "ada", "journal");
    await connect(base, "ada", "other");
    const ada = readOAuthFile(connectorsHome).grants.find((g) => g.user === "ada")!;
    const journalInbox = inboxName("ada:journal", ada.actor);
    const otherInbox = inboxName("ada:other", ada.actor);
    const session = await signIn(base, "ada", PASSWORD);
    const dashboard = await (await getAdmin(base, session)).text();
    const formToken = formTokenOf(dashboard);
    const confirm = await postAdmin(base, "/admin/revoke", session, {
      form_token: formToken,
      name: journalInbox,
    });
    expect(confirm.status).toBe(200);
    const confirmToken = confirmTokenOf(await confirm.text());
    gateway.attachedContainers.delete(journalInbox);
    gateway.connectionInboxes.delete(journalInbox);
    const done = await postAdmin(base, "/admin/revoke-confirm", session, {
      form_token: formToken,
      name: journalInbox,
      confirm_token: confirmToken,
    });
    expect(done.status).toBe(409);
    expect(await done.text()).toContain("not attached here");
    const otherPool = gateway.connectionInboxes.get(otherInbox)!.gateway!;
    expect(
      holdsGrant(
        otherPool.reactor,
        otherPool.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        otherPool.operatorAuthor,
      ),
    ).toBe(true);
    expect(readOAuthFile(connectorsHome).grants.map((g) => g.user)).toEqual(["ada"]);
    expect((await whoami(base, adaToken)).status).toBe(200);
  });

  it("a sibling whose store refuses the negation turns the answer into a 503 that names it", async () => {
    const pools = new Map<string, MemoryBackend>();
    const { base, connectorsHome, gateway, faults } = await exchangeServer({ pools });
    const adaToken = await connect(base, "ada", "journal");
    await connect(base, "ada", "other");
    const ada = readOAuthFile(connectorsHome).grants.find((g) => g.user === "ada")!;
    const journalInbox = inboxName("ada:journal", ada.actor);
    const otherInbox = inboxName("ada:other", ada.actor);
    (pools.get(otherInbox) as RefusingBackend).refuse = true;

    const session = await signIn(base, "ada", PASSWORD);
    const { done } = await revokeViaPanel(base, session, journalInbox);
    expect(done.status).toBe(503);
    const text = await done.text();
    expect(text).toContain(otherInbox);
    expect(text).toContain("incomplete");
    expect(faults.join("\n")).toContain(otherInbox);
    const journalPool = gateway.connectionInboxes.get(journalInbox)!.gateway!;
    const otherPool = gateway.connectionInboxes.get(otherInbox)!.gateway!;
    expect(
      holdsGrant(
        journalPool.reactor,
        journalPool.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        journalPool.operatorAuthor,
      ),
    ).toBe(false);
    expect(
      holdsGrant(
        otherPool.reactor,
        otherPool.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        otherPool.operatorAuthor,
      ),
    ).toBe(true);
    expect((await whoami(base, adaToken)).status).toBe(401);
  });

  it("a bind that meets a handle whose pool is unregistered refuses rather than resuming a closed pool", async () => {
    const { base, connectorsHome, gateway, usersHome } = await exchangeServer();
    await connect(base, "ada", "journal");
    const grant = readOAuthFile(connectorsHome).grants[0]!;
    const handle = gateway.connectionInboxes.get(grant.inbox!)!;
    gateway.attachedContainers.delete(grant.inbox!);
    const owner = readUserSeed(usersHome, "ada") as { seed: string };
    await expect(
      gateway.bindConnection({
        container: "ada:journal",
        connectionKey: grant.actor,
        ownerSeed: owner.seed,
      }),
    ).rejects.toThrow(/being dropped/);
    expect(gateway.connectionInboxes.get(grant.inbox!)).toBe(handle);
  });

  it("a person revoking a foreign key's inbox in their own reach negates that pool alone: the other person's pair stands", async () => {
    const { base, connectorsHome, gateway, usersHome } = await exchangeServer();
    await connect(base, "bea", "notes");
    const adaToken = await connect(base, "ada", "journal");
    const ada = readOAuthFile(connectorsHome).grants.find((g) => g.user === "ada")!;
    const beaSeed = readUserSeed(usersHome, "bea") as { seed: string };
    await gateway.bindConnection({
      container: "bea:notes",
      connectionKey: ada.actor,
      ownerSeed: beaSeed.seed,
    });
    const foreign = inboxName("bea:notes", ada.actor);

    const session = await signIn(base, "bea", PASSWORD);
    const { dashboard, confirmHtml, done } = await revokeViaPanel(base, session, foreign);
    expect(done.status).toBe(200);
    const doneHtml = await done.text();
    for (const html of [confirmHtml, doneHtml]) {
      expect(html).toContain("another person's");
      expect(withoutKeys(html)).not.toContain("ada");
    }
    const panel = dashboard.split("<h2>Connections.</h2>")[1]?.split("<h2>")[0] ?? "";
    const row = panel.split("<li>").find((part) => part.includes(foreign.slice(0, 40))) ?? "";
    expect(row, dashboard).not.toBe("");
    expect(row).toContain("another person's");
    expect(withoutKeys(row)).not.toContain("Example Connector");
    expect(row).not.toContain("live token");
    expect(withoutKeys(row)).not.toContain("ada");
    const foreignPool = gateway.connectionInboxes.get(foreign)!.gateway!;
    expect(
      holdsGrant(
        foreignPool.reactor,
        foreignPool.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        foreignPool.operatorAuthor,
      ),
    ).toBe(false);
    const file = readOAuthFile(connectorsHome);
    expect(file.grants.map((g) => g.user).sort()).toEqual(["ada", "bea"]);
    expect((await whoami(base, adaToken)).status).toBe(200);
    const adaPool = gateway.connectionInboxes.get(ada.inbox!)!.gateway!;
    expect(
      holdsGrant(
        adaPool.reactor,
        adaPool.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        adaPool.operatorAuthor,
      ),
    ).toBe(true);
    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        ada.actor,
        "write",
        gateway.operatorAuthor,
      ),
    ).toBe(false);
  });
});
