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

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  SLOW_SCRYPT,
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

  it("(o) a damaged lock file is discarded, not adopted: the count still reaches a lock", async () => {
    // login-locks.json fails OPEN by design — it is a work budget, not an authorization surface, and a
    // local disk fault must not be a total login outage. Failing open is not the same as adopting
    // garbage, though: an entry that is not a record must be dropped, or the counter it feeds becomes
    // NaN and the door never locks at all.
    writeFileSync(
      join(home, "login-locks.json"),
      JSON.stringify({ users: { myk: "locked forever", wren: { failures: "many" } } }),
    );
    served = await serveHome(home);
    // fail-open: the garbage did not lock anyone out
    expect((await tryPassword("wren", WREN)).status).toBe(200);
    // and the real count still works, from zero
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await missOnce("myk", attempt)).status, `miss ${attempt}`).toBe(401);
    }
    expect((await missOnce("myk", 6)).status).toBe(429);
  });

  it("(o) the lock lifts when its own window passes, and the count starts over", async () => {
    // The FAILURE window stays long so machine load cannot make the two misses drift apart; only
    // the lock is short, and the sleep is twice its length.
    served = await serveHome(home, {
      limit: { maxFailures: 2, windowMs: 60_000, lockMs: 100, maxTracked: 64 },
    });
    for (let attempt = 1; attempt <= 2; attempt += 1) await missOnce("myk", attempt);
    expect((await missOnce("myk", 3)).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await tryPassword("myk", PASSWORD)).status).toBe(200);
  });
});

// The budget rails need ONE hash to outlast a round trip by orders of magnitude, and the lever is the
// user's OWN cost: `verifyPassword` derives at the parameters the entry carries, and the decoy imitates
// an existing entry rather than the door's configuration — which is what keeps an absent name and a
// present one costing the same (criterion j, again). So these rails get their own home holding a single
// user created at SLOW_SCRYPT, roughly a second a hash.
describe("the cap on unauthenticated hashing", () => {
  let slowHome: string;
  let slow: Served;

  beforeEach(async () => {
    slowHome = makeHome();
    await bootStore(slowHome);
    await createUser(slowHome, "myk", PASSWORD, { scrypt: SLOW_SCRYPT });
  });
  afterEach(async () => {
    await slow?.close();
    dropHome(slowHome);
  });

  const slowTry = async (name: string, password: string): Promise<Response> => {
    const begun = await beginLogin(slow.base);
    return postLogin(slow.base, name, password, {
      cookie: begun.cookie,
      formToken: begun.formToken,
    });
  };

  // The witness every timing fixture here owes: were the held hashes STILL RUNNING when the probe ran?
  // Without it a rail whose fixture silently completed early would pass having tested nothing.
  const stillHolding = async (held: Promise<unknown>): Promise<string> =>
    Promise.race([held.then(() => "finished"), Promise.resolve("still running")]);

  it("(q) a cap of zero refuses the RIGHT password without hashing it", async () => {
    // The strict form of the criterion, and it needs no clock: a correct password cannot answer 503 if
    // the cap were consulted after the compare — it would answer 200.
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

  it("(q) an attempt arriving while one is in flight is refused, and the first still succeeds", async () => {
    // NOT a race between equals. One hash runs for about a second, and the second attempt arrives 100ms
    // in. Six requests fired at once would need two of them to overlap a one-millisecond hash, which is
    // a coin flip dressed as a rail.
    slow = await serveHome(slowHome, { maxConcurrentHashes: 1 });
    const holding = slowTry("nobody-at-all", PASSWORD);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const turned = await slowTry("myk", PASSWORD);
    expect(await stillHolding(holding), "the held hash finished early: this proved nothing").toBe(
      "still running",
    );
    expect(turned.status).toBe(503);
    expect((await turned.json()) as { errors: string[] }).toEqual({
      errors: [expect.stringMatching(/busy/i) as unknown as string],
    });
    expect(cookieFrom(turned)).toBeUndefined();

    // the one that held the budget was answered, not dropped — and the slot came back
    expect((await holding).status).toBe(401);
    expect((await slowTry("myk", PASSWORD)).status).toBe(200);
  });

  it("(q) the refusal is BYTE-IDENTICAL for a name that exists and one that does not", async () => {
    // A budget that reserves a smaller share for unknown names is a USERNAME ORACLE: the two shares run
    // out at different times, so an existing name answers 401 while an absent one answers 503, and the
    // caller learns which names exist. That is what the decoy hash prevents, so the budget has to be ONE
    // counter both branches draw on.
    //
    // FOUR slots, TWO held. Under the global cap, and exactly AT a reserved decoy share of half — so a
    // split budget turns the absent name away with 503 while the known name goes through to its 401. One
    // counter answers both the same. The known password is WRONG on purpose: two refusals are comparable,
    // a success and a refusal are not.
    slow = await serveHome(slowHome, { maxConcurrentHashes: 4 });
    const holding = Promise.all([
      slowTry("nobody-at-all", PASSWORD),
      slowTry("nor-this", PASSWORD),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const known = await slowTry("myk", "the wrong password");
    const absent = await slowTry("also-nobody", "the wrong password");
    expect(await stillHolding(holding), "the held hashes finished early: this proved nothing").toBe(
      "still running",
    );
    expect(known.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(await known.text()).toBe(await absent.text());

    // NAMED GAP: this compares status and body, never TIME. `decoyParamsFor` is what makes the two paths
    // cost the same, and credentials-corrupt.test.ts pins that directly rather than with a stopwatch.
    await holding;
  });
});
