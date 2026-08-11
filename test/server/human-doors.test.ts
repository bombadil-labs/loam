// T146 — the human doors answer humans in HTML, and JSON callers keep their exact bytes.
//
// The discriminator under test: a POST is a BROWSER FORM SUBMISSION when its content-type is
// form-urlencoded AND its Accept asks for text/html — what real Chrome sends on a form
// navigation. Every frozen rail and API caller sends fetch's default accept, so the frozen JSON
// shapes are pinned by files this one must not touch (login-door.test.ts, login-csrf.test.ts,
// referrer-policy.test.ts); the byte-exact expectations in (b) here are HAND-WRITTEN copies of
// those shapes (H10), so a drift in either frame goes red in THIS file, beside the HTML rail
// it must stay in step with.
//
// What this file deliberately does not assert: the real browser walk (wrong password, then
// right, then the signed-in → admin → sign-out link-walk) lives in test/browser/human-doors.test.ts,
// where real Chrome sends the real headers. This file proves the seam; that one proves a person
// can use it. And the 503 refusals (busy door, unreachable ground) are not exercised in the HTML
// frame: they ride the same refuseDoor seam (a) pins, and building a vanished-mount or held-hash
// fixture here would duplicate login-door.test.ts (q)/(s) for no new seam coverage — the frame
// rail that would close it fully is a browser story against a broken store.

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
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { SAME_ORIGIN, cookiesOf, formTokenOf, valueOf } from "../helpers/session-fixture.js";

vi.setConfig({ testTimeout: 20_000 }); // real listening servers

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

/** What a real browser's form navigation asks for; fetch's default is star-slash-star. */
const BROWSER_ACCEPT = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
} as const;

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

async function doorServer(
  doorOptions: Record<string, unknown> = {},
): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  for (const [name, roles] of [
    ["myk", ["operator"]],
    ["ada", ["actor"]],
    ["norole", []],
  ] as const) {
    await gateway.append([signClaims(userClaims(name, OPERATOR, ts++), OPERATOR_SEED)]);
    for (const role of roles) {
      await gateway.append([signClaims(roleClaims(name, role, OPERATOR, ts++), OPERATOR_SEED)]);
    }
  }
  const home = mkdtempSync(join(tmpdir(), "loam-human-doors-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { myk: hash, ada: hash, norole: hash } });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default", ...doorOptions },
  });
  handles.push(handle);
  return { base: handle.url, gateway };
}

/** A fresh stateless pre-session: nonce cookie value + the form token minted for it. */
async function formPair(base: string): Promise<{ token: string; nonce: string }> {
  const form = await fetch(`${base}/login`);
  const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
  return { token: formTokenOf(await form.text()), nonce };
}

function postLogin(
  base: string,
  fields: Record<string, string>,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${base}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Sign in and keep both halves a page needs: the session cookie and its own form token. */
async function signInFull(
  base: string,
  user: string,
): Promise<{ sessionId: string; formToken: string }> {
  const pair = await formPair(base);
  const res = await postLogin(
    base,
    { form_token: pair.token, user, password: PASSWORD },
    { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN },
  );
  expect(res.status).toBe(200);
  const session = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
  return { sessionId: session, formToken: formTokenOf(await res.text()) };
}

describe("T146 — a browser form POST is answered in HTML", () => {
  it("(a) a wrong password gets the sign-in page back: refusal inline, user kept, and the form it carries WORKS", async () => {
    const { base } = await doorServer();
    const pair = await formPair(base);
    const refused = await postLogin(
      base,
      { form_token: pair.token, user: "myk", password: "not it" },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN, ...BROWSER_ACCEPT },
    );
    expect(refused.status).toBe(401);
    expect(refused.headers.get("content-type")).toContain("text/html");
    expect(refused.headers.get("referrer-policy")).toBe("same-origin");
    expect(cookiesOf(refused)).toEqual([]); // a refusal sets nothing
    const body = await refused.text();
    // The one-refusal sentence, exactly the JSON's — and the form, intact, user preserved.
    expect(body).toContain("the login was refused");
    expect(body).toContain('action="/login"');
    expect(body).toContain('name="user" value="myk"');
    // The token the refusal page carries is honest: the retry with the right password succeeds.
    const retry = await postLogin(
      base,
      { form_token: formTokenOf(body), user: "myk", password: PASSWORD },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN, ...BROWSER_ACCEPT },
    );
    expect(retry.status).toBe(200);
    expect(await retry.text()).toContain("Signed in");
  });

  it("(b) the JSON caller's bytes did not move — hand-written, byte-exact", async () => {
    const { base } = await doorServer();
    // The identical wrong-password POST, minus the browser Accept: the frozen JSON shape.
    const pair = await formPair(base);
    const refused = await postLogin(
      base,
      { form_token: pair.token, user: "myk", password: "not it" },
      { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN },
    );
    expect(refused.status).toBe(401);
    expect(refused.headers.get("content-type")).toContain("application/json");
    expect(refused.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await refused.text()).toBe('{"errors":["the login was refused"]}');
    // The provenance refusal, JSON frame.
    const cross = await postLogin(base, { user: "myk", password: PASSWORD }, {});
    expect(cross.status).toBe(403);
    expect(await cross.text()).toBe(
      '{"errors":["this request did not come from this store\'s own page, so it is refused — ' +
        'reload the page and try again"]}',
    );
    // The orphan logout, JSON frame.
    const orphan = await fetch(`${base}/logout`, { method: "POST", headers: SAME_ORIGIN });
    expect(orphan.status).toBe(401);
    expect(await orphan.text()).toBe('{"errors":["no live session is presented here"]}');
    // An application/json Accept is a JSON caller too, whatever the content-type says.
    const jsonAccept = await postLogin(
      base,
      { user: "myk", password: PASSWORD },
      { accept: "application/json" },
    );
    expect(jsonAccept.headers.get("content-type")).toContain("application/json");
    // And a browser Accept WITHOUT the form content-type is a JSON caller too — both conjuncts
    // of the discriminator are load-bearing, so each is pinned alone.
    const htmlAcceptOnly = await fetch(`${base}/login`, {
      method: "POST",
      headers: { "content-type": "application/json", ...BROWSER_ACCEPT },
      body: JSON.stringify({ user: "myk", password: PASSWORD }),
    });
    expect(htmlAcceptOnly.status).toBe(403);
    expect(htmlAcceptOnly.headers.get("content-type")).toContain("application/json");
    // A caller that merely TOLERATES html behind its preferred JSON is a JSON caller: text/html
    // must be the accept's first media range, the shape every browser form navigation sends.
    const tolerated = await postLogin(
      base,
      { user: "myk", password: PASSWORD },
      { accept: "application/json, text/html;q=0.1" },
    );
    expect(tolerated.headers.get("content-type")).toContain("application/json");
  });

  it("(c) one refusal in the HTML frame too: three causes, identical but for the echo of what the caller typed", async () => {
    const { base } = await doorServer();
    const pair = await formPair(base);
    const attempt = (user: string, password: string): Promise<Response> =>
      postLogin(
        base,
        { form_token: pair.token, user, password },
        { cookie: `${PRESESSION_COOKIE}=${pair.nonce}`, ...SAME_ORIGIN, ...BROWSER_ACCEPT },
      );
    const wrongPassword = await attempt("myk", "not it");
    const unknownName = await attempt("ghost", "anything");
    const roleless = await attempt("norole", PASSWORD);
    expect(wrongPassword.status).toBe(401);
    expect(unknownName.status).toBe(401);
    expect(roleless.status).toBe(401);
    // The page may echo the name its own caller just typed; it may say nothing else that
    // differs. Strip that echo and the three bodies must be byte-identical — no oracle.
    const withoutEcho = (html: string): string =>
      html.replace(/name="user" value="[^"]*"/, 'name="user"');
    const bodies = await Promise.all([wrongPassword.text(), unknownName.text(), roleless.text()]);
    expect(bodies[0]).toContain('name="user" value="myk"');
    expect(withoutEcho(bodies[1])).toBe(withoutEcho(bodies[0]));
    expect(withoutEcho(bodies[2])).toBe(withoutEcho(bodies[0]));
  });

  it("(d) a browser's provenance refusal names the cure and still carries a usable form", async () => {
    const { base } = await doorServer();
    const pair = await formPair(base);
    const refused = await postLogin(
      base,
      { form_token: pair.token, user: "myk", password: PASSWORD },
      {
        cookie: `${PRESESSION_COOKIE}=${pair.nonce}`,
        "sec-fetch-site": "cross-site",
        ...BROWSER_ACCEPT,
      },
    );
    expect(refused.status).toBe(403);
    expect(refused.headers.get("content-type")).toContain("text/html");
    expect(cookiesOf(refused)).toEqual([]);
    const body = await refused.text();
    expect(body.toLowerCase()).toContain("reload");
    expect(body).toContain('action="/login"'); // the nonce was presented, so the form re-renders
  });

  it("(e) a browser's orphan logout lands on a page that offers the way in", async () => {
    const { base } = await doorServer();
    const orphan = await fetch(`${base}/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...SAME_ORIGIN,
        ...BROWSER_ACCEPT,
      },
      body: "",
    });
    expect(orphan.status).toBe(401);
    expect(orphan.headers.get("content-type")).toContain("text/html");
    const body = await orphan.text();
    expect(body).toContain("no live session is presented here");
    // No cookie was presented, so no honest form token exists — the page links instead.
    expect(body).toContain('href="/login"');
  });

  it("(h) an HTML-frame refusal slides no idle window — the salvage renders through peek, never touch", async () => {
    // The frozen no-slide rail (login-csrf (b2)) never enters the HTML frame, and the HTML
    // refusal is the one new path that reads the session row on its way to a refusal. If the
    // salvage ever read it through `touch`, refused browser traffic would keep a victim's
    // session alive forever. Same clock fixture as (b2), driven through the browser frame.
    let clock = 0;
    const { base } = await doorServer({ idleMs: 1000, monotonicNow: () => clock });
    const myk = await signInFull(base, "myk");
    const sessionCookie = { cookie: `${SESSION_COOKIE}=${myk.sessionId}` };
    clock = 900;
    // Clears the guard (session token binds), is refused on its merits, and renders the HTML
    // salvage — the assertion on content-type proves the refusal path under test actually ran.
    const refused = await postLogin(
      base,
      { form_token: myk.formToken, user: "myk", password: "not it" },
      { ...sessionCookie, ...SAME_ORIGIN, ...BROWSER_ACCEPT },
    );
    expect(refused.status).toBe(401);
    expect(refused.headers.get("content-type")).toContain("text/html");
    // Past the ORIGINAL window: a slid session would still answer Signed in here.
    clock = 1500;
    const after = await fetch(`${base}/login`, { headers: sessionCookie });
    expect(await after.text()).not.toContain("Signed in");
    // The control: a session ADMITTED at 900 does slide to 1900 (two-sided, in this fixture).
    clock = 0;
    const second = await signInFull(base, "myk");
    const secondCookie = { cookie: `${SESSION_COOKIE}=${second.sessionId}` };
    clock = 900;
    expect(await (await fetch(`${base}/login`, { headers: secondCookie })).text()).toContain(
      "Signed in",
    );
    clock = 1500;
    expect(await (await fetch(`${base}/login`, { headers: secondCookie })).text()).toContain(
      "Signed in",
    );
  });
});

describe("T146 — the pages link each other", () => {
  it("(f) signed-in names /admin; the admin pages carry the sign-out form; an admin refusal links the ways out", async () => {
    const { base } = await doorServer();
    const myk = await signInFull(base, "myk");
    const signedIn = await fetch(`${base}/login`, {
      headers: { cookie: `${SESSION_COOKIE}=${myk.sessionId}` },
    });
    expect(await signedIn.text()).toContain('href="/admin"');

    // ada has no container yet: the create-offer page still carries the sign-out form.
    const ada = await signInFull(base, "ada");
    const adaCookie = { cookie: `${SESSION_COOKIE}=${ada.sessionId}` };
    const offer = await fetch(`${base}/admin`, { headers: adaCookie });
    // The whole form, markup and all — a garbled button or close tag is a form a person
    // cannot use, so the assertions pin the exact markup (a mutation probe survived less).
    const offerHtml = await offer.text();
    expect(offerHtml).toContain('<form method="post" action="/logout">');
    expect(offerHtml).toContain('<button type="submit">sign out</button>\n</form>');

    // With a root, the dashboard carries it too.
    await fetch(`${base}/admin/create-root`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...SAME_ORIGIN,
        ...adaCookie,
      },
      body: new URLSearchParams({ form_token: ada.formToken }).toString(),
    });
    const dashboard = await fetch(`${base}/admin`, { headers: adaCookie });
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain('<form method="post" action="/logout">');
    expect(dashboardHtml).toContain('<button type="submit">sign out</button>\n</form>');

    // A refusal page is no longer a dead end.
    const refused = await fetch(
      `${base}/admin/container?name=${encodeURIComponent("somebody-else")}`,
      { headers: adaCookie },
    );
    expect(refused.status).toBe(403);
    const refusal = await refused.text();
    expect(refusal).toContain("<h1>Refused.</h1>");
    expect(refusal).toContain('<a href="/login">Go to the sign-in page.</a>');
    expect(refusal).toContain('<a href="/admin">Back to your containers.</a>');
  });

  it("(g) the declare form invites exactly the shape the door accepts — and the invited completion lands", async () => {
    const { base, gateway } = await doorServer();
    const ada = await signInFull(base, "ada");
    const adaCookie = { cookie: `${SESSION_COOKIE}=${ada.sessionId}` };
    await fetch(`${base}/admin/create-root`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...SAME_ORIGIN,
        ...adaCookie,
      },
      body: new URLSearchParams({ form_token: ada.formToken }).toString(),
    });
    const dashboard = await (await fetch(`${base}/admin`, { headers: adaCookie })).text();
    // The invited shape is the door's own precondition, pre-filled: the name input opens with
    // `ada:` already typed, so completing it cannot produce a name the door refuses for shape.
    expect(dashboard).toContain('<input name="name" value="ada:">');
    // Two-sided: the completion of exactly that invitation is accepted.
    const declared = await fetch(`${base}/admin/declare`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...SAME_ORIGIN,
        ...adaCookie,
      },
      body: new URLSearchParams({
        form_token: ada.formToken,
        name: "ada:notes",
        parent: "ada",
        posture: "separate",
      }).toString(),
    });
    expect(declared.status).toBe(303);
    expect(gateway.containers().containers.has("ada:notes")).toBe(true);
  });
});
