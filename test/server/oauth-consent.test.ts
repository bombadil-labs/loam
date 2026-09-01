// §37 phase 14 — the consent page (T135). Criteria (1)–(7) of
// .adlc/specs/37-14-the-consent-page.md, transcribed. `GET /oauth/authorize` renders a consent page
// behind a phase-5 session; its approval POST mints ONE authorization code — no seed, no token, no
// grant. Redemption is phase 15.
//
// The session half is the REAL login doors' machinery (a `serve` with `users`), reused through the
// SessionGate — so criterion 1 (a real phase-5 session) and criterion 5 (a real phase-6 form token)
// exercise the enforcing code, not a fake. Clients are registered by writing `oauth.json` directly:
// the register door is phase 13's rail, and a deterministic fixture keeps these rails about the
// consent page alone.
//
// What this file deliberately does NOT assert, and which rail closes each gap:
//   - Redemption of a code, and its single-use/expiry ENFORCEMENT — phase 15 (T136). This phase only
//     mints; criterion 6 rails the recorded deadline, not a check that reads it.
//   - The register door's own validation (name, redirect origin allowlist) — phase 13's file.

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
import { CSP, PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import {
  EMPTY_OAUTH,
  readOAuthFile,
  writeOAuthFile,
  type OAuthClient,
} from "../../src/server/oauth-file.js";
import { AUTHORIZE_PATH, CODE_TTL_MS } from "../../src/server/oauth.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

// The one origin this store permits a redirect at, and the one client it holds. A different path, an
// added query and another port on this origin are each the criterion-2 negatives.
const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = "https://app.example/cb";
const CLIENT_ID = "connector-fixed-0001";
const PLAIN_NAME = "Example Connector";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const clientRecord = (over: Partial<OAuthClient> = {}): OAuthClient => ({
  clientId: CLIENT_ID,
  clientName: PLAIN_NAME,
  redirectUris: [REDIRECT],
  registeredAt: 1,
  generation: 1,
  ...over,
});

async function consentServer(opts: {
  client?: OAuthClient | undefined; // undefined → no client registered
  monotonicNow?: () => number;
}): Promise<{ base: string; home: string; handle: ServerHandle }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);

  const home = mkdtempSync(join(tmpdir(), "loam-consent-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  if (opts.client !== undefined) {
    writeOAuthFile(home, { ...EMPTY_OAUTH, clients: [opts.client] });
  }

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: { home, allowRedirectOrigins: [ALLOW_ORIGIN] },
    users: {
      home,
      mount: "default",
      ...(opts.monotonicNow === undefined ? {} : { monotonicNow: opts.monotonicNow }),
    },
  });
  handles.push(handle);
  return { base: handle.url, home, handle };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;
const fieldOf = (html: string, name: string): string | undefined =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1];

/** Sign in as myk over the REAL login doors; returns the session cookie value. */
async function signIn(base: string): Promise<string> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!;
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie)}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token, user: "myk", password: PASSWORD }).toString(),
  });
  const sessionCookie = cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
  return valueOf(sessionCookie);
}

async function getAuthorize(
  base: string,
  query: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  const qs = new URLSearchParams(query).toString();
  return fetch(`${base}${AUTHORIZE_PATH}?${qs}`, { headers, redirect: "manual" });
}

async function postApprove(
  base: string,
  sessionId: string,
  fields: Record<string, string>,
  headers: Record<string, string> = { ...SAME_ORIGIN },
): Promise<Response> {
  return fetch(`${base}${AUTHORIZE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
}

/** Sign in, GET the consent page for the fixture client, and return the session + the page's hidden fields. */
async function readied(
  base: string,
  query: Record<string, string> = { client_id: CLIENT_ID, redirect_uri: REDIRECT, state: "st-42" },
): Promise<{
  sessionId: string;
  formToken: string;
  clientId: string;
  redirectUri: string;
  state: string;
}> {
  const sessionId = await signIn(base);
  const page = await getAuthorize(base, query, { cookie: `${SESSION_COOKIE}=${sessionId}` });
  const html = await page.text();
  expect(html).toContain("Approve a connector?");
  return {
    sessionId,
    formToken: fieldOf(html, "form_token")!,
    clientId: fieldOf(html, "client_id")!,
    redirectUri: fieldOf(html, "redirect_uri")!,
    state: fieldOf(html, "state") ?? "",
  };
}

const codeCount = (home: string): number => (readOAuthFile(home).codes ?? []).length;

describe("§37 phase 14 — the consent page", () => {
  it("(1) sits behind a phase-5 session: no session shows the login form and mints nothing", async () => {
    const { base, home } = await consentServer({ client: clientRecord() });

    // No session cookie: the login form, 200, and no code written.
    const anon = await getAuthorize(base, { client_id: CLIENT_ID, redirect_uri: REDIRECT });
    expect(anon.status).toBe(200);
    const anonBody = await anon.text();
    expect(anonBody).toContain("Sign in.");
    expect(anonBody).not.toContain("Approve a connector?");
    expect(codeCount(home)).toBe(0);

    // Positive control: a real session reaches the consent page instead.
    const sessionId = await signIn(base);
    const withSession = await getAuthorize(
      base,
      { client_id: CLIENT_ID, redirect_uri: REDIRECT },
      { cookie: `${SESSION_COOKIE}=${sessionId}` },
    );
    expect(withSession.status).toBe(200);
    const body = await withSession.text();
    expect(body).toContain("Approve a connector?");
    expect(body).not.toContain("Sign in.");
  });

  it("(2) redirect_uri must EXACTLY match a registered one — path, query and port each refuse", async () => {
    const { base } = await consentServer({ client: clientRecord() });
    const sessionId = await signIn(base);
    const get = (redirect_uri: string): Promise<Response> =>
      getAuthorize(
        base,
        { client_id: CLIENT_ID, redirect_uri },
        { cookie: `${SESSION_COOKIE}=${sessionId}` },
      );
    const isConsent = async (res: Response): Promise<boolean> =>
      res.status === 200 && (await res.text()).includes("Approve a connector?");

    // Positive control: the EXACT registered uri is accepted — without it the three negatives could
    // pass on any refusal (plan §2.2).
    expect(await isConsent(await get(REDIRECT))).toBe(true);

    // Three negatives: a different path, an added query, and another port. Each refused, none the page.
    for (const bad of [
      "https://app.example/other",
      `${REDIRECT}?a=1`,
      "https://app.example:8443/cb",
    ]) {
      const res = await get(bad);
      expect(await isConsent(res)).toBe(false);
      expect(res.status).toBe(400);
    }

    // And an unknown client_id, exact uri or not, is refused the same way.
    const unknown = await getAuthorize(
      base,
      { client_id: "connector-nope", redirect_uri: REDIRECT },
      { cookie: `${SESSION_COOKIE}=${sessionId}` },
    );
    expect(await isConsent(unknown)).toBe(false);
    expect(unknown.status).toBe(400);
  });

  it("(3) no response carries a Location off the allowlist, on EVERY refusal path", async () => {
    const { base, home } = await consentServer({ client: clientRecord() });
    const sessionId = await signIn(base);

    const refusals = [
      // no session
      await getAuthorize(base, { client_id: CLIENT_ID, redirect_uri: REDIRECT }),
      // bad redirect_uri, behind a session
      await getAuthorize(
        base,
        { client_id: CLIENT_ID, redirect_uri: "https://app.example/evil" },
        { cookie: `${SESSION_COOKIE}=${sessionId}` },
      ),
      // cross-site POST (foreign Origin)
      await postApprove(
        base,
        sessionId,
        { client_id: CLIENT_ID, redirect_uri: REDIRECT, form_token: "anything" },
        { origin: "https://evil.example" },
      ),
    ];
    for (const res of refusals) {
      expect(res.headers.get("location")).toBeNull();
    }
    expect(codeCount(home)).toBe(0);

    // Positive control: a granted approval DOES set a Location, and only to the REGISTERED uri — so
    // "no Location on refusals" is not vacuously true of a door that never redirects at all.
    const r = await readied(base);
    const ok = await postApprove(base, r.sessionId, {
      client_id: r.clientId,
      redirect_uri: r.redirectUri,
      state: r.state,
      form_token: r.formToken,
    });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")!.startsWith(`${REDIRECT}?code=`)).toBe(true);
  });

  it("(4) escapes client_name, displays the REGISTERED uri, carries the no-script CSP", async () => {
    const hostile = "<script>alert(1)</script>";
    const { base } = await consentServer({ client: clientRecord({ clientName: hostile }) });
    const sessionId = await signIn(base);
    const res = await getAuthorize(
      base,
      { client_id: CLIENT_ID, redirect_uri: REDIRECT },
      { cookie: `${SESSION_COOKIE}=${sessionId}` },
    );
    expect(res.headers.get("content-security-policy")).toBe(
      CSP.replace("form-action 'self'", `form-action 'self' ${ALLOW_ORIGIN}`),
    );
    const body = await res.text();
    // The name is escaped, never live markup.
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).not.toContain("<script");
    // The REGISTERED uri is shown.
    expect(body).toContain(REDIRECT);
  });

  it("(5) the approval carries phase-6's same-origin + form token; cross-site-shaped mints nothing", async () => {
    const { base, home } = await consentServer({ client: clientRecord() });
    const r = await readied(base);

    // Foreign Origin: refused, no code.
    const foreign = await postApprove(
      base,
      r.sessionId,
      { client_id: r.clientId, redirect_uri: r.redirectUri, form_token: r.formToken },
      { origin: "https://evil.example" },
    );
    expect(foreign.status).toBe(403);
    expect(codeCount(home)).toBe(0);

    // Same-origin but a forged form token: refused, no code.
    const forged = await postApprove(base, r.sessionId, {
      client_id: r.clientId,
      redirect_uri: r.redirectUri,
      form_token: "not-the-token",
    });
    expect(forged.status).toBe(403);
    expect(codeCount(home)).toBe(0);

    // Positive control: a valid same-origin approval with the session's own form token mints ONE code.
    const ok = await postApprove(base, r.sessionId, {
      client_id: r.clientId,
      redirect_uri: r.redirectUri,
      state: r.state,
      form_token: r.formToken,
    });
    expect(ok.status).toBe(302);
    expect(codeCount(home)).toBe(1);
  });

  it("(5b) a granted approval mints ONLY a code — no seed, no token, no grant", async () => {
    const { base, home } = await consentServer({ client: clientRecord() });
    const r = await readied(base);
    const ok = await postApprove(base, r.sessionId, {
      client_id: r.clientId,
      redirect_uri: r.redirectUri,
      form_token: r.formToken,
    });
    expect(ok.status).toBe(302);
    const file = readOAuthFile(home);
    expect((file.codes ?? []).length).toBe(1); // the code is there
    expect(file.grants).toEqual([]); // and nothing else moved
    expect(file.tokens).toEqual([]);
  });

  it("(6) a minted code binds client_id AND redirect_uri, and its deadline is monotonic", async () => {
    let clock = 0;
    const { base, home } = await consentServer({
      client: clientRecord(),
      monotonicNow: () => clock,
    });

    // Mint at clock=1000: the deadline is 1000+TTL, computed from the INJECTED clock — a door reading
    // Date.now() would record ~1.7e12 and fail this equality.
    clock = 1000;
    const first = await readied(base);
    const ok1 = await postApprove(base, first.sessionId, {
      client_id: first.clientId,
      redirect_uri: first.redirectUri,
      form_token: first.formToken,
    });
    expect(ok1.status).toBe(302);
    const afterFirst = readOAuthFile(home).codes ?? [];
    expect(afterFirst).toHaveLength(1);
    const code1 = afterFirst[0]!;
    expect(code1.clientId).toBe(CLIENT_ID);
    expect(code1.redirectUri).toBe(REDIRECT);
    expect(code1.expiresAt).toBe(1000 + CODE_TTL_MS);

    // Step the clock BACKWARD and mint again: the new code's deadline anchors to its own (earlier)
    // mint moment, so it is SMALLER — a backstep never extends a code — and the first code's recorded
    // deadline does not move.
    clock = 500;
    const second = await readied(base);
    const ok2 = await postApprove(base, second.sessionId, {
      client_id: second.clientId,
      redirect_uri: second.redirectUri,
      form_token: second.formToken,
    });
    expect(ok2.status).toBe(302);
    const codes = readOAuthFile(home).codes ?? [];
    expect(codes).toHaveLength(2);
    const stillFirst = codes.find((c) => c.digest === code1.digest)!;
    const code2 = codes.find((c) => c.digest !== code1.digest)!;
    expect(stillFirst.expiresAt).toBe(1000 + CODE_TTL_MS); // unmoved
    expect(code2.expiresAt).toBe(500 + CODE_TTL_MS);
    expect(code2.expiresAt).toBeLessThan(stillFirst.expiresAt);
  });

  it("(7) the consent copy states a grant's real power: a lawful striker over the operator's claims", async () => {
    const { base } = await consentServer({ client: clientRecord() });
    const sessionId = await signIn(base);
    const res = await getAuthorize(
      base,
      { client_id: CLIENT_ID, redirect_uri: REDIRECT },
      { cookie: `${SESSION_COOKIE}=${sessionId}` },
    );
    const body = await res.text();
    expect(body).toContain("lawful striker");
    expect(body).toContain("retract claims the operator wrote");
  });
});
