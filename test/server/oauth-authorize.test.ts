// §37 (T114), criteria (h) (i) (j) (k): the consent page, and the two fences around it.
//
// This is the door a human actually looks at, so it is the door where a lie is cheapest. Four things
// must hold at once:
//
//   (h) the redirect target is an EXACT match of one this client registered — not a prefix, not the
//       same host with another path, not the same path on another port;
//   (i) no response this door sends ever carries a Location outside the configured allowlist, on the
//       success path or any refusal path — an OAuth endpoint is the classic open redirect;
//   (j) the page shows the REGISTERED uri and escapes every piece of caller text, under a CSP that
//       permits no script;
//   (k) the approval POST carries §36's two independent signals, so a page on another origin cannot
//       submit it for the operator.
//
// ON (j)'s "registered rather than caller text": exact-match means the two strings are equal by the
// time the page renders, so no rail can separate them by comparing the shown value to the sent one.
// These rails separate them the two ways that ARE separable — the client registers TWO uris and the
// page must show the one that was asked for (not the first one stored), and the expected string is
// read back from oauth.json rather than from the request. The escaping rails carry the rest.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD, bootStore, createUser, dropHome, makeHome, signIn } from "./user-fixture.js";
import { readOAuthFile } from "../../src/server/oauth-file.js";
import {
  CLAUDE_ORIGIN,
  CLAUDE_REDIRECT,
  OTHER_ORIGIN,
  approve,
  codeFrom,
  formTokenIn,
  getAuthorize,
  paramEntries,
  pkce,
  register,
  serveOAuth,
  wellFormedAuthorize,
  type AuthorizeParams,
  type ServedOAuth,
} from "./oauth-fixture.js";

vi.setConfig({ testTimeout: 20000 });

let home: string;
let served: ServedOAuth;
let session: { cookie: string; formToken: string };

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  served = await serveOAuth(home);
  session = await signIn(served.base);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

/** Register a client and hold a well-formed authorize query for it. */
async function client(
  redirectUris?: readonly string[],
  name?: string,
): Promise<{ id: string; params: AuthorizeParams; verifier: string }> {
  const registered = await register(served.base, {
    ...(redirectUris === undefined ? {} : { redirectUris }),
    ...(name === undefined ? {} : { name }),
  });
  if (registered.status !== 201) throw new Error(`register: ${registered.status}`);
  const secret = pkce();
  return {
    id: registered.clientId,
    params: {
      ...wellFormedAuthorize(registered.clientId, secret.challenge),
      redirect_uri: redirectUris?.[0] ?? CLAUDE_REDIRECT,
    },
    verifier: secret.verifier,
  };
}

/** Every grant this store has minted — the ledger a "mints nothing" assertion has to read. */
const grantsInHome = (): number => readOAuthFile(home).grants.length;
const tokensInHome = (): number => readOAuthFile(home).tokens.length;

describe("GET /oauth/authorize — the redirect fence", () => {
  it("(h) a redirect_uri that is not an EXACT match of a registered one is refused", async () => {
    const c = await client([`${CLAUDE_ORIGIN}/api/mcp/auth_callback`]);
    for (const near of [
      `${CLAUDE_ORIGIN}/api/mcp/auth_callback/`, // one trailing slash
      `${CLAUDE_ORIGIN}/api/mcp/auth_callback?x=1`, // an added query
      `${CLAUDE_ORIGIN}/api/mcp`, // a prefix
      `${CLAUDE_ORIGIN}/api/mcp/auth_callback/../../evil`, // a traversal
      `${CLAUDE_ORIGIN}:8443/api/mcp/auth_callback`, // another port
      `${OTHER_ORIGIN}/api/mcp/auth_callback`, // another ALLOWLISTED origin
      "https://attacker.example/api/mcp/auth_callback",
    ]) {
      const asked = await getAuthorize(
        served.base,
        { ...c.params, redirect_uri: near },
        session.cookie,
      );
      expect(asked.res.status, `${near} reached consent`).toBe(400);
      expect(asked.res.headers.get("location"), `${near} redirected`).toBeNull();
    }
    expect(grantsInHome()).toBe(0);
  });

  it("(h) another allowlisted origin is not a licence: the client's OWN list is the fence", async () => {
    // The allowlist bounds what may be REGISTERED. It is not the per-client fence — two connectors on
    // the allowlist must not be able to receive each other's codes.
    const a = await client([`${CLAUDE_ORIGIN}/a`]);
    const other = await client([`${OTHER_ORIGIN}/b`]);
    const crossed = await getAuthorize(
      served.base,
      { ...a.params, redirect_uri: `${OTHER_ORIGIN}/b` },
      session.cookie,
    );
    expect(crossed.res.status).toBe(400);
    expect(other.id).not.toBe(a.id);
  });

  it("(h) an unknown client_id, and a missing one, are refused before anything else", async () => {
    const c = await client();
    for (const id of ["", "not-a-client", `${c.id}x`, c.id.toUpperCase()]) {
      const asked = await getAuthorize(served.base, { ...c.params, client_id: id }, session.cookie);
      expect(asked.res.status, `client_id "${id}" reached consent`).toBe(400);
    }
    const none = await getAuthorize(
      served.base,
      { ...c.params, client_id: undefined },
      session.cookie,
    );
    expect(none.res.status).toBe(400);
  });

  it("(h) PKCE is required, S256 only, and response_type must be code", async () => {
    const c = await client();
    const refusals: AuthorizeParams[] = [
      { ...c.params, code_challenge: undefined },
      { ...c.params, code_challenge: "" },
      { ...c.params, code_challenge_method: "plain" },
      { ...c.params, code_challenge_method: undefined },
      { ...c.params, code_challenge_method: "s256" },
      { ...c.params, response_type: "token" },
      { ...c.params, response_type: undefined },
      { ...c.params, response_type: "code token" },
    ];
    for (const params of refusals) {
      const asked = await getAuthorize(served.base, params, session.cookie);
      expect(asked.res.status, `${JSON.stringify(params)} reached consent`).toBe(400);
    }
    // and the well-formed one does reach it, so the loop above is not passing on a broken fixture
    const ok = await getAuthorize(served.base, c.params, session.cookie);
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatch(/Approve/);
  });
});

describe("GET /oauth/authorize — the consent page", () => {
  it("(j) the page shows the registered uri that was ASKED for, read back from the file", async () => {
    // Two registered uris, and the SECOND one asked for. A page that renders the first stored entry
    // would pass a one-uri rail and fail here.
    const c = await client([`${CLAUDE_ORIGIN}/first`, `${CLAUDE_ORIGIN}/second`]);
    const asked = await getAuthorize(
      served.base,
      { ...c.params, redirect_uri: `${CLAUDE_ORIGIN}/second` },
      session.cookie,
    );
    expect(asked.res.status).toBe(200);
    const stored = readOAuthFile(home).clients.find((x) => x.clientId === c.id)!;
    expect(stored.redirectUris).toEqual([`${CLAUDE_ORIGIN}/first`, `${CLAUDE_ORIGIN}/second`]);
    expect(asked.body).toContain(stored.redirectUris[1]!);
    expect(asked.body).not.toContain(stored.redirectUris[0]!);
  });

  it("(j) client_name is escaped byte for byte", async () => {
    const hostile = `<script>alert(1)</script>&"'`;
    const c = await client([CLAUDE_REDIRECT], hostile);
    const asked = await getAuthorize(served.base, c.params, session.cookie);
    expect(asked.res.status).toBe(200);
    // The five characters that matter, each in its escaped form and none in its raw one.
    expect(asked.body).not.toContain("<script>");
    expect(asked.body).not.toContain("</script>");
    expect(asked.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(asked.body).toContain("&amp;");
    expect(asked.body).toContain("&quot;");
    expect(asked.body).toContain("&#39;");
    // The name IS shown — an escaping rail passes vacuously if the page simply omits the field.
    expect(asked.body).toMatch(/alert\(1\)/);
  });

  it("(j) caller text in state and scope cannot reach the page unescaped", async () => {
    // The precise property, rather than a blocklist of scary substrings: NO caller text appears
    // verbatim. `onerror=alert(1)` is harmless once its surrounding quote and angle bracket are
    // escaped, so a rail that banned that substring would be banning the safe rendering; a rail that
    // bans the RAW STRING catches every way the escaping could fail, including one nobody listed.
    const c = await client();
    const state = `"><script>alert('state')</script>`;
    const scope = `"><img src=x onerror=alert(1)>`;
    const asked = await getAuthorize(served.base, { ...c.params, state, scope }, session.cookie);
    expect(asked.res.status).toBe(200);
    expect(asked.body).not.toContain(state);
    expect(asked.body).not.toContain(scope);
    // Neither may a PREFIX that breaks out of the attribute it sits in.
    expect(asked.body).not.toContain(`"><`);
    expect(asked.body).not.toContain("<script>");
    expect(asked.body).not.toContain("<img");
    // The STATE has to survive INTO the approval, or the redirect back loses it — so it is on the page
    // in a hidden field, escaped. That is the value this rail proves is escaped rather than absent.
    expect(asked.body).toContain("&lt;script&gt;");
    // The SCOPE is a different case, and the stronger one: §37 grants exactly one scope, so the
    // caller's scope text governs nothing and never reaches the page at all. Nothing to escape beats
    // escaping — asserted as absence, including of its escaped form.
    expect(asked.body).not.toContain("&lt;img");
    expect(asked.body).not.toContain("onerror");
  });

  it("(j) the page carries a CSP that permits no script, and no framing", async () => {
    const c = await client();
    const asked = await getAuthorize(served.base, c.params, session.cookie);
    const csp = asked.res.headers.get("content-security-policy");
    expect(csp).not.toBeNull();
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    // The page must not carry a script tag either — the header is the belt to that braces.
    expect(asked.body).not.toMatch(/<script/i);
    // No CORS on this door: it reads a cookie, so a cross-origin page must not be able to read it.
    expect(asked.res.headers.get("access-control-allow-origin")).toBeNull();
    expect(asked.res.headers.get("cache-control")).toContain("no-store");
  });

  it("(j) the page names what the connector will be able to do, in words a human reads", async () => {
    // The consent page is the one place a human decides. A page that said "approve?" and nothing else
    // would satisfy every other rail here and inform nobody.
    const c = await client([CLAUDE_REDIRECT], "Claude");
    const asked = await getAuthorize(served.base, c.params, session.cookie);
    expect(asked.body).toMatch(/read/i);
    expect(asked.body).toMatch(/write/i);
    // and it says the connector writes as ITSELF, which is the whole design
    expect(asked.body).toMatch(/its own|own name|own author/i);
  });
});

describe("POST /oauth/authorize — the approval", () => {
  it("(k) a cross-site-shaped approval is refused and mints nothing", async () => {
    const c = await client();
    const page = await getAuthorize(served.base, c.params, session.cookie);
    const formToken = formTokenIn(page.body);
    expect(formToken).not.toBe("");

    const refusals = [
      { label: "no form token", opts: { cookie: session.cookie, formToken: undefined } },
      { label: "an empty form token", opts: { cookie: session.cookie, formToken: "" } },
      { label: "a wrong form token", opts: { cookie: session.cookie, formToken: "x".repeat(43) } },
      {
        label: "a foreign Origin",
        opts: { cookie: session.cookie, formToken, origin: "https://attacker.example" },
      },
      {
        label: "no same-origin signal at all",
        opts: { cookie: session.cookie, formToken, secFetchSite: null },
      },
      {
        label: "Sec-Fetch-Site: cross-site",
        opts: { cookie: session.cookie, formToken, secFetchSite: "cross-site" },
      },
      { label: "no cookie", opts: { formToken } },
    ];
    for (const { label, opts } of refusals) {
      const res = await approve(served.base, c.params, opts);
      expect([401, 403], `${label} was accepted (${res.status})`).toContain(res.status);
      expect(codeFrom(res), `${label} yielded a code`).toBeUndefined();
      expect(res.headers.get("location"), `${label} redirected`).toBeNull();
    }
    expect(grantsInHome()).toBe(0);
    expect(tokensInHome()).toBe(0);

    // The well-formed approval DOES work, so the loop is not passing on a door that refuses everything.
    const ok = await approve(served.base, c.params, { cookie: session.cookie, formToken });
    expect(ok.status).toBe(302);
    expect(codeFrom(ok)).toMatch(/.+/);
  });

  it("(k) a foreign Origin outranks a same-origin Sec-Fetch-Site", async () => {
    // A non-browser caller writes both headers. The one naming a specific foreign page is the one to
    // believe — otherwise the weaker signal becomes the way past the stronger one.
    const c = await client();
    const page = await getAuthorize(served.base, c.params, session.cookie);
    const res = await approve(served.base, c.params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
      origin: "https://attacker.example",
      secFetchSite: "same-origin",
    });
    expect(res.status).toBe(403);
    expect(grantsInHome()).toBe(0);
  });

  it("(k) the approval re-checks the redirect fence — the GET's verdict is not a licence", async () => {
    // The consent page is a hidden-field form, and a hidden field is caller text on the way back. A
    // POST that only trusted "the GET already checked this" would take whatever the field now says.
    const c = await client([`${CLAUDE_ORIGIN}/first`]);
    const page = await getAuthorize(served.base, c.params, session.cookie);
    const formToken = formTokenIn(page.body);
    for (const swapped of [
      "https://attacker.example/cb",
      `${OTHER_ORIGIN}/first`,
      `${CLAUDE_ORIGIN}/first?x=1`,
    ]) {
      const res = await approve(
        served.base,
        { ...c.params, redirect_uri: swapped },
        { cookie: session.cookie, formToken },
      );
      expect([400, 403], `${swapped} was approved`).toContain(res.status);
      expect(res.headers.get("location"), `${swapped} redirected`).toBeNull();
    }
    expect(grantsInHome()).toBe(0);
  });

  it("(k) the approval re-checks the CLIENT and the PKCE method too", async () => {
    const c = await client();
    const other = await client([`${OTHER_ORIGIN}/x`]);
    const page = await getAuthorize(served.base, c.params, session.cookie);
    const formToken = formTokenIn(page.body);
    for (const params of [
      { ...c.params, client_id: "not-a-client" },
      { ...c.params, client_id: other.id }, // a real client, wrong redirect for it
      { ...c.params, code_challenge: undefined },
      { ...c.params, code_challenge_method: "plain" },
      { ...c.params, response_type: "token" },
    ]) {
      const res = await approve(served.base, params, { cookie: session.cookie, formToken });
      expect([400, 403], `${JSON.stringify(params)} was approved`).toContain(res.status);
      expect(codeFrom(res)).toBeUndefined();
    }
  });

  it("(k) a POST with no approval field mints nothing — silence is not consent", async () => {
    const c = await client();
    const page = await getAuthorize(served.base, c.params, session.cookie);
    const body = new URLSearchParams();
    for (const [key, value] of paramEntries(c.params)) body.set(key, value);
    body.set("form_token", formTokenIn(page.body));
    // no `approve` field at all
    const res = await fetch(`${served.base}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
        cookie: `__Host-loam_session=${session.cookie}`,
      },
      body: body.toString(),
    });
    expect(res.status).not.toBe(302);
    expect(codeFrom(res)).toBeUndefined();
    expect(grantsInHome()).toBe(0);
  });
});

describe("(i) no OAuth response is an open redirect", () => {
  it("every response's Location, if any, sits at an allowlisted origin", async () => {
    const allowed = new Set([CLAUDE_ORIGIN, OTHER_ORIGIN]);
    const c = await client();
    const page = await getAuthorize(served.base, c.params, session.cookie);
    const formToken = formTokenIn(page.body);

    // Everything this door can be asked, success and refusal alike, in one sweep.
    const responses: { label: string; res: Response }[] = [];
    const hostile = [
      "https://attacker.example/cb",
      "//attacker.example/cb",
      "/\\attacker.example",
      "https:attacker.example",
      `${CLAUDE_ORIGIN}@attacker.example/cb`,
      `${CLAUDE_ORIGIN}/cb?next=https://attacker.example`,
      "http://127.0.0.1:1/cb",
    ];
    for (const uri of hostile) {
      responses.push({
        label: `GET ${uri}`,
        res: (await getAuthorize(served.base, { ...c.params, redirect_uri: uri }, session.cookie))
          .res,
      });
      responses.push({
        label: `POST ${uri}`,
        res: await approve(
          served.base,
          { ...c.params, redirect_uri: uri },
          { cookie: session.cookie, formToken },
        ),
      });
    }
    // and the refusal shapes that are not about the uri at all
    responses.push({
      label: "no session",
      res: (await getAuthorize(served.base, c.params)).res,
    });
    responses.push({
      label: "unknown client",
      res: (await getAuthorize(served.base, { ...c.params, client_id: "nope" }, session.cookie))
        .res,
    });
    responses.push({
      label: "cross-site approval",
      res: await approve(served.base, c.params, {
        cookie: session.cookie,
        formToken,
        origin: "https://attacker.example",
      }),
    });
    responses.push({
      label: "the token endpoint",
      res: await fetch(`${served.base}/oauth/token`, { method: "POST", body: "" }),
    });
    responses.push({
      label: "registration",
      res: await fetch(`${served.base}/oauth/register`, { method: "POST", body: "{}" }),
    });

    for (const { label, res } of responses) {
      const location = res.headers.get("location");
      if (location === null) continue;
      // A relative Location is not allowed either: a browser resolves it against THIS origin, which is
      // fine, but it must never be the way a caller-supplied string reaches the header at all.
      const origin = new URL(location, served.base).origin;
      expect(allowed.has(origin), `${label} redirected to ${location}`).toBe(true);
    }
    // The success path is the one Location this door legitimately sends, and it must be there — a
    // sweep over an endpoint that never redirects at all would pass vacuously.
    const ok = await approve(served.base, c.params, { cookie: session.cookie, formToken });
    expect(ok.status).toBe(302);
    expect(new URL(ok.headers.get("location")!).origin).toBe(CLAUDE_ORIGIN);
  });

  it("the success redirect carries the state back verbatim, and nothing else of ours", async () => {
    const c = await client();
    const state = "opaque state with spaces & symbols=1";
    const params = { ...c.params, state };
    const page = await getAuthorize(served.base, params, session.cookie);
    const ok = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const location = new URL(ok.headers.get("location")!);
    expect(location.searchParams.get("state")).toBe(state);
    expect(location.searchParams.get("code")).toMatch(/.+/);
    // No secret rides the redirect: the code is the only credential, and it is single-use and bound.
    expect([...location.searchParams.keys()].sort()).toEqual(["code", "state"]);
  });
});
