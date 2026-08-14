// §40 phase A5 — the connections panel (T141). Criterion 12 of .adlc/specs/40-admin-page.md,
// transcribed. The dashboard lists every connection bound to the session user's subtree (the
// container table's inbox pools, joined with oauth.json when connectors are configured), and revoke
// drives §39.3c through a two-step confirm: the connection's next write refuses, its past deltas
// keep their author, a sibling connection is untouched. With connectors, revoking through the panel
// also drives phase 15's revokeConnector, so a live bearer is refused on the very next request.
//
// What this file deliberately does NOT assert, and which rail closes each gap:
//   - The inbox DROP (total forget) — A2's rails (`admin-containers.test.ts`); the panel only links it.
//   - revokeConnector's own file semantics (generation bump, code burn) — `oauth-revoke.test.ts`.
//   - The login doors' own refusals — the frozen §36 rails.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { containerClaims } from "../../src/gateway/container.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { initHome, writeUserSeed } from "../../src/cli/config.js";
import {
  EMPTY_OAUTH,
  readOAuthFile,
  writeOAuthFile,
  type OAuthClient,
} from "../../src/server/oauth-file.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN } from "../spike/garden.js";

vi.setConfig({ testTimeout: 25000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

const SEEDS = { ada: "aa".repeat(32), bea: "bb".repeat(32) } as const;
const KEYS = { ada: authorForSeed(SEEDS.ada), bea: authorForSeed(SEEDS.bea) } as const;
const CONN_SEED = "c5".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const CONN2_SEED = "d6".repeat(32);
const CONN2 = authorForSeed(CONN2_SEED);

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

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));

async function signIn(base: string, user: string): Promise<string> {
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
    body: new URLSearchParams({ form_token: token, user, password: PASSWORD }).toString(),
  });
  return valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
}

const getAdmin = (base: string, sessionId: string): Promise<Response> =>
  fetch(`${base}/admin`, {
    redirect: "manual",
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
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

const tokenOf = (html: string): string => /name="form_token" value="([^"]+)"/.exec(html)?.[1] ?? "";

/** The connections panel's own section — the tree above it also names inbox containers. */
const panelOf = (html: string): string =>
  html.split("<h2>Connections.</h2>")[1]?.split("<h2>")[0] ?? "";

/** The panel row for one connection key (the full key rides in the row's title attribute). */
const rowFor = (html: string, key: string): string =>
  panelOf(html)
    .split("<li>")
    .find((part) => part.includes(key)) ?? "";
const confirmTokenOf = (html: string): string =>
  /name="confirm_token" value="([^"]+)"/.exec(html)?.[1] ?? "";

/** Run the whole two-step confirm flow against one inbox. Returns the final response. */
async function revokeViaPanel(base: string, sessionId: string, name: string): Promise<Response> {
  const dashboard = await (await getAdmin(base, sessionId)).text();
  const formToken = tokenOf(dashboard);
  const confirm = await postAdmin(base, "/admin/revoke", sessionId, {
    form_token: formToken,
    name,
  });
  expect(confirm.status).toBe(200);
  const confirmHtml = await confirm.text();
  const confirmToken = confirmTokenOf(confirmHtml);
  expect(confirmToken).not.toBe("");
  return postAdmin(base, "/admin/revoke-confirm", sessionId, {
    form_token: formToken,
    name,
    confirm_token: confirmToken,
  });
}

/** A connection-signed data write into an inbox pool. */
const noteBy = (seed: string, ts: number, text: string): Delta =>
  signClaims(
    {
      timestamp: ts,
      author: authorForSeed(seed),
      pointers: [{ role: "note", target: { kind: "primitive", value: text } }],
    },
    seed,
  );

// --- the bare fixture (no connectors) ------------------------------------------------------------

/**
 * Two rooted users; two connections bound to ada's root through `gw.bindConnection` with her own
 * seed as owner. No `connectors` configured, so the panel runs on the container table alone.
 */
async function bareServer(): Promise<{
  base: string;
  gateway: Gateway;
  inboxes: { one: string; two: string };
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  for (const name of ["ada", "bea"] as const) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, "actor", OPERATOR, ts++));
    await op(
      containerClaims(
        {
          container: name,
          trust: "curated",
          posture: "shared",
          membership: authoredBy(KEYS[name]),
        },
        OPERATOR,
        ts++,
      ),
    );
  }
  await gateway.bindConnection({ container: "ada", connectionKey: CONN, ownerSeed: SEEDS.ada });
  await gateway.bindConnection({ container: "ada", connectionKey: CONN2, ownerSeed: SEEDS.ada });

  const home = mkdtempSync(join(tmpdir(), "loam-admin-conn-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { ada: hash, bea: hash } });
  writeUserSeed(home, "ada", SEEDS.ada);
  writeUserSeed(home, "bea", SEEDS.bea);

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return {
    base: handle.url,
    gateway,
    inboxes: { one: `inbox:ada:${CONN}`, two: `inbox:ada:${CONN2}` },
  };
}

describe("§40 criterion 12 — the connections panel (bare bound connections)", () => {
  it("lists exactly the subtree's connections: ada sees both keys; bea sees neither", async () => {
    const { base, inboxes } = await bareServer();

    const ada = await signIn(base, "ada");
    const adaPage = await (await getAdmin(base, ada)).text();
    expect(adaPage).toContain("Connections");
    expect(adaPage).toContain(CONN);
    expect(adaPage).toContain(CONN2);
    // Each row links its inbox's own page — the drop lives there, not on the panel.
    expect(adaPage).toContain(`name=${encodeURIComponent(inboxes.one)}`);
    // No connector flow is configured: the panel says so instead of pretending to know clients.
    expect(adaPage).toContain("no connector flow");

    // Isolation: bea's panel carries neither of ada's connections, in any spelling.
    const bea = await signIn(base, "bea");
    const beaPage = await (await getAdmin(base, bea)).text();
    expect(beaPage).toContain("Connections"); // the panel renders (positive control)
    expect(beaPage).not.toContain(CONN);
    expect(beaPage).not.toContain(CONN2);
    expect(beaPage).not.toContain("inbox:ada");
  });

  it("revoke through the confirm flow is §39.3c two-sided; a forged confirm token does nothing", async () => {
    const { base, gateway, inboxes } = await bareServer();
    const pool1 = gateway.connectionInboxes.get(inboxes.one)!.gateway!;
    const pool2 = gateway.connectionInboxes.get(inboxes.two)!.gateway!;
    const past = noteBy(CONN_SEED, gateway.nextTimestamp(), "written before the revoke");
    await pool1.append([past]);

    const ada = await signIn(base, "ada");

    // The no-confirm direct POST does nothing: a forged token refuses, and the write still lands.
    const dashboard = await (await getAdmin(base, ada)).text();
    const forged = await postAdmin(base, "/admin/revoke-confirm", ada, {
      form_token: tokenOf(dashboard),
      name: inboxes.one,
      confirm_token: "not-a-minted-token",
    });
    expect(forged.status).toBe(403);
    await pool1.append([noteBy(CONN_SEED, gateway.nextTimestamp(), "still writable")]);

    // The confirm page tells the truth before anything happens: refuse-next-write, keep the past.
    const confirm = await postAdmin(base, "/admin/revoke", ada, {
      form_token: tokenOf(dashboard),
      name: inboxes.one,
    });
    const confirmHtml = await confirm.text();
    expect(confirmHtml).toContain("keep");
    expect(confirmHtml).toContain(CONN);

    // The full flow revokes.
    const done = await revokeViaPanel(base, ada, inboxes.one);
    expect(done.status).toBe(200);
    const doneHtml = await done.text();
    expect(doneHtml).toContain("Revoked");

    // DELTA level, two-sided (§39.3c): the next write refuses; the sibling still writes; the past
    // delta keeps its author and stays in the gather.
    await expect(
      pool1.append([noteBy(CONN_SEED, gateway.nextTimestamp(), "after the revoke")]),
    ).rejects.toThrow();
    const w2 = noteBy(CONN2_SEED, gateway.nextTimestamp(), "the sibling is untouched");
    await pool2.append([w2]);
    expect(pool2.reactor.get(w2.id)).toBeDefined();
    expect(pool1.reactor.get(past.id)!.claims.author).toBe(CONN);
    expect(gateway.connectionScope({ bound: "ada" }).map((d) => d.id)).toContain(past.id);

    // OBJECT level: the panel now shows the revoked state ON THAT ROW (the tree's own "active"
    // state words must not satisfy this), the sibling row stays active, and the revoked row STAYS
    // listed — history does not rewrite.
    const after = await (await getAdmin(base, ada)).text();
    expect(rowFor(after, CONN)).toContain("revoked");
    expect(rowFor(after, CONN2)).toContain("active");
  });

  it("a foreign session cannot revoke: bea addressing ada's inbox gets the uniform refusal", async () => {
    const { base, gateway, inboxes } = await bareServer();
    const pool1 = gateway.connectionInboxes.get(inboxes.one)!.gateway!;

    const bea = await signIn(base, "bea");
    const beaPage = await (await getAdmin(base, bea)).text();
    const res = await postAdmin(base, "/admin/revoke", bea, {
      form_token: tokenOf(beaPage),
      name: inboxes.one,
    });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain("inbox:ada"); // existence is confirmed neither way
    // Positive control: the connection still writes — nothing was revoked.
    await pool1.append([noteBy(CONN_SEED, gateway.nextTimestamp(), "unrevoked")]);
  });
});

// --- the connector fixture (phases 13–15 joined) -------------------------------------------------

const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = "https://app.example/cb";
const CLIENT_ID = "connector-fixed-0001";
const CLIENT_NAME = "Example Connector";
const MYK_SEED = "5f".repeat(32);
const MYK = authorForSeed(MYK_SEED);

const clientRecord = (): OAuthClient => ({
  clientId: CLIENT_ID,
  clientName: CLIENT_NAME,
  redirectUris: [REDIRECT],
  registeredAt: 1,
  generation: 1,
});

const b64url = (buf: Buffer): string => buf.toString("base64url");
const pkce = (): { verifier: string; challenge: string } => {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

const fieldOf = (html: string, name: string): string =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

/**
 * The oauth-token fixture, plus a root container for myk. register (pre-written client) → consent →
 * redeem mints the connector's actor and bearer; the actor is then BOUND to myk's container as a
 * §39 connection, which is the row the panel joins with oauth.json.
 */
async function connectorServer(): Promise<{
  base: string;
  home: string;
  gateway: Gateway;
  token: string;
  actor: string;
  actorSeed: string;
  inbox: string;
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([
    signClaims(
      containerClaims(
        { container: "myk", trust: "curated", posture: "shared", membership: authoredBy(MYK) },
        OPERATOR,
        ts++,
      ),
      OPERATOR_SEED,
    ),
  ]);
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, MYK, "write", OPERATOR, ts++), OPERATOR_SEED),
  ]);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

  const home = mkdtempSync(join(tmpdir(), "loam-admin-conn-oauth-"));
  homes.push(home);
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  writeUserSeed(home, "myk", MYK_SEED);
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
  const base = handle.url;

  // Consent (phase 14): sign in, approve, catch the code off the redirect.
  const { verifier, challenge } = pkce();
  const sessionId = await signIn(base, "myk");
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-1",
  }).toString();
  const consent = await fetch(`${base}/oauth/authorize?${query}`, {
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    redirect: "manual",
  });
  const consentHtml = await consent.text();
  const approve = await fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({
      form_token: fieldOf(consentHtml, "form_token"),
      client_id: fieldOf(consentHtml, "client_id"),
      redirect_uri: fieldOf(consentHtml, "redirect_uri"),
      code_challenge: fieldOf(consentHtml, "code_challenge"),
      code_challenge_method: "S256",
      state: fieldOf(consentHtml, "state"),
    }).toString(),
    redirect: "manual",
  });
  expect(approve.status).toBe(302);
  const code = new URL(approve.headers.get("location")!).searchParams.get("code")!;

  // Redeem (phase 15): the bearer and the connector's actor.
  const redeemed = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code,
      code_verifier: verifier,
    }).toString(),
  });
  expect(redeemed.status).toBe(200);
  const token = ((await redeemed.json()) as { access_token: string }).access_token;
  const grant = readOAuthFile(home).grants[0]!;

  // The join row: the connector's actor, bound to myk's container as a §39 connection.
  await gateway.bindConnection({
    container: "myk",
    connectionKey: grant.actor,
    ownerSeed: MYK_SEED,
  });
  return {
    base,
    home,
    gateway,
    token,
    actor: grant.actor,
    actorSeed: grant.actorSeed,
    inbox: `inbox:myk:${grant.actor}`,
  };
}

const mutate = (base: string, token: string, height: number): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `mutation { plant(entity: "${FERN}", height: ${height}) { height } }`,
    }),
  });

describe("§40 criterion 12 — the connections panel joins oauth.json (phases 13–15)", () => {
  it("the row joins the client name and generation; revoke through the panel refuses the live bearer", async () => {
    const { base, home, gateway, token, actor, actorSeed, inbox } = await connectorServer();
    const pool = gateway.connectionInboxes.get(inbox)!.gateway!;

    const myk = await signIn(base, "myk");
    const page = await (await getAdmin(base, myk)).text();
    expect(page).toContain(actor);
    // The join rides ON THE ROW: client name, generation, and the live token, from oauth.json.
    const joined = rowFor(page, actor);
    expect(joined).toContain(CLIENT_NAME);
    expect(joined).toContain("generation 1");
    expect(joined).toContain("1 live token");

    // Positive controls: the bearer writes AND the actor's inbox write lands, BEFORE the revoke.
    expect((await mutate(base, token, 90)).status).toBe(200);
    const past = noteBy(actorSeed, gateway.nextTimestamp(), "written before the revoke");
    await pool.append([past]);

    // Revoke through the panel's confirm flow.
    const done = await revokeViaPanel(base, myk, inbox);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain(CLIENT_NAME);

    // Phase 15's rail, driven through the browser door: the very next bearer request refuses, and
    // nothing landed. The generation bumped and the grant is gone from the file.
    const after = await mutate(base, token, 91);
    expect(after.status).toBe(401);
    const file = readOAuthFile(home);
    expect(file.clients[0]!.generation).toBe(2);
    expect(file.grants).toHaveLength(0);

    // §39.3c holds at the inbox too: the actor's next inbox write refuses; the past inbox delta and
    // the bearer's landed primary write both keep the actor as author.
    await expect(
      pool.append([noteBy(actorSeed, gateway.nextTimestamp(), "after the revoke")]),
    ).rejects.toThrow();
    expect(pool.reactor.get(past.id)!.claims.author).toBe(actor);
    const authors = [...gateway.reactor.snapshot()]
      .filter((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "height",
        ),
      )
      .map((d) => d.claims.author);
    expect(authors).toContain(actor);

    // The panel now shows the revoked state ON THE ROW, and the row stays listed — history does
    // not rewrite.
    const afterPage = await (await getAdmin(base, myk)).text();
    expect(rowFor(afterPage, actor)).toContain("revoked");
  });
});
