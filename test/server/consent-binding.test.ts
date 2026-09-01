// §58 S1a (T262, criterion a): the consent page binds a connection to ONE container under the
// person's home, chosen or created on the page, and provisions the home and the target in one
// act. Two levels are never bindable: the store root and the user's home container. The
// approval's code record carries the binding — user and container — so the token exchange (S1b)
// binds the connection where the person said, never store-wide.
//
// Two shapes of "no binding" are told apart on purpose: the page's own form always carries the
// two fields, so a blank choice refuses in words; a POST carrying NEITHER field (a hand-built
// one) mints a code with no container and provisions nothing. The exchange does not read the
// binding yet, so that code still redeems as before — this file pins that shape and names it.
//
// What this file deliberately does NOT assert, and where each gap closes:
//   - The exchange's side — the per-(client, user) key, the inbox pool, the absent store-wide
//     grant, the refusal of an unbound code — has no rail yet; the exchange's own slice of §58
//     brings it, and turns the no-fields case below into a refusal.
//   - The consent page's pre-§58 behaviour (redirect fence, form token, PKCE, the code's shape) —
//     the frozen phase-14 rail (`oauth-consent.test.ts`), which this change leaves byte-identical.
//   - The browser walk of story 1 (criterion 12) has no rail yet; `door-smoke.test.ts` story 2
//     names a container on the real page, and the full walk lands with the exchange's slice.
//
// Erasure standing rule: every store here is this file's own mkdtemp/memory fixture.

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { userSeedPath } from "../../src/cli/config.js";
import { holdsGrant } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { EMPTY_OAUTH, readOAuthFile, writeOAuthFile } from "../../src/server/oauth-file.js";
import { AUTHORIZE_PATH } from "../../src/server/oauth.js";
import { ensureUserKey } from "../../src/server/provision.js";
import { SAME_ORIGIN, signIn } from "../helpers/session-fixture.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = "https://app.example/cb";
const CLIENT_ID = "connector-fixed-0001";
// A valid S256 challenge for the fixture — the exchange is not driven here, only the mint.
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) {
    const home = homes.pop()!;
    try {
      chmodSync(home, 0o700);
    } catch {
      /* already writable, or gone */
    }
    rmSync(home, { recursive: true, force: true });
  }
});

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

/**
 * A served store with one login user, ada, who has NO containers and NO signing seed yet. The
 * connectors' home and the users' home are DISTINCT directories on purpose: a seed provisioned
 * into the wrong one would split a person into two keys, and one shared directory could never
 * show it.
 */
async function bareUserServer(): Promise<{
  base: string;
  usersHome: string;
  connectorsHome: string;
  gateway: Gateway;
  op: (claims: Claims) => Promise<unknown>;
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  await op(userClaims("ada", OPERATOR, ts++));
  await op(roleClaims("ada", "actor", OPERATOR, ts++));
  const usersHome = mkdtempSync(join(tmpdir(), "loam-s1a-users-"));
  const connectorsHome = mkdtempSync(join(tmpdir(), "loam-s1a-connectors-"));
  homes.push(usersHome, connectorsHome);
  writeCredentials(usersHome, { version: 1, users: { ada: await hashPassword(PASSWORD, CHEAP) } });
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
  });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: { home: connectorsHome, allowRedirectOrigins: [ALLOW_ORIGIN] },
    users: { home: usersHome, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, usersHome, connectorsHome, gateway, op };
}

const AUTHORIZE_QUERY = {
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  state: "st-42",
  response_type: "code",
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
};

const fieldOf = (html: string, name: string): string | undefined =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1];

async function consentPage(base: string, sessionId: string): Promise<string> {
  const res = await fetch(`${base}${AUTHORIZE_PATH}?${new URLSearchParams(AUTHORIZE_QUERY)}`, {
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    redirect: "manual",
  });
  expect(res.status).toBe(200);
  return res.text();
}

/** POST the approval with the page's own fields plus `extra` — the binding, or nothing at all. */
async function approve(
  base: string,
  sessionId: string,
  html: string,
  extra: Record<string, string>,
): Promise<Response> {
  const fields: Record<string, string> = {
    form_token: fieldOf(html, "form_token")!,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state: "st-42",
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    ...extra,
  };
  return fetch(`${base}${AUTHORIZE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
}

const adaNames = (gateway: Gateway): string[] =>
  [...gateway.containers().containers.keys()].filter((n) => n.startsWith("ada")).sort();

describe("§58 S1a (a) — the consent page binds a container under the person's home", () => {
  it("shows the binding field, and on the first day provisions the home, the seed, and the target in one act", async () => {
    const { base, usersHome, connectorsHome, gateway } = await bareUserServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);

    // The page asks, in words, where this connection lives — and on day one it has nothing to
    // list yet, so it offers to create.
    expect(html).toContain("Bind this connection to");
    expect(html).toContain('name="bind_new"');
    expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(false);
    expect(gateway.containers().containers.has("ada")).toBe(false);

    // A posted `user` field changes nothing: the binding's user is the SESSION's, only.
    const res = await approve(base, ada, html, { bind_new: "journal", user: "bea" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(REDIRECT);

    // One act, three facts: the home is declared, the seed is minted — in the USERS' home, not
    // the connectors' — and the target is declared under the home, exactly as the admin page's
    // create-root would have done.
    const table = gateway.containers().containers;
    expect(table.has("ada")).toBe(true);
    expect(table.has("ada:journal")).toBe(true);
    expect(table.get("ada:journal")?.parent).toBe("ada");
    expect(table.has("bea")).toBe(false);
    expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(true);
    expect(existsSync(userSeedPath(connectorsHome, "ada"))).toBe(false);

    // The code carries the binding: whose act, and where the connection will live. The minted
    // seed is in neither the record nor the page.
    const codes = readOAuthFile(connectorsHome).codes ?? [];
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ clientId: CLIENT_ID, user: "ada", container: "ada:journal" });
    const seed = readFileSync(userSeedPath(usersHome, "ada"), "utf8").trim();
    // And WHOSE: each container gathers what the minted key authors, and that key holds the
    // store-wide write grant — the standing create-root gives, now given here.
    const mintedKey = authorForSeed(seed);
    expect(table.get("ada")!.membership).toEqual(authoredBy(mintedKey));
    expect(table.get("ada:journal")!.membership).toEqual(authoredBy(mintedKey));
    expect(holdsGrant(gateway.reactor, STORE_ENTITY, mintedKey, "write", OPERATOR)).toBe(true);
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(readOAuthFile(connectorsHome))).not.toContain(seed);
    expect(await consentPage(base, ada)).not.toContain(seed);
  });

  it("lists the containers already under the person's home and binds an existing one", async () => {
    const { base, connectorsHome, gateway, op } = await bareUserServer();
    // A grandchild is declared FIRST, before its parent and the home stand, so the table meets it
    // ahead of both in arrival order: only a walk that runs to a fixpoint reaches it, through the
    // child the same walk adds. The reach is the whole subtree, at any depth below the home — and
    // nothing at all while the home does not stand.
    let ts = 9300;
    await op(
      containerClaims(
        {
          container: "ada:journal:2025",
          trust: "curated",
          posture: "shared",
          parent: "ada:journal",
          membership: authoredBy(OPERATOR),
        },
        OPERATOR,
        ts++,
      ),
    );
    const ada = await signIn(base, "ada", PASSWORD);
    const first = await consentPage(base, ada);
    expect(first).not.toContain("ada:journal:2025");
    expect((await approve(base, ada, first, { bind_new: "journal" })).status).toBe(302);
    // Beside the journal: a pool receiving into it (a connection's own, never offered) and a
    // sibling whose name ends in a space — the store's own name, offered and compared as-is.
    await op(
      containerClaims(
        {
          container: "ada:journal:inbox-1",
          trust: "curated",
          posture: "separate",
          membership: authoredBy(OPERATOR),
          inboxOf: "ada:journal",
        },
        OPERATOR,
        ts++,
      ),
    );
    await op(
      containerClaims(
        {
          container: "ada:notes ",
          trust: "curated",
          posture: "shared",
          parent: "ada",
          membership: authoredBy(OPERATOR),
        },
        OPERATOR,
        ts++,
      ),
    );
    const standing = [
      "ada",
      "ada:journal",
      "ada:journal:2025",
      "ada:journal:inbox-1",
      "ada:notes ",
    ];
    expect(adaNames(gateway)).toEqual(standing);

    const second = await consentPage(base, ada);
    // The existing containers are offered by name, the grandchild among them; the home itself
    // and the pool are not.
    expect(second).toContain('value="ada:journal"');
    expect(second).toContain('value="ada:journal:2025"');
    expect(second).toContain('value="ada:notes "');
    expect(second).not.toContain('value="ada"');
    expect(second).not.toContain("inbox-1");
    const res = await approve(base, ada, second, { bind: "ada:journal" });
    expect(res.status).toBe(302);
    const codes = readOAuthFile(connectorsHome).codes ?? [];
    expect(codes).toHaveLength(2);
    expect(codes[1]).toMatchObject({ user: "ada", container: "ada:journal" });
    // No second declaration — at the bytes: the ground holds exactly as many deltas after a
    // repeat CREATE of the same leaf as before it, because a standing name in reach binds the
    // existing container rather than redeclaring it. (A redeclaration with the same parent and
    // membership would leave the name set and the resolved table unchanged; only the count sees.)
    const deltas = async (): Promise<number> =>
      (await gateway.backend.deltasSince(new Set())).length;
    const before = await deltas();
    expect((await approve(base, ada, second, { bind_new: "journal" })).status).toBe(302);
    expect(await deltas()).toBe(before);
    expect(adaNames(gateway)).toEqual(standing);
    // The name with the space binds exactly as listed — untrimmed — and so does the grandchild.
    expect((await approve(base, ada, second, { bind: "ada:notes " })).status).toBe(302);
    expect(readOAuthFile(connectorsHome).codes?.at(-1)).toMatchObject({ container: "ada:notes " });
    expect((await approve(base, ada, second, { bind: "ada:journal:2025" })).status).toBe(302);
    expect(readOAuthFile(connectorsHome).codes?.at(-1)).toMatchObject({
      container: "ada:journal:2025",
    });
    // With the home standing, the home and the pool are still refused, each by its own reason —
    // a pool inside the reach hides nothing from its owner, so it is not "not yours" — and
    // neither mints nor declares.
    const home = await approve(base, ada, second, { bind: "ada" });
    expect(home.status).toBe(400);
    expect(await home.text()).toContain("never bound");
    const pool = await approve(base, ada, second, { bind: "ada:journal:inbox-1" });
    expect(pool.status).toBe(400);
    expect(await pool.text()).toContain("a pool is never bound");
    expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(5);
    expect(adaNames(gateway)).toEqual(standing);
    expect(await deltas()).toBe(before);
  });

  it("refuses the two levels that are never bound — the store root and the home — and mints nothing", async () => {
    const { base, usersHome, connectorsHome, gateway } = await bareUserServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);

    const blanks = [{ bind: "" }, { bind: "ada" }, { bind_new: "" }, { bind: "", bind_new: "" }];
    for (const binding of blanks) {
      const res = await approve(base, ada, html, binding);
      expect(res.status, JSON.stringify(binding)).toBe(400);
      expect(await res.text()).toMatch(/never bound|one level below|under your name/i);
    }
    // Two-sided: nothing was minted and nothing was declared for a refused binding.
    expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(0);
    expect(gateway.containers().containers.has("ada")).toBe(false);
    expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(false);
  });

  it("refuses a binding outside the person's reach with the uniform not-yours answer, real or not", async () => {
    const { base, connectorsHome, gateway, op } = await bareUserServer();
    // bea's home and child REALLY exist; zed's do not. ada must be told the same thing about
    // both — existence is confirmed neither way — and the same for a create that lands on a
    // container standing outside her reach (a receiver declared with no parent).
    let ts = 9100;
    await op(userClaims("bea", OPERATOR, ts++));
    await op(
      containerClaims(
        { container: "bea", trust: "curated", posture: "shared", membership: authoredBy(OPERATOR) },
        OPERATOR,
        ts++,
      ),
    );
    await op(
      containerClaims(
        {
          container: "bea:journal",
          trust: "curated",
          posture: "shared",
          parent: "bea",
          membership: authoredBy(OPERATOR),
        },
        OPERATOR,
        ts++,
      ),
    );
    // `ada:journal` already stands, declared by nobody's page: no parent, outside ada's reach.
    await op(
      containerClaims(
        {
          container: "ada:journal",
          trust: "curated",
          posture: "shared",
          membership: authoredBy(OPERATOR),
        },
        OPERATOR,
        ts++,
      ),
    );
    // ada's own home and one child stand too, so the reach is walked for real — bea's child is
    // refused by the walk, not by ada having no home.
    await op(
      containerClaims(
        { container: "ada", trust: "curated", posture: "shared", membership: authoredBy(OPERATOR) },
        OPERATOR,
        ts++,
      ),
    );
    await op(
      containerClaims(
        {
          container: "ada:notes",
          trust: "curated",
          posture: "shared",
          parent: "ada",
          membership: authoredBy(OPERATOR),
        },
        OPERATOR,
        ts++,
      ),
    );
    expect(gateway.containers().containers.has("bea:journal")).toBe(true);
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);
    expect(html).toContain('value="ada:notes"');
    expect(html).not.toContain("bea:journal");
    expect(html).not.toContain('value="ada:journal"');

    const real = await approve(base, ada, html, { bind: "bea:journal" });
    const fake = await approve(base, ada, html, { bind: "zed:journal" });
    const rootless = await approve(base, ada, html, { bind_new: "journal" });
    expect(real.status).toBe(404);
    expect(fake.status).toBe(real.status);
    expect(rootless.status).toBe(real.status);
    const realText = await real.text();
    expect(await fake.text()).toBe(realText);
    expect(await rootless.text()).toBe(realText);
    expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(0);
  });

  it("a leaf name is fenced to what a path can carry", async () => {
    const { base, connectorsHome } = await bareUserServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);
    const bad = ["with:colon", "has space", "../up", "x".repeat(80), "-lead", "a.b", "a?b", "a#b"];
    for (const leaf of bad) {
      const res = await approve(base, ada, html, { bind_new: leaf });
      expect(res.status, leaf).toBe(400);
    }
    expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(0);
  });

  it("a container whose name the record could not carry is neither listed nor bindable", async () => {
    const { base, connectorsHome, gateway, op } = await bareUserServer();
    let ts = 9200;
    await op(
      containerClaims(
        { container: "ada", trust: "curated", posture: "shared", membership: authoredBy(OPERATOR) },
        OPERATOR,
        ts++,
      ),
    );
    // Declaration is looser than the binding: a control character is declarable today — a C0
    // one and a C1 one (NEL) alike. The fence is the connector record's own predicate, so no
    // name the page offers can be one the store then refuses to write.
    const odds = ["ada:x\u0001y", "ada:no\u0085tes"];
    for (const odd of odds) {
      await op(
        containerClaims(
          {
            container: odd,
            trust: "curated",
            posture: "shared",
            parent: "ada",
            membership: authoredBy(OPERATOR),
          },
          OPERATOR,
          ts++,
        ),
      );
      expect(gateway.containers().containers.has(odd)).toBe(true);
    }
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);
    expect(html).not.toContain("ada:x");
    expect(html).not.toContain("ada:no");
    for (const odd of odds) {
      const res = await approve(base, ada, html, { bind: odd });
      expect(res.status, JSON.stringify(odd)).toBe(400);
      expect(await res.text()).toContain("cannot be bound");
    }
    expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(0);
  });

  it("a POST carrying no binding fields mints an unbound code the exchange still redeems as before", async () => {
    // Not this page's form — the page always sends both fields — so only a hand-built POST lands
    // here. The code carries the user and no container, and the store is untouched. THIS IS AN
    // OPEN WINDOW, pinned so it is seen: the exchange does not read the binding yet, and this
    // code redeems to the store-wide grant it always did. The exchange's slice turns this case
    // into a refusal.
    const { base, usersHome, connectorsHome, gateway } = await bareUserServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);
    const res = await approve(base, ada, html, {});
    expect(res.status).toBe(302);
    const codes = readOAuthFile(connectorsHome).codes ?? [];
    expect(codes).toHaveLength(1);
    expect(codes[0]?.user).toBe("ada");
    expect(codes[0]?.container).toBeUndefined();
    expect(gateway.containers().containers.has("ada")).toBe(false);
    expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(false);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "when the seed cannot be minted, the approval refuses and keeps nothing partial",
    async () => {
      const { base, usersHome, connectorsHome, gateway } = await bareUserServer();
      const ada = await signIn(base, "ada", PASSWORD);
      const html = await consentPage(base, ada);
      chmodSync(usersHome, 0o500); // the seed file cannot be written
      const res = await approve(base, ada, html, { bind_new: "journal" });
      expect(res.status).toBe(503);
      expect(await res.text()).toContain("could not be provisioned");
      chmodSync(usersHome, 0o700);
      // Nothing partial: no code, no home, no target, no seed.
      expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(0);
      expect(adaNames(gateway)).toEqual([]);
      expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(false);
    },
  );

  it("a seed whose grant could not land is taken back, so a retry mints afresh", async () => {
    // The provisioning act alone, against a ground whose first append fails: the seed file this
    // act wrote is removed and the refusal says so — otherwise the next attempt would read a
    // "present" seed that never earned its grant, and keep it forever. The retry succeeds.
    const home = mkdtempSync(join(tmpdir(), "loam-s1a-grant-"));
    homes.push(home);
    const faults: string[] = [];
    let failures = 1;
    const ground = {
      options: { seed: OPERATOR_SEED },
      operatorAuthor: OPERATOR,
      nextTimestamp: () => 1,
      append: (): Promise<void> =>
        failures-- > 0 ? Promise.reject(new Error("no room on the ground")) : Promise.resolve(),
    } as unknown as Gateway;
    const first = await ensureUserKey(ground, home, "ada", (m) => faults.push(m));
    expect("refusal" in first ? first.refusal : undefined).toMatchObject({ status: 503 });
    expect("refusal" in first ? first.refusal.message : "").toContain("Nothing partial was kept");
    expect(faults.join("\n")).toContain("no room on the ground");
    expect(existsSync(userSeedPath(home, "ada"))).toBe(false);

    const second = await ensureUserKey(ground, home, "ada", (m) => faults.push(m));
    expect("userSeed" in second).toBe(true);
    expect(existsSync(userSeedPath(home, "ada"))).toBe(true);
    expect(faults).toHaveLength(1);
  });
});
