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

const BROWSER = {
  "content-type": "application/x-www-form-urlencoded",
  accept: "text/html,application/xhtml+xml",
  ...SAME_ORIGIN,
} as const;

const hiddenOf = (html: string, name: string): string | undefined => {
  const raw = new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1];
  return raw
    ?.replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
};

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

    const form = await authorizeAsStranger(base, query);
    expect(form.status).toBe(200);
    expect(form.html).toContain("Sign in.");
    const continuation = hiddenOf(form.html, "continue");
    expect(
      continuation,
      "the login form rendered on the authorize path carries no continuation",
    ).toBeDefined();

    const signedIn = await submitLogin(base, {
      formToken: formTokenOf(form.html),
      nonce: form.nonce,
      continuation,
    });
    expect(signedIn.status).toBe(303);
    const location = signedIn.headers.get("location") ?? "";
    expect(location.startsWith(`${AUTHORIZE_PATH}?`)).toBe(true);
    const session = valueOf(cookiesOf(signedIn).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
    const resumed = new URLSearchParams(location.slice(location.indexOf("?") + 1));
    for (const [name, value] of new URLSearchParams(query)) {
      expect(resumed.get(name), `the resumed query dropped ${name}`).toBe(value);
    }

    const consent = await fetch(`${base}${location}`, {
      redirect: "manual",
      headers: { accept: "text/html", cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(consent.status).toBe(200);
    const consentHtml = await consent.text();
    expect(consentHtml).toContain("Approve a connector?");
    expect(consentHtml).not.toContain("Signed in.");

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
      const control = await fetch(`${base}/login`, { redirect: "manual" });
      const controlHtml = await control.text();
      const followed = await submitLogin(base, {
        formToken: formTokenOf(controlHtml),
        nonce: valueOf(cookiesOf(control).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!),
        continuation: authorizeQuery(),
      });
      expect(followed.headers.get("location")).toContain(AUTHORIZE_PATH);
      if (location !== null) {
        expect(new URL(location, "https://store.example").origin).toBe("https://store.example");
        expect(new URL(location, "https://store.example").pathname).toBe(AUTHORIZE_PATH);
        expect(location.slice(AUTHORIZE_PATH.length + 1)).not.toMatch(/[\r\n?#/]/);
        const session = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
        const resumed = await fetch(`${base}${location}`, {
          redirect: "manual",
          headers: { accept: "text/html", cookie: `${SESSION_COOKIE}=${session}` },
        });
        expect(resumed.headers.get("location")).toBeNull();
      } else {
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Signed in.");
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

  it("(d) the pre-session fence stops a continuation stapled onto another browser's sign-in", async () => {
    const { base } = await authorizeServer();
    const a = await fetch(`${base}/login`, { redirect: "manual" });
    const aHtml = await a.text();
    const aNonce = valueOf(cookiesOf(a).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
    const b = await authorizeAsStranger(base, authorizeQuery());
    const bContinuation = hiddenOf(b.html, "continue");
    expect(bContinuation).toBeDefined();

    const crossed = await submitLogin(base, {
      formToken: formTokenOf(b.html),
      nonce: aNonce,
      continuation: bContinuation,
    });
    expect(crossed.status).toBe(403);
    expect(crossed.headers.get("location")).toBeNull();
    expect(cookiesOf(crossed).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);

    const substituted = authorizeQuery({ state: "a-different-state" });
    const b2 = await authorizeAsStranger(base, authorizeQuery());
    const own = await submitLogin(base, {
      formToken: formTokenOf(b2.html),
      nonce: b2.nonce,
      continuation: substituted,
    });
    expect(own.status).toBe(303);
    const landed = own.headers.get("location")!;
    expect(new URL(landed, "https://store.example").pathname).toBe(AUTHORIZE_PATH);
    expect(new URLSearchParams(landed.slice(landed.indexOf("?") + 1)).get("state")).toBe(
      "a-different-state",
    );

    const ordinary = await submitLogin(base, { formToken: formTokenOf(aHtml), nonce: aNonce });
    expect(ordinary.status).toBe(200);
    expect(ordinary.headers.get("location")).toBeNull();
    expect(await ordinary.text()).toContain("Signed in.");
  });

  it("(g) an outsized authorize query earns no continuation, and a normal one does", async () => {
    const { base } = await authorizeServer();
    const outsized = await authorizeAsStranger(base, authorizeQuery({ state: "x".repeat(9000) }));
    expect(outsized.status).toBe(200);
    expect(outsized.html).toContain("Sign in.");
    expect(hiddenOf(outsized.html, "continue")).toBeUndefined();
    const within = await authorizeAsStranger(base, authorizeQuery({ state: "x".repeat(100) }));
    expect(hiddenOf(within.html, "continue")).toBeDefined();
  });

  it("(e1) a resumed consent still refuses a PKCE method this store cannot verify (T167)", async () => {
    const { base } = await authorizeServer();
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

  it("(e2) the consent door still refuses a form-token-less approval from a resumed session", async () => {
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
