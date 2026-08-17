// T148 item 1 — the dropped continuation. An unauthenticated `GET /oauth/authorize` renders the
// login form, and before this ticket a successful sign-in landed on the plain "Signed in." page:
// the authorize request (client_id, redirect_uri, state, code_challenge) was gone, no consent page
// was ever rendered, no code was ever minted, and the connector received nothing.
//
// THE STORY RAIL IS THE POINT (a). It drives the whole act with real requests against a real
// server, following each response by hand the way a browser does: authorize → login form → sign in
// → consent page → approve → the redirect carrying a code. Nothing is hand-built. No fixture
// composes a continuation for the door; every value comes off the previous response's bytes.
//
// THE SECOND HALF IS THE FENCE (c). A continuation is a QUERY, never a destination: the login door
// re-attaches allowlisted authorize parameters to this store's OWN path literal. An open redirect
// here would be a credential-phishing gift — a victim signs in to a real Loam store and is bounced
// to an attacker's page — so each named shape is asserted separately, not as one class.
//
// What this file deliberately does NOT assert, and which rail closes each gap:
//   - The consent page's own criteria (the striker warning, the exact-match fence's full negative
//     set, the code record's shape) — test/server/oauth-consent.test.ts (T135), frozen.
//   - `authorizeRequestDefect`'s full table — test/server/oauth-authorize-validation.test.ts and
//     test/server/oauth-pkce-method.test.ts (T167). Rail (e) asserts only that a RESUMED consent
//     runs the same gate a direct one runs.
//   - Redemption of the minted code — phase 15's file.
//   - The EXACT byte at which an outsized continuation stops being read. (g) proves the ceiling
//     exists and refuses; nothing depends on the precise number, so no rail pins it.

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
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { EMPTY_OAUTH, writeOAuthFile, type OAuthClient } from "../../src/server/oauth-file.js";
import { AUTHORIZE_PATH } from "../../src/server/oauth.js";
import { cookiesOf, formTokenOf, valueOf, SAME_ORIGIN } from "../helpers/session-fixture.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = "https://app.example/cb";
const CLIENT_ID = "connector-fixed-0001";

// A real PKCE challenge: 43 characters of the unreserved set, as RFC 7636 requires.
const CHALLENGE = "a".repeat(43);

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const CLIENT: OAuthClient = {
  clientId: CLIENT_ID,
  clientName: "Example Connector",
  redirectUris: [REDIRECT],
  registeredAt: 1,
  generation: 1,
};

async function authorizeServer(): Promise<{ base: string; home: string }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);

  const home = mkdtempSync(join(tmpdir(), "loam-continuation-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  writeOAuthFile(home, { ...EMPTY_OAUTH, clients: [CLIENT] });

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

/** The authorize query a well-formed connector sends. */
const authorizeQuery = (over: Record<string, string> = {}): string =>
  new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state: "opaque-state-value",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    ...over,
  }).toString();

/** A browser's own headers on a form navigation — what the login door reads to frame a refusal. */
const BROWSER = {
  "content-type": "application/x-www-form-urlencoded",
  accept: "text/html,application/xhtml+xml",
  ...SAME_ORIGIN,
} as const;

/**
 * A hidden field's value as a BROWSER would read it — the attribute is HTML-escaped on the page, so
 * the entities are decoded here. Submitting the escaped text instead would test a caller no browser
 * can be, and would hide a continuation that never survives its own round trip.
 */
const hiddenOf = (html: string, name: string): string | undefined => {
  const raw = new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1];
  return raw
    ?.replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
};

/**
 * The login form a person is shown when an authorize request finds no session — the FIRST leg of the
 * story, returned whole so each later leg reads its values off these bytes rather than composing
 * them.
 */
async function authorizeAsStranger(
  base: string,
  query: string,
): Promise<{ status: number; html: string; nonce: string }> {
  const res = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
    redirect: "manual",
    headers: { accept: "text/html" },
  });
  const nonceHeader = cookiesOf(res).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`));
  return {
    status: res.status,
    html: await res.text(),
    nonce: nonceHeader === undefined ? "" : valueOf(nonceHeader),
  };
}

/** POST the login form's own fields back, carrying whatever continuation it rendered. */
async function submitLogin(
  base: string,
  fields: { formToken: string; nonce: string; continuation?: string | undefined },
  password = PASSWORD,
): Promise<Response> {
  const body: Record<string, string> = {
    form_token: fields.formToken,
    user: "myk",
    password,
  };
  if (fields.continuation !== undefined) body["continue"] = fields.continuation;
  return fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { ...BROWSER, cookie: `${PRESESSION_COOKIE}=${fields.nonce}` },
    body: new URLSearchParams(body).toString(),
  });
}

describe("the authorize door's continuation (T148 item 1)", () => {
  it("(a) carries a stranger from authorize, through sign-in, to consent, to a minted code", async () => {
    const { base } = await authorizeServer();
    const query = authorizeQuery();

    // Leg 1 — the connector sends a person here, and this store has never seen them.
    const form = await authorizeAsStranger(base, query);
    expect(form.status).toBe(200);
    expect(form.html).toContain("Sign in.");
    const continuation = hiddenOf(form.html, "continue");
    expect(
      continuation,
      "the login form rendered on the authorize path carries no continuation",
    ).toBeDefined();

    // Leg 2 — the password is correct, and the answer must SEND THEM BACK, not congratulate them.
    const signedIn = await submitLogin(base, {
      formToken: formTokenOf(form.html),
      nonce: form.nonce,
      continuation,
    });
    expect(signedIn.status).toBe(303);
    const location = signedIn.headers.get("location") ?? "";
    expect(location.startsWith(`${AUTHORIZE_PATH}?`)).toBe(true);
    const session = valueOf(cookiesOf(signedIn).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
    // Every authorize parameter the connector sent survives the round trip.
    const resumed = new URLSearchParams(location.slice(location.indexOf("?") + 1));
    for (const [name, value] of new URLSearchParams(query)) {
      expect(resumed.get(name), `the resumed query dropped ${name}`).toBe(value);
    }

    // Leg 3 — following it lands on the CONSENT page, not /admin and not a success page.
    const consent = await fetch(`${base}${location}`, {
      redirect: "manual",
      headers: { accept: "text/html", cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(consent.status).toBe(200);
    const consentHtml = await consent.text();
    expect(consentHtml).toContain("Approve a connector?");
    expect(consentHtml).not.toContain("Signed in.");

    // Leg 4 — approving mints a code, and the redirect carries it to the registered address.
    const approve = await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      redirect: "manual",
      headers: { ...BROWSER, cookie: `${SESSION_COOKIE}=${session}` },
      body: new URLSearchParams({
        form_token: formTokenOf(consentHtml),
        client_id: hiddenOf(consentHtml, "client_id")!,
        redirect_uri: hiddenOf(consentHtml, "redirect_uri")!,
        state: hiddenOf(consentHtml, "state")!,
        code_challenge: hiddenOf(consentHtml, "code_challenge")!,
        code_challenge_method: hiddenOf(consentHtml, "code_challenge_method")!,
      }).toString(),
    });
    expect(approve.status).toBe(302);
    const back = new URL(approve.headers.get("location")!);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(back.searchParams.get("state")).toBe("opaque-state-value");
  });

  it("(b) leaves the ordinary sign-in exactly where it lands today", async () => {
    const { base } = await authorizeServer();
    const form = await fetch(`${base}/login`, { redirect: "manual" });
    const html = await form.text();
    // The ordinary form carries NO continuation to round-trip — the field is the authorize path's.
    expect(hiddenOf(html, "continue")).toBeUndefined();

    const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
    const res = await submitLogin(base, { formToken: formTokenOf(html), nonce });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.text();
    expect(body).toContain("Signed in.");
    expect(body).toContain('<a href="/admin">');
    expect(cookiesOf(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  });

  // THE FENCE. Each shape is asserted on its own: a continuation may reach this store's own
  // authorize path and nowhere else, whatever text a caller puts in the field.
  const FOREIGN: readonly (readonly [string, string])[] = [
    ["another origin", "https://evil.example/steal"],
    ["scheme-relative", "//evil.example"],
    ["an encoded scheme-relative", "/%2f%2fevil.example"],
    ["an encoded traversal", "..%2f..%2fevil.example"],
    ["a nested absolute url", `https://evil.example/x?client_id=${CLIENT_ID}`],
    ["a continuation naming its own path", `${AUTHORIZE_PATH}@evil.example?client_id=x`],
    ["a header injection", "client_id=a%0d%0aLocation:%20https://evil.example"],
    ["a fragment escape", "client_id=a#https://evil.example"],
  ];

  for (const [shape, hostile] of FOREIGN) {
    it(`(c) refuses to follow a continuation naming ${shape}`, async () => {
      const { base } = await authorizeServer();
      const form = await fetch(`${base}/login`, { redirect: "manual" });
      const html = await form.text();
      const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
      const res = await submitLogin(base, {
        formToken: formTokenOf(html),
        nonce,
        continuation: hostile,
      });
      const location = res.headers.get("location");
      // THE POSITIVE CONTROL. A "must not follow" assertion is green when nothing follows
      // anything, so this same door is asked to follow a WELL-FORMED continuation in the same
      // test: delete the feature and the fence goes red instead of passing vacuously (H10).
      const control = await fetch(`${base}/login`, { redirect: "manual" });
      const controlHtml = await control.text();
      const followed = await submitLogin(base, {
        formToken: formTokenOf(controlHtml),
        nonce: valueOf(cookiesOf(control).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!),
        continuation: authorizeQuery(),
      });
      expect(followed.headers.get("location")).toContain(AUTHORIZE_PATH);
      // Either the door refused the continuation outright (no Location at all), or it resumed —
      // and a resume is ALWAYS this store's own authorize path, resolved against a foreign base to
      // prove it cannot be read as an absolute or scheme-relative url.
      if (location !== null) {
        // Resolved against a FOREIGN base, so an absolute or scheme-relative continuation would
        // show as a different origin here rather than hiding behind this server's own address.
        expect(new URL(location, "https://store.example").origin).toBe("https://store.example");
        expect(new URL(location, "https://store.example").pathname).toBe(AUTHORIZE_PATH);
        // Hostile text that survives inside a PARAMETER VALUE is encoded, never structural: no raw
        // delimiter, no CR or LF, so it can neither escape the query nor split the header.
        expect(location.slice(AUTHORIZE_PATH.length + 1)).not.toMatch(/[\r\n?#/]/);
        // And following it lands on this store's own refusal, never a redirect onward.
        const session = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
        const resumed = await fetch(`${base}${location}`, {
          redirect: "manual",
          headers: { accept: "text/html", cookie: `${SESSION_COOKIE}=${session}` },
        });
        expect(resumed.headers.get("location")).toBeNull();
      }
    });
  }

  it("(c2) a continuation naming a foreign redirect_uri resumes, and the exact-match fence refuses it", async () => {
    const { base } = await authorizeServer();
    const form = await fetch(`${base}/login`, { redirect: "manual" });
    const html = await form.text();
    const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
    const res = await submitLogin(base, {
      formToken: formTokenOf(html),
      nonce,
      continuation: authorizeQuery({ redirect_uri: "https://evil.example/cb" }),
    });
    const location = res.headers.get("location")!;
    expect(new URL(location, "https://store.example").pathname).toBe(AUTHORIZE_PATH);
    const session = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
    const resumed = await fetch(`${base}${location}`, {
      redirect: "manual",
      headers: { accept: "text/html", cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(resumed.status).toBe(400);
    expect(resumed.headers.get("location")).toBeNull();
    expect(await resumed.text()).not.toContain("evil.example");
  });

  it("(d) a continuation cannot move a different browser's landing", async () => {
    const { base } = await authorizeServer();
    // Browser A opens the ordinary login form and holds its own pre-session nonce.
    const a = await fetch(`${base}/login`, { redirect: "manual" });
    const aHtml = await a.text();
    const aNonce = valueOf(cookiesOf(a).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
    // Browser B opens the authorize path and holds a DIFFERENT one, with a continuation.
    const b = await authorizeAsStranger(base, authorizeQuery());
    const bContinuation = hiddenOf(b.html, "continue");
    expect(bContinuation).toBeDefined();

    // B's continuation, submitted against A's pre-session, is refused: the form token is bound to
    // the nonce cookie, so nobody can staple a destination onto another browser's sign-in.
    const crossed = await submitLogin(base, {
      formToken: formTokenOf(b.html),
      nonce: aNonce,
      continuation: bContinuation,
    });
    expect(crossed.status).toBe(403);
    expect(crossed.headers.get("location")).toBeNull();
    expect(cookiesOf(crossed).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    // And A's own sign-in still lands where an ordinary sign-in lands.
    const ordinary = await submitLogin(base, { formToken: formTokenOf(aHtml), nonce: aNonce });
    expect(ordinary.status).toBe(200);
    expect(ordinary.headers.get("location")).toBeNull();
    expect(await ordinary.text()).toContain("Signed in.");
  });

  it("(g) an outsized authorize query earns no continuation at all", async () => {
    const { base } = await authorizeServer();
    // Far past the ceiling continuation.ts holds. The form still renders — a person may always
    // sign in — but it carries nothing, so the door never resumes a query it refused to read.
    const form = await authorizeAsStranger(base, authorizeQuery({ state: "x".repeat(9000) }));
    expect(form.status).toBe(200);
    expect(form.html).toContain("Sign in.");
    expect(hiddenOf(form.html, "continue")).toBeUndefined();
  });

  it("(e1) a resumed consent still refuses a PKCE method this store cannot verify (T167)", async () => {
    const { base } = await authorizeServer();
    // The doomed request: a challenge with no method, which RFC 7636 reads as `plain`.
    const query = authorizeQuery({ code_challenge_method: "" });
    const form = await authorizeAsStranger(base, query);
    const res = await submitLogin(base, {
      formToken: formTokenOf(form.html),
      nonce: form.nonce,
      continuation: hiddenOf(form.html, "continue"),
    });
    const location = res.headers.get("location")!;
    const session = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
    const resumed = await fetch(`${base}${location}`, {
      redirect: "manual",
      headers: { accept: "text/html", cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(resumed.status).toBe(400);
    expect(resumed.headers.get("location")).toBeNull();
    expect(await resumed.text()).toContain("code_challenge_method");
  });

  it("(e2) a resumed consent still refuses an approval with no form token", async () => {
    const { base } = await authorizeServer();
    const form = await authorizeAsStranger(base, authorizeQuery());
    const res = await submitLogin(base, {
      formToken: formTokenOf(form.html),
      nonce: form.nonce,
      continuation: hiddenOf(form.html, "continue"),
    });
    expect(res.headers.get("location")).toContain(AUTHORIZE_PATH);
    const session = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
    const approve = await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      redirect: "manual",
      headers: { ...BROWSER, cookie: `${SESSION_COOKIE}=${session}` },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        state: "opaque-state-value",
        code_challenge: CHALLENGE,
        code_challenge_method: "S256",
      }).toString(),
    });
    expect(approve.status).toBe(403);
    expect(approve.headers.get("location")).toBeNull();
  });

  it("(f) a wrong password on the authorize path re-renders the form with its continuation intact", async () => {
    const { base } = await authorizeServer();
    const form = await authorizeAsStranger(base, authorizeQuery());
    const refused = await submitLogin(
      base,
      {
        formToken: formTokenOf(form.html),
        nonce: form.nonce,
        continuation: hiddenOf(form.html, "continue"),
      },
      "wrong horse",
    );
    expect(refused.status).toBe(401);
    expect(refused.headers.get("location")).toBeNull();
    const html = await refused.text();
    expect(html).toContain("Sign in.");
    expect(hiddenOf(form.html, "continue")).toBeDefined();
    expect(hiddenOf(html, "continue")).toBe(hiddenOf(form.html, "continue"));
  });
});
