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

  /**
   * The witness every timing fixture here owes: was this request STILL IN FLIGHT? Without it a fixture
   * that silently completed early would leave its rail green having tested nothing.
   *
   * A FLAG, not `Promise.race`. Racing a pending promise against `Promise.resolve("still running")` looks
   * like a witness and is a constant: the already-fulfilled arm queues its callback first, every time,
   * even for a promise that settled seconds ago. This one records the fact when it happens and reads it
   * after a full macrotask drain, so a settled promise has had every chance to say so.
   */
  const inFlight = <T>(
    request: Promise<T>,
  ): { readonly running: () => boolean; wait: Promise<T> } => {
    let done = false;
    const wait = request.then((value) => {
      done = true;
      return value;
    });
    return { running: () => !done, wait };
  };
  const drained = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

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
    const holding = inFlight(slowTry("nobody-at-all", PASSWORD));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const turned = await slowTry("myk", PASSWORD);
    await drained();
    expect(holding.running(), "the held hash finished early: this proved nothing").toBe(true);
    expect(turned.status).toBe(503);
    expect((await turned.json()) as { errors: string[] }).toEqual({
      errors: [expect.stringMatching(/busy/i) as unknown as string],
    });
    expect(cookieFrom(turned)).toBeUndefined();

    // the one that held the budget was answered, not dropped — and the slot came back
    expect((await holding.wait).status).toBe(401);
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
    //
    // The two probes go out TOGETHER. Awaited one after the other, the second would arrive after the held
    // pair had finished, and the rail would compare two answers given by an empty budget — green, and
    // about nothing.
    slow = await serveHome(slowHome, { maxConcurrentHashes: 4 });
    const holding = [
      inFlight(slowTry("nobody-at-all", PASSWORD)),
      inFlight(slowTry("nor-this", PASSWORD)),
    ];
    await new Promise((resolve) => setTimeout(resolve, 100));

    const probes = Promise.all([
      slowTry("myk", "the wrong password"),
      slowTry("also-nobody", "the wrong password"),
    ]);
    // witnessed BEFORE the probes are awaited: both holders must still be occupying their slots
    await drained();
    expect(
      holding.map((h) => h.running()),
      "a held hash finished early: this proved nothing",
    ).toEqual([true, true]);

    const [known, absent] = await probes;
    expect(known.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(await known.text()).toBe(await absent.text());

    // NAMED GAP: this compares status and body, never TIME. `decoyParamsFor` is what makes the two paths
    // cost the same, and credentials-corrupt.test.ts pins that directly rather than with a stopwatch.
    await Promise.all(holding.map((h) => h.wait));
  });

  // THE LIMITER MUST HAVE NO OFF SWITCH, and "the table is full" is the shape an off switch hides in.
  // Both fillings are tested, because the first version of this fix only handled one of them: a table of
  // UNLOCKED counts evicted correctly, and a table where every record held a LIVE LOCK stopped counting
  // altogether — 4096 junk names bought fifteen minutes of no limiting for everyone else.
  it.each([
    ["unlocked counts", 1],
    ["live locks", 3],
  ])("(o) a table full of %s still tracks a new name", async (_label, missesPerFiller) => {
    served = await serveHome(home, {
      limit: { maxFailures: 3, windowMs: 600_000, lockMs: 600_000, maxTracked: 2 },
    });
    for (const name of ["filler-one", "filler-two"]) {
      for (let i = 0; i < missesPerFiller; i += 1) {
        const begun = await beginLogin(served.base);
        const res = await postLogin(served.base, name, `wrong ${i}`, {
          cookie: begun.cookie,
          formToken: begun.formToken,
        });
        expect([401, 429]).toContain(res.status);
      }
    }
    // a third name still gets counted, and still reaches its lock
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const begun = await beginLogin(served.base);
      const res = await postLogin(served.base, "myk", `wrong ${attempt}`, {
        cookie: begun.cookie,
        formToken: begun.formToken,
      });
      expect(res.status, `miss ${attempt}`).toBe(401);
    }
    const locked = await tryPassword("myk", PASSWORD);
    expect(locked.status).toBe(429);
  });

  it("(o) overlapping attempts each count: the limit is not multiplied by the concurrency", async () => {
    // A LOST UPDATE is what this pins. Read the table, await the hash, write the snapshot back, and two
    // overlapping attempts both compute the same `failures + 1` — so the effective limit becomes
    // maxFailures times however many hashes may run at once. Measured at 20 for the shipped defaults when
    // this was broken. Concurrency is the whole point: sent one at a time, a broken limiter looks fine.
    served = await serveHome(home, { maxConcurrentHashes: 4 });
    const misses = await Promise.all(
      Array.from({ length: 4 }, async (_unused, i) => {
        const begun = await beginLogin(served.base);
        return postLogin(served.base, "myk", `wrong ${i}`, {
          cookie: begun.cookie,
          formToken: begun.formToken,
        });
      }),
    );
    expect(misses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    // FOUR attempts landed, so four are counted. One more reaches five and the lock engages.
    const fifth = await missOnce("myk", 5);
    expect(fifth.status).toBe(401);
    expect((await tryPassword("myk", PASSWORD)).status).toBe(429);
  });
});
