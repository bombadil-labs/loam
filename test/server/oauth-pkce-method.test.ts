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
import { initHome } from "../../src/cli/config.js";
import { EMPTY_OAUTH, readOAuthFile, writeOAuthFile } from "../../src/server/oauth-file.js";
import { AUTHORIZE_PATH, authorizeRequestDefect } from "../../src/server/oauth.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { SAME_ORIGIN, formTokenOf, signIn as signInFixture } from "../helpers/session-fixture.js";

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const CLIENT_ID = "conn-1";
const REDIRECT = "https://app.example/callback";
const ALLOW_ORIGIN = "https://app.example";

const handles: ServerHandle[] = [];
const homes: string[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

async function authorizeServer(): Promise<{ base: string; home: string }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);
  const home = mkdtempSync(join(tmpdir(), "loam-pkce-method-"));
  homes.push(home);
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
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
  return { base: handle.url, home };
}

const codeCount = (home: string): number => (readOAuthFile(home).codes ?? []).length;

describe("T167: the omitted method beside a present challenge", () => {
  it("refuses, naming the parameter and the supported value, reflecting nothing", () => {
    const defect = authorizeRequestDefect("", "", CHALLENGE);
    expect(defect).toBeDefined();
    expect(defect).toContain("code_challenge_method");
    expect(defect).toContain("S256");
    expect(defect).toContain("plain");
    expect(defect).not.toContain(CHALLENGE);
  });

  it("an explicit S256 declaration beside the same challenge passes", () => {
    expect(authorizeRequestDefect("code", "S256", CHALLENGE)).toBeUndefined();
  });

  it("CONTROL: no challenge at all is untouched by this gate — the named remaining case", () => {
    expect(authorizeRequestDefect("", "")).toBeUndefined();
    expect(authorizeRequestDefect("code", "")).toBeUndefined();
  });

  it("the named-value refusals still outrank the omission rule, so their messages are stable", () => {
    expect(authorizeRequestDefect("token", "", CHALLENGE)).toContain("response_type");
    expect(authorizeRequestDefect("code", "plain", CHALLENGE)).toContain("when sent");
  });
});

describe("T167 at the DOORS — the object level, both gates", () => {
  it("the consent GET refuses the plain spelling with the parameter named, and the page never renders", async () => {
    const { base } = await authorizeServer();
    const sessionId = await signInFixture(base, "myk", PASSWORD);
    const qs = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-42",
      code_challenge: CHALLENGE,
    }).toString();
    const res = await fetch(`${base}${AUTHORIZE_PATH}?${qs}`, {
      headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("code_challenge_method");
    expect(body).not.toContain("Approve a connector?");
    expect(body).not.toContain(CHALLENGE);
  });

  it("a hand-built approval POST with the plain spelling refuses, and no code is minted", async () => {
    const { base, home } = await authorizeServer();
    const sessionId = await signInFixture(base, "myk", PASSWORD);
    const okQs = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-42",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    }).toString();
    const page = await fetch(`${base}${AUTHORIZE_PATH}?${okQs}`, {
      headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('name="code_challenge_method" value="S256"');

    const res = await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${sessionId}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(html),
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        state: "st-42",
        code_challenge: CHALLENGE,
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("code_challenge_method");
    expect(codeCount(home)).toBe(0);
  });
});
