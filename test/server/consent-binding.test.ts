// §58 S1a (T262, criterion a): the consent page binds a connection to ONE container under the
// person's home, chosen or created on the page, and provisions the home and the target in one
// act. Two levels are never bindable: the store root and the user's home container. The
// approval's code record carries the binding — user and container — so the token exchange (S1b)
// binds the connection where the person said, never store-wide.
//
// What this file deliberately does NOT assert, and which rail closes each gap:
//   - The exchange's side — the per-(client, user) key, the inbox pool, the absent store-wide
//     grant — is S1b's rail (`consent-exchange.test.ts`).
//   - The consent page's pre-§58 behaviour (redirect fence, form token, PKCE, the code's shape) —
//     the frozen phase-14 rail (`oauth-consent.test.ts`); this file drives the same door and only
//     adds the binding.
//   - The refusal when a user seed cannot be minted (an unwritable home) — named here, not staged:
//     the admin page's create-root rail owns that path and this page reuses its provisioning.
//
// Erasure standing rule: every store here is this file's own mkdtemp/memory fixture.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { userSeedPath } from "../../src/cli/config.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { EMPTY_OAUTH, readOAuthFile, writeOAuthFile } from "../../src/server/oauth-file.js";
import { AUTHORIZE_PATH } from "../../src/server/oauth.js";
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
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

/** A served store with one login user, ada, who has NO containers and NO signing seed yet. */
async function bareUserServer(): Promise<{ base: string; home: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("ada", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("ada", "actor", OPERATOR, ts++), OPERATOR_SEED)]);
  const home = mkdtempSync(join(tmpdir(), "loam-s1a-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { ada: await hashPassword(PASSWORD, CHEAP) } });
  writeOAuthFile(home, {
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
    connectors: { home, allowRedirectOrigins: [ALLOW_ORIGIN] },
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, home, gateway };
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
  binding: Record<string, string>,
): Promise<Response> {
  const fields: Record<string, string> = {
    form_token: fieldOf(html, "form_token")!,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state: "st-42",
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    ...binding,
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

describe("§58 S1a (a) — the consent page binds a container under the person's home", () => {
  it("shows the binding field, and on the first day provisions the home, the seed, and the target in one act", async () => {
    const { base, home, gateway } = await bareUserServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);

    // The page asks, in words, where this connection lives — and on day one it has nothing to
    // list yet, so it offers to create.
    expect(html).toContain("Bind this connection to");
    expect(html).toContain('name="bind_new"');
    expect(existsSync(userSeedPath(home, "ada"))).toBe(false);
    expect(gateway.containers().containers.has("ada")).toBe(false);

    const res = await approve(base, ada, html, { bind_new: "journal" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(REDIRECT);

    // One act, three facts: the home is declared, the seed is minted, the target is declared
    // under the home — exactly as the admin page's create-root would have done.
    const table = gateway.containers().containers;
    expect(table.has("ada")).toBe(true);
    expect(table.has("ada:journal")).toBe(true);
    expect(table.get("ada:journal")?.parent).toBe("ada");
    expect(existsSync(userSeedPath(home, "ada"))).toBe(true);

    // The code carries the binding: whose act, and where the connection will live. The seed is
    // in neither the code nor the page.
    const codes = readOAuthFile(home).codes ?? [];
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ clientId: CLIENT_ID, user: "ada", container: "ada:journal" });
    expect(html).not.toContain("0e0e0e");
  });

  it("lists the containers already under the person's home and binds an existing one", async () => {
    const { base, home, gateway } = await bareUserServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const first = await consentPage(base, ada);
    expect((await approve(base, ada, first, { bind_new: "journal" })).status).toBe(302);

    const second = await consentPage(base, ada);
    // The existing container is offered by name; the home itself is not an option.
    expect(second).toContain('value="ada:journal"');
    expect(second).not.toContain('value="ada"');
    const res = await approve(base, ada, second, { bind: "ada:journal" });
    expect(res.status).toBe(302);
    const codes = readOAuthFile(home).codes ?? [];
    expect(codes).toHaveLength(2);
    expect(codes[1]).toMatchObject({ user: "ada", container: "ada:journal" });
    // No second declaration: binding an existing container declares nothing new.
    expect([...gateway.containers().containers.keys()].filter((n) => n.startsWith("ada"))).toEqual([
      "ada",
      "ada:journal",
    ]);
  });

  it("refuses the two levels that are never bound — the store root and the home — and mints nothing", async () => {
    const { base, home, gateway } = await bareUserServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);

    for (const binding of [{ bind: "" }, { bind: "ada" }, { bind_new: "" }]) {
      const res = await approve(base, ada, html, binding);
      expect(res.status, JSON.stringify(binding)).toBe(400);
      const body = await res.text();
      expect(body).toMatch(/never bound|one level below|under your name/i);
      expect(body).not.toContain("Location");
    }
    // Two-sided: nothing was minted and nothing was declared for a refused binding.
    expect(readOAuthFile(home).codes ?? []).toHaveLength(0);
    expect(gateway.containers().containers.has("ada")).toBe(false);
    expect(existsSync(userSeedPath(home, "ada"))).toBe(false);
  });

  it("refuses a binding outside the person's own subtree with the uniform not-yours answer", async () => {
    const { base, home, gateway } = await bareUserServer();
    // Another user's container exists; ada must not be able to bind into it, and must learn
    // nothing about whether it exists.
    let ts = 9100;
    await gateway.append([signClaims(userClaims("bea", OPERATOR, ts++), OPERATOR_SEED)]);
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);
    const real = await approve(base, ada, html, { bind: "bea:journal" });
    const fake = await approve(base, ada, html, { bind: "zed:journal" });
    expect(real.status).toBe(fake.status);
    expect(await real.text()).toBe(await fake.text());
    expect(readOAuthFile(home).codes ?? []).toHaveLength(0);
  });

  it("a leaf name is fenced to what a path can carry", async () => {
    const { base, home } = await bareUserServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await consentPage(base, ada);
    for (const bad of ["with:colon", "has space", "../up", "x".repeat(80)]) {
      const res = await approve(base, ada, html, { bind_new: bad });
      expect(res.status, bad).toBe(400);
    }
    expect(readOAuthFile(home).codes ?? []).toHaveLength(0);
  });
});
