// §36 phase 9 — the login delay (T130). Criteria 1–16 of .adlc/specs/36-09-the-login-delay.md,
// transcribed. Two levels, as CLAUDE.md requires: the pure delay functions are driven directly with
// an injected clock (delta level — what is in the file), and the login door is driven as a real
// listening server with an injected `waitFor` (object level — what the door answers).
//
// NO REAL SLEEP IS EVER ASSERTED. The wait is served by an injected `waitFor` whose gate the test
// controls, so a "still in flight" witness is a settled-flag read after a microtask flush, never a
// stopwatch. Every concurrency fixture carries that witness (criterion 7): it asserts the attempt it
// claims is waiting has NOT settled while the gate is closed, and a positive control proves the
// witness can tell the difference.
//
// What this file deliberately does NOT assert: a timing FLOOR (a duration rail is a flake by
// construction — the delay table is pinned through `delayFor`'s return value instead); and the squat
// is stated with its cost, never railed as a defence (criterion 10).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// A fault switch the mock reads. Hoisted so the `vi.mock` factory can close over it. Both writes
// delegate to the real module unless the matching flag is set, so the unit tests below still run the
// real `noteFailure`/`forgetFailures` while criterion 9 can make either write throw on demand.
const faults = vi.hoisted(() => ({ note: false, forget: false }));
vi.mock("../../src/server/login-locks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/login-locks.js")>();
  return {
    ...actual,
    noteFailure: (home: string, name: string, now: number, policy: actualPolicy): void => {
      if (faults.note) throw new Error("simulated write fault (noteFailure)");
      actual.noteFailure(home, name, now, policy);
    },
    forgetFailures: (home: string, name: string): void => {
      if (faults.forget) throw new Error("simulated write fault (forgetFailures)");
      actual.forgetFailures(home, name);
    },
  };
});

// Imported AFTER the mock so the unit calls route through the (delegating) mock — proving the door
// and the units share one module surface.
import {
  delayFor,
  delayMs,
  delayMsIn,
  locksPath,
  noteFailure,
  readLocks,
  type LimitPolicy,
} from "../../src/server/login-locks.js";
type actualPolicy = LimitPolicy;

vi.setConfig({ testTimeout: 20000 });

const OPERATOR_SEED = "0e".repeat(32);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
// A wait-policy for the DOOR: a positive base so an accrued name owes a non-zero wait the injected
// gate can hold. The millisecond values never elapse — `waitFor` is injected in every door test.
const DOOR_LIMIT: LimitPolicy = {
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  forgetMs: 900_000,
  maxTracked: 512,
};
// A tiny pinnable policy for the unit tests, so the table can be written as literals.
const P: LimitPolicy = { baseDelayMs: 200, maxDelayMs: 1600, forgetMs: 900_000, maxTracked: 4 };
const T = 1_000_000; // a fixed wall-clock origin for the injected `limitNow`.

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  faults.note = false;
  faults.forget = false;
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "loam-login-delay-"));
  homes.push(home);
  return home;
};

interface Shape {
  readonly ground?: Record<string, readonly ("operator" | "actor")[]>;
  readonly passwords?: Record<string, string>;
  readonly scryptFor?: Record<string, ScryptParams>;
}

async function loginServer(
  shape: Shape,
  doorOptions: Record<string, unknown> = {},
): Promise<{ base: string; handle: ServerHandle; home: string }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const author = authorForSeed(OPERATOR_SEED);
  for (const [name, roles] of Object.entries(shape.ground ?? {})) {
    await gateway.append([signClaims(userClaims(name, author, ts++), OPERATOR_SEED)]);
    for (const role of roles)
      await gateway.append([signClaims(roleClaims(name, role, author, ts++), OPERATOR_SEED)]);
  }
  const home = scratchHome();
  const users: Record<string, Awaited<ReturnType<typeof hashPassword>>> = {};
  for (const [name, password] of Object.entries(shape.passwords ?? {}))
    users[name] = await hashPassword(password, shape.scryptFor?.[name] ?? CHEAP);
  writeCredentials(home, { version: 1, users });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default", limit: DOOR_LIMIT, limitNow: () => T, ...doorOptions },
  });
  handles.push(handle);
  return { base: handle.url, handle, home };
}

const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;
const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));

/** A fresh stateless pre-session: the nonce cookie to present and the token that matches it. */
async function formPair(base: string): Promise<{ token: string; nonceCookie: string }> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!;
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  return { token, nonceCookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie)}` };
}

/** POST a credential with a valid nonce+token pair, plus any extra headers (e.g. X-Forwarded-For). */
async function attemptLogin(
  base: string,
  user: string,
  password: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const pair = await formPair(base);
  return fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: pair.nonceCookie,
      ...SAME_ORIGIN,
      ...headers,
    },
    body: new URLSearchParams({ form_token: pair.token, user, password }).toString(),
  });
}

// A settled-flag witness. `isSettled()` is read after a microtask/macrotask flush; a request parked
// in the injected wait CANNOT respond, so its flag stays false — that is the in-flight witness.
function track<T>(p: Promise<T>): { promise: Promise<T>; isSettled: () => boolean } {
  let settled = false;
  const promise = p.then(
    (v) => ((settled = true), v),
    (e: unknown) => {
      settled = true;
      throw e;
    },
  );
  return { promise, isSettled: () => settled };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

// An injectable, GATED `waitFor`: it records each owed value, counts entries, and blocks until
// `release()` is called. `untilEntered(n)` resolves once `n` attempts are parked inside it.
function makeGate(): {
  waitFor: (ms: number) => Promise<void>;
  owed: number[];
  untilEntered: (n: number) => Promise<void>;
  release: () => void;
} {
  const owed: number[] = [];
  let entered = 0;
  const waiters: Array<{ n: number; resolve: () => void }> = [];
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const waitFor = async (ms: number): Promise<void> => {
    owed.push(ms);
    entered += 1;
    for (const w of waiters) if (entered >= w.n) w.resolve();
    await released;
  };
  const untilEntered = (n: number): Promise<void> =>
    new Promise((resolve) => (entered >= n ? resolve() : waiters.push({ n, resolve })));
  return { waitFor, owed, untilEntered, release };
}
// A pass-through wait for the door tests that only need the delay recorded, never held.
const immediateWait = async (): Promise<void> => {};

const statusOf = (r: Response): number => r.status;

describe("§36 phase 9 — the login delay (unit: the delay functions)", () => {
  it("delayFor doubles per failure and caps, against pinned literals", () => {
    expect(delayFor(0, P)).toBe(0);
    expect(delayFor(1, P)).toBe(200);
    expect(delayFor(2, P)).toBe(400);
    expect(delayFor(3, P)).toBe(800);
    expect(delayFor(4, P)).toBe(1600);
    expect(delayFor(5, P)).toBe(1600); // capped, not 3200
    expect(delayFor(64, P)).toBe(1600); // 2 ** 63 → still a finite number at the cap
  });

  it("a flood against one name leaves a different name at zero wait", () => {
    const home = scratchHome();
    for (let i = 0; i < 10; i++) noteFailure(home, "target", T, P);
    expect(delayMs(home, "target", T, P)).toBe(P.maxDelayMs); // 10 failures → capped
    expect(delayMs(home, "bystander", T, P)).toBe(0); // never failed → nothing owed
  });

  it("a wall-clock step backwards leaves the accumulated wait in place", () => {
    const locks = new Map([["target", { failures: 3, lastFailureAt: T }]]);
    expect(delayMsIn(locks, "target", T, P)).toBe(800);
    // The clock steps a full window BACKWARD: elapsed is negative, never past forgetMs, so the wait
    // stands. A record's decay must only fire on genuine silence, never on a clock correction.
    expect(delayMsIn(locks, "target", T - P.forgetMs, P)).toBe(800);
    expect(delayMsIn(locks, "target", 0, P)).toBe(800);
  });

  it("inside the forget window the wait persists", () => {
    const home = scratchHome();
    noteFailure(home, "target", T, P); // count 1
    expect(delayMs(home, "target", T + P.forgetMs, P)).toBe(200); // exactly at the edge: not spent
  });

  it("past the forget window the name starts clean", () => {
    const home = scratchHome();
    noteFailure(home, "target", T, P);
    expect(delayMs(home, "target", T + P.forgetMs + 1, P)).toBe(0); // one ms past → spent → clean
    // And the NEXT failure starts the count over at 1, not where it left off.
    noteFailure(home, "target", T + P.forgetMs + 1, P);
    expect(delayMs(home, "target", T + P.forgetMs + 1, P)).toBe(200);
  });

  it("the table is bounded at maxTracked and evicts the weakest", () => {
    const home = scratchHome();
    // Five distinct names, one failure each, seated oldest-first. maxTracked is 4.
    for (const name of ["a", "b", "c", "d", "e"]) noteFailure(home, name, T, P);
    const locks = readLocks(home);
    expect(locks.size).toBe(4); // bounded
    expect(locks.has("a")).toBe(false); // the oldest, weakest row was evicted
    expect(locks.has("e")).toBe(true); // the newest survives
  });

  it("a wide squat holds a chosen name at zero and does not decay", () => {
    const home = scratchHome();
    // The attacker fills the table with junk, so the target's row is never present at guess time.
    for (const f of ["f1", "f2", "f3", "f4"]) noteFailure(home, f, T, P);
    expect(delayMs(home, "target", T, P)).toBe(0); // target absent → 0
    noteFailure(home, "target", T, P); // the guess seats the target (count 1), evicting one junk
    // The attacker re-floods with maxTracked fresh seatings; the target (count 1, oldest) is evicted.
    for (const g of ["g1", "g2", "g3", "g4"]) noteFailure(home, g, T, P);
    expect(readLocks(home).has("target")).toBe(false);
    expect(delayMs(home, "target", T, P)).toBe(0);
    // It does NOT decay: a full forget window of silence leaves the target still at zero, because its
    // row is gone rather than merely old. No waiting on the defender's part erodes a wide squat.
    expect(delayMs(home, "target", T + P.forgetMs + 1, P)).toBe(0);
  });

  it("a narrow squat holds zero until one idle window, then the charge returns", () => {
    const home = scratchHome();
    // Junk held STRONGER than the target (count 2), filling the table.
    for (const f of ["f1", "f2", "f3", "f4"])
      for (let i = 0; i < 2; i++) noteFailure(home, f, T, P);
    expect(delayMs(home, "target", T, P)).toBe(0);
    noteFailure(home, "target", T, P); // seats target at count 1 (strict weakest), evicting one junk
    // The attacker refreshes with one fresh seating, evicting the weakest — the target.
    noteFailure(home, "f5", T, P);
    expect(readLocks(home).has("target")).toBe(false);
    expect(delayMs(home, "target", T, P)).toBe(0); // squatted
    // DECAY: the attacker stops refreshing. One forget window later the junk is spent, so the
    // target's next seating survives and the charge returns.
    noteFailure(home, "target", T + P.forgetMs + 1, P);
    expect(delayMs(home, "target", T + P.forgetMs + 1, P)).toBe(200);
  });

  it("a damaged record file reads as no records", () => {
    const home = scratchHome();
    writeFileSync(locksPath(home), "this is not json {", "utf8");
    expect(readLocks(home).size).toBe(0); // fail-open: unparseable → none, never a throw
  });
});

describe("§36 phase 9 — the login delay (door: what it answers)", () => {
  it("twenty failures do not lock, and a correct password is still admitted", async () => {
    const { base } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait },
    );
    for (let i = 0; i < 20; i++) {
      const res = await attemptLogin(base, "myk", "wrong");
      expect(res.status).toBe(401); // a refusal, NEVER a lockout status
    }
    const ok = await attemptLogin(base, "myk", PASSWORD);
    expect(ok.status).toBe(200); // admitted after any number of failures — the whole promise
    expect(await ok.text()).toContain("Signed in");
  });

  it("pays the wait before the compare, so a hit and a miss block alike", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor },
    );
    noteFailure(home, "myk", T, DOOR_LIMIT); // seat a row so both attempts owe a wait
    const hit = track(attemptLogin(base, "myk", PASSWORD));
    const miss = track(attemptLogin(base, "myk", "wrong"));
    await gate.untilEntered(2);
    await flush();
    // WITNESS: neither has answered. If the wait were paid AFTER the compare, the miss (or the hit)
    // would already carry its status — which is the timing leak criterion 3 forbids.
    expect(hit.isSettled()).toBe(false);
    expect(miss.isSettled()).toBe(false);
    gate.release();
    // Positive control: once the wait is released, the two DO diverge — so the block was the wait,
    // not a hang, and the door is genuinely deciding hit vs miss.
    expect(statusOf(await hit.promise)).toBe(200);
    expect(statusOf(await miss.promise)).toBe(401);
  });

  it("a waiting attempt holds no hash slot, so another name gets in", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { a: ["operator"], b: ["operator"] }, passwords: { a: PASSWORD, b: PASSWORD } },
      { waitFor: gate.waitFor, maxConcurrentHashes: 1 },
    );
    noteFailure(home, "a", T, DOOR_LIMIT); // a owes a wait; b owes none
    const waiting = track(attemptLogin(base, "a", PASSWORD));
    await gate.untilEntered(1);
    // b never enters the gate (owes nothing) and completes on the single hash slot — which proves the
    // parked attempt for a is NOT holding it.
    const other = await attemptLogin(base, "b", PASSWORD);
    expect(other.status).toBe(200);
    await flush();
    expect(waiting.isSettled()).toBe(false); // WITNESS: a is still parked in its wait
    gate.release();
    expect(statusOf(await waiting.promise)).toBe(200);
  });

  it("the concurrency fixtures prove their held attempt is genuinely in flight", async () => {
    // The witness itself, under test. A GATED wait leaves the attempt unsettled; an IMMEDIATE wait
    // lets the same attempt settle. If both read the same way, every concurrency rail above is
    // vacuous, so this is their positive control.
    const gate = makeGate();
    const gated = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor },
    );
    noteFailure(gated.home, "myk", T, DOOR_LIMIT);
    const held = track(attemptLogin(gated.base, "myk", PASSWORD));
    await gate.untilEntered(1);
    await flush();
    expect(held.isSettled()).toBe(false); // the gate holds it

    const open = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait },
    );
    noteFailure(open.home, "myk", T, DOOR_LIMIT);
    const free = track(attemptLogin(open.base, "myk", PASSWORD));
    await free.promise;
    await flush();
    expect(free.isSettled()).toBe(true); // an un-gated wait DOES settle — the witness can tell

    gate.release();
    await held.promise;
  });

  it("two overlapping failures each increment the count", async () => {
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait },
    );
    // Fire two wrong-password attempts together. `noteFailure` re-reads the file itself with no await
    // between read and write, so the second increment sees the first — the count reads two, not one.
    // A snapshot carried across the hash would make the limit maxFailures × concurrency.
    const [r1, r2] = await Promise.all([
      attemptLogin(base, "myk", "wrong"),
      attemptLogin(base, "myk", "wrong"),
    ]);
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(readLocks(home).get("myk")?.failures).toBe(2);
  });

  it("the applied wait equals delayFor(count) whichever way the clock steps", async () => {
    const gate = makeGate();
    const forward = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor, limitNow: () => T + 5_000 }, // clock ahead of the seeded row
    );
    noteFailure(forward.home, "myk", T, DOOR_LIMIT); // count 1 → delayFor(1) = base
    const p = track(attemptLogin(forward.base, "myk", PASSWORD));
    await gate.untilEntered(1);
    expect(gate.owed).toEqual([DOOR_LIMIT.baseDelayMs]); // NOT a deadline against lastFailureAt
    gate.release();
    await p.promise;

    const back = makeGate();
    const backward = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: back.waitFor, limitNow: () => T - 5_000 }, // clock behind the seeded row
    );
    noteFailure(backward.home, "myk", T, DOOR_LIMIT);
    const q = track(attemptLogin(backward.base, "myk", PASSWORD));
    await back.untilEntered(1);
    expect(back.owed).toEqual([DOOR_LIMIT.baseDelayMs]); // same wait, unmoved by the backward step
    back.release();
    await q.promise;
  });

  it("a write fault on record still admits a correct password (fail-open, no budget)", async () => {
    const faultsSeen: string[] = [];
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait, onFault: (m: string) => faultsSeen.push(m) },
    );
    faults.note = true; // every noteFailure throws
    const miss = await attemptLogin(base, "myk", "wrong");
    expect(miss.status).toBe(401); // a write fault must NOT become a 503
    expect(faultsSeen.some((m) => m.includes("login-locks.json"))).toBe(true); // named to the operator
    expect(readLocks(home).size).toBe(0); // fail-open means NO budget at all — no row was written
    const ok = await attemptLogin(base, "myk", PASSWORD);
    expect(ok.status).toBe(200); // and the correct password is still admitted
  });

  it("a write fault on the success-clear path still admits the correct password", async () => {
    const faultsSeen: string[] = [];
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait, onFault: (m: string) => faultsSeen.push(m) },
    );
    noteFailure(home, "myk", T, DOOR_LIMIT); // a row exists, so a successful login tries to clear it
    faults.forget = true; // the clear write throws
    const ok = await attemptLogin(base, "myk", PASSWORD);
    expect(ok.status).toBe(200); // the correct password is admitted despite the clear-write fault
    expect(cookiesOf(ok).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true); // seated
    expect(faultsSeen.some((m) => m.includes("login-locks.json"))).toBe(true);
  });

  it("N concurrent attempts pay one wait, not N (no rate bound is sound)", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor, maxConcurrentHashes: 8 },
    );
    noteFailure(home, "myk", T, DOOR_LIMIT); // count 1 → each concurrent attempt owes delayFor(1)
    const N = 5;
    const attempts = Array.from({ length: N }, () => track(attemptLogin(base, "myk", "wrong")));
    await gate.untilEntered(N);
    await flush();
    // Each attempt read the ONE count and paid the ONE wait — N entries, all equal — not a queue that
    // serialises N waits. So a caller buys maxConcurrentHashes guesses per wait; a per-second bound
    // would be wrong by orders of magnitude.
    expect(gate.owed).toEqual(Array(N).fill(DOOR_LIMIT.baseDelayMs));
    for (const a of attempts) expect(a.isSettled()).toBe(false);
    gate.release();
    for (const a of attempts) expect(statusOf(await a.promise)).toBe(401);
  });

  it("twenty failures from twenty forwarded addresses accumulate one wait on the name", async () => {
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait },
    );
    // A rotated X-Forwarded-For is the caller's to write. An IP-keyed limiter would reset every time;
    // a username-keyed one accumulates one growing wait on the name.
    for (let i = 0; i < 20; i++) {
      const res = await attemptLogin(base, "myk", "wrong", { "x-forwarded-for": `203.0.113.${i}` });
      expect(res.status).toBe(401);
    }
    expect(readLocks(home).get("myk")?.failures).toBe(20); // one row, twenty failures — keyed on the name
    expect(delayMs(home, "myk", T, DOOR_LIMIT)).toBe(DOOR_LIMIT.maxDelayMs); // one capped wait
    expect(readLocks(home).size).toBe(1); // no per-address rows leaked in
  });

  it("the failure count keys on the same string the credential lookup uses", async () => {
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait },
    );
    for (let i = 0; i < 3; i++) await attemptLogin(base, "myk", "wrong");
    // The count sits under the exact username the credential lookup uses — no normalization between
    // the two, so two surface forms cannot split one credential's count across two rows.
    expect(readLocks(home).get("myk")?.failures).toBe(3);
    expect(delayMs(home, "myk", T, DOOR_LIMIT)).toBe(delayFor(3, DOOR_LIMIT));
    expect(delayMs(home, "MYK", T, DOOR_LIMIT)).toBe(0); // a different string is a different key
  });

  it("the cap is re-checked after the wait, so a second released waiter draws the 503", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor, maxConcurrentHashes: 1 },
    );
    noteFailure(home, "myk", T, DOOR_LIMIT); // both attempts read this count and owe a wait
    const first = track(attemptLogin(base, "myk", PASSWORD));
    await gate.untilEntered(1);
    const second = track(attemptLogin(base, "myk", "wrong"));
    await gate.untilEntered(2);
    await flush();
    expect(first.isSettled()).toBe(false);
    expect(second.isSettled()).toBe(false);
    gate.release();
    const statuses = [statusOf(await first.promise), statusOf(await second.promise)];
    // Both cleared the wait, THEN contended for the one hash slot. Exactly one drew the 503 — proof
    // the cap is read after the wait (never before it) and refuses the surplus rather than queueing it.
    expect(statuses.filter((s) => s === 503)).toHaveLength(1);
    expect(statuses).toContain(200);
  });

  it("the hash cap refuses the surplus attempt rather than queueing it", async () => {
    // A genuinely slow hash holds the one slot; probes meet the cap and are refused, then recover
    // once the slot frees. The in-flight witness: if the slow hash settled before any probe met the
    // cap, the fixture proved nothing and SAYS so.
    const SLOW: ScryptParams = { N: 65536, r: 8, p: 2, keylen: 32 };
    const { base } = await loginServer(
      {
        ground: { myk: ["operator"], slow: ["operator"] },
        passwords: { myk: PASSWORD, slow: "ponderous" },
        scryptFor: { slow: SLOW },
      },
      { waitFor: immediateWait, maxConcurrentHashes: 1 },
    );
    // One stateless pair serves every POST here (reusable by design), so a probe pays no per-probe
    // page load and can meet the cap before the slow hash drains.
    const pair = await formPair(base);
    const post = (user: string, password: string): Promise<Response> =>
      fetch(`${base}/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: pair.nonceCookie,
          ...SAME_ORIGIN,
        },
        body: new URLSearchParams({ form_token: pair.token, user, password }).toString(),
      });
    let slowSettled = false;
    const slow = post("slow", "ponderous").then((r) => ((slowSettled = true), r));
    let busy: Response | undefined;
    while (busy === undefined && !slowSettled) {
      const probe = await post("myk", PASSWORD);
      if (probe.status === 503) busy = probe;
    }
    expect(busy, "the slow hash settled before any probe met the cap").toBeDefined();
    expect((await busy!.text()).toLowerCase()).toContain("busy");
    expect((await slow).status).toBe(200); // drained, the slow correct password is admitted
    expect((await attemptLogin(base, "myk", PASSWORD)).status).toBe(200); // and the door recovers
  });

  it.skipIf(process.platform === "win32")(
    "a FIFO at the record path is refused, not opened",
    { timeout: 4000 },
    async () => {
      const { base, home } = await loginServer(
        { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
        { waitFor: immediateWait },
      );
      // A FIFO here would park readFileSync — and the whole single-threaded login door — forever
      // (T120). The stat guard must refuse it. If the guard regressed, this login never answers and
      // the 4s timeout fails the suite VISIBLY rather than hanging silently.
      execFileSync("mkfifo", [locksPath(home)]);
      const res = await attemptLogin(base, "myk", PASSWORD);
      expect(res.status).toBe(200); // the door answered — the FIFO was refused, never opened
    },
  );

  it("a directory at the record path is refused by name", async () => {
    const faultsSeen: string[] = [];
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait, onFault: (m: string) => faultsSeen.push(m) },
    );
    mkdirSync(locksPath(home)); // a directory is not a regular file
    const miss = await attemptLogin(base, "myk", "wrong");
    expect(miss.status).toBe(401); // the read is refused (fail-open), so the login still answers
    // The WRITE cannot land on a directory, and that fault is named to the operator by its path —
    // not one generic message for every fault.
    expect(faultsSeen.some((m) => m.includes("login-locks.json"))).toBe(true);
  });
});
