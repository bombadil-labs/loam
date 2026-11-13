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

import {
  DEFAULT_LIMIT,
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
const DOOR_LIMIT: LimitPolicy = {
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  forgetMs: 900_000,
  maxTracked: 512,
};
const P: LimitPolicy = { baseDelayMs: 200, maxDelayMs: 1600, forgetMs: 900_000, maxTracked: 4 };
const T = 1_000_000;

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

async function formPair(base: string): Promise<{ token: string; nonceCookie: string }> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!;
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  return { token, nonceCookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie)}` };
}

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
const immediateWait = async (): Promise<void> => {};

const statusOf = (r: Response): number => r.status;

describe("§36 phase 9 — the login delay (unit: the delay functions)", () => {
  it("delayFor doubles per failure and caps, against pinned literals", () => {
    expect(delayFor(0, P)).toBe(0);
    expect(delayFor(1, P)).toBe(200);
    expect(delayFor(2, P)).toBe(400);
    expect(delayFor(3, P)).toBe(800);
    expect(delayFor(4, P)).toBe(1600);
    expect(delayFor(5, P)).toBe(1600);
    expect(delayFor(64, P)).toBe(1600);
  });

  it("a flood against one name leaves a different name at zero wait", () => {
    const home = scratchHome();
    for (let i = 0; i < 10; i++) noteFailure(home, "target", T, P);
    expect(delayMs(home, "target", T, P)).toBe(P.maxDelayMs);
    expect(delayMs(home, "bystander", T, P)).toBe(0);
  });

  it("a wall-clock step backwards leaves the accumulated wait in place", () => {
    const locks = new Map([["target", { failures: 3, lastFailureAt: T }]]);
    expect(delayMsIn(locks, "target", T, P)).toBe(800);
    expect(delayMsIn(locks, "target", T - P.forgetMs, P)).toBe(800);
    expect(delayMsIn(locks, "target", 0, P)).toBe(800);
  });

  it("inside the forget window the wait persists", () => {
    const home = scratchHome();
    noteFailure(home, "target", T, P);
    expect(delayMs(home, "target", T + P.forgetMs, P)).toBe(200);
  });

  it("past the forget window the name starts clean", () => {
    const home = scratchHome();
    noteFailure(home, "target", T, P);
    expect(delayMs(home, "target", T + P.forgetMs + 1, P)).toBe(0);
    noteFailure(home, "target", T + P.forgetMs + 1, P);
    expect(delayMs(home, "target", T + P.forgetMs + 1, P)).toBe(200);
  });

  it("the table is bounded at maxTracked", () => {
    const home = scratchHome();
    for (const name of ["a", "b", "c", "d", "e"]) noteFailure(home, name, T, P);
    expect(readLocks(home).size).toBe(4);
  });

  it("eviction takes the OLDEST among equal-failure rows, not the first inserted", () => {
    const home = scratchHome();
    noteFailure(home, "newer", T + 100, P);
    noteFailure(home, "older", T, P);
    noteFailure(home, "keepA", T + 100, P);
    noteFailure(home, "keepB", T + 100, P);
    noteFailure(home, "fresh", T + 200, P);
    const locks = readLocks(home);
    expect(locks.has("older")).toBe(false);
    expect(locks.has("newer")).toBe(true);
  });

  it("DEFAULT_LIMIT pins the shipped policy constants", () => {
    expect(DEFAULT_LIMIT).toEqual({
      baseDelayMs: 250,
      maxDelayMs: 5_000,
      forgetMs: 900_000,
      maxTracked: 512,
    });
  });

  it("readLocks keeps a well-formed row and drops every malformed entry shape", () => {
    const home = scratchHome();
    writeFileSync(
      locksPath(home),
      JSON.stringify({
        users: {
          good: { failures: 3, lastFailureAt: T },
          zero: { failures: 0, lastFailureAt: T },
          nullEntry: null,
          notObject: 5,
          noStamp: { failures: 2 },
          stringStamp: { failures: 2, lastFailureAt: "soon" },
          floatFailures: { failures: 1.5, lastFailureAt: T },
          negFailures: { failures: -1, lastFailureAt: T },
        },
      }),
      "utf8",
    );
    const locks = readLocks(home);
    expect([...locks.keys()].sort()).toEqual(["good", "zero"]);
    expect(locks.get("good")?.failures).toBe(3);
  });

  it("a wide squat holds a chosen name at zero and does not decay", () => {
    const home = scratchHome();
    for (const f of ["f1", "f2", "f3", "f4"]) noteFailure(home, f, T, P);
    expect(delayMs(home, "target", T, P)).toBe(0);
    noteFailure(home, "target", T, P);
    for (const g of ["g1", "g2", "g3", "g4"]) noteFailure(home, g, T, P);
    expect(readLocks(home).has("target")).toBe(false);
    expect(delayMs(home, "target", T, P)).toBe(0);
    expect(delayMs(home, "target", T + P.forgetMs + 1, P)).toBe(0);
  });

  it("a narrow squat holds zero until one idle window, then the charge returns", () => {
    const home = scratchHome();
    for (const f of ["f1", "f2", "f3", "f4"])
      for (let i = 0; i < 2; i++) noteFailure(home, f, T, P);
    expect(delayMs(home, "target", T, P)).toBe(0);
    noteFailure(home, "target", T, P);
    noteFailure(home, "f5", T, P);
    expect(readLocks(home).has("target")).toBe(false);
    expect(delayMs(home, "target", T, P)).toBe(0);
    noteFailure(home, "target", T + P.forgetMs + 1, P);
    expect(delayMs(home, "target", T + P.forgetMs + 1, P)).toBe(200);
  });

  it("a damaged record file reads as no records", () => {
    const home = scratchHome();
    writeFileSync(locksPath(home), "this is not json {", "utf8");
    expect(readLocks(home).size).toBe(0);
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
      expect(res.status).toBe(401);
    }
    const ok = await attemptLogin(base, "myk", PASSWORD);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Signed in");
  });

  it("pays the wait before the compare, so a hit and a miss block alike", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor },
    );
    noteFailure(home, "myk", T, DOOR_LIMIT);
    const hit = track(attemptLogin(base, "myk", PASSWORD));
    const miss = track(attemptLogin(base, "myk", "wrong"));
    await gate.untilEntered(2);
    await flush();
    expect(gate.owed).toEqual([DOOR_LIMIT.baseDelayMs, DOOR_LIMIT.baseDelayMs]);
    expect(hit.isSettled()).toBe(false);
    expect(miss.isSettled()).toBe(false);
    gate.release();
    expect(statusOf(await hit.promise)).toBe(200);
    expect(statusOf(await miss.promise)).toBe(401);
  });

  it("a waiting attempt holds no hash slot, so another name gets in", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { a: ["operator"], b: ["operator"] }, passwords: { a: PASSWORD, b: PASSWORD } },
      { waitFor: gate.waitFor, maxConcurrentHashes: 1 },
    );
    noteFailure(home, "a", T, DOOR_LIMIT);
    const waiting = track(attemptLogin(base, "a", PASSWORD));
    await gate.untilEntered(1);
    const other = await attemptLogin(base, "b", PASSWORD);
    expect(other.status).toBe(200);
    await flush();
    expect(waiting.isSettled()).toBe(false);
    gate.release();
    expect(statusOf(await waiting.promise)).toBe(200);
  });

  it("the concurrency fixtures prove their held attempt is genuinely in flight", async () => {
    const gate = makeGate();
    const gated = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor },
    );
    noteFailure(gated.home, "myk", T, DOOR_LIMIT);
    const held = track(attemptLogin(gated.base, "myk", PASSWORD));
    await gate.untilEntered(1);
    await flush();
    expect(held.isSettled()).toBe(false);

    const open = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait },
    );
    noteFailure(open.home, "myk", T, DOOR_LIMIT);
    const free = track(attemptLogin(open.base, "myk", PASSWORD));
    await free.promise;
    await flush();
    expect(free.isSettled()).toBe(true);

    gate.release();
    await held.promise;
  });

  it("two overlapping failures each increment the count", async () => {
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait },
    );
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
      { waitFor: gate.waitFor, limitNow: () => T + 5_000 },
    );
    noteFailure(forward.home, "myk", T, DOOR_LIMIT);
    const p = track(attemptLogin(forward.base, "myk", PASSWORD));
    await gate.untilEntered(1);
    expect(gate.owed).toEqual([DOOR_LIMIT.baseDelayMs]);
    gate.release();
    await p.promise;

    const back = makeGate();
    const backward = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: back.waitFor, limitNow: () => T - 5_000 },
    );
    noteFailure(backward.home, "myk", T, DOOR_LIMIT);
    const q = track(attemptLogin(backward.base, "myk", PASSWORD));
    await back.untilEntered(1);
    expect(back.owed).toEqual([DOOR_LIMIT.baseDelayMs]);
    back.release();
    await q.promise;
  });

  it("any positive owed wait is served, down to a single millisecond", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor, limit: { ...DOOR_LIMIT, baseDelayMs: 1 } },
    );
    noteFailure(home, "myk", T, { ...DOOR_LIMIT, baseDelayMs: 1 });
    const p = track(attemptLogin(base, "myk", PASSWORD));
    await gate.untilEntered(1);
    expect(gate.owed).toEqual([1]);
    await flush();
    expect(p.isSettled()).toBe(false);
    gate.release();
    await p.promise;
  });

  it("a write fault on record still admits a correct password (fail-open, no budget)", async () => {
    const faultsSeen: string[] = [];
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait, onFault: (m: string) => faultsSeen.push(m) },
    );
    faults.note = true;
    const miss = await attemptLogin(base, "myk", "wrong");
    expect(miss.status).toBe(401);
    expect(faultsSeen.some((m) => m.includes("login-locks.json"))).toBe(true);
    expect(readLocks(home).size).toBe(0);
    const ok = await attemptLogin(base, "myk", PASSWORD);
    expect(ok.status).toBe(200);
  });

  it("a write fault on the success-clear path still admits the correct password", async () => {
    const faultsSeen: string[] = [];
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait, onFault: (m: string) => faultsSeen.push(m) },
    );
    noteFailure(home, "myk", T, DOOR_LIMIT);
    faults.forget = true;
    const ok = await attemptLogin(base, "myk", PASSWORD);
    expect(ok.status).toBe(200);
    expect(cookiesOf(ok).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    expect(faultsSeen.some((m) => m.includes("login-locks.json"))).toBe(true);
  });

  it("N concurrent attempts pay one wait, not N (no rate bound is sound)", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor, maxConcurrentHashes: 8 },
    );
    noteFailure(home, "myk", T, DOOR_LIMIT);
    const N = 5;
    const attempts = Array.from({ length: N }, () => track(attemptLogin(base, "myk", "wrong")));
    await gate.untilEntered(N);
    await flush();
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
    for (let i = 0; i < 20; i++) {
      const res = await attemptLogin(base, "myk", "wrong", { "x-forwarded-for": `203.0.113.${i}` });
      expect(res.status).toBe(401);
    }
    expect(readLocks(home).get("myk")?.failures).toBe(20);
    expect(delayMs(home, "myk", T, DOOR_LIMIT)).toBe(DOOR_LIMIT.maxDelayMs);
    expect(readLocks(home).size).toBe(1);
  });

  it("the failure count keys on the same string the credential lookup uses", async () => {
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait },
    );
    for (let i = 0; i < 3; i++) await attemptLogin(base, "myk", "wrong");
    expect(readLocks(home).get("myk")?.failures).toBe(3);
    expect(delayMs(home, "myk", T, DOOR_LIMIT)).toBe(delayFor(3, DOOR_LIMIT));
    expect(delayMs(home, "MYK", T, DOOR_LIMIT)).toBe(0);
  });

  it("the cap is re-checked after the wait, so a second released waiter draws the 503", async () => {
    const gate = makeGate();
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: gate.waitFor, maxConcurrentHashes: 1 },
    );
    noteFailure(home, "myk", T, DOOR_LIMIT);
    const first = track(attemptLogin(base, "myk", PASSWORD));
    await gate.untilEntered(1);
    const second = track(attemptLogin(base, "myk", "wrong"));
    await gate.untilEntered(2);
    await flush();
    expect(first.isSettled()).toBe(false);
    expect(second.isSettled()).toBe(false);
    gate.release();
    const statuses = [statusOf(await first.promise), statusOf(await second.promise)];
    expect(statuses.filter((s) => s === 503)).toHaveLength(1);
    expect(statuses).toContain(200);
  });

  it("the hash cap refuses the surplus attempt rather than queueing it", async () => {
    const SLOW: ScryptParams = { N: 65536, r: 8, p: 2, keylen: 32 };
    const { base } = await loginServer(
      {
        ground: { myk: ["operator"], slow: ["operator"] },
        passwords: { myk: PASSWORD, slow: "ponderous" },
        scryptFor: { slow: SLOW },
      },
      { waitFor: immediateWait, maxConcurrentHashes: 1 },
    );
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
    expect((await slow).status).toBe(200);
    expect((await attemptLogin(base, "myk", PASSWORD)).status).toBe(200);
  });

  it.skipIf(process.platform === "win32")(
    "a FIFO at the record path is refused, not opened",
    { timeout: 4000 },
    async () => {
      const { base, home } = await loginServer(
        { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
        { waitFor: immediateWait },
      );
      execFileSync("mkfifo", [locksPath(home)]);
      const res = await attemptLogin(base, "myk", PASSWORD);
      expect(res.status).toBe(200);
    },
  );

  it("a directory at the record path is refused by name", async () => {
    const faultsSeen: string[] = [];
    const { base, home } = await loginServer(
      { ground: { myk: ["operator"] }, passwords: { myk: PASSWORD } },
      { waitFor: immediateWait, onFault: (m: string) => faultsSeen.push(m) },
    );
    mkdirSync(locksPath(home));
    const miss = await attemptLogin(base, "myk", "wrong");
    expect(miss.status).toBe(401);
    expect(faultsSeen.some((m) => m.includes("login-locks.json"))).toBe(true);
  });
});
