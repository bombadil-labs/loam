// §36 (T113), criteria (d) (e) (k) (l) (m) (n) (r): the login door and the session it opens.
//
// A session is server memory behind an opaque cookie. Every rail here is about the COOKIE and the
// session's lifetime — never about what the cookie may open, which session-doors.test.ts owns.
//
// The cookie's attribute string is pinned BYTE FOR BYTE and asserted again under three shapes of
// caller-controlled forwarding header, because the whole reason the public URL is configured is
// that Host and X-Forwarded-* are the caller's to write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGIN_REFUSED_BODY,
  PASSWORD,
  SESSION_COOKIE,
  beginLogin,
  bootStore,
  cookieAttributes,
  cookieFrom,
  createUser,
  dropHome,
  formTokenFor,
  makeHome,
  postDoor,
  postLogin,
  serveHome,
  signIn,
  testIo,
  type Served,
} from "./user-fixture.js";
import { run } from "../../src/cli/cli.js";
import { type ServerHandle } from "../../src/server/http.js";

vi.setConfig({ testTimeout: 20000 });

let home: string;
let served: Served;

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

// Does this cookie still open a door? /session/token is the cheapest live session probe.
const stillOpen = async (base: string, cookie: string): Promise<boolean> => {
  const formToken = await formTokenFor(base, cookie);
  const res = await postDoor(base, "/session/token", { cookie, formToken });
  return res.status === 200;
};

describe("POST /login", () => {
  it("(d) the right password sets exactly one cookie with a pinned attribute string", async () => {
    served = await serveHome(home);
    const begun = await beginLogin(served.base);
    const res = await postLogin(served.base, "myk", PASSWORD, {
      cookie: begun.cookie,
      formToken: begun.formToken,
    });
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(cookieAttributes(res)).toBe("HttpOnly; Secure; SameSite=Lax; Path=/");
    expect(res.headers.getSetCookie().join(" ")).not.toMatch(/Domain/i);
    // EXACTLY one, as the title says: the reader helpers both take the first match, so a second
    // Set-Cookie for the same name — with weaker attributes — would be invisible to every rail here.
    expect(
      res.headers.getSetCookie().filter((c) => c.startsWith(`${SESSION_COOKIE}=`)),
    ).toHaveLength(1);
  });

  it("(d) a wrong password answers 401 and sets no cookie at all", async () => {
    served = await serveHome(home);
    const begun = await beginLogin(served.base);
    const res = await postLogin(served.base, "myk", "not the password", {
      cookie: begun.cookie,
      formToken: begun.formToken,
    });
    expect(res.status).toBe(401);
    // the LOGIN door's own refusal, not the refusal an unresolvable mount name gives — a rail that
    // accepted either would pass on a store with no login door at all
    expect(await res.text()).toBe(LOGIN_REFUSED_BODY);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    // and the pre-session it arrived with is still just a pre-session: it opens nothing
    expect(await stillOpen(served.base, begun.cookie)).toBe(false);
  });

  it("(d) an unknown user answers the SAME status and body as a wrong password", async () => {
    served = await serveHome(home);
    const wrong = await beginLogin(served.base);
    const wrongRes = await postLogin(served.base, "myk", "not the password", {
      cookie: wrong.cookie,
      formToken: wrong.formToken,
    });
    const absent = await beginLogin(served.base);
    const absentRes = await postLogin(served.base, "nobody", PASSWORD, {
      cookie: absent.cookie,
      formToken: absent.formToken,
    });
    expect(absentRes.status).toBe(wrongRes.status);
    const body = await absentRes.text();
    expect(body).toBe(await wrongRes.text());
    expect(body).toBe(LOGIN_REFUSED_BODY); // and it is the login door answering, not a missing mount
  });

  it("(e) the attribute string is byte-identical under any forwarding header the caller writes", async () => {
    served = await serveHome(home, { publicUrl: "https://loam.example" });
    const shapes: Record<string, string>[] = [
      {},
      { "x-forwarded-proto": "https" },
      { "x-forwarded-proto": "http", "x-forwarded-host": "attacker.example" },
      { host: "attacker.example" },
    ];
    const seen = new Set<string>();
    for (const headers of shapes) {
      const begun = await beginLogin(served.base);
      const res = await postLogin(served.base, "myk", PASSWORD, {
        cookie: begun.cookie,
        formToken: begun.formToken,
        origin: "https://loam.example",
        headers,
      });
      expect(res.status).toBe(200);
      seen.add(cookieAttributes(res) ?? "MISSING");
    }
    expect([...seen]).toEqual(["HttpOnly; Secure; SameSite=Lax; Path=/"]);
  });

  it("(l) logging in over a live session mints a different id and kills the old one", async () => {
    served = await serveHome(home);
    const first = await signIn(served.base);
    expect(await stillOpen(served.base, first.cookie)).toBe(true);

    const res = await postLogin(served.base, "myk", PASSWORD, {
      sessionCookie: first.cookie,
      formToken: first.formToken,
    });
    expect(res.status).toBe(200);
    const second = cookieFrom(res);
    expect(second).toBeDefined();
    expect(second).not.toBe(first.cookie);
    expect(await stillOpen(served.base, second!)).toBe(true);
    expect(await stillOpen(served.base, first.cookie)).toBe(false);
  });

  // THE ATTACK THIS CLOSES: any page on the internet fetches GET /login with credentials. SameSite=Lax
  // withholds the cookie on a cross-site subresource request, so the door sees no session and mints a
  // fresh pre-session nonce. Written into the SAME cookie name, that nonce lands on top of the live
  // session id and signs the operator out — and the orphaned session keeps its idle window with no
  // cookie left to reach it, so the tokens it minted can no longer be revoked by signing out.
  //
  // Two-sided: the session survives the cross-site GET, and GET /login still does its own job — it
  // hands an anonymous visitor a usable nonce.
  it("(l) a cross-site GET /login cannot overwrite a live session", async () => {
    served = await serveHome(home);
    const session = await signIn(served.base);
    const token = await postDoor(served.base, "/session/token", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(token.status).toBe(200);

    // the shape a cross-site subresource request has: no cookie reaches the server at all
    const drive = await fetch(`${served.base}/login`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(drive.status).toBe(200);
    // whatever it set, it did NOT set the session cookie
    expect(drive.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(
      false,
    );
    // and the session it could not see is still open, still minting
    expect(await stillOpen(served.base, session.cookie)).toBe(true);
    // the other side: an anonymous visitor still gets a nonce that works
    const begun = await beginLogin(served.base);
    expect(begun.cookie).not.toBe("");
    expect(
      (
        await postLogin(served.base, "myk", PASSWORD, {
          cookie: begun.cookie,
          formToken: begun.formToken,
        })
      ).status,
    ).toBe(200);
  });

  it("(r) the login page permits no script", async () => {
    served = await serveHome(home);
    const res = await fetch(`${served.base}/login`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/script-src 'none'/);
    // the page itself carries no script either — a CSP is a belt, not a licence
    const body = await res.text();
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/\son[a-z]+=/i);
  });
});

describe("POST /logout", () => {
  it("(k) ends the session: the same cookie opens nothing afterwards", async () => {
    served = await serveHome(home);
    const session = await signIn(served.base);
    expect(await stillOpen(served.base, session.cookie)).toBe(true);

    const res = await postDoor(served.base, "/logout", {
      cookie: session.cookie,
      formToken: session.formToken,
    });
    expect(res.status).toBe(200);
    expect(await stillOpen(served.base, session.cookie)).toBe(false);
    // logging out again: a WRONG form token is not this page's form (403), and the right stateless one
    // reaches the door and finds no session to end (401). Both refusals, and each for its own reason.
    expect(
      (await postDoor(served.base, "/logout", { cookie: session.cookie, formToken: "anything" }))
        .status,
    ).toBe(403);
    const stale = await formTokenFor(served.base, session.cookie);
    expect(
      (
        await postDoor(served.base, "/logout", {
          preCookie: session.cookie,
          formToken: stale,
        })
      ).status,
    ).toBe(401);
  });
});

describe("a session's lifetime", () => {
  it("(m) expires on an idle window, and a wall-clock step backwards does not extend it", async () => {
    // A session's clock is MONOTONIC on purpose: Date.now() is settable, and a store whose clock
    // slips backwards must not resurrect a session that already timed out.
    let ticks = 0;
    served = await serveHome(home, { idleMs: 1000, monotonicNow: () => ticks });
    const session = await signIn(served.base);
    expect(await stillOpen(served.base, session.cookie)).toBe(true);

    ticks += 1001;
    expect(await stillOpen(served.base, session.cookie)).toBe(false);

    // now shove the wall clock a day into the past. The session stays dead.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() - 24 * 3600 * 1000));
      expect(await stillOpen(served.base, session.cookie)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(m) the SHIPPED clock is monotonic too, with no clock injected at all", async () => {
    // The rail above drives an injected clock, which proves the expiry LOGIC and says nothing about the
    // default. This one injects nothing: it lets the real monotonic source run, then moves Date.now()
    // a day into the past. Only `Date` is faked — faking `performance` would freeze the very clock
    // under test. An implementation reading Date.now() revives the session here and fails.
    served = await serveHome(home, { idleMs: 1000 });
    const session = await signIn(served.base);
    expect(await stillOpen(served.base, session.cookie)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() - 24 * 3600 * 1000));
      expect(await stillOpen(served.base, session.cookie)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(m) activity inside the window keeps the session alive", async () => {
    let ticks = 0;
    served = await serveHome(home, { idleMs: 1000, monotonicNow: () => ticks });
    const session = await signIn(served.base);
    for (let step = 0; step < 4; step += 1) {
      ticks += 900;
      expect(await stillOpen(served.base, session.cookie)).toBe(true);
    }
    expect(ticks).toBeGreaterThan(1000); // past the window in total, alive by activity
  });

  it("(n) a restart invalidates every cookie", async () => {
    served = await serveHome(home);
    const session = await signIn(served.base);
    expect(await stillOpen(served.base, session.cookie)).toBe(true);

    await served.close();
    served = await serveHome(home);
    expect(await stillOpen(served.base, session.cookie)).toBe(false);
    // the door still works — the cookie died, not the login
    expect(await stillOpen(served.base, (await signIn(served.base)).cookie)).toBe(true);
  });
});

// Everything above serves through `serve()` directly. This one goes through `loam serve`, because
// the wiring between them is its own promise: a home that HAS users opens the login doors, and
// --public-url is the address the Origin check reads. A mutation probe found nothing else pinning
// either — the flag could be deleted from serve's allowlist and every rail above stayed green.
describe("loam serve wires the login doors", () => {
  it("opens /login for a home with users, and reads --public-url for the Origin check", async () => {
    const io = testIo();
    const handle = (await run(
      [
        "serve",
        "--http",
        "--port",
        "0",
        "--token",
        "op-token",
        "--home",
        home,
        "--public-url",
        "https://loam.example",
      ],
      io.io,
      { detach: true },
    )) as ServerHandle;
    try {
      expect(io.out.join("\n")).toMatch(/login at https:\/\/loam\.example\/login/);
      const begun = await beginLogin(handle.url);
      expect(begun.res.status).toBe(200);
      expect(begun.formToken).not.toBe("");

      // the configured origin opens the door
      const good = await postLogin(handle.url, "myk", PASSWORD, {
        secFetchSite: null,
        origin: "https://loam.example",
        cookie: begun.cookie,
        formToken: begun.formToken,
      });
      expect(good.status).toBe(200);

      // a foreign one does not, however the Host header is dressed
      const again = await beginLogin(handle.url);
      const bad = await postLogin(handle.url, "myk", PASSWORD, {
        secFetchSite: null,
        origin: "https://attacker.example",
        headers: { host: "loam.example" },
        cookie: again.cookie,
        formToken: again.formToken,
      });
      expect(bad.status).toBe(403);
    } finally {
      await handle.close();
    }
  });

  it("leaves the doors shut for a home with no users at all", async () => {
    const bare = makeHome();
    const io = testIo();
    const handle = (await run(
      ["serve", "--http", "--port", "0", "--token", "op-token", "--home", bare],
      io.io,
      { detach: true },
    )) as ServerHandle;
    try {
      expect(io.out.join("\n")).not.toMatch(/login/);
      // /login is just an unresolvable mount name again, with the refusal one always gave
      const res = await fetch(`${handle.url}/login`);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(
        JSON.stringify({ errors: ["a bearer token is required, and this one opens nothing"] }),
      );
    } finally {
      await handle.close();
      dropHome(bare);
    }
  });
});
