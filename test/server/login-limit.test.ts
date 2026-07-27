// §36 (T113), criteria (o) (p) (q): the failed-login limiter, and the cap on unpaid work.
//
// The limiter keys on the USERNAME, never on a caller-supplied source. Behind a proxy every request
// arrives from 127.0.0.1 and X-Forwarded-For is the caller's to write, so a per-source limiter is a
// remote off-switch for the operator's own login. Keying on the username moves the off-switch to a
// place only the box can reach: `loam user unlock`.
//
// The second half is a different budget. scrypt is expensive ON PURPOSE, which makes an
// unauthenticated login a lever on the server's CPU. So the door caps concurrent hashing globally,
// and refuses past the cap WITHOUT hashing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  beginLogin,
  bootStore,
  cookieFrom,
  createUser,
  dropHome,
  makeHome,
  postLogin,
  serveHome,
  testIo,
  type Served,
} from "./user-fixture.js";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 30000 });

const WREN = "a wholly different password";

let home: string;
let served: Served;

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  await createUser(home, "wren", WREN, { operator: false });
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

// One wrong password for `name`, from a fresh forged source each time.
const missOnce = async (name: string, attempt: number): Promise<Response> => {
  const begun = await beginLogin(served.base);
  return postLogin(served.base, name, `wrong ${attempt}`, {
    cookie: begun.cookie,
    formToken: begun.formToken,
    headers: { "x-forwarded-for": `203.0.113.${attempt}`, "x-real-ip": `198.51.100.${attempt}` },
  });
};

const tryPassword = async (name: string, password: string): Promise<Response> => {
  const begun = await beginLogin(served.base);
  return postLogin(served.base, name, password, {
    cookie: begun.cookie,
    formToken: begun.formToken,
  });
};

describe("the failed-login limiter", () => {
  it("(o) locks the USERNAME after five misses, and a forged source does not reset the count", async () => {
    served = await serveHome(home);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await missOnce("myk", attempt)).status, `miss ${attempt}`).toBe(401);
    }
    const sixth = await missOnce("myk", 6);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);

    // the lock is myk's, not the door's: wren still gets in with the right password
    const wren = await tryPassword("wren", WREN);
    expect(wren.status).toBe(200);
    expect(cookieFrom(wren)).toBeDefined();

    // and myk's own CORRECT password is refused while the lock holds — the lock outranks the hash
    const locked = await tryPassword("myk", PASSWORD);
    expect(locked.status).toBe(429);
    expect(cookieFrom(locked)).toBeUndefined();
  });

  it("(o) an unknown username locks like any other — the limiter is no oracle", async () => {
    served = await serveHome(home);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await missOnce("nobody", attempt)).status).toBe(401);
    }
    expect((await missOnce("nobody", 6)).status).toBe(429);
    // and locking `nobody` did not lock `myk`
    expect((await tryPassword("myk", PASSWORD)).status).toBe(200);
  });

  it("(p) `loam user unlock` clears the lock from the box", async () => {
    served = await serveHome(home);
    for (let attempt = 1; attempt <= 6; attempt += 1) await missOnce("myk", attempt);
    expect((await tryPassword("myk", PASSWORD)).status).toBe(429);

    const io = testIo();
    expect(await run(["user", "unlock", "myk", "--home", home], io.io)).toBe(0);
    expect(io.out.join("\n")).toMatch(/myk/);

    expect((await tryPassword("myk", PASSWORD)).status).toBe(200);
  });

  it("(p) unlock refuses a name the home has no user for, and unlocks nobody by accident", async () => {
    served = await serveHome(home);
    for (let attempt = 1; attempt <= 6; attempt += 1) await missOnce("myk", attempt);
    const io = testIo();
    expect(await run(["user", "unlock", "stranger", "--home", home], io.io)).toBe(2);
    expect((await tryPassword("myk", PASSWORD)).status).toBe(429); // myk is still locked
  });

  it("(o) the lock lifts when its own window passes, and the count starts over", async () => {
    // The FAILURE window stays long so machine load cannot make the two misses drift apart; only
    // the lock is short, and the sleep is twice its length.
    served = await serveHome(home, { limit: { maxFailures: 2, windowMs: 60_000, lockMs: 100 } });
    for (let attempt = 1; attempt <= 2; attempt += 1) await missOnce("myk", attempt);
    expect((await missOnce("myk", 3)).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await tryPassword("myk", PASSWORD)).status).toBe(200);
  });
});

describe("the cap on unauthenticated hashing", () => {
  it("(q) a cap of zero refuses the RIGHT password without hashing it", async () => {
    // The strict form of the criterion, and it needs no clock: a correct password cannot answer
    // 503 if the cap were consulted after the compare — it would answer 200.
    served = await serveHome(home, { maxConcurrentHashes: 0 });
    const res = await tryPassword("myk", PASSWORD);
    expect(res.status).toBe(503);
    expect((await res.json()) as { errors: string[] }).toEqual({
      errors: [expect.stringMatching(/login/i) as unknown as string],
    });
    expect(cookieFrom(res)).toBeUndefined();
    // a refusal for want of budget is not a failed attempt: it must not fill the limiter either
    for (let attempt = 0; attempt < 8; attempt += 1) await tryPassword("myk", PASSWORD);
    await served.close();
    served = await serveHome(home);
    expect((await tryPassword("myk", PASSWORD)).status).toBe(200);
  });

  it("(q) concurrent attempts past the cap are refused while one is in flight", async () => {
    served = await serveHome(home, { maxConcurrentHashes: 1 });
    const flight = await Promise.all(Array.from({ length: 6 }, () => tryPassword("myk", PASSWORD)));
    const statuses = flight.map((r) => r.status);
    expect(statuses).toContain(503);
    expect(statuses).toContain(200);
    expect(statuses.filter((s) => s === 200).length).toBeLessThan(6);
  });
});
