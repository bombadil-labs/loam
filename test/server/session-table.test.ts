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

    // The table's own record is a digest, never the secret: shape and value both differ.
    const digests = table.tokenDigests(id);
    expect(digests).toHaveLength(1);
    const digest = digests[0]!;
    expect(digest).not.toBe(secret);
    expect(digest).toBe(createHash("sha256").update(secret!).digest("hex")); // independent compute
    expect(digest).toHaveLength(64); // sha256 hex
    expect(secret).not.toHaveLength(64); // base64url of 32 random bytes — a different shape

    // Positive control: the freshly minted token resolves.
    expect(table.resolveToken(secret!)).toBe("dana");

    // Negative, two-sided: past the TOKEN's own TTL but well inside the SESSION's idle window, the
    // token no longer resolves even though the session itself is still open.
    clock = 101;
    expect(table.resolveToken(secret!)).toBeUndefined();
    expect(table.touch(id)).toEqual({ user: "dana" });
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
