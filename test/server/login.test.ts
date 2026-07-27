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
  type Served,
} from "./user-fixture.js";

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
      cookie: first.cookie,
      formToken: first.formToken,
    });
    expect(res.status).toBe(200);
    const second = cookieFrom(res);
    expect(second).toBeDefined();
    expect(second).not.toBe(first.cookie);
    expect(await stillOpen(served.base, second!)).toBe(true);
    expect(await stillOpen(served.base, first.cookie)).toBe(false);
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
    // and logging out again finds no session to end
    expect(
      (await postDoor(served.base, "/logout", { cookie: session.cookie, formToken: "anything" }))
        .status,
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
