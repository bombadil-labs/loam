// §36 (T113), criteria (h) (i): the three POST doors refuse a cross-site-shaped request.
//
// A cookie rides along on a form POST from any page on the internet, and no preflight stands in
// the way — a form-encoded body is a simple request. So each POST door wants a same-origin signal
// AND a form token bound to the session. Belt and braces, because this is the door that guards
// every other door.
//
// "Refused" is not enough on its own, so every rail here also asserts that the SESSION DID NOT
// MOVE: a refusal that logged the caller out, or minted a token anyway, would be the bug.

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
    // no session state moved: the pre-session is still a pre-session
    expect(await stillOpen(begun.cookie)).toBe(false);
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

  it("(i) one session's form token does not open another session's door", async () => {
    const mine = await signIn(served.base);
    const other = await beginLogin(served.base);
    const res = await postDoor(served.base, "/session/token", {
      cookie: other.cookie,
      formToken: mine.formToken,
    });
    expect(res.status).not.toBe(200);
    expect(await stillOpen(mine.cookie)).toBe(true); // mine is untouched
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
