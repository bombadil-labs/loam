// §36 (T113), criteria (h) (i): the three POST doors refuse a cross-site-shaped request.
//
// A cookie rides along on a form POST from any page on the internet, and no preflight stands in
// the way — a form-encoded body is a simple request. So each POST door wants a same-origin signal
// AND a form token bound to the session. Belt and braces, because this is the door that guards
// every other door.
//
// "Refused" is not enough on its own, so every rail here also asserts that the SESSION DID NOT
// MOVE: a refusal that logged the caller out, or minted a token anyway, would be the bug.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  beginLogin,
  bootStore,
  cookieFrom,
  createUser,
  dropHome,
  formTokenFor,
  makeHome,
  postDoor,
  postLogin,
  serveHome,
  signIn,
  type PostOptions,
  type Served,
} from "./user-fixture.js";

vi.setConfig({ testTimeout: 20000 });

const PUBLIC_URL = "https://loam.example";

let home: string;
let served: Served;

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  served = await serveHome(home, { publicUrl: PUBLIC_URL });
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

const stillOpen = async (cookie: string): Promise<boolean> => {
  const formToken = await formTokenFor(served.base, cookie);
  return (await postDoor(served.base, "/session/token", { cookie, formToken })).status === 200;
};

// The four shapes a cross-site POST arrives in. `same-origin` is what a browser sends for the
// page's own form; anything else — or nothing at all — is not this page's form.
const CROSS_SITE: readonly (readonly [string, PostOptions])[] = [
  ["no same-origin signal at all", { secFetchSite: null }],
  ["Sec-Fetch-Site: cross-site", { secFetchSite: "cross-site" }],
  ["Sec-Fetch-Site: none (a typed URL, not this form)", { secFetchSite: "none" }],
  [
    "an Origin that is not the configured public URL",
    { secFetchSite: null, origin: "https://attacker.example" },
  ],
  // The shape that pins the PRECEDENCE. A caller writes both headers, so a foreign Origin has to be
  // refused even while Sec-Fetch-Site claims same-origin — otherwise the two checks could be reordered
  // to let the weaker one answer first, and every other case here would stay green.
  [
    "a foreign Origin alongside Sec-Fetch-Site: same-origin",
    { secFetchSite: "same-origin", origin: "https://attacker.example" },
  ],
];

describe("POST /login refuses a cross-site shape", () => {
  it.each(CROSS_SITE)("(h) %s", async (_label, shape) => {
    const begun = await beginLogin(served.base);
    const res = await postLogin(served.base, "myk", PASSWORD, {
      ...shape,
      cookie: begun.cookie,
      formToken: begun.formToken,
    });
    expect(res.status).toBe(403);
    expect(cookieFrom(res)).toBeUndefined();
    // NOTHING MOVED, read from the state that can actually move. `stillOpen` on a pre-session is false
    // in every world, so it says little on its own; the pre-session's own form token proves it was not
    // dropped, and the lock file proves the attempt was not counted against a victim.
    expect(await formTokenFor(served.base, begun.cookie)).toBe(begun.formToken);
    expect(existsSync(join(home, "login-locks.json"))).toBe(false);
    expect(await stillOpen(begun.cookie)).toBe(false);
  });

  it("(h) a cross-site POST cannot fill a victim's failure counter", async () => {
    // The refusal happens before `noteFailure`, and this is what says so: a page on another origin
    // hammering the door must not be able to lock the operator out of their own store.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const begun = await beginLogin(served.base);
      const res = await postLogin(served.base, "myk", `wrong ${attempt}`, {
        secFetchSite: "cross-site",
        cookie: begun.cookie,
        formToken: begun.formToken,
      });
      expect(res.status).toBe(403);
    }
    expect(existsSync(join(home, "login-locks.json"))).toBe(false);
    // and the operator's own login still works, which is the outcome that matters
    const begun = await beginLogin(served.base);
    const ok = await postLogin(served.base, "myk", PASSWORD, {
      origin: PUBLIC_URL,
      secFetchSite: null,
      cookie: begun.cookie,
      formToken: begun.formToken,
    });
    expect(ok.status).toBe(200);
  });

  it("(h) the configured public URL as Origin is accepted with no Sec-Fetch-Site at all", async () => {
    const begun = await beginLogin(served.base);
    const res = await postLogin(served.base, "myk", PASSWORD, {
      secFetchSite: null,
      origin: PUBLIC_URL,
      cookie: begun.cookie,
      formToken: begun.formToken,
    });
    expect(res.status).toBe(200);
  });

  it("(h) a foreign Host header cannot make a foreign Origin look like home", async () => {
    const begun = await beginLogin(served.base);
    const res = await postLogin(served.base, "myk", PASSWORD, {
      secFetchSite: null,
      origin: "https://attacker.example",
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
      cookie: begun.cookie,
      formToken: begun.formToken,
    });
    expect(res.status).toBe(403);
    expect(await stillOpen(begun.cookie)).toBe(false);
  });

  it("(i) a wrong or absent form token is refused, and creates no session", async () => {
    for (const formToken of [undefined, "", "not-the-token", "a".repeat(43)]) {
      const begun = await beginLogin(served.base);
      const res = await postLogin(served.base, "myk", PASSWORD, {
        cookie: begun.cookie,
        formToken,
      });
      expect(res.status, String(formToken)).toBe(403);
      expect(cookieFrom(res), String(formToken)).toBeUndefined();
      expect(await stillOpen(begun.cookie)).toBe(false);
    }
  });

  it("(i) one session's form token does not open another SIGNED-IN session's door", async () => {
    // Both sessions are AUTHENTICATED on purpose. Pairing a signed-in token with a pre-session cookie
    // would be refused for want of a session, before the token was ever compared — so the rail would
    // pass even if every session shared one process-wide form token.
    const mine = await signIn(served.base, "myk", PASSWORD);
    const theirs = await signIn(served.base, "myk", PASSWORD);
    expect(theirs.formToken).not.toBe(mine.formToken);

    const res = await postDoor(served.base, "/session/token", {
      cookie: theirs.cookie,
      formToken: mine.formToken,
    });
    expect(res.status).toBe(403);
    // and each session still opens its OWN door
    expect(await stillOpen(theirs.cookie)).toBe(true);
    expect(await stillOpen(mine.cookie)).toBe(true);
  });
});

describe("POST /logout and POST /session/token refuse a cross-site shape", () => {
  it.each(CROSS_SITE)("(h) /logout, %s", async (_label, shape) => {
    const session = await signIn(served.base);
    const res = await postDoor(served.base, "/logout", {
      ...shape,
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(res.status).toBe(403);
    expect(await stillOpen(session.cookie)).toBe(true); // the refusal did not log anyone out
  });

  it.each(CROSS_SITE)("(h) /session/token, %s", async (_label, shape) => {
    const session = await signIn(served.base);
    const res = await postDoor(served.base, "/session/token", {
      ...shape,
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/"token"/);
    expect(await stillOpen(session.cookie)).toBe(true);
  });

  it("(i) /logout and /session/token refuse a wrong or absent form token", async () => {
    const session = await signIn(served.base);
    for (const path of ["/logout", "/session/token"]) {
      for (const formToken of [undefined, "", "not-the-token"]) {
        const res = await postDoor(served.base, path, { cookie: session.cookie, formToken });
        expect(res.status, `${path} ${String(formToken)}`).toBe(403);
      }
    }
    expect(await stillOpen(session.cookie)).toBe(true);
  });

  it("(h) GET /login is not gated — a browser must be able to reach the form", async () => {
    const res = await fetch(`${served.base}/login`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(200);
  });
});

// With NO --public-url the store's own address is the one it bound, and a browser typed at
// `http://localhost:<port>` sends that spelling of it. An exact compare against `127.0.0.1` would
// refuse the operator's own form on the commonest path there is, so the loopback spellings on the same
// port count as this store — and nothing else does.
// The not-yet-signed-in half of a login holds no server state: the cookie is a nonce, and the form token
// is an HMAC of that nonce under a key minted at boot. That is what stops `GET /login` from being a way
// to fill a table. It only works if the HMAC is unforgeable and BOUND to the cookie presented.
describe("the stateless form token", () => {
  it("(i) a cookie of the caller's own choosing needs the matching HMAC, which only this store can make", async () => {
    const mine = "a-nonce-i-chose-myself-0123456789";
    // no form token at all, and a plausible-looking one: both refused
    for (const formToken of [undefined, "", mine, Buffer.from(mine).toString("base64url")]) {
      const res = await postLogin(served.base, "myk", PASSWORD, { cookie: mine, formToken });
      expect(res.status, String(formToken)).toBe(403);
      expect(cookieFrom(res), String(formToken)).toBeUndefined();
    }
    // the store's own answer for that same cookie DOES open it — so the refusals above are the HMAC's
    // work, not the cookie's shape
    const issued = await formTokenFor(served.base, mine);
    expect(issued).not.toBe("");
    const ok = await postLogin(served.base, "myk", PASSWORD, {
      cookie: mine,
      formToken: issued,
      origin: PUBLIC_URL,
      secFetchSite: null,
    });
    expect(ok.status).toBe(200);
    // and signing in replaced the caller's chosen value: a planted cookie is never a live session id
    expect(cookieFrom(ok)).toBeDefined();
    expect(cookieFrom(ok)).not.toBe(mine);
  });

  it("(i) a token issued for ONE cookie does not open another", async () => {
    const first = "the-first-nonce-000000000000000000";
    const second = "the-second-nonce-11111111111111111";
    const issued = await formTokenFor(served.base, first);
    const res = await postLogin(served.base, "myk", PASSWORD, {
      cookie: second,
      formToken: issued,
    });
    expect(res.status).toBe(403);
  });

  it("(i) GET /login allocates nothing: a thousand of them leave the door open", async () => {
    // The failure this replaces: a table entry per page load meant a flood could evict the seat a real
    // login needed a moment later. `maxSessions: 1` makes that failure loud if it ever comes back.
    await served.close();
    served = await serveHome(home, { publicUrl: PUBLIC_URL, maxSessions: 1 });
    for (let i = 0; i < 1000; i += 1) await fetch(`${served.base}/login`);
    const begun = await beginLogin(served.base);
    const res = await postLogin(served.base, "myk", PASSWORD, {
      cookie: begun.cookie,
      formToken: begun.formToken,
    });
    expect(res.status).toBe(200);
  });
});

// `maxSessions` bounds SIGNED-IN sessions, and every one of them cost a correct password. The bound is
// real, so it earns a rail — and so does the sweep that lets a seat come back.
describe("how many sessions a store will hold", () => {
  it("refuses a new sign-in when every seat is taken, and frees one when it lapses", async () => {
    let ticks = 0;
    await served.close();
    served = await serveHome(home, {
      publicUrl: PUBLIC_URL,
      maxSessions: 1,
      idleMs: 1000,
      monotonicNow: () => ticks,
    });
    const first = await beginLogin(served.base);
    expect(
      (
        await postLogin(served.base, "myk", PASSWORD, {
          cookie: first.cookie,
          formToken: first.formToken,
        })
      ).status,
    ).toBe(200);

    const second = await beginLogin(served.base);
    const full = await postLogin(served.base, "myk", PASSWORD, {
      cookie: second.cookie,
      formToken: second.formToken,
    });
    expect(full.status).toBe(503);
    expect((await full.json()) as { errors: string[] }).toEqual({
      errors: [expect.stringMatching(/sessions it can/i) as unknown as string],
    });
    expect(cookieFrom(full)).toBeUndefined();

    // the seat comes back when the first session's idle window passes
    ticks += 1001;
    const third = await beginLogin(served.base);
    expect(
      (
        await postLogin(served.base, "myk", PASSWORD, {
          cookie: third.cookie,
          formToken: third.formToken,
        })
      ).status,
    ).toBe(200);
  });
});

describe("the default public URL knows its own loopback spellings", () => {
  it("(h) accepts localhost and 127.0.0.1 on the bound port, and no other host", async () => {
    await served.close();
    served = await serveHome(home); // no publicUrl: it defaults to the bound http://127.0.0.1:<port>
    const port = new URL(served.base).port;
    for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
      const begun = await beginLogin(served.base);
      const res = await postLogin(served.base, "myk", PASSWORD, {
        secFetchSite: null,
        origin,
        cookie: begun.cookie,
        formToken: begun.formToken,
      });
      expect(res.status, origin).toBe(200);
    }
    // a different PORT on loopback is a different store, and a foreign host is a foreign host
    for (const origin of [`http://127.0.0.1:${Number(port) + 1}`, "http://evil.example"]) {
      const begun = await beginLogin(served.base);
      const res = await postLogin(served.base, "myk", PASSWORD, {
        secFetchSite: null,
        origin,
        cookie: begun.cookie,
        formToken: begun.formToken,
      });
      expect(res.status, origin).toBe(403);
    }
  });
});
