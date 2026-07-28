// §36 phase 4 — the session table (T125). Six criteria, transcribed from
// .adlc/specs/36-04-the-session-table.md. Every negative assertion below carries a positive control
// in the same test (plan §2.3): a rail that only asserts "undefined" would also pass on an unrelated
// bug, so each test first proves the mechanism resolves at all, then proves the one behaviour under
// test turns it off. No test computes its expected value from the code under test's own arithmetic —
// every clock value is a hand-written literal.
//
// This phase adds no door and reads no cookie, so nothing here touches `node:http` or a cookie
// header — that is phase 5.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSessionTable } from "../../src/server/session.js";

describe("§36 phase 4 — the session table", () => {
  // Criterion 1
  it("refuses a session past its idle window", () => {
    let clock = 1_000;
    const table = createSessionTable({ idleMs: 1_000, now: () => clock });
    const opened = table.open("alice");
    expect(opened).toBeDefined();
    const id = opened!.id;

    // Positive control: well within the idle window, touch resolves.
    clock = 1_500;
    expect(table.touch(id)).toEqual({ user: "alice" });

    // Negative: past the (now-slid) idle window, touch refuses.
    clock = 1_500 + 1_000 + 1;
    expect(table.touch(id)).toBeUndefined();
  });

  // Supports criterion 1 and 4: the documented defaults (`SessionTableOptions`'s docstrings) are
  // pinned literals, not read back from the code under test.
  it("defaults to a 30-minute idle window and a 4096-session cap", () => {
    let clock = 0;
    const table = createSessionTable({ now: () => clock });
    const opened = table.open("default-idle");
    const id = opened!.id;

    clock = 30 * 60_000; // exactly the documented default — still within the window
    expect(table.touch(id)).toEqual({ user: "default-idle" });
    clock = 30 * 60_000 + 30 * 60_000 + 1; // one more full default window past the slide, plus 1ms
    expect(table.touch(id)).toBeUndefined();

    const capTable = createSessionTable({ now: () => 0 });
    for (let i = 0; i < 4096; i++) {
      expect(capTable.open(`user-${i}`)).toBeDefined();
    }
    expect(capTable.size).toBe(4096);
    expect(capTable.open("one-too-many")).toBeUndefined();
  });

  // Criterion 2
  it("does not let a wall-clock step backwards revive an expired session", () => {
    let clock = 1_000_000;
    const table = createSessionTable({ idleMs: 1_000, now: () => clock });
    const opened = table.open("bob");
    expect(opened).toBeDefined();
    const id = opened!.id;

    // Drive the clock past the idle window: expiry is genuinely detected (this is criterion 1's own
    // assertion, doubling as the positive control that the detection path runs at all).
    clock = 1_000_000 + 1_000 + 1;
    expect(table.touch(id)).toBeUndefined();

    // Now step the clock BACKWARDS, well before the original open() reading. A design that checked
    // liveness by re-reading a settable wall clock live could see this as "no time has passed" and
    // treat the session as still good; this table cannot, because the row was already deleted the
    // moment expiry was found.
    clock = 500;
    expect(table.touch(id)).toBeUndefined();
  });

  // Criterion 3
  it("invalidates every session across a restart — a fresh table starts empty", () => {
    const clock = 1_000;
    const before = createSessionTable({ idleMs: 60_000, now: () => clock });
    const opened = before.open("carol");
    expect(opened).toBeDefined();
    const id = opened!.id;
    expect(before.touch(id)).toEqual({ user: "carol" }); // positive control: the id is genuinely live

    // A process restart is a fresh module load, which is a fresh createSessionTable() call — no
    // channel carries state between the two. State this is deliberate for one operator (§9a): there
    // is no persistence layer this phase owes a migration to.
    const after = createSessionTable({ idleMs: 60_000, now: () => clock });
    expect(after.touch(id)).toBeUndefined();
  });

  // Criterion 4 — the cap, and the sweep-on-open fix for an abandoned session
  it("holds at most its cap, never evicts a live session, and reclaims an abandoned one", () => {
    let clock = 0;
    const table = createSessionTable({ idleMs: 1_000, maxSessions: 2, now: () => clock });
    const first = table.open("a");
    const second = table.open("b");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(table.size).toBe(2);

    // Negative: the table is full, a third open refuses.
    expect(table.open("c")).toBeUndefined();

    // Positive control: refusing a new session did not evict either live one.
    expect(table.touch(first!.id)).toEqual({ user: "a" });
    expect(table.touch(second!.id)).toEqual({ user: "b" });

    // Two-sided on the sweep fix: once both existing sessions are genuinely past their idle window,
    // a later open() reclaims the space rather than refusing forever.
    clock = 1_000 + 1;
    const third = table.open("c");
    expect(third).toBeDefined();
    expect(table.size).toBe(1);
  });

  // Criterion 5 — digest storage, and the TTL-isolation fix
  it("holds a minted token as a digest with its own TTL, isolated from the session's idle window", () => {
    let clock = 0;
    const table = createSessionTable({ idleMs: 10_000, now: () => clock });
    const opened = table.open("dana");
    const id = opened!.id;

    const secret = table.mintToken(id, 100);
    expect(secret).toBeDefined();

    // The table's own record is a digest, never the secret: shape and value both differ. 32 random
    // bytes as base64url is exactly 43 characters (pinned, not derived from `secret`'s own length —
    // a caller minting the wrong byte count would not be caught by comparing the secret to itself).
    const digests = table.tokenDigests(id);
    expect(digests).toHaveLength(1);
    const digest = digests[0]!;
    expect(digest).not.toBe(secret);
    expect(digest).toBe(createHash("sha256").update(secret!).digest("hex")); // independent compute
    expect(digest).toHaveLength(64); // sha256 hex
    expect(secret).toHaveLength(43); // base64url of exactly 32 random bytes

    // Positive control: the freshly minted token resolves.
    expect(table.resolveToken(secret!)).toBe("dana");

    // touch() prunes a session's own expired digests as a side effect — but must not prune a digest
    // that is NOT yet expired. Mint a second, long-lived token, touch the session while it is still
    // good, and confirm it survived the prune (a mutated prune that deletes on PRESENCE rather than
    // EXPIRY would fail this).
    const longLived = table.mintToken(id, 10_000);
    const longLivedDigest = table.tokenDigests(id).find((d) => d !== digest)!;
    expect(table.touch(id)).toEqual({ user: "dana" });
    expect(table.resolveToken(longLived!)).toBe("dana");
    expect(table.tokenDigests(id)).toHaveLength(2);

    // Negative, two-sided: past the FIRST token's own TTL but well inside the SESSION's idle window,
    // it no longer resolves even though the session itself is still open. touch()'s prune must
    // actually remove the expired digest (a mutated prune that never fires on expiry would leave it
    // behind, even though resolveToken's own check would still refuse it) while leaving the still-
    // good digest in place (a mutated prune that deletes on presence rather than expiry would not).
    clock = 101;
    expect(table.resolveToken(secret!)).toBeUndefined();
    expect(table.touch(id)).toEqual({ user: "dana" });
    expect(table.tokenDigests(id)).toEqual([longLivedDigest]);
    expect(table.resolveToken(longLived!)).toBe("dana");
  });

  // Criterion 6
  it("revokes every token a session minted when the session is dropped", () => {
    const table = createSessionTable({ idleMs: 10_000 });
    const opened = table.open("erin");
    const id = opened!.id;
    const secret = table.mintToken(id, 5_000);

    // Positive control: resolution works before revocation is even in play.
    expect(table.resolveToken(secret!)).toBe("erin");

    table.drop(id);

    expect(table.resolveToken(secret!)).toBeUndefined();
    expect(table.touch(id)).toBeUndefined();
  });
});
