// T148 (validation half) — the authorize door refuses a doomed request at the door. A caller that
// NAMES an unsupported `response_type` or `code_challenge_method` asks for a flow the token door
// can never finish; before this rail the person approved, a code minted, and the failure arrived
// at the token endpoint wearing `invalid_grant`. Now the GET (and a hand-built POST) refuses on the
// consent door's own no-Location page, naming the parameter.
//
// Two-sided, per CLAUDE.md: every doomed shape refuses at the GET with the parameter named AND
// mints nothing, and the fully-explicit correct request (`response_type=code`,
// `code_challenge_method=S256`, a real S256 challenge) still renders consent and completes the
// WHOLE flow through the token exchange — the door and the redeemer agree.
//
// What this file deliberately does NOT assert, and why:
//   - ABSENT `response_type` / `code_challenge_method` stay accepted. The frozen suites
//     (oauth-consent, oauth-token, oauth-revoke, admin-connections, referrer-policy, door-smoke)
//     all omit both, and the redeemer reads neither — absence is a working spelling.
//   - An ABSENT `code_challenge` still renders consent and still mints (the ticket's remaining
//     vacuous case): the frozen oauth-consent suite asserts exactly that behaviour, so closing it
//     needs a rail-evolution decision, not a workaround. See the T148 PR.
//   - An ABSENT `code_challenge_method` is, per RFC 7636 §4.3, a declaration of `plain`. So an
//     RFC-conformant plain client sends no method, passes this validation BY DESIGN, mints a code,
//     and still fails late at the token door wearing `invalid_grant` — the exact late failure this
//     ticket exists to remove. It is not closable here: T135's frozen `oauth-consent.test.ts`
//     sends neither parameter, so making absence refuse would break a frozen rail. Closing it
//     needs a decision about what an omitted method means to this store, plus an authorization
//     pair to evolve that rail. Tracked as T167.

import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { initHome } from "../../src/cli/config.js";
import { EMPTY_OAUTH, readOAuthFile, writeOAuthFile } from "../../src/server/oauth-file.js";
import { AUTHORIZE_PATH, authorizeRequestDefect } from "../../src/server/oauth.js";
import { SAME_ORIGIN, formTokenOf, signIn } from "../helpers/session-fixture.js";

vi.setConfig({ testTimeout: 25000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = "https://app.example/cb";
const CLIENT_ID = "connector-fixed-0001";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

/** A fresh PKCE pair: a 43-char verifier and its real S256 challenge (RFC 7636). */
const pkce = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

const fieldOf = (html: string, name: string): string =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

async function authorizeServer(): Promise<{ base: string; home: string }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);

  const home = mkdtempSync(join(tmpdir(), "loam-authz-valid-"));
  homes.push(home);
  // The token door signs the connector's write grant with <home>/operator.seed at redemption.
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

async function getAuthorize(
  base: string,
  sessionId: string,
  query: Record<string, string>,
): Promise<Response> {
  return fetch(`${base}${AUTHORIZE_PATH}?${new URLSearchParams(query)}`, {
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    redirect: "manual",
  });
}

async function postApprove(
  base: string,
  sessionId: string,
  fields: Record<string, string>,
): Promise<Response> {
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

describe("T148 — the authorize door refuses a doomed request at the door", () => {
  it("a GET naming an unsupported response_type refuses: 400 page, response_type named, no Location", async () => {
    const { base, home } = await authorizeServer();
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();
    for (const responseType of ["token", "code id_token", "CODE"]) {
      const res = await getAuthorize(base, sessionId, {
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        state: "st-1",
        code_challenge: challenge,
        response_type: responseType,
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      const body = await res.text();
      expect(body).toContain("Refused.");
      expect(body).toContain("response_type");
      expect(body).not.toContain("Approve a connector?");
    }
    expect(codeCount(home)).toBe(0);
  });

  it("a GET naming an unsupported code_challenge_method refuses the same way", async () => {
    const { base, home } = await authorizeServer();
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();
    for (const method of ["plain", "s256", "S512"]) {
      const res = await getAuthorize(base, sessionId, {
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        state: "st-1",
        code_challenge: challenge,
        code_challenge_method: method,
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      const body = await res.text();
      expect(body).toContain("Refused.");
      expect(body).toContain("code_challenge_method");
      expect(body).not.toContain("Approve a connector?");
    }
    expect(codeCount(home)).toBe(0);
  });

  it("the refusal reflects no caller text: a hostile value never rides back into the DOM", async () => {
    const { base } = await authorizeServer();
    const sessionId = await signIn(base, "myk", PASSWORD);
    const hostile = '"><script>alert(1)</script>';
    const res = await getAuthorize(base, sessionId, {
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: hostile,
    });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).not.toContain("alert(1)");
    expect(body).not.toContain("<script");
  });

  it("a hand-built POST naming an unsupported value mints nothing, even with a live session and token", async () => {
    const { base, home } = await authorizeServer();
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();
    // A REAL form token, read from the consent page the ordinary way.
    const page = await getAuthorize(base, sessionId, {
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-1",
      code_challenge: challenge,
    });
    const html = await page.text();
    expect(html).toContain("Approve a connector?");
    const formToken = formTokenOf(html);

    for (const doomed of [{ response_type: "token" }, { code_challenge_method: "plain" }]) {
      const res = await postApprove(base, sessionId, {
        form_token: formToken,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        state: "st-1",
        code_challenge: challenge,
        ...doomed,
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(codeCount(home)).toBe(0);
    }
  });

  // The POSITIVE control for the POST gate. The end-to-end approval below copies the form's hidden
  // fields, which carry NEITHER parameter, so it could not tell an inverted POST condition from a
  // correct one. This POST names both supported values explicitly and must still mint.
  it("a hand-built POST naming the SUPPORTED values still mints: the POST gate refuses only the doomed", async () => {
    const { base, home } = await authorizeServer();
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();
    const page = await getAuthorize(base, sessionId, {
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-ok",
      code_challenge: challenge,
    });
    const html = await page.text();
    const res = await postApprove(base, sessionId, {
      form_token: formTokenOf(html),
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-ok",
      code_challenge: challenge,
      response_type: "code",
      code_challenge_method: "S256",
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("code")).not.toBe("");
    expect(codeCount(home)).toBe(1);
  });

  it("the fully-explicit correct request completes the WHOLE flow: consent, code, token", async () => {
    const { base, home } = await authorizeServer();
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { verifier, challenge } = pkce();

    // The GET, with every parameter this door validates spelled out and correct.
    const page = await getAuthorize(base, sessionId, {
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-42",
      code_challenge: challenge,
      response_type: "code",
      code_challenge_method: "S256",
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Approve a connector?");

    // The approval, from the page's own hidden fields.
    const approve = await postApprove(base, sessionId, {
      form_token: formTokenOf(html),
      client_id: fieldOf(html, "client_id"),
      redirect_uri: fieldOf(html, "redirect_uri"),
      state: fieldOf(html, "state"),
      code_challenge: fieldOf(html, "code_challenge"),
    });
    expect(approve.status).toBe(302);
    const location = new URL(approve.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("st-42");
    const code = location.searchParams.get("code")!;
    expect(code).not.toBe("");
    expect(codeCount(home)).toBe(1);

    // The redemption: the code the door minted is one the token door redeems — the agreement.
    const redeemed = await fetch(`${base}/oauth/token`, {
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
    expect(redeemed.status).toBe(200);
    const token = (await redeemed.json()) as { access_token?: string; token_type?: string };
    expect(token.token_type).toBe("Bearer");
    expect(token.access_token).toBeTruthy();
  });

  it("authorizeRequestDefect: absence passes, the exact supported value passes, anything else is named", () => {
    expect(authorizeRequestDefect("", "")).toBeUndefined();
    expect(authorizeRequestDefect("code", "S256")).toBeUndefined();
    expect(authorizeRequestDefect("code", "")).toBeUndefined();
    expect(authorizeRequestDefect("", "S256")).toBeUndefined();
    expect(authorizeRequestDefect("token", "")).toContain("response_type");
    expect(authorizeRequestDefect("", "plain")).toContain("code_challenge_method");
    // response_type is judged first: a request wrong both ways names the flow before the hash.
    expect(authorizeRequestDefect("token", "plain")).toContain("response_type");
  });
});
