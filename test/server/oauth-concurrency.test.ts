// §37 (T114), criteria (s) (t) (u): oauth.json under pressure.
//
// The file is the only durable half of §37, and it holds the connector's SIGNING SEED. So three
// things have to be true of it: a race cannot mint two identities for one connector, a write cannot
// leave a half-file or a world-readable one behind, and a file this door cannot parse must refuse the
// flow rather than guess.
//
// (u) is H7 at the file layer. "Cannot determine what this file says" is never "it says nothing" —
// treating an unparseable oauth.json as an empty one would silently re-mint a seed for a connector
// that already has one, and the old grant would stay in the ground with nobody holding its key.

import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { PASSWORD, bootStore, createUser, dropHome, makeHome, signIn } from "./user-fixture.js";
import {
  LOCK_STALE_MS,
  OAuthFileBusy,
  OAuthFileUnreadable,
  oauthLockPath,
  oauthPath,
  readOAuthFile,
  withOAuthFile,
  writeOAuthFile,
} from "../../src/server/oauth-file.js";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import {
  CLAUDE_REDIRECT,
  approve,
  bearer,
  codeFrom,
  formTokenIn,
  getAuthorize,
  mcp,
  pkce,
  redeem,
  register,
  serveOAuth,
  wellFormedAuthorize,
  type ServedOAuth,
} from "./oauth-fixture.js";

vi.setConfig({ testTimeout: 30000 });

const SEED = "11".repeat(32);
const SEED_AUTHOR = authorForSeed(SEED);

let home: string;
let served: ServedOAuth;
let session: { cookie: string; formToken: string };

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  served = await serveOAuth(home);
  session = await signIn(served.base);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

/** One authorize → approve, yielding a redeemable code for `clientId`. */
async function codeFor(
  clientId: string,
  redirectUri = CLAUDE_REDIRECT,
): Promise<{ code: string; verifier: string }> {
  const secret = pkce();
  const params = {
    ...wellFormedAuthorize(clientId, secret.challenge),
    redirect_uri: redirectUri,
  };
  const page = await getAuthorize(served.base, params, session.cookie);
  expect(page.res.status).toBe(200);
  const approved = await approve(served.base, params, {
    cookie: session.cookie,
    formToken: formTokenIn(page.body),
  });
  expect(approved.status).toBe(302);
  return { code: codeFrom(approved)!, verifier: secret.verifier };
}

describe("(s) two concurrent first-grants", () => {
  it("end with exactly ONE minted seed, and both tokens resolve to it", async () => {
    // The interleaving this closes: read oauth.json, see no seed for this client, mint one, await the
    // grant append, write the file. Two redemptions in that window each mint — and the second write
    // wins, leaving one seed holding a token and one orphan grant in the ground forever.
    const client = await register(served.base);
    expect(client.status).toBe(201);
    const first = await codeFor(client.clientId);
    const second = await codeFor(client.clientId);

    const body = (c: { code: string; verifier: string }) => ({
      grant_type: "authorization_code",
      code: c.code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: client.clientId,
      code_verifier: c.verifier,
    });
    // Issued together, deliberately not awaited in turn.
    const [a, b] = await Promise.all([
      redeem(served.base, body(first)),
      redeem(served.base, body(second)),
    ]);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);

    const file = readOAuthFile(home);
    expect(file.grants.length).toBe(1);
    expect(file.tokens.length).toBe(2);
    expect(new Set(file.tokens.map((t) => t.clientId))).toEqual(new Set([client.clientId]));

    // BOTH tokens work, and both write as the SAME author — the object-level half. A file holding one
    // seed while one of the two tokens resolves to nothing would pass the counts above.
    for (const token of [a.body["access_token"], b.body["access_token"]] as string[]) {
      const res = await mcp(
        served.base,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        bearer(token),
      );
      expect(res.status).toBe(200);
    }
  });

  it("four at once still end with one seed", async () => {
    const client = await register(served.base);
    const codes = await Promise.all([
      codeFor(client.clientId),
      codeFor(client.clientId),
      codeFor(client.clientId),
      codeFor(client.clientId),
    ]);
    const results = await Promise.all(
      codes.map((c) =>
        redeem(served.base, {
          grant_type: "authorization_code",
          code: c.code,
          redirect_uri: CLAUDE_REDIRECT,
          client_id: client.clientId,
          code_verifier: c.verifier,
        }),
      ),
    );
    expect(results.map((r) => r.res.status)).toEqual([200, 200, 200, 200]);
    const file = readOAuthFile(home);
    expect(file.grants.length).toBe(1);
    expect(file.tokens.length).toBe(4);
  });

  it("two concurrent grants for DIFFERENT clients mint two seeds, and lose neither", async () => {
    // The other direction. A mutex that serialised on one global key and then re-read a stale snapshot
    // would drop one of these writes entirely.
    const one = await register(served.base);
    const two = await register(served.base);
    const [ca, cb] = [await codeFor(one.clientId), await codeFor(two.clientId)];
    const [a, b] = await Promise.all([
      redeem(served.base, {
        grant_type: "authorization_code",
        code: ca.code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: one.clientId,
        code_verifier: ca.verifier,
      }),
      redeem(served.base, {
        grant_type: "authorization_code",
        code: cb.code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: two.clientId,
        code_verifier: cb.verifier,
      }),
    ]);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    const file = readOAuthFile(home);
    expect(file.grants.length).toBe(2);
    expect(new Set(file.grants.map((g) => g.clientId))).toEqual(
      new Set([one.clientId, two.clientId]),
    );
    expect(file.tokens.length).toBe(2);
  });

  it("concurrent registrations all land — no write is lost", async () => {
    const results = await Promise.all([
      register(served.base),
      register(served.base),
      register(served.base),
      register(served.base),
      register(served.base),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = new Set(results.map((r) => r.clientId));
    expect(ids.size).toBe(5);
    expect(new Set(readOAuthFile(home).clients.map((c) => c.clientId))).toEqual(ids);
  });
});

describe("(s) the cross-process lock", () => {
  // The interleaving no in-process rail can reach: `loam grant revoke` runs in ANOTHER process, and the
  // server writes this file too. Whichever wrote second used to spread a snapshot taken before the
  // other's change and silently discard it — and the direction that discards the REVOKE leaves the
  // operator told a connector was closed while its token still opens the door.
  //
  // WHAT THESE RAILS REACH, named rather than numbered — an ordinal here goes stale the moment a rail is
  // added, and the wrong ordinals then read as authoritative.
  //
  // In this process, on the lock PRIMITIVE: a held lock blocks and writes nothing; a stale lock is
  // broken; the lock is released even when the callback throws; a writer that did not create it never
  // enters the callback; and a writer whose lock is stolen mid-callback refuses rather than overwriting
  // the thief.
  //
  // Across processes: ONE rail spawns a second OS process and contends for real. That is the only honest
  // test of a cross-process lock, because everything synchronous on one thread passes whether or not
  // anything locks at all.
  //
  // WHAT THEY DO NOT REACH, two things, both named because a reader will look for them.
  //
  // The guarantee here is about the WRITE, not about the callback. A stale-break race can put two
  // writers inside `work` at once, and only the loser's write is refused; no rail asserts that, because
  // it is not a property this lock claims. `withOAuthFile`'s docstring says which window stays open and
  // why closing it needs a compare-and-swap the filesystem does not offer.
  //
  // And `claimLock` makes the lock and its owner's name appear in ONE atomic step, by hard-linking from
  // a temp that already holds the nonce. No rail here can see that: by the time any callback runs, the
  // name is present either way, so a rail written for it passes against the two-step form it replaced —
  // measured, not assumed. The property is proven by reading `claimLock`, and the reason it matters is
  // that every ownership test in that file reads the name.

  it("a held lock blocks a second writer rather than letting it overwrite", () => {
    // The discriminating assertion for the lock's existence. Without it, `withOAuthFile` reads and
    // writes straight through and this passes instantly with the other writer's change gone.
    writeOAuthFile(home, readOAuthFile(home));
    const before = readOAuthFile(home);
    writeFileSync(oauthLockPath(home), `${process.pid}\n`);
    try {
      expect(() =>
        withOAuthFile(home, (file) => ({
          next: { ...file, clients: [] },
          result: undefined,
        })),
      ).toThrow(OAuthFileBusy);
      // And it wrote NOTHING while it waited — a lock that threw after writing would be worse than none.
      expect(readOAuthFile(home)).toEqual(before);
    } finally {
      rmSync(oauthLockPath(home), { force: true });
    }
    // With the lock gone the same call succeeds, so the refusal above was the lock and not the payload.
    expect(() => withOAuthFile(home, (file) => ({ next: file, result: undefined }))).not.toThrow();
  });

  it("a STALE lock is broken, so a crashed writer cannot wedge the store forever", () => {
    writeFileSync(oauthLockPath(home), "1\n");
    const past = Date.now() - LOCK_STALE_MS - 5_000;
    utimesSync(oauthLockPath(home), new Date(past), new Date(past));
    const seen = withOAuthFile(home, (file) => ({ result: file.clients.length }));
    expect(seen).toBe(0);
    // And the lock is released rather than left behind by the writer that broke it.
    expect(existsSync(oauthLockPath(home))).toBe(false);
  });

  it("the lock is released even when the work throws", () => {
    expect(() =>
      withOAuthFile(home, () => {
        throw new Error("the work failed");
      }),
    ).toThrow("the work failed");
    expect(existsSync(oauthLockPath(home))).toBe(false);
    // The next writer is not blocked by the failed one.
    expect(() => withOAuthFile(home, (file) => ({ next: file, result: 0 }))).not.toThrow();
  });

  it("(v) TWO PROCESSES contending both land their write", async () => {
    // A REAL PROCESS BOUNDARY, and the reason the in-process version of this rail was deleted:
    // `withOAuthFile`'s callback is synchronous by design and `cmdGrant` is synchronous throughout, so
    // two of them on one thread cannot interleave. `Promise.all` over them ran the first to completion
    // before the second started, and its assertions held whether or not anything locked at all.
    //
    // The child is BUNDLED with esbuild: nothing among this repo's dependencies is a TypeScript loader a
    // spawned `node` could use — vitest transforms in its own process and cannot lend that to a child —
    // esbuild is already a dependency, and the output runs on plain node.
    const entry = fileURLToPath(new URL("./oauth-lock-child.mts", import.meta.url));
    const bundle = join(home, "lock-child.mjs");
    await esbuild.build({
      entryPoints: [entry],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      // Dependencies are bundled IN rather than left external: the output lives in the temp home, and
      // node resolves a bare import relative to the importing file, which from /tmp finds no
      // node_modules at all. `oauth-file.ts` reaches only node builtins and one pure-JS package, so
      // there is nothing native to leave behind.
      logLevel: "silent",
    });
    writeOAuthFile(home, readOAuthFile(home));

    // The child takes the lock and HOLDS it for 400ms inside its locked section.
    //
    // The hold is generous on purpose, and the parent's 2s wait budget is not the constraint that
    // decides it: the parent waits with a SYNCHRONOUS `Atomics.wait`, so its budget is unaffected by
    // event-loop load. What load does affect is the parent's ability to OBSERVE the lock before the
    // child releases it — the discovery poll below runs on the event loop — so a long hold is the safe
    // direction, and the assertion after the acquire is written not to care how long it is.
    const spawned = new Promise<void>((resolve, reject) => {
      const proc = spawn(process.execPath, [bundle, home, "child-one", "400"], {
        stdio: ["ignore", "ignore", "pipe"],
        cwd: process.cwd(),
      });
      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`child exited ${String(code)}: ${stderr}`)),
      );
    });

    // Wait until the child actually holds it, so the parent's acquire genuinely contends.
    //
    // RACED AGAINST THE CHILD'S OWN EXIT. If the child dies before it ever creates the lock, a bare
    // discovery loop burns its whole timeout, fails on a confusing assertion, and leaves `spawned`
    // rejecting unawaited — which surfaces as an unhandled rejection attributed to a LATER test. This
    // way the child's failure is the failure this rail reports.
    let held = false;
    await Promise.race([
      spawned.then(() => {
        throw new Error("the child finished before the parent ever saw its lock");
      }),
      (async () => {
        const from = Date.now();
        while (Date.now() - from < 20_000) {
          if (existsSync(oauthLockPath(home))) {
            held = true;
            return;
          }
          await new Promise((r) => setTimeout(r, 2));
        }
      })(),
    ]);
    expect(held).toBe(true);

    // The parent's write, issued while the child holds the lock. It must WAIT, not overwrite.
    //
    // NO TIMING FLOOR, and that is a correction rather than a gap: "the acquire took at least one poll
    // interval" is unsound, because the lock is observed on the event loop and claimed after it, so a
    // stall spanning the child's whole hold leaves the child released before the parent's first claim —
    // which then succeeds with no pause at all, through no fault of the lock.
    //
    // WHAT REPLACES IT IS AN OBSERVATION FROM INSIDE THE CALLBACK, and it needs no clock at all.
    //
    // Serialization means the LATER writer reads the earlier one's finished work. The child claims,
    // reads, busy-waits, and writes LAST, releasing only after that — so a parent that genuinely waited
    // must find `child-one` already in the file.
    //
    // WHICH ROW GOES MISSING WITHOUT THE LOCK, traced rather than guessed: the parent enters at once and
    // writes immediately, and the child then writes at the end of its hold, spreading the snapshot it
    // read before `parent-one` existed. So `parent-one` is the row that disappears and `child-one`
    // survives — which is why the assertion below is about the child's row being ALREADY THERE, and why
    // that is the one that speaks first. `toContain("child-one")` would still pass.
    let sawChildAlready = false;
    withOAuthFile<undefined>(home, (file) => {
      sawChildAlready = file.clients.some((c) => c.clientId === "child-one");
      return {
        next: {
          ...file,
          clients: [
            ...file.clients,
            {
              clientId: "parent-one",
              clientName: "parent-one",
              redirectUris: ["https://claude.ai/parent"],
              registeredAt: Date.now(),
              generation: 1,
            },
          ],
        },
        result: undefined,
      };
    });
    await spawned;

    // THE PARENT REALLY WAITED: its callback read a file the child had already finished writing. This is
    // the assertion that catches a missing lock most directly.
    expect(sawChildAlready).toBe(true);
    // And BOTH writes survived. Without the lock the child writes last and spreads a snapshot taken
    // before the parent's write, so `parent-one` is the row that disappears.
    const ids = readOAuthFile(home).clients.map((c) => c.clientId);
    expect(ids).toContain("child-one");
    expect(ids).toContain("parent-one");
    // The lock is released rather than left behind by either.
    expect(existsSync(oauthLockPath(home))).toBe(false);
  });

  it("a writer that did NOT create the lock never enters the callback", () => {
    // The acquire-side ownership question, from the only angle one process can ask it: a live lock held
    // by someone else must keep this writer OUT of `work` entirely, not merely refuse its write. A
    // callback that ran here would have read the file and could have had a side effect.
    writeOAuthFile(home, readOAuthFile(home));
    writeFileSync(oauthLockPath(home), "someone-else\n");
    let entered = false;
    try {
      expect(() =>
        withOAuthFile<undefined>(home, (file) => {
          entered = true;
          return { next: file, result: undefined };
        }),
      ).toThrow(OAuthFileBusy);
      expect(entered).toBe(false);
      // The holder's lock is untouched: a writer that never had it must not release it.
      expect(readFileSync(oauthLockPath(home), "utf8")).toBe("someone-else\n");
    } finally {
      rmSync(oauthLockPath(home), { force: true });
    }
  });

  it("a writer whose lock is STOLEN refuses rather than writing over the thief", () => {
    // Breaking a stale lock by PATH cannot be made race-free: two writers can both decide the same lock
    // is stale, and the second removal deletes the FIRST one's fresh lock. Both would then be inside the
    // callback at once, which is the whole bug this lock exists to prevent. So ownership is proven by
    // the nonce in the file rather than assumed from a successful create.
    writeOAuthFile(home, readOAuthFile(home));
    const before = readOAuthFile(home);
    expect(() =>
      withOAuthFile<undefined>(home, (file) => {
        // Simulate the theft: another writer broke this lock and took it, mid-callback.
        writeFileSync(oauthLockPath(home), "someone-else\n");
        return {
          next: {
            ...file,
            clients: [
              ...file.clients,
              {
                clientId: "should-not-land",
                clientName: "x",
                redirectUris: [],
                registeredAt: 1,
                generation: 1,
              },
            ],
          },
          result: undefined,
        };
      }),
    ).toThrow(OAuthFileBusy);
    // NOTHING was written, and the thief's lock is still there — this writer must not delete it.
    expect(readOAuthFile(home)).toEqual(before);
    expect(readFileSync(oauthLockPath(home), "utf8")).toBe("someone-else\n");
    rmSync(oauthLockPath(home), { force: true });
  });
});

describe("a lock the door cannot take", () => {
  // TWO CLASSES, ONE ANSWER TO A CALLER. `OAuthFileBusy` (someone holds it, or a stale break took it)
  // and `OAuthFileUnlockable` (this home's filesystem has no hard links) both mean "the lock could not
  // be taken". Their messages name the lock's ABSOLUTE PATH, and the unlockable one also names a serve
  // flag — and both of these doors are unauthenticated and answer with `access-control-allow-origin: *`.
  // So the caller gets a fixed string and the operator gets the detail, which is the same split every
  // other local fault in §37 makes.
  //
  // WHICH CLASS THESE RAILS REACH: `OAuthFileBusy` only. Pre-creating the lock is the one way a real
  // filesystem produces a contended claim, and every rail below induces it that way. Reaching the other
  // class needs `linkSync` to fail some way no filesystem state can arrange, so
  // `oauth-lock-unsupported.test.ts` mocks it in its own file and asserts the doors' answers there.

  it("(u) tells the caller nothing about the home, and tells the operator everything", async () => {
    // Induced by holding the lock from outside: the door waits its budget, gives up with
    // `OAuthFileBusy`, and answers. Reaching the class is the point — every other rail in this file
    // induces `OAuthFileUnreadable` instead, which is why they were blind to this one.
    writeOAuthFile(home, readOAuthFile(home));
    writeFileSync(oauthLockPath(home), "someone-else\n");
    try {
      const registered = await register(served.base);
      expect([500, 503]).toContain(registered.status);
      const body = JSON.stringify(registered.body);
      // THE CALLER LEARNS NOTHING. Not the home, not the lock's path, not a flag to probe.
      expect(body).not.toContain(home);
      expect(body).not.toContain("oauth.json");
      // These two describe strings only the OTHER lock class can produce, and this fixture reaches
      // `OAuthFileBusy` alone — `oauth-lock-unsupported.test.ts` induces the unsupported-filesystem
      // class and asserts the door's answer for it. Kept here because they cost nothing and a future
      // catch site that folded the two together would be caught by whichever rail ran first.
      expect(body).not.toContain("oauth-allow-redirect");
      expect(body).not.toContain("hard link");
      // and it does say the true thing, so the refusal is not merely opaque
      expect(body).toMatch(/lock/);

      // THE OPERATOR LEARNS EVERYTHING, on the channel that is theirs alone.
      const said = served.faults.join("\n");
      expect(said).toContain(home);
      expect(said).toMatch(/oauth\.json\.lock/);
    } finally {
      rmSync(oauthLockPath(home), { force: true });
    }
  });

  it("(u) the same split on the token endpoint", async () => {
    // The mint path has its own catch and its own refusal, so it needs its own assertion — the two
    // doors were changed together and could drift apart.
    const client = await register(served.base);
    const code = await codeFor(client.clientId);
    writeFileSync(oauthLockPath(home), "someone-else\n");
    try {
      const redeemed = await redeem(served.base, {
        grant_type: "authorization_code",
        code: code.code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: client.clientId,
        code_verifier: code.verifier,
      });
      expect([500, 503]).toContain(redeemed.res.status);
      const body = JSON.stringify(redeemed.body);
      expect(body).not.toContain(home);
      expect(body).not.toContain("oauth.json");
      expect(body).toMatch(/lock/);
      expect(served.faults.join("\n")).toContain(home);
    } finally {
      rmSync(oauthLockPath(home), { force: true });
    }
  });

  it("(u) a lock fault is NOT reported as a damaged file", async () => {
    // The distinction the caller is entitled to: a home whose lock is held is not a home whose records
    // are corrupt, and sending the operator to read a perfectly good file is the failure this branch
    // exists to prevent. Asserted against the OTHER refusal's wording.
    writeOAuthFile(home, readOAuthFile(home));
    writeFileSync(oauthLockPath(home), "someone-else\n");
    let locked;
    try {
      locked = await register(served.base);
    } finally {
      rmSync(oauthLockPath(home), { force: true });
    }
    expect(JSON.stringify(locked.body)).not.toMatch(/cannot read/);

    // And the damaged-file refusal still says its own thing, so the two are really distinct.
    writeFileSync(oauthPath(home), "{{{ not json");
    const unreadable = await register(served.base);
    expect(JSON.stringify(unreadable.body)).toMatch(/cannot read/);
  });
});

describe("the bounds nothing else counts", () => {
  it("maxCodes bounds the codes in flight, and a lapsed one frees its slot", async () => {
    // Consent is the only thing that mints a code, so this is not an anonymous lever — but an unbounded
    // map is still an unbounded map, and the sweep before the cap is what makes the 503 honest.
    let ticks = 0;
    await served.close();
    served = await serveOAuth(home, {
      oauth: { maxCodes: 2, codeTtlMs: 1000, monotonicNow: () => ticks },
    });
    session = await signIn(served.base);
    const client = await register(served.base);
    await codeFor(client.clientId);
    await codeFor(client.clientId);

    // The third is refused rather than admitted.
    const secret = pkce();
    const params = {
      ...wellFormedAuthorize(client.clientId, secret.challenge),
      redirect_uri: CLAUDE_REDIRECT,
    };
    const page = await getAuthorize(served.base, params, session.cookie);
    const full = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    expect(full.status).toBe(503);
    expect(codeFrom(full)).toBeUndefined();

    // LAPSED CODES FREE THEIR SLOTS, or the cap would be permanent and the 503's advice a lie.
    ticks += 1001;
    const after = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    expect(after.status).toBe(302);
    expect(codeFrom(after)).toMatch(/.+/);
  });

  it("maxTokensPerClient bounds one connector's live tokens", async () => {
    await served.close();
    served = await serveOAuth(home, { oauth: { maxTokensPerClient: 2 } });
    session = await signIn(served.base);
    const client = await register(served.base);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const code = await codeFor(client.clientId);
      const redeemed = await redeem(served.base, {
        grant_type: "authorization_code",
        code: code.code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: client.clientId,
        code_verifier: code.verifier,
      });
      statuses.push(redeemed.res.status);
    }
    expect(statuses).toEqual([200, 200, 400]);
    expect(readOAuthFile(home).tokens.length).toBe(2);
    // One connector's cap is its own: another connector still mints.
    const other = await register(served.base);
    const code = await codeFor(other.clientId);
    const mine = await redeem(served.base, {
      grant_type: "authorization_code",
      code: code.code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: other.clientId,
      code_verifier: code.verifier,
    });
    expect(mine.res.status).toBe(200);
  });
});

describe("(t) the write is atomic and 0600", () => {
  it("a SECOND write over a 0644 file still ends at 0600", async () => {
    // The failure this catches: an open that truncates in place inherits whatever mode the file
    // already had. A first write on a fresh path is created 0600 and looks correct forever.
    const first = await register(served.base);
    expect(first.status).toBe(201);
    chmodSync(oauthPath(home), 0o644);
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o644);
    }
    const second = await register(served.base);
    expect(second.status).toBe(201);
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o600);
    }
    // and the second write did not lose the first client
    expect(readOAuthFile(home).clients.length).toBe(2);
  });

  it("the write REPLACES the file rather than truncating it, and leaves no temp", async () => {
    // The discriminating assertion, and the reason a "does it still parse" loop is not one: awaiting
    // each write means no reader ever runs mid-write, so a plain `writeFileSync` + `chmod` would keep
    // that loop green. `rename` puts a NEW inode at the path; truncate-in-place keeps the old one. So
    // the inode moving is what proves the temp-then-rename, from outside, with no timing at all.
    await register(served.base);
    const first = statSync(oauthPath(home));
    await register(served.base);
    const second = statSync(oauthPath(home));
    if (process.platform !== "win32") {
      expect(second.ino).not.toBe(first.ino);
    }
    // Every state a reader could observe parses, and the temp is not left behind.
    for (let i = 0; i < 4; i += 1) {
      await register(served.base);
      expect(() => readOAuthFile(home)).not.toThrow();
    }
    const leftovers = readdirSync(home).filter(
      (f) => f.startsWith("oauth.json.") && f.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
    // WHAT THIS DOES NOT ASSERT: the fsync. Nothing observable from a test distinguishes a synced
    // write from an unsynced one without a power cut, so durability across a crash rests on reading
    // `writeOAuthFile`. The rail that would close it is a filesystem fault injector, which this suite
    // does not have.
  });

  it("writeOAuthFile applies 0600 to a path that already exists at 0644", () => {
    // The unit-level statement of the same law, so the property is pinned where it lives rather than
    // only through the door that happens to call it today.
    const file = readOAuthFile(home);
    writeOAuthFile(home, file);
    chmodSync(oauthPath(home), 0o644);
    writeOAuthFile(home, file);
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(oauthPath(home), "utf8").endsWith("\n")).toBe(true);
  });
});

describe("(u) a file this door cannot read", () => {
  const corruptions: { label: string; bytes: string }[] = [
    { label: "truncated mid-object", bytes: '{"version":1,"clients":[{"clientId":"a' },
    { label: "empty", bytes: "" },
    { label: "not JSON at all", bytes: "this is not json" },
    { label: "a JSON array", bytes: "[]" },
    { label: "JSON null", bytes: "null" },
    { label: "the wrong version", bytes: '{"version":2,"clients":[],"grants":[],"tokens":[]}' },
    { label: "clients not an array", bytes: '{"version":1,"clients":{},"grants":[],"tokens":[]}' },
    {
      label: "a client with no id",
      bytes:
        '{"version":1,"clients":[{"clientName":"x","redirectUris":[]}],"grants":[],"tokens":[]}',
    },
    {
      label: "a grant whose seed is not hex",
      bytes:
        '{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"zz","actor":"b","grantedAt":1}],"tokens":[]}',
    },
    {
      label: "a grant whose actor disagrees with its seed",
      bytes:
        `{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"${"11".repeat(32)}",` +
        `"actor":"not-the-author-of-that-seed","grantedAt":1,"standing":true}],"tokens":[]}`,
    },
    {
      label: "a grant that does not say whether it stands",
      bytes:
        `{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"${SEED}",` +
        `"actor":"${SEED_AUTHOR}","grantedAt":1}],"tokens":[]}`,
    },
    {
      label: "a client with no generation",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x","redirectUris":[],' +
        '"registeredAt":1}],"grants":[],"tokens":[]}',
    },
    {
      label: "a client whose generation is zero",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x","redirectUris":[],' +
        '"registeredAt":1,"generation":0}],"grants":[],"tokens":[]}',
    },
    {
      // A file edited by hand must not be able to smuggle a forged row into `loam grant list`.
      label: "a client whose name carries a newline",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x\\n    client   forged",' +
        '"redirectUris":[],"registeredAt":1,"generation":1}],"grants":[],"tokens":[]}',
    },
  ];

  it("refuses to parse, with a named error rather than an empty file", () => {
    for (const { label, bytes } of corruptions) {
      writeFileSync(oauthPath(home), bytes);
      let thrown: unknown;
      try {
        readOAuthFile(home);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${label} parsed`).toBeInstanceOf(OAuthFileUnreadable);
      expect(String((thrown as Error).message), `${label} said nothing`).toContain("oauth.json");
    }
  });

  it("refuses the flow rather than crashing the server, and says nothing to the caller", async () => {
    writeFileSync(oauthPath(home), '{"version":1,"clients":[{"clientId":"a');
    // Every OAuth door that needs the file refuses, and none of them 500s with the home's path in it.
    const registered = await register(served.base);
    expect([500, 503]).toContain(registered.status);
    expect(JSON.stringify(registered.body)).not.toContain(home);

    const authorize = await getAuthorize(
      served.base,
      wellFormedAuthorize("some-client", "x".repeat(43)),
      session.cookie,
    );
    expect([400, 500, 503]).toContain(authorize.res.status);
    expect(authorize.body).not.toContain(home);

    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: "nope",
      client_id: "some-client",
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: "v".repeat(43),
    });
    expect([400, 500, 503]).toContain(redeemed.res.status);
    expect(JSON.stringify(redeemed.body)).not.toContain(home);

    // THE SERVER IS ALIVE. The doors that have nothing to do with oauth.json still answer.
    expect((await fetch(`${served.base}/`)).status).toBe(200);
    expect((await fetch(`${served.base}/login`)).status).toBe(200);
    // and a presented bearer token is refused rather than admitted — the file cannot say who holds one
    const probe = await mcp(
      served.base,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      bearer("some-token-that-is-not-in-the-static-table"),
    );
    expect(probe.status).toBe(401);
  });

  it("(u) a REAL token is refused while ANY grant entry is damaged", async () => {
    // The token half of (u), and it was vacuous: the only "presented bearer token" assertion used a
    // token in no table, so its 401 came from an unrelated cause and would have held with the whole
    // corruption check deleted. This mints a real one and damages a DIFFERENT grant.
    //
    // It is also what pins `grantForToken` to the same strictness as `readOAuthFile`. That function
    // exists to skip N key derivations for an UNKNOWN token; an earlier form skipped validating every
    // grant but the one it returned, which made the request path a second, more forgiving parser — a
    // damaged neighbour refused every write and still admitted tokens.
    const client = await register(served.base);
    const code = await codeFor(client.clientId);
    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: code.code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: client.clientId,
      code_verifier: code.verifier,
    });
    expect(redeemed.res.status).toBe(200);
    const token = redeemed.body["access_token"] as string;
    // It works before the damage, or "it stopped working" proves nothing.
    expect(
      (await mcp(served.base, { jsonrpc: "2.0", id: 1, method: "tools/list" }, bearer(token)))
        .status,
    ).toBe(200);

    const sound = readOAuthFile(home);
    const damaged = {
      ...sound,
      grants: [
        ...sound.grants,
        // A SECOND connector's grant, whose actor does not derive from its own seed. Nothing about
        // this entry concerns the live token, which is exactly why a per-entry parser admitted it.
        {
          clientId: "connector-somebody-else",
          actorSeed: "22".repeat(32),
          actor: "ed25519:not-the-author-of-that-seed",
          grantedAt: 1,
          standing: true,
        },
      ],
    };
    writeFileSync(oauthPath(home), `${JSON.stringify(damaged, null, 2)}\n`);
    // The file no longer reads, so the door cannot say who holds this token.
    expect(() => readOAuthFile(home)).toThrow(OAuthFileUnreadable);
    const refused = await mcp(
      served.base,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      bearer(token),
    );
    expect(refused.status).toBe(401);
    // And the operator is TOLD, because a door that silently stopped opening is a swallowed error.
    expect(served.faults.join("\n")).toMatch(/oauth\.json/);
  });

  it("(u) the operator is told, and the caller is not — both halves of every refusal", async () => {
    // `onFault` is the operator's channel and the detail names the home's absolute path, so the two
    // claims are asserted against each other: the message reaches the operator AND not the caller.
    writeFileSync(oauthPath(home), "{{{ not json");
    const registered = await register(served.base);
    expect([500, 503]).toContain(registered.status);
    const said = served.faults.join("\n");
    expect(said).toMatch(/oauth\.json/);
    expect(said).toContain(home);
    expect(JSON.stringify(registered.body)).not.toContain(home);
  });

  it("does not crash the BOOT path either", async () => {
    // A store that will not serve because its oauth.json is damaged is a much worse outage than one
    // that serves every other door and refuses §37. The doors open; §37 refuses.
    await served.close();
    writeFileSync(oauthPath(home), "{{{ not json");
    served = await serveOAuth(home);
    expect((await fetch(`${served.base}/`)).status).toBe(200);
    const res = await register(served.base);
    expect([500, 503]).toContain(res.status);
  });

  it("an ABSENT file is an empty one — a home with no connectors is not damaged", () => {
    rmSync(oauthPath(home), { force: true });
    const file = readOAuthFile(home);
    expect(file).toEqual({ version: 1, clients: [], grants: [], tokens: [] });
  });
});
