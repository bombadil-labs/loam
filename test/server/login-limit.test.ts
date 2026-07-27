// §36 (T113/T116), criteria (o) (o1)–(o8) (p) (q): the failed-login DELAY, and the cap on unpaid work.
//
// THE LOGIN DOOR DELAYS; IT NEVER LOCKS. A correct password is admitted however many failures came
// before it. A wrong one makes the next attempt for that name wait longer, up to a cap. A lock is an
// off switch a stranger can pull — anyone who knows a username could shut the operator out of their
// own store — so there is no lock, no expiry to wait out, and nothing scarce for a flood to steer.
//
// The limiter keys on the USERNAME, never on a caller-supplied source. Behind a proxy every request
// arrives from 127.0.0.1 and X-Forwarded-For is the caller's to write, so a per-source limiter is a
// remote lever on the operator's own login. Keying on the username puts the only lever that clears a
// record where only the box can reach it: `loam user unlock`.
//
// WHAT THESE RAILS ASSERT, both sides of the same promise: guessing costs time that grows, AND a
// correct password is never refused. Every timing assertion is a LOWER bound except where an upper
// bound is the property under test, because a loaded machine can only make a wait longer — so the
// rails cannot flake upward, and an absent delay answers in milliseconds, which is the whole signal.
// Where an upper bound is unavoidable it sits at least twenty times over the real cost.
//
// WHAT THEY DELIBERATELY DO NOT ASSERT — six gaps, and this list is meant to be complete:
//
//  1. That a flood against one name cannot make this door refuse another name. It CAN. What is pinned
//     is narrower and the difference matters: an attempt spends no hash budget WHILE IT WAITS, so
//     another name gets in during the wait. The waits then elapse together, the flood spends the whole
//     hash budget at once, and a name arriving in THAT window gets 503 — which session.ts calls out as
//     login being deliberately degradable, and which the far-side rail below asserts directly.
//     A waiting attempt also pins one connection for the length of its wait. Nothing caps how many may
//     wait at once, and no cap is safe: refusing past one is the lockout again.
//  2. ANY GUESS RATE. Waits do not serialize, so a caller with many connections has them elapse
//     together and their rate is the concurrent-hash cap's, not `maxDelayMs`'s. The rails below fix
//     the wait a SERIAL attempt pays; read none of them as attempts per second.
//  3. Two servers over one home. Every write replaces the file whole, so they are last-writer-wins
//     on the count. One home, one server is the supported posture.
//  4. WHAT THE LIMITER DOES WHEN ITS FILE IS BROKEN, beyond the answer not moving. The fail-open rails
//     prove 401 stays 401 and a correct password is still admitted; they do not characterise the state,
//     and the state splits three ways rather than two:
//       - the file cannot be READ and the PATH CAN BE REPLACED (damaged bytes, no `users` table, mode
//         0000, a dangling symlink): every name waits zero, and it lasts exactly ONE failed login —
//         the next one writes a new table over the damage, which self-repairs and DISCARDS every record
//         nobody could read. The discriminator is the path, not the home: a writable home is not enough.
//       - the PATH CANNOT BE REPLACED (a directory at it): `renameSync` answers EISDIR however writable
//         the home is, so every name waits zero until an operator clears the path. That is the first
//         (o7) rail's own fixture.
//       - the file reads but the home cannot be WRITTEN: a name with no row waits zero, while a name
//         WITH a row keeps paying its accumulated wait — up to the cap, not automatically the cap — and
//         that wait can no longer be grown OR cleared. A correct password does not clear it and
//         `loam user unlock` cannot either; both need the same write. It retires only after `forgetMs`
//         of silence. That is the second (o7) rail's fixture.
//     Slow or unbudgeted, never shut, and the cure is the disk. Only ONE of the two rails runs on
//     Windows: the write half needs a POSIX mode to build its fixture.
//  5. TIME, in the byte-identical refusal rail below. It compares status and body only, and says so
//     again at its own call site.
//  6. THAT A TARGETED NAME IS CHARGED WHEN THE TABLE IS SQUATTED. It is not. A row is seated at one
//     failure, so a row being seated is always among the weakest, and the operative quantity is
//     SEATINGS PER ROUND — rows added for a name not currently in the table, whether or not the name is
//     new. Both shapes are measured at 0ms charged per round:
//       - `maxTracked` seatings per round, cycling the whole table. No setup, works under EITHER
//         tie-break order, and NOTHING standing: a full `forgetMs` of silence before every guess does
//         not erode it. This is the cheap shape and it does not decay.
//       - ONE seating per round, with the other rows held at a count at least the target's. Setup is
//         `count × (maxTracked − 1)`; junk at EXACTLY the target's count is enough. This shape needs
//         `maxTracked − 1` refreshes per `forgetMs` window whatever the guess rate, so it does decay.
//     The BOUNDARY is railed on both sides below — `maxTracked − 1` seatings and the target
//     accumulates, `maxTracked` and it holds no row at all. What is NOT railed is the second shape's
//     setup, and no eviction order fixes either: login-locks.ts states what closing them takes, and it
//     is a different store rather than a different comparator.
//
// The last half of the file is a different budget. scrypt is expensive ON PURPOSE, which makes an
// unauthenticated login a lever on the server's CPU. So the door caps concurrent hashing globally,
// and refuses past the cap WITHOUT hashing.

import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
import {
  DEFAULT_LIMIT,
  delayFor,
  delayMs,
  locksPath,
  noteFailure,
  unreadableRecordFile,
  readLocks,
  type LimitPolicy,
} from "../../src/server/login-locks.js";

vi.setConfig({ testTimeout: 30000 });

const WREN = "a wholly different password";

// Named policies, so a rail's numbers read as a choice rather than as noise.
//
// COUNTS FAST, WAITS BARELY. For rails about the COUNT, where the wait is only in the way.
const COUNTING: LimitPolicy = { baseDelayMs: 1, maxDelayMs: 4, forgetMs: 600_000, maxTracked: 64 };
// A wait that grows in visible steps: 0, 300, 600, 1200, 1200…
const STEPPED: LimitPolicy = {
  baseDelayMs: 300,
  maxDelayMs: 1200,
  forgetMs: 600_000,
  maxTracked: 64,
};
// One long wait from the very first failure — the lever for every ordering rail here. Two seconds
// against an unwaited login's twenty milliseconds is fifty times the separation each bound needs.
const LONG: LimitPolicy = {
  baseDelayMs: 2000,
  maxDelayMs: 2000,
  forgetMs: 600_000,
  maxTracked: 64,
};
/** No wait at all, generously: fifty times what an unwaited login on a loaded box actually costs. */
const UNWAITED_MS = 1000;

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

/** How long a request took, in milliseconds, with its response. */
const timed = async <T>(work: Promise<T>): Promise<{ ms: number; res: T }> => {
  const from = Date.now();
  const res = await work;
  return { ms: Date.now() - from, res };
};

/**
 * The witness every timing fixture here owes: was this request STILL IN FLIGHT? Without it a fixture
 * that silently completed early would leave its rail green having tested nothing.
 *
 * A FLAG, not `Promise.race`. Racing a pending promise against `Promise.resolve("still running")` looks
 * like a witness and is a constant: the already-fulfilled arm queues its callback first, every time,
 * even for a promise that settled seconds ago. This one records the fact when it happens.
 *
 * THE CALLER OWES IT A REAL WINDOW, and this is the part that is easy to get wrong. `running()` only
 * carries information once the request has had CHANCE to finish; a settled request needs a socket
 * write, the server's handling and a response read, which is several event-loop iterations. So
 * `drained()` — one `setImmediate` — is NOT enough: read after it, `running()` is unconditionally
 * true and the witness excludes nothing. Read it after a real pause, or after another request's full
 * round trip, and it means what it says.
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

describe("the failed-login delay", () => {
  it("(o) twenty failures do not lock: the RIGHT password still opens the door", async () => {
    // THE RAIL THAT GOES RED IF A LOCK CREEPS BACK. Nothing else here would notice: a limiter that
    // refuses after five misses satisfies every "guessing is bounded" assertion in this file.
    served = await serveHome(home, { limit: COUNTING });
    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      statuses.push((await missOnce("myk", attempt)).status);
    }
    expect([...new Set(statuses)]).toEqual([401]); // never 429: there is no lock to reach

    // Delta level: the failures really did accumulate. Without this the rail passes just as well on a
    // limiter that counts nothing at all.
    expect(readLocks(home).get("myk")?.failures).toBe(20);
    expect(delayMs(home, "myk", Date.now(), COUNTING)).toBe(COUNTING.maxDelayMs);

    // Object level: the door admits the correct password anyway, and hands over a session.
    const opened = await tryPassword("myk", PASSWORD);
    expect(opened.status).toBe(200);
    expect(cookieFrom(opened)).toBeDefined();

    // and the success cleared the record, so the operator pays that wait once rather than forever
    expect(readLocks(home).has("myk")).toBe(false);
  });

  it("(o7) a FAILURE that cannot be recorded answers 401, never 503", async () => {
    // THE READ IS FAIL-OPEN AND THE WRITE HAS TO MATCH. A directory where login-locks.json belongs
    // makes the recording write throw: the rename onto a directory fails with EISDIR. Unguarded, that
    // reaches the door's outer guard and answers 503, so a local disk fault would decide what the
    // door says — and a caller who sees 503 where 401 belongs learns that something is wrong with the
    // box rather than with their password.
    //
    // A DIRECTORY rather than a mode, because a test running as root ignores a mode.
    mkdirSync(locksPath(home));
    const faults: string[] = [];
    served = await serveHome(home, { limit: LONG, onFault: (m) => faults.push(m) });

    expect((await missOnce("myk", 1)).status).toBe(401);
    // and the right password is still admitted — nothing about this state refuses it
    const opened = await tryPassword("myk", PASSWORD);
    expect(opened.status).toBe(200);
    expect(cookieFrom(opened)).toBeDefined();

    // NOT SWALLOWED. The operator's own channel hears it; the caller's answer never moved.
    expect(faults.join("\n")).toMatch(/login-locks\.json/);
    // EXACTLY ONE, and the count says which half ran: the read fails open to no records, so the
    // success path finds nothing to clear and never writes. The clearing half is pinned separately,
    // because this fixture cannot reach it.
    expect(faults).toHaveLength(1);
  });

  // POSIX ONLY, and skipped rather than weakened (T116). The fixture needs a directory that can be READ
  // and not WRITTEN, and a mode is the only way to get one — the clearing write is never attempted
  // unless a record survives the read. Windows maps `chmodSync` to the read-only attribute alone, which
  // does not deny creating a file inside a directory, so the mode would not bite. The rail would then
  // go RED on its own bite-check below, not pass — which is the right direction and the wrong report:
  // it would blame the operator's user account for a platform difference. So it is skipped there, and
  // the Linux leg proves the behaviour, which is platform-agnostic try/catch in session.ts. The sibling
  // (o7) rail uses a directory instead of a mode and still runs on both legs.
  it.skipIf(process.platform === "win32")(
    "(o7) a COUNT that cannot be cleared still admits the right password",
    async () => {
      // The other half of the fail-open write, and the one that matters most: the password has already
      // been accepted, so nothing after that may refuse it. Unguarded, this answers 503 with a session
      // already seated and no cookie to reach it — a correct password refused, and one of `maxSessions`
      // burned per retry.
      //
      // The fixture needs the file READABLE and the directory UNWRITABLE, which a mode is the only way
      // to get: a record has to survive the read for the clearing write to be attempted at all.
      //
      // The policy CHARGES a visible wait, so the rail can pin what the frozen record costs. Four
      // failures at 200ms doubling is 1600ms — its own accumulated wait, which is what the criterion
      // claims, and not automatically the cap.
      const stepped: LimitPolicy = {
        baseDelayMs: 200,
        maxDelayMs: 6400,
        forgetMs: 600_000,
        maxTracked: 64,
      };
      writeFileSync(
        locksPath(home),
        JSON.stringify({ users: { myk: { failures: 4, lastFailureAt: Date.now() } } }),
      );
      const faults: string[] = [];
      served = await serveHome(home, { limit: stepped, onFault: (m) => faults.push(m) });
      expect(readLocks(home).get("myk")?.failures).toBe(4); // the record really is there to be cleared
      chmodSync(home, 0o500);
      try {
        // THE FIXTURE HAS TO BITE, and it cannot as root. Asserted rather than skipped: a rail that
        // quietly passes without exercising its subject is worse than one that says it could not.
        expect(() => {
          const probe = join(home, "probe.tmp");
          writeFileSync(probe, "x");
          rmSync(probe, { force: true });
        }, "this home is still writable, so the clearing write cannot fail: run as a non-root user").toThrow();

        const { ms, res: opened } = await timed(tryPassword("myk", PASSWORD));
        expect(opened.status).toBe(200);
        expect(cookieFrom(opened)).toBeDefined();
        expect(faults.join("\n")).toMatch(/login-locks\.json/);
        // THE FROZEN RECORD STILL CHARGES ITS OWN WAIT, and this is what criterion (o7) claims: four
        // failures at 200ms doubling is 1600ms, not the 6400ms cap. Without this the criterion names a
        // behaviour no rail measures.
        expect(ms).toBeGreaterThanOrEqual(1500);
        expect(ms).toBeLessThan(5000); // its accumulated wait, and not the cap
        // the count survived, because clearing it is a courtesy rather than a step
        expect(readLocks(home).get("myk")?.failures).toBe(4);
        // and a SECOND login pays it again — the successful one could not clear it
        const { ms: again } = await timed(tryPassword("myk", PASSWORD));
        expect(again).toBeGreaterThanOrEqual(1500);
      } finally {
        chmodSync(home, 0o700); // or afterEach cannot remove its own temp home
      }
    },
  );

  it("(o) an unknown username accumulates the same way, and shuts nobody out", async () => {
    // The limiter is no oracle: a name nobody holds is counted exactly like one that exists.
    served = await serveHome(home, { limit: COUNTING });
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect((await missOnce("nobody", attempt)).status).toBe(401);
    }
    expect(readLocks(home).get("nobody")?.failures).toBe(20);
    // and grinding `nobody` neither locked nor slowed `myk`
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(UNWAITED_MS);
    expect(delayMs(home, "myk", Date.now(), COUNTING)).toBe(0);
  });

  it("(o2) the cost is paid BEFORE the compare: a door that cannot hash still waits it out", async () => {
    // `maxConcurrentHashes: 0` means NO password can be compared at all. An attempt for a name that
    // has accumulated failures must still pay its wait before it hears that. A cost charged after the
    // compare is no cost: the answer is already decided, and a fast 401 beside a slow 200 tells the
    // caller which they got just as plainly as the status would.
    served = await serveHome(home, { limit: LONG });
    expect((await missOnce("myk", 1)).status).toBe(401);
    await served.close();

    served = await serveHome(home, { limit: LONG, maxConcurrentHashes: 0 });
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(503);
    expect(cookieFrom(res)).toBeUndefined();
    expect(ms).toBeGreaterThanOrEqual(1900);
  });

  it("(o1) the wait grows with each failure", async () => {
    served = await serveHome(home, { limit: STEPPED });
    const miss = async (attempt: number): Promise<number> => {
      const { ms, res } = await timed(missOnce("myk", attempt));
      expect(res.status, `miss ${attempt}`).toBe(401);
      return ms;
    };
    const first = await miss(1); // no prior failure: nothing owed
    const second = await miss(2); // one prior failure: 300ms
    const third = await miss(3); // two: 600ms
    const fourth = await miss(4); // three: 1200ms, the cap
    expect(second).toBeGreaterThanOrEqual(250);
    expect(third).toBeGreaterThanOrEqual(550);
    expect(fourth).toBeGreaterThanOrEqual(1150);
    expect(second).toBeGreaterThan(first);
    expect(fourth).toBeGreaterThan(second);
  });

  it("(o1) the wait is CAPPED: twenty-five failures still answer promptly", async () => {
    // Doubling with no ceiling would reach 40ms × 2²⁴, which is over a week, so an uncapped wait does
    // not make this rail slow. It makes it never return, and the test times out red.
    const capped: LimitPolicy = {
      baseDelayMs: 40,
      maxDelayMs: 120,
      forgetMs: 600_000,
      maxTracked: 64,
    };
    served = await serveHome(home, { limit: capped });
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      expect((await missOnce("myk", attempt)).status, `miss ${attempt}`).toBe(401);
    }
    expect(readLocks(home).get("myk")?.failures).toBe(25);
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it("(o1) `delayFor` doubles from the base and saturates at the cap", () => {
    const policy: LimitPolicy = {
      baseDelayMs: 250,
      maxDelayMs: 2000,
      forgetMs: 60_000,
      maxTracked: 8,
    };
    expect([0, 1, 2, 3, 4, 5, 6].map((f) => delayFor(f, policy))).toEqual([
      0, 250, 500, 1000, 2000, 2000, 2000,
    ]);
    // A count no caller could reach must still answer a NUMBER: 2 ** 4095 is Infinity, not a wrap.
    expect(delayFor(4096, policy)).toBe(2000);
    // and the shipped policy is a delay, never a denial: it names a ceiling, and the ceiling is finite
    expect(DEFAULT_LIMIT.maxDelayMs).toBeLessThan(60_000);
    expect(delayFor(4096, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT.maxDelayMs);
  });

  it("(o3) waiting attempts spend no hash budget, so one name's flood cannot refuse another", async () => {
    // ONE hash slot for the whole door. If a waiting attempt held that slot, wren could not get in —
    // and a 503 for wren is the denial this whole design exists to remove, arriving by another route.
    served = await serveHome(home, { limit: LONG, maxConcurrentHashes: 1 });
    expect((await missOnce("myk", 1)).status).toBe(401); // one failure: every later myk attempt waits 2s

    // THE PRE-SESSIONS ARE BOUGHT FIRST, so the four POSTs are the next thing on the wire. Fetched
    // inside the flood promises instead, a flood attempt might not have sent its POST before wren sent
    // hers — and then wren would find the hash slot free even under the mutant this rail exists to
    // catch, and the rail would go green on a request-ordering accident.
    const begun = await Promise.all([2, 3, 4, 5].map(() => beginLogin(served.base)));
    const flood = begun.map((b, i) =>
      inFlight(
        postLogin(served.base, "myk", `wrong ${i}`, { cookie: b.cookie, formToken: b.formToken }),
      ),
    );

    // ONE WITNESS, TAKEN AFTER WREN'S OWN ROUND TRIP. A check between firing the flood and awaiting it
    // would be worthless — nothing has had time to settle yet, so `running()` is true for any door at
    // all. Wren's login is a full round trip, so a flood still open on the far side of it really was
    // open THROUGHOUT, which is exactly the claim: wren got in while four attempts were waiting.
    const { ms, res } = await timed(tryPassword("wren", WREN));
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toBeDefined();
    expect(ms).toBeLessThan(UNWAITED_MS); // wren waited for nothing myk had accumulated
    expect(
      flood.map((f) => f.running()),
      "the flood drained before wren got in: this proved nothing",
    ).toEqual([true, true, true, true]);

    // Every waiting attempt is ANSWERED — a wait is not a quiet refusal — and none of the answers is
    // 429, because there is no lock for one to reach.
    //
    // WHICH answer each gets is NOT asserted here, and that is deliberate rather than weak. On the far
    // side of the wait the four contend for one slot, and how many reach a compare depends on whether
    // a hash outlasts the few milliseconds of stagger between the wakers. At this home's scrypt cost
    // it does not, so any count from one to four is a legitimate outcome and pinning one would be a
    // coin flip. The rail below buys the same property on a home where one hash lasts about a second.
    const answered = await Promise.all(flood.map((f) => f.wait));
    expect(answered.every((r) => r.status === 401 || r.status === 503)).toBe(true);
    // and a 503 costs the caller no count, so the count moved by exactly the compares that happened.
    // The expectation comes from the DOOR's own answers, never from login-locks.ts (H10).
    expect(readLocks(home).get("myk")?.failures).toBe(
      1 + answered.filter((r) => r.status === 401).length,
    );
  });

  it("(o4) overlapping attempts each count: no attempt loses another's failure", async () => {
    // A LOST UPDATE is what this pins. Read the table, await the hash, write the snapshot back, and
    // four overlapping attempts all compute the same `failures + 1` — so the count says one or two
    // where four landed. Concurrency is the whole point: sent one at a time, a broken limiter looks
    // fine.
    const doubling: LimitPolicy = {
      baseDelayMs: 200,
      maxDelayMs: 6400,
      forgetMs: 600_000,
      maxTracked: 64,
    };
    served = await serveHome(home, { limit: doubling, maxConcurrentHashes: 4 });

    // THE WITNESS NEEDS A REAL WINDOW, and `drained()` is not one. It resolves in the check phase of
    // the CURRENT event-loop iteration, before any socket write, so `running()` read after it is
    // unconditionally true — for any door, including one that answered instantly. A witness that
    // cannot fail excludes nothing, and what it is here to exclude is four SERIALIZED attempts.
    //
    // So this rail buys its own window: one prior failure means every one of the four waits 200ms
    // before it reaches a hash, and the witness is read 100ms in.
    //
    // WHAT THE WITNESS PROVES, exactly: none of the four had answered yet. It does NOT prove they
    // overlap — a door that queued them one behind another would also have all four pending at 100ms.
    // What makes them overlap is that they all wake from the SAME 200ms wait and then hash together
    // under `maxConcurrentHashes: 4`. The witness's job is narrower and still worth having: it fails
    // the moment the door stops charging a wait at all, which is when four instant answers could
    // serialize and the lost-update assertion below would prove nothing.
    expect((await missOnce("myk", 0)).status).toBe(401);
    const begun = await Promise.all([1, 2, 3, 4].map(() => beginLogin(served.base)));
    const flight = begun.map((b, i) =>
      inFlight(
        postLogin(served.base, "myk", `wrong ${i}`, { cookie: b.cookie, formToken: b.formToken }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      flight.map((f) => f.running()),
      "an attempt answered inside its own wait: the door charged no wait, so these did not overlap",
    ).toEqual([true, true, true, true]);

    const misses = await Promise.all(flight.map((f) => f.wait));
    expect(misses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    // Delta level: one before plus four overlapping, so the record says five.
    expect(readLocks(home).get("myk")?.failures).toBe(5);
    // Object level: the door charges for all five. 200ms × 2⁴ = 3200ms. Had three of the four been
    // lost the count would read two, and the next attempt would wait 400ms — which is what this lower
    // bound separates, with an order of magnitude to spare.
    const { ms, res } = await timed(missOnce("myk", 5));
    expect(res.status).toBe(401);
    expect(ms).toBeGreaterThanOrEqual(3000);
  });

  it("(o5) a wall clock stepped BACKWARDS cannot erase an accumulated wait", async () => {
    // A step backwards leaves the recorded stamp IN THE FUTURE, which is exactly what this writes by
    // hand. The door must read that as no time passed, never as the forget window having lapsed.
    writeFileSync(
      locksPath(home),
      JSON.stringify({ users: { myk: { failures: 3, lastFailureAt: Date.now() + 3_600_000 } } }),
    );
    served = await serveHome(home, { limit: LONG });
    // delta level: the record survived the read, and it still buys the full wait
    expect(readLocks(home).get("myk")?.failures).toBe(3);
    expect(delayMs(home, "myk", Date.now(), LONG)).toBe(LONG.maxDelayMs);
    // object level: the door really waits before it answers
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeGreaterThanOrEqual(1900);
  });

  it("(o5) silence past the forget window DOES clear it — the other side of the same read", async () => {
    const brief: LimitPolicy = {
      baseDelayMs: 2000,
      maxDelayMs: 2000,
      forgetMs: 1000,
      maxTracked: 64,
    };
    writeFileSync(
      locksPath(home),
      JSON.stringify({ users: { myk: { failures: 9, lastFailureAt: Date.now() - 600_000 } } }),
    );
    served = await serveHome(home, { limit: brief });
    expect(delayMs(home, "myk", Date.now(), brief)).toBe(0);
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(UNWAITED_MS);
  });

  it("(o5) a fresh failure re-arms a spent record rather than resuming its count", async () => {
    // A count that survived its own forget window would be a permanent wait wearing a timer's
    // clothes: nine failures forgiven, then one miss charging as if it were the tenth.
    const brief: LimitPolicy = {
      baseDelayMs: 300,
      maxDelayMs: 4000,
      forgetMs: 1000,
      maxTracked: 64,
    };
    writeFileSync(
      locksPath(home),
      JSON.stringify({ users: { myk: { failures: 9, lastFailureAt: Date.now() - 600_000 } } }),
    );
    served = await serveHome(home, { limit: brief });
    expect((await missOnce("myk", 1)).status).toBe(401);
    expect(readLocks(home).get("myk")?.failures).toBe(1);
    expect(delayMs(home, "myk", Date.now(), brief)).toBe(300);
  });

  it("(o6) the table holds no more than maxTracked, and a flood cannot flush a stronger record", async () => {
    // THE FILE IS BOUNDED, because an unauthenticated caller drives every write to it. Bounded means
    // something has to give when it is full — and what gives must never be the record a caller has
    // already been made to pay for.
    const small: LimitPolicy = { baseDelayMs: 1, maxDelayMs: 4, forgetMs: 600_000, maxTracked: 3 };
    served = await serveHome(home, { limit: small });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await missOnce("myk", attempt)).status).toBe(401);
    }
    expect(readLocks(home).get("myk")?.failures).toBe(3);

    for (const name of ["flood-a", "flood-b", "flood-c", "flood-d", "flood-e"]) {
      expect((await missOnce(name, 1)).status, `${name}`).toBe(401);
    }

    const after = readLocks(home);
    expect(after.size).toBeLessThanOrEqual(small.maxTracked);
    // the strongest record SURVIVES, count and all: five one-failure names must not buy back the
    // three failures myk had already accumulated
    expect(after.get("myk")?.failures).toBe(3);
    // two-sided — the bound did not stop counting the flood either. The newest flood name is tracked.
    expect(after.has("flood-e")).toBe(true);
    // and whatever the table holds, the correct password still opens the door
    expect((await tryPassword("myk", PASSWORD)).status).toBe(200);
  });

  it("(o6) a saturating flood cannot stop a targeted name from ACCUMULATING", async () => {
    // THE RAIL THAT A SINGLE EVICTION CANNOT REPLACE. Evicting one row correctly proves nothing about
    // the CYCLE, and the cycle is where the whole feature can be switched off for one name: keep the
    // table full of fresh names, interleave one guess at the target, and if a newly seated row is the
    // first of its count to go, the target's row is flushed before it can ever reach two failures. The
    // count stays at one, the wait stays at the base, and every rail that watches a single eviction
    // stays green.
    //
    // THIS SITS ON THE BOUNDARY, at `maxTracked − 1` SEATINGS per round — the widest flood the
    // tie-break survives. The quantity is SEATINGS, meaning rows added for a name not currently in the
    // table, and not "fresh names": a name the flood evicted last round is absent now, so recycling one
    // seats a row exactly as a never-seen name does. The sibling rail below pins the far side.
    const small: LimitPolicy = {
      baseDelayMs: 200,
      maxDelayMs: 4000,
      forgetMs: 600_000,
      maxTracked: 4,
    };
    served = await serveHome(home, { limit: small });
    for (const junk of ["junk-1", "junk-2", "junk-3", "junk-4"]) {
      expect((await missOnce(junk, 1)).status).toBe(401);
    }
    expect(readLocks(home).size).toBe(small.maxTracked); // the table really is full

    // Four rounds of: one guess at the target, then `maxTracked − 1` seatings. Only ROUND ONE is decided
    // by the tie — from round two the target out-counts every other row and `failures` alone protects
    // it. That is the point: the tie has to hold ONCE for the count to start growing, and after that the
    // count defends itself.
    for (let round = 1; round <= 4; round += 1) {
      expect((await missOnce("myk", round)).status, `round ${round}`).toBe(401);
      for (let i = 0; i < small.maxTracked - 1; i += 1) {
        expect((await missOnce(`r${round}-f${i}`, 1)).status, `round ${round} filler ${i}`).toBe(
          401,
        );
      }
    }

    // Delta level: the target's count GREW across the rounds. Flushed every round it would read one.
    expect(readLocks(home).get("myk")?.failures).toBe(4);
    // Object level: the door charges for all four. 200ms × 2³ = 1600ms.
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeGreaterThanOrEqual(1500);
  });

  it("(o6) at maxTracked SEATINGS per round the tie-break stops helping — the limit, pinned", async () => {
    // THE FAR SIDE OF THE SAME BOUNDARY, and it asserts the LIMITATION rather than a protection. Three
    // documents now claim this boundary is exact; without a rail on both sides that claim rests on a
    // scratch probe, and a change that moved the boundary would leave every other rail here green.
    //
    // One more seating per round than the rail above, and nothing survives a round that could tie. So
    // the tie-break never decides anything and the target's row is gone every time — with no setup, and
    // under either eviction order. This is the residual the working spec asks Myk to weigh.
    const small: LimitPolicy = {
      baseDelayMs: 200,
      maxDelayMs: 4000,
      forgetMs: 600_000,
      maxTracked: 4,
    };
    served = await serveHome(home, { limit: small });
    for (let round = 1; round <= 4; round += 1) {
      // the target is charged NOTHING, every round: measured before its own miss, so a wait would show
      expect(delayMs(home, "myk", Date.now(), small), `round ${round}`).toBe(0);
      expect((await missOnce("myk", round)).status).toBe(401);
      for (let i = 0; i < small.maxTracked; i += 1) {
        expect((await missOnce(`r${round}-f${i}`, 1)).status, `round ${round} filler ${i}`).toBe(
          401,
        );
      }
    }
    // Delta level: four rounds of failures and the target holds no row at all.
    expect(readLocks(home).has("myk")).toBe(false);
    expect(readLocks(home).size).toBe(small.maxTracked); // the bound still holds while this happens
    // Object level: the door charges nothing, so the correct password is admitted promptly.
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(UNWAITED_MS);
  });

  it("(o6) a RECYCLED name seats a row: the boundary is seatings, not novelty", async () => {
    // `maxTracked − 1` fresh names plus ONE name reused every round reaches `maxTracked` seatings, so it
    // defeats the tie-break exactly as an all-fresh flood does. Without this, "flood `maxTracked` fresh
    // names" reads as the requirement and a caller who recycles looks bounded when they are not.
    const small: LimitPolicy = {
      baseDelayMs: 200,
      maxDelayMs: 4000,
      forgetMs: 600_000,
      maxTracked: 4,
    };
    served = await serveHome(home, { limit: small });
    for (let round = 1; round <= 4; round += 1) {
      expect((await missOnce("myk", round)).status).toBe(401);
      for (let i = 0; i < small.maxTracked - 1; i += 1) {
        await missOnce(`r${round}-f${i}`, 1);
      }
      // the same name every round — evicted by the flood above, so it is absent and SEATS again
      expect((await missOnce("pong", round)).status, `round ${round} recycled`).toBe(401);
      expect(readLocks(home).get("pong")?.failures, `round ${round}`).toBe(1); // re-seated, not grown
    }
    expect(readLocks(home).has("myk")).toBe(false);
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(UNWAITED_MS);
  });

  it("(o6) maxTracked below one tracks nothing, so the bound holds at every value", () => {
    const home2 = makeHome();
    try {
      const off: LimitPolicy = {
        baseDelayMs: 200,
        maxDelayMs: 4000,
        forgetMs: 600_000,
        maxTracked: 0,
      };
      for (const name of ["a", "b", "c"]) noteFailure(home2, name, Date.now(), off);
      expect(readLocks(home2).size).toBe(0); // not one — the criterion's bound is exact at zero
      const one: LimitPolicy = { ...off, maxTracked: 1 };
      for (const name of ["a", "b", "c"]) noteFailure(home2, name, Date.now(), one);
      expect(readLocks(home2).size).toBe(1);
    } finally {
      dropHome(home2);
    }
  });

  it("(o6) the tie reads the LAST FAILURE, not the order rows were seated", async () => {
    // THE THIRD VARIANT, which neither sibling rail can see. Drop the secondary sort term altogether
    // and `sort` is stable, so ties fall back to insertion order — and in every other fixture here
    // insertion order and age order are the same list, so both stay green on a comparator that has no
    // tie-break at all.
    //
    // They come apart when a row's count GROWS IN PLACE: a Map keeps the key's original slot, so the
    // row is insertion-FIRST while its last failure is the newest. This fixture builds exactly that.
    // myk is seated first and fails last, so insertion order says evict myk and the last failure says
    // evict the junk row. Only the second is right, and only the second leaves the row that was just
    // attacked in the table.
    const small: LimitPolicy = {
      baseDelayMs: 200,
      maxDelayMs: 3200,
      forgetMs: 600_000,
      maxTracked: 2,
    };
    served = await serveHome(home, { limit: small });
    expect((await missOnce("myk", 1)).status).toBe(401); // seated FIRST, one failure
    expect((await missOnce("junk", 1)).status).toBe(401); // seated second, one failure
    expect((await missOnce("junk", 2)).status).toBe(401); // junk reaches two
    expect((await missOnce("myk", 2)).status).toBe(401); // myk reaches two, and is now the NEWEST
    expect(readLocks(home).get("myk")?.failures).toBe(2);
    expect(readLocks(home).get("junk")?.failures).toBe(2); // the tie really is a tie

    // A third name forces one eviction between two rows tied at two failures.
    expect((await missOnce("fresh", 1)).status).toBe(401);
    const after = readLocks(home);
    expect(after.size).toBe(2);
    expect(after.has("junk")).toBe(false); // its failure was older, so it went
    expect(after.get("myk")?.failures).toBe(2); // and the row just attacked survived, count intact

    // Object level: the door still charges myk for those two failures. 200ms × 2 = 400ms.
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeGreaterThanOrEqual(350);
  });

  it("(o6) a NEWLY SEATED row is the last of its count to go, not the first", async () => {
    // The tie-break, at one eviction. A row is seated at ONE failure, so it is always the newest of the
    // one-failure rows — and evicting the newest of an equal count means a fresh row is flushed before
    // it can grow. The rail above proves what that costs over a cycle; this one pins the single step.
    //
    // THE WAIT IS LONG ON PURPOSE, so the harm is observable at the DOOR and not only in the file. What
    // an eviction takes is time the door would have charged, and at `maxDelayMs: 4` the file would read
    // correctly while the door charged nothing either way — a rail that cannot see its own subject.
    const small: LimitPolicy = {
      baseDelayMs: 2000,
      maxDelayMs: 2000,
      forgetMs: 600_000,
      maxTracked: 2,
    };
    served = await serveHome(home, { limit: small });
    expect((await missOnce("junk-a", 1)).status).toBe(401); // the OLDEST one-failure row
    expect((await missOnce("myk", 1)).status).toBe(401); // seated newest, at one failure
    expect(readLocks(home).size).toBe(2);

    // A third name at the SAME count. The table is full and every row ties at one failure.
    expect((await missOnce("junk-b", 1)).status).toBe(401);
    // Delta level: the newly seated row SURVIVED and the oldest of the equals went.
    const after = readLocks(home);
    expect(after.size).toBe(2);
    expect(after.has("myk")).toBe(true);
    expect(after.has("junk-a")).toBe(false);
    // Object level: the door still CHARGES myk for that surviving row. A record the file kept but the
    // door no longer honoured would be the same theft, one layer down.
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200); // and a correct password is admitted, however long it waited
    expect(ms).toBeGreaterThanOrEqual(1900);
  });

  it("(o6) an over-bound table is cut back to the bound, not trimmed by one", async () => {
    // The multi-row eviction branch. A policy narrowed since the last write leaves the file over its
    // own bound, and evicting a single row per attempt would never catch up. Written by hand because
    // the door itself can never produce an over-bound file — which is also why no other rail reaches
    // this branch at a value where `size - maxTracked + 1` is anything but one.
    const now = Date.now();
    writeFileSync(
      locksPath(home),
      JSON.stringify({
        users: {
          strongest: { failures: 9, lastFailureAt: now - 5000 },
          strong: { failures: 7, lastFailureAt: now - 4000 },
          middle: { failures: 5, lastFailureAt: now - 3000 },
          weak: { failures: 3, lastFailureAt: now - 2000 },
          weaker: { failures: 2, lastFailureAt: now - 1000 },
          weakest: { failures: 1, lastFailureAt: now },
        },
      }),
    );
    expect(readLocks(home).size).toBe(6); // the fixture really is over the bound below
    const small: LimitPolicy = { baseDelayMs: 1, maxDelayMs: 4, forgetMs: 600_000, maxTracked: 3 };
    served = await serveHome(home, { limit: small });

    expect((await missOnce("newcomer", 1)).status).toBe(401);
    const after = readLocks(home);
    // ONE attempt cut six rows to three. Trimming by one would leave five, plus the newcomer.
    expect(after.size).toBe(small.maxTracked);
    // and it cut from the WEAK end: the two strongest survived beside the new row
    expect([...after.keys()].sort()).toEqual(["newcomer", "strong", "strongest"]);
    expect(after.get("strongest")?.failures).toBe(9); // the count survived, not just the key
    // ONE LEVEL ONLY, and deliberately: this asserts the FILE, never what the door then charges. The
    // subject is which rows a single write keeps, and a door reads the file it is handed either way.
    // The tie-break rail above carries the door-level half for this pair.
  });

  it("(p) `loam user unlock` clears the accumulated wait from the box", async () => {
    served = await serveHome(home, { limit: LONG });
    expect((await missOnce("myk", 1)).status).toBe(401);
    expect(delayMs(home, "myk", Date.now(), LONG)).toBe(LONG.maxDelayMs);

    const io = testIo();
    expect(await run(["user", "unlock", "myk", "--home", home], io.io)).toBe(0);
    expect(io.out.join("\n")).toMatch(/myk/);
    // delta level: the record is gone from the file
    expect(readLocks(home).has("myk")).toBe(false);
    // object level: the next attempt pays nothing
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(UNWAITED_MS);
  });

  it("(p) `loam user unlock --all` clears every record, whatever name it holds", async () => {
    served = await serveHome(home, { limit: LONG });
    for (const name of ["junk-a", "junk-b"]) expect((await missOnce(name, 1)).status).toBe(401);
    expect((await missOnce("myk", 1)).status).toBe(401);
    expect(readLocks(home).size).toBe(3);

    // It names no user, and it clears records whose names it was never told.
    const io = testIo();
    expect(await run(["user", "unlock", "--all", "--home", home], io.io)).toBe(0);
    expect(io.out.join("\n")).toMatch(/cleared 3 login records/);
    expect(readLocks(home).size).toBe(0);
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(UNWAITED_MS);
  });

  it("(p) unlock --all takes no name, and says so", async () => {
    served = await serveHome(home);
    const io = testIo();
    expect(await run(["user", "unlock", "myk", "--all", "--home", home], io.io)).toBe(2);
    expect(io.err.join("\n")).toMatch(/takes no name/);
  });

  it("(p) unlock refuses a name the home has no user for, and clears nobody by accident", async () => {
    served = await serveHome(home, { limit: COUNTING });
    expect((await missOnce("myk", 1)).status).toBe(401);
    const io = testIo();
    expect(await run(["user", "unlock", "stranger", "--home", home], io.io)).toBe(2);
    expect(readLocks(home).get("myk")?.failures).toBe(1); // myk's record is untouched
  });

  // POSIX ONLY, for the reason the (o7) clearing rail names: the fixture needs a home that can be READ
  // and not WRITTEN, and only a mode gives that. Skipped on Windows rather than weakened.
  it.skipIf(process.platform === "win32")(
    "(p) unlock REFUSES when it cannot rewrite the file, and never claims it cleared anything",
    async () => {
      // The command's whole job is to clear a record. A write it cannot make must be reported as a
      // failure, in the command's own words — a bare errno reads as a bug in loam rather than as a
      // permission on a directory, and "cleared" printed over a record still on disk would be the
      // report claiming an operation it did not achieve.
      served = await serveHome(home, { limit: COUNTING });
      expect((await missOnce("myk", 1)).status).toBe(401);
      expect(readLocks(home).get("myk")?.failures).toBe(1);
      chmodSync(home, 0o500);
      try {
        expect(() => {
          const probe = join(home, "probe.tmp");
          writeFileSync(probe, "x");
          rmSync(probe, { force: true });
        }, "this home is still writable, so the clearing write cannot fail").toThrow();

        const one = testIo();
        expect(await run(["user", "unlock", "myk", "--home", home], one.io)).toBe(1);
        expect(one.out.join("\n")).not.toMatch(/cleared/);
        expect(one.err.join("\n")).toMatch(/nothing was cleared/);
        expect(one.err.join("\n")).toMatch(/forget window/); // it names a cure, not just a failure

        const all = testIo();
        expect(await run(["user", "unlock", "--all", "--home", home], all.io)).toBe(1);
        expect(all.out.join("\n")).not.toMatch(/cleared/);
        expect(all.err.join("\n")).toMatch(/none were cleared/);

        // and the record really is still there — the refusal was honest in both directions
        expect(readLocks(home).get("myk")?.failures).toBe(1);
      } finally {
        chmodSync(home, 0o700);
      }
    },
  );

  it("(o8) unlock tells an ABSENT record file apart from one it cannot read", async () => {
    // An unreadable file and an empty one read the same way to the door — no records — but they mean
    // opposite things to an operator. Absent is the ordinary state of a home where nobody has failed a
    // login. Unreadable means the door is charging NOBODY, and this is the only command that looks at
    // the file, so silence here is the fault going unreported anywhere.
    served = await serveHome(home, { limit: COUNTING });

    // ABSENT: no file at all, so nothing to explain. Exit 0, and no fault named.
    expect(readLocks(home).size).toBe(0);
    const absent = testIo();
    expect(await run(["user", "unlock", "--all", "--home", home], absent.io)).toBe(0);
    expect(absent.out.join("\n")).toMatch(/no login records/);
    expect(absent.err.join("\n")).toBe("");

    // UNREADABLE: a directory where the file belongs. Same empty read, opposite report.
    mkdirSync(locksPath(home));
    const broken = testIo();
    expect(await run(["user", "unlock", "--all", "--home", home], broken.io)).toBe(1);
    expect(broken.err.join("\n")).toMatch(/login-locks\.json/);
    expect(broken.err.join("\n")).toMatch(/charging no name any delay/);
    expect(broken.out.join("\n")).not.toMatch(/nothing to clear/);

    // and the per-name path says it too, rather than "already waits for nothing"
    const named = testIo();
    expect(await run(["user", "unlock", "myk", "--home", home], named.io)).toBe(1);
    expect(named.err.join("\n")).toMatch(/charging no name any delay/);
    expect(named.out.join("\n")).not.toMatch(/waits for nothing/);
  });

  it("(o8) DAMAGED BYTES report the same way an unreadable file does", async () => {
    // The other shape of the same fault, and the one an operator is likelier to cause: the file is
    // readable and its contents are not a record table. Both leave the door charging nobody.
    served = await serveHome(home, { limit: COUNTING });
    writeFileSync(locksPath(home), "this is not json at all");
    const io = testIo();
    expect(await run(["user", "unlock", "--all", "--home", home], io.io)).toBe(1);
    expect(io.err.join("\n")).toMatch(/not JSON/);

    // and a `users` table whose entries are not records: read as none, reported as damage. ONE entry
    // reads "1 entry that is", not "1 entry that are" — a report an operator reads has to parse.
    writeFileSync(locksPath(home), JSON.stringify({ users: { myk: "locked forever" } }));
    expect(readLocks(home).size).toBe(0);
    const entries = testIo();
    expect(await run(["user", "unlock", "--all", "--home", home], entries.io)).toBe(1);
    expect(entries.err.join("\n")).toMatch(/1 entry that is not a login record/);
    // and the advice WARNS rather than promising: whether the file is replaced turns on the door's
    // policy and on the path, neither of which this process was told.
    expect(entries.err.join("\n")).toMatch(/may replace this file/);
    expect(entries.err.join("\n")).toMatch(/copy it now/);

    // TWO-SIDED: a legitimately EMPTY users table is not damage, and must not be reported as any
    writeFileSync(locksPath(home), JSON.stringify({ users: {} }));
    const empty = testIo();
    expect(await run(["user", "unlock", "--all", "--home", home], empty.io)).toBe(0);
    expect(empty.err.join("\n")).toBe("");
  });

  it("(o8) a MISTYPED --home is named, not answered with an empty table", async () => {
    // The likeliest way anybody reaches this code, and the worst one to answer with silence. A home that
    // does not exist holds no record file, which reads exactly like "nobody has failed a login yet" — so
    // the command used to print "nothing to clear" and exit 0 over a typo. And that state is the one
    // (o8) exists for: the door charges nobody there and cannot even self-repair, because the temp file
    // cannot be created either.
    const missing = join(home, "no-such-home");
    const io = testIo();
    expect(await run(["user", "unlock", "--all", "--home", missing], io.io)).toBe(1);
    expect(io.err.join("\n")).toMatch(/no-such-home/);
    expect(io.err.join("\n")).toMatch(/Check the --home path if you passed one/);
    expect(io.err.join("\n")).toMatch(/loam init/); // the first-run reader has a cure too
    expect(io.out.join("\n")).not.toMatch(/nothing to clear/);

    // and the per-name path says it too rather than "already waits for nothing"
    const named = testIo();
    expect(await run(["user", "unlock", "myk", "--home", missing], named.io)).toBe(1);
    expect(named.err.join("\n")).toMatch(/do not read an empty answer as a clean one/);
    expect(named.out.join("\n")).not.toMatch(/waits for nothing/);
  });

  // POSIX only for the symlink shapes; Windows needs a privilege to make one. The predicate under test
  // is `statSync(home).isDirectory()`, which is platform-agnostic.
  it.skipIf(process.platform === "win32")(
    "(o8) an UNUSABLE HOME is named, whatever shape makes it unusable",
    () => {
      // FIVE SHAPES, and the reason this rail exists as a table rather than one case: the check has been
      // wrong twice, each time on a shape the previous version did not consider. `lstat` alone misses a
      // DANGLING home — it succeeds on the link — and `lstat().isDirectory()` would condemn a HEALTHY
      // symlinked home, which is the trap in the one-token fix. Only `stat().isDirectory()` separates all
      // five, so all five are asserted here together.
      const root = makeHome();
      try {
        const real = join(root, "real");
        mkdirSync(real);
        const target = join(root, "target");
        mkdirSync(target);
        const link = join(root, "link");
        symlinkSync(target, link);
        const dangling = join(root, "dangling");
        symlinkSync(join(root, "gone"), dangling);
        const asFile = join(root, "as-file");
        writeFileSync(asFile, "not a home");
        const missing = join(root, "missing");

        // USABLE: silent. A healthy symlinked home is the one this must not condemn.
        expect(unreadableRecordFile(real)).toBeUndefined();
        expect(unreadableRecordFile(link)).toBeUndefined();

        // UNUSABLE: each named, and each says it is the HOME rather than the record file.
        for (const [label, path] of [
          ["dangling", dangling],
          ["file", asFile],
          ["missing", missing],
        ] as const) {
          const said = unreadableRecordFile(path);
          expect(said, label).toMatch(/is not a usable loam home/);
          expect(said, label).toMatch(/Check the --home path if you passed one/);
          expect(said, label).toMatch(/loam init/); // the first-run reader has a cure too
          // and NOT the record-file advice: there are no bytes here to be perishable
          expect(said, label).not.toMatch(/copy it now/);
        }
        // the file-valued home names WHY, rather than only that something went wrong
        expect(unreadableRecordFile(asFile)).toMatch(/it is not a directory/);

        // AN UNTRAVERSABLE DIRECTORY IS A SIXTH SHAPE, and `isDirectory` alone says yes to it: `stat`
        // needs only a traversable PARENT, so a mode-0000 home passes the type test and the record-file
        // branch then offers perishable-bytes advice for a file that can never exist there.
        const sealed = join(root, "sealed");
        mkdirSync(sealed);
        chmodSync(sealed, 0o000);
        try {
          const said = unreadableRecordFile(sealed);
          expect(said).toMatch(/is not a usable loam home/);
          expect(said).not.toMatch(/copy it now/); // never the record-file advice
        } finally {
          chmodSync(sealed, 0o700);
        }

        // TWO-SIDED, and this is the trap in the fix: a READ-ONLY home is a SUPPORTED state — criterion
        // (o7) covers it, with a row frozen at its accumulated wait — so asking for write here would
        // condemn a home the door works with. It must stay silent.
        const readOnly = join(root, "read-only");
        mkdirSync(readOnly);
        writeFileSync(
          locksPath(readOnly),
          JSON.stringify({ users: { myk: { failures: 4, lastFailureAt: Date.now() } } }),
        );
        chmodSync(readOnly, 0o500);
        try {
          expect(unreadableRecordFile(readOnly)).toBeUndefined();
          expect(readLocks(readOnly).get("myk")?.failures).toBe(4); // and the row is still charged
        } finally {
          chmodSync(readOnly, 0o700);
        }
      } finally {
        dropHome(root);
      }
    },
  );

  it("(o8) a DANGLING SYMLINK is something at the path, not an absent file", async () => {
    // `readFileSync` follows the link and raises ENOENT, which reads exactly like "no file yet" — so an
    // existence test built on the read's errno calls this healthy and stays silent. It is not healthy:
    // the door is charging nobody. Presence is asked with `lstat`, which sees the link itself.
    served = await serveHome(home, { limit: COUNTING });
    symlinkSync(join(home, "nothing-is-here.json"), locksPath(home));
    expect(readLocks(home).size).toBe(0);
    const io = testIo();
    expect(await run(["user", "unlock", "--all", "--home", home], io.io)).toBe(1);
    expect(io.err.join("\n")).toMatch(/cannot be read/);
    expect(io.err.join("\n")).toMatch(/charging no name any delay/);
  });

  it("(o7) a read fault SELF-REPAIRS on the next failed login, discarding what it could not read", async () => {
    // The correction that matters most about fail-open: it is not a standing outage. `readLocks` returns
    // nothing, then `noteFailure` writes a whole new table over the damage — so one unauthenticated
    // failed login repairs the file AND throws away every record nobody could parse. An operator who
    // wants those counts has to act before the next attempt, which is why `unlock` says so.
    // Bytes that are not JSON at all, so the WHOLE table is unreadable. A file with one damaged entry
    // beside a good one is not this case — `readLocks` returns the good one and the door charges it.
    writeFileSync(locksPath(home), '{"users": {"victim": {"failures": 9, "lastFai');
    expect(readLocks(home).size).toBe(0);
    served = await serveHome(home, { limit: STEPPED });

    // ONE failed login for a different name replaces the file.
    expect((await missOnce("attacker", 1)).status).toBe(401);
    const after = readLocks(home);
    expect(after.size).toBe(1);
    expect(after.has("attacker")).toBe(true);
    // AT THE BYTES, because the claim is about bytes. `readLocks` returned nothing BEFORE the write
    // too, so `has("victim") === false` is satisfied by a table that never had it and by one that
    // salvaged those bytes under a key `isRecord` rejects — and `unreadableRecordFile` goes silent
    // either way once one valid row exists. Only reading the file distinguishes discarded from hidden.
    expect(readFileSync(locksPath(home), "utf8")).not.toContain("victim");
    expect(after.has("victim")).toBe(false); // and the reader agrees with the bytes

    // and the file is healthy again: the count grows from here, and unlock reports no fault
    expect((await missOnce("attacker", 2)).status).toBe(401);
    expect(readLocks(home).get("attacker")?.failures).toBe(2);
    const io = testIo();
    expect(await run(["user", "unlock", "--all", "--home", home], io.io)).toBe(0);
    expect(io.err.join("\n")).toBe("");
  });

  it("(o7) a DIRECTORY at the path does NOT self-repair, on a writable home", async () => {
    // The other side of the rail above, and the reason its claim is about the PATH rather than the home.
    // This home is writable — the temp file lands beside the directory without complaint — and the
    // rename onto a directory still answers EISDIR. So the fault persists, and any wording that says
    // "if the home is writable it repairs" is wrong for exactly this case.
    mkdirSync(locksPath(home));
    const faults: string[] = [];
    served = await serveHome(home, { limit: STEPPED, onFault: (m) => faults.push(m) });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await missOnce("attacker", attempt)).status).toBe(401);
    }
    // No row was ever written, so nobody is charged and the fault is still there after three attempts.
    expect(readLocks(home).size).toBe(0);
    expect(delayMs(home, "attacker", Date.now(), STEPPED)).toBe(0);
    expect(faults.length).toBeGreaterThanOrEqual(3); // the operator hears it on every attempt
    // and the home really is writable, so the directory is the whole reason
    const probe = join(home, "probe.tmp");
    writeFileSync(probe, "x");
    rmSync(probe, { force: true });
  });

  it("(o6) a table of nothing but SPENT rows is cleared when maxTracked is below one", () => {
    // The bound's floor, by the route the in-memory prune hides. Every row is spent, so the prune empties
    // the map before the below-one branch looks at it — and a size test on the PRUNED map skips the write
    // and leaves those rows on disk forever, breaking the bound at exactly the value the branch defends.
    const home2 = makeHome();
    try {
      const brief: LimitPolicy = { baseDelayMs: 1, maxDelayMs: 4, forgetMs: 1, maxTracked: 0 };
      writeFileSync(
        locksPath(home2),
        JSON.stringify({
          users: { a: { failures: 9, lastFailureAt: 1 }, b: { failures: 3, lastFailureAt: 2 } },
        }),
      );
      expect(readLocks(home2).size).toBe(2); // the rows really are on disk, and long spent
      noteFailure(home2, "c", Date.now(), brief);
      expect(readLocks(home2).size).toBe(0); // cleared from DISK, not merely from the map
    } finally {
      dropHome(home2);
    }
  });

  it("(p) unlock reports the COUNT it cleared, never a wait it cannot know", async () => {
    // The command runs in a different process from the door and was never told the door's policy. A
    // wait is a property of that policy, so naming one here would be a guess; the count is a fact.
    served = await serveHome(home, { limit: COUNTING });
    for (let attempt = 1; attempt <= 3; attempt += 1) await missOnce("myk", attempt);
    const io = testIo();
    expect(await run(["user", "unlock", "myk", "--home", home], io.io)).toBe(0);
    expect(io.out.join("\n")).toMatch(/3 failed attempts/);
  });

  it("(o) a damaged lock file is discarded, not adopted: the count still accumulates", async () => {
    // login-locks.json fails OPEN by design — it is a work budget, not an authorization surface, and a
    // local disk fault must not make every login slow with no way to clear it. Failing open is not the
    // same as adopting garbage, though: an entry that is not a record must be dropped, or the counter
    // it feeds becomes NaN and the delay is never charged at all.
    writeFileSync(
      locksPath(home),
      JSON.stringify({ users: { myk: "waiting forever", wren: { failures: "many" } } }),
    );
    served = await serveHome(home, { limit: LONG });
    // fail-open: the garbage delayed nobody
    const { ms, res } = await timed(tryPassword("wren", WREN));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(UNWAITED_MS);
    // and the real count still works, from zero
    expect((await missOnce("myk", 1)).status).toBe(401);
    expect(readLocks(home).get("myk")?.failures).toBe(1);
  });

  it("(o) a record written by an older shape is dropped, not half-read", async () => {
    // The retired lock carried `firstFailureAt` and `lockedUntil`. Reading such a row as a delay
    // record would leave the timestamp undefined, and an undefined stamp makes every comparison
    // false — so it is refused as a record at all, which is this file's fail-open direction.
    writeFileSync(
      locksPath(home),
      JSON.stringify({
        users: {
          myk: { failures: 5, firstFailureAt: Date.now(), lockedUntil: Date.now() + 900_000 },
        },
      }),
    );
    expect(readLocks(home).size).toBe(0);
    served = await serveHome(home, { limit: LONG });
    const { ms, res } = await timed(tryPassword("myk", PASSWORD));
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(UNWAITED_MS);
  });

  it("(o) a successful login clears the count: the next miss starts from one", async () => {
    // A correct password is what `loam user unlock` prints as the ordinary cure, so the count must
    // reset on success. Without this, four misses then a good login then one miss charges the
    // operator for five — and every other rail here stays green, because none of them passes
    // mid-count.
    served = await serveHome(home, { limit: COUNTING });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await missOnce("myk", attempt)).status, `first run miss ${attempt}`).toBe(401);
    }
    expect(readLocks(home).get("myk")?.failures).toBe(4);
    expect((await tryPassword("myk", PASSWORD)).status).toBe(200);
    expect(readLocks(home).has("myk")).toBe(false);
    expect((await missOnce("myk", 5)).status).toBe(401);
    expect(readLocks(home).get("myk")?.failures).toBe(1);
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
    expect(readLocks(home).size).toBe(0);
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

  it("(o3) the hash cap still bites on the FAR SIDE of a wait", async () => {
    // The other half of (o3), and it belongs in THIS describe rather than beside its twin, because it
    // needs what this home has: one hash that lasts about a second.
    //
    // Four attempts for one name wake from their wait within a few milliseconds of each other, against
    // ONE hash slot. That only settles deterministically when a hash outlasts the stagger by orders of
    // magnitude — at the fast home's cost it does not, and asserting a count there is a coin flip that
    // reads like a rail. Here the first waker holds the slot for ~1s, so the other three are refused
    // every time.
    //
    // Asserting only "every status is 401 or 503" would prove nothing: those are the only two a wrong
    // password can produce now that no login path emits 429, and the pair stays green with the cap
    // removed entirely. The COUNT of refusals is what goes red then.
    const brief: LimitPolicy = {
      baseDelayMs: 300,
      maxDelayMs: 300,
      forgetMs: 600_000,
      maxTracked: 8,
    };
    slow = await serveHome(slowHome, { limit: brief, maxConcurrentHashes: 1 });
    expect((await slowTry("myk", "wrong once")).status).toBe(401); // one failure: later attempts wait

    const begun = await Promise.all([1, 2, 3, 4].map(() => beginLogin(slow.base)));
    const flight = begun.map((b, i) =>
      inFlight(
        postLogin(slow.base, "myk", `wrong ${i}`, { cookie: b.cookie, formToken: b.formToken }),
      ),
    );
    // Witnessed 150ms into a 300ms wait, which is a REAL window: an attempt that had already answered
    // would have flipped its flag by now. Read after a bare `drained()` instead, this check is true for
    // any door at all and excludes nothing.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      flight.map((f) => f.running()),
      "an attempt answered inside its own wait: the four did not overlap",
    ).toEqual([true, true, true, true]);

    const answered = await Promise.all(flight.map((f) => f.wait));
    expect(answered.filter((r) => r.status === 503)).toHaveLength(3);
    expect(answered.filter((r) => r.status === 401)).toHaveLength(1);
    // and a refusal for want of budget is not a failed attempt: one compare, so one more count
    expect(readLocks(slowHome).get("myk")?.failures).toBe(2);
  });
});
