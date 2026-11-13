import { seedSigner } from "../../src/gateway/signer.js";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writtenByUser } from "../../src/gateway/member-of.js";
import { FERN, observed } from "../spike/garden.js";
import { authorForSeed, Reactor, signClaims, type Claims } from "@bombadil/rhizomatic";
import { userSeedPath } from "../../src/cli/config.js";
import { holdsGrant } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container-law.js";
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
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) {
    const home = homes.pop()!;
    try {
      chmodSync(home, 0o700);
    } catch {}
    rmSync(home, { recursive: true, force: true });
  }
});

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

async function bareUserServer(onFault?: (message: string) => void): Promise<{
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
    connectors: {
      home: connectorsHome,
      allowRedirectOrigins: [ALLOW_ORIGIN],
      ...(onFault === undefined ? {} : { onFault }),
    },
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

    expect(html).toContain("Bind this connection to");
    expect(html).toContain('name="bind_new"');
    expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(false);
    expect(gateway.containers().containers.has("ada")).toBe(false);

    const res = await approve(base, ada, html, { bind_new: "journal", user: "bea" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(REDIRECT);

    const table = gateway.containers().containers;
    expect(table.has("ada")).toBe(true);
    expect(table.has("ada:journal")).toBe(true);
    expect(table.get("ada:journal")?.parent).toBe("ada");
    expect(table.has("bea")).toBe(false);
    expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(true);
    expect(existsSync(userSeedPath(connectorsHome, "ada"))).toBe(false);

    const codes = readOAuthFile(connectorsHome).codes ?? [];
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ clientId: CLIENT_ID, user: "ada", container: "ada:journal" });
    const seed = readFileSync(userSeedPath(usersHome, "ada"), "utf8").trim();
    const mintedKey = authorForSeed(seed);
    expect(table.get("ada")!.membership).toEqual(writtenByUser("ada", "ada"));
    expect(table.get("ada:journal")!.membership).toEqual(writtenByUser("ada", "ada:journal"));
    const byAda = observed(FERN, "height", 1, gateway.stamp(mintedKey).timestamp, seed);
    await gateway.append([byAda]);
    for (const c of ["ada", "ada:journal"])
      expect(gateway.select(table.get(c)!.membership).map((d) => d.id)).toContain(byAda.id);
    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        mintedKey,
        "write",
        OPERATOR,
      ),
    ).toBe(true);
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(readOAuthFile(connectorsHome))).not.toContain(seed);
    expect(await consentPage(base, ada)).not.toContain(seed);
  });

  it("lists the containers already under the person's home and binds an existing one", async () => {
    const { base, connectorsHome, gateway, op } = await bareUserServer();
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
    const ada = await signIn(base, "ada", PASSWORD);
    const first = await consentPage(base, ada);
    expect(first).not.toContain("ada:journal:2025");
    expect(first).not.toContain('value="ada:notes "');
    expect((await approve(base, ada, first, { bind_new: "journal" })).status).toBe(302);
    await op(
      containerClaims(
        {
          container: "ada:inbox-1",
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
          container: "ada:inbox-2",
          trust: "curated",
          posture: "separate",
          parent: "ada",
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
          container: "ada:vault",
          trust: "curated",
          posture: "separate",
          parent: "ada",
          membership: authoredBy(OPERATOR),
        },
        OPERATOR,
        ts++,
      ),
    );
    const standing = [
      "ada",
      "ada:inbox-1",
      "ada:inbox-2",
      "ada:journal",
      "ada:journal:2025",
      "ada:notes ",
      "ada:vault",
    ];
    expect(adaNames(gateway)).toEqual(standing);

    const second = await consentPage(base, ada);
    expect(second).toContain('value="ada:journal"');
    expect(second).toContain('value="ada:journal:2025"');
    expect(second).toContain('value="ada:notes "');
    expect(second).toContain('value="ada:vault"');
    expect(second).not.toContain('value="ada"');
    expect(second).not.toContain("inbox-1");
    expect(second).not.toContain("inbox-2");
    const res = await approve(base, ada, second, { bind: "ada:journal" });
    expect(res.status).toBe(302);
    const codes = readOAuthFile(connectorsHome).codes ?? [];
    expect(codes).toHaveLength(2);
    expect(codes[1]).toMatchObject({ user: "ada", container: "ada:journal" });
    const deltas = async (): Promise<number> =>
      (await gateway.backend.deltasSince(new Set())).length;
    const before = await deltas();
    expect((await approve(base, ada, second, { bind_new: "journal" })).status).toBe(302);
    expect(await deltas()).toBe(before);
    expect(adaNames(gateway)).toEqual(standing);
    expect((await approve(base, ada, second, { bind: "ada:notes " })).status).toBe(302);
    expect(readOAuthFile(connectorsHome).codes?.at(-1)).toMatchObject({ container: "ada:notes " });
    expect((await approve(base, ada, second, { bind: "ada:journal:2025" })).status).toBe(302);
    expect(readOAuthFile(connectorsHome).codes?.at(-1)).toMatchObject({
      container: "ada:journal:2025",
    });
    expect((await approve(base, ada, second, { bind: "ada:vault" })).status).toBe(302);
    expect(readOAuthFile(connectorsHome).codes?.at(-1)).toMatchObject({ container: "ada:vault" });
    const home = await approve(base, ada, second, { bind: "ada" });
    expect(home.status).toBe(400);
    expect(await home.text()).toContain("Your home container is never bound");
    const pool = await approve(base, ada, second, { bind: "ada:inbox-1" });
    expect(pool.status).toBe(400);
    expect(await pool.text()).toContain("a pool is never bound");
    const parented = await approve(base, ada, second, { bind: "ada:inbox-2" });
    expect(parented.status).toBe(400);
    expect(await parented.text()).toContain("a pool is never bound");
    const intoPool = await approve(base, ada, second, { bind_new: "inbox-1" });
    expect(intoPool.status).toBe(400);
    expect(await intoPool.text()).toContain("a pool is never bound");
    expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(6);
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
    expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(0);
    expect(gateway.containers().containers.has("ada")).toBe(false);
    expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(false);
  });

  it("refuses a binding outside the person's reach with the uniform not-yours answer, real or not", async () => {
    const { base, connectorsHome, gateway, op } = await bareUserServer();
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
    const bad = ["with:colon", "has space", "../up", "x".repeat(64), "-lead", "a.b", "a?b", "a#b"];
    for (const leaf of bad) {
      const res = await approve(base, ada, html, { bind_new: leaf });
      expect(res.status, leaf).toBe(400);
    }
    expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(0);
    const longest = "x".repeat(63);
    expect((await approve(base, ada, html, { bind_new: longest })).status).toBe(302);
    expect(readOAuthFile(connectorsHome).codes?.[0]).toMatchObject({ container: `ada:${longest}` });
    expect((await approve(base, ada, html, { bind_new: "j" })).status).toBe(302);
    expect(readOAuthFile(connectorsHome).codes?.[1]).toMatchObject({ container: "ada:j" });
    expect((await approve(base, ada, html, { bind_new: "2025" })).status).toBe(302);
    expect(readOAuthFile(connectorsHome).codes?.[2]).toMatchObject({ container: "ada:2025" });
  });

  it("the record refuses an empty binding name and carries a one-character one", () => {
    const home = mkdtempSync(join(tmpdir(), "loam-s1a-record-"));
    homes.push(home);
    const code = {
      digest: "d".repeat(64),
      clientId: CLIENT_ID,
      redirectUri: REDIRECT,
      expiresAt: 1,
      issuedAt: 1,
      generation: 1,
      user: "ada",
    };
    const file = (container: string): void =>
      writeFileSync(
        join(home, "oauth.json"),
        JSON.stringify({ ...EMPTY_OAUTH, codes: [{ ...code, container }] }),
        { mode: 0o600 },
      );
    file("a");
    expect(readOAuthFile(home).codes?.[0]?.container).toBe("a");
    file("");
    expect(() => readOAuthFile(home)).toThrow(/non-empty/);
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
      const faults: string[] = [];
      const { base, usersHome, connectorsHome, gateway } = await bareUserServer((m) =>
        faults.push(m),
      );
      const ada = await signIn(base, "ada", PASSWORD);
      const html = await consentPage(base, ada);
      chmodSync(usersHome, 0o500);
      const res = await approve(base, ada, html, { bind_new: "journal" });
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain("could not be provisioned");
      chmodSync(usersHome, 0o700);
      expect(faults.join("\n")).toContain("could not provision a signing key for ada");
      expect(text).not.toContain(usersHome);
      expect(readOAuthFile(connectorsHome).codes ?? []).toHaveLength(0);
      expect(adaNames(gateway)).toEqual([]);
      expect(existsSync(userSeedPath(usersHome, "ada"))).toBe(false);
    },
  );

  it("a seed whose grant could not land is taken back, so a retry mints afresh", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-s1a-grant-"));
    homes.push(home);
    const faults: string[] = [];
    let failures = 1;
    const ground = {
      options: { seed: OPERATOR_SEED },
      signer: seedSigner(OPERATOR_SEED),
      operatorAuthor: OPERATOR,
      reactor: new Reactor(),
      validityNow: () => 1,
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

    for (const half of [
      { options: {}, signer: undefined, operatorAuthor: OPERATOR },
      {
        options: { seed: OPERATOR_SEED },
        signer: seedSigner(OPERATOR_SEED),
        operatorAuthor: undefined,
      },
    ]) {
      const unsigned = {
        ...half,
        nextTimestamp: () => 1,
        append: (): Promise<void> => Promise.resolve(),
      } as unknown as Gateway;
      const fresh = mkdtempSync(join(tmpdir(), "loam-s1a-unsigned-"));
      homes.push(fresh);
      const refused = await ensureUserKey(unsigned, fresh, "ada", (m) => faults.push(m));
      expect("refusal" in refused ? refused.refusal : undefined).toMatchObject({ status: 503 });
      expect("refusal" in refused ? refused.refusal.message : "").toContain("cannot sign");
      expect(existsSync(userSeedPath(fresh, "ada"))).toBe(false);
    }
    expect(faults).toHaveLength(1);
  });
});
