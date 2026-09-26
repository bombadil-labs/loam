// The last step-4 readers. Each case reads on both sides of a validity boundary.
//
//   - receive-policy: the receiver's decisions are a governed read. A decision counts only inside
//     its own window at `now`; a withdrawal by the receiver counts only inside its own window.
//   - erasure history: a graveyard or an erasure record keeps counting after its own `validUntil`
//     (erasure is eternal). `readGraveyards`, the cut's graveyard lookup, the completeness check's
//     strike report, `refusedIds` and `standingErasures` all read it that way. A record the
//     operator struck stays struck: the history read does not revive it.
//   - the channel drop: a record negated only for a window gets a new untimed strike, so it stays
//     severed after the window ends. A bystander channel keeps its record.
//   - `survivalOver`: a shipper's strike counts only inside its own window at `now`.
//   - the connections panel's grant label names the true state of a write grant.
//   - the revoke selection names every unnegated operator grant, timed or not (a control).
//
// Named gaps: the grant label is asserted at `connectionGrantState`, not at a served panel;
// `test/server/admin-connections.test.ts` drives the served panel for "revoked" and "active".
// The receive projection has no door; it is asserted at its function.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Reactor,
  authorForSeed,
  makeNegationClaims,
  publishHyperSchemaClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { manifestExportClaims, readManifest } from "../../src/gateway/adopt-law.js";
import { refusedIds, standingErasures } from "../../src/gateway/erase.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { projectLiveReceiving } from "../../src/gateway/receive-policy.js";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { graveyardClaims, graveyardCompleteness, readGraveyards } from "../../src/gateway/slate.js";
import {
  connectionGrantState,
  unnegatedOperatorGrantIds,
} from "../../src/server/admin-federation.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import {
  BEFORE_DEADLINE,
  OP as SLATE_OP,
  OP_SEED as SLATE_SEED,
  REQUESTED_AT,
  bootSlateStore,
  standSlate,
} from "../gateway/slating.js";

afterEach(() => {
  vi.useRealTimers();
});

/** Re-sign `claims` by `seed` with the validity window `window`. */
const within = (
  claims: Claims,
  seed: string,
  window: { validFrom: number; validUntil?: number },
): Delta => signClaims({ ...claims, ...window }, seed);

// --- receive-policy.ts: the receiver's decisions are a governed read ----------------------------

describe("receive policy reads the receiver's decisions at `now`", () => {
  const R = "11".repeat(32);
  const S = "22".repeat(32);
  const X = "33".repeat(32);
  const receiver = authorForSeed(R);
  const author = authorForSeed(S);
  const destination = "alice_outbox";
  const entity = "hyperschema:Plant";
  const T1 = 1_000;
  const T2 = 2_000;

  const decision = (
    value: object,
    seed: string,
    window: { validFrom: number; validUntil?: number },
  ): Delta =>
    within(
      {
        author: authorForSeed(seed),
        timestamp: window.validFrom,
        validFrom: window.validFrom,
        pointers: [
          {
            role: "decision",
            target: {
              kind: "entity",
              entity: { id: "receive-policy", context: "loam.receive.experimental.v1" },
            },
          },
          { role: "payload", target: { kind: "primitive", value: JSON.stringify(value) } },
        ],
      },
      seed,
      window,
    );
  const bindingBody = {
    kind: "binding",
    relationship: "media-to-alice",
    source: "media_log",
    destination,
    sourceAuthor: author,
    entity,
    reading: "Plant",
    mode: "live",
  };
  const curseBody = { kind: "curse", relationship: "media-to-alice", reading: "Plant" };
  const law = (): Delta[] => {
    const c = registrationDeltaClaims(entity, "Plant", PLANT_POLICY, [FERN], author, () => 10);
    return [
      signClaims(publishHyperSchemaClaims(PLANT, entity, author, 10), S),
      ...[c.living, c.snapshot, c.binding].map((x) => signClaims(x, S)),
    ];
  };
  const statusAt = (decisions: Delta[], now: number): string[] =>
    projectLiveReceiving({
      receiver,
      destination,
      decisions,
      sources: [{ id: "media_log", deltas: law() }],
      now,
    }).map((r) => `${r.relationship ?? ""}:${r.status}`);

  it("a curse valid over [T1, T2) curses only inside its window", () => {
    const binding = decision(bindingBody, R, { validFrom: 1 });
    const curse = decision(curseBody, R, { validFrom: T1, validUntil: T2 });
    // Delta level: the curse is the receiver's own, so only its window can set it aside.
    expect(curse.claims.author).toBe(receiver);
    expect(statusAt([binding, curse], T1 - 1)).toEqual(["media-to-alice:selected"]);
    expect(statusAt([binding, curse], T1)).toEqual(["media-to-alice:cursed"]);
    expect(statusAt([binding, curse], T2 - 1)).toEqual(["media-to-alice:cursed"]);
    expect(statusAt([binding, curse], T2)).toEqual(["media-to-alice:selected"]);
  });

  it("a binding valid until T2 serves before T2 and not after; a pause on it then is inert", () => {
    const binding = decision(bindingBody, R, { validFrom: 1, validUntil: T2 });
    const pause = decision(
      {
        kind: "pause",
        relationship: "media-to-alice",
        reading: "Plant",
        bindingId: binding.id,
        selection: null,
      },
      R,
      { validFrom: 1 },
    );
    expect(statusAt([binding], T2 - 1)).toEqual(["media-to-alice:selected"]);
    expect(statusAt([binding], T2)).toEqual([]);
    // Inside the window the pause pins the binding (unavailable); after it the pause is inert,
    // not a refusal of the relationship.
    expect(statusAt([binding, pause], T2 - 1)).toEqual(["media-to-alice:unavailable"]);
    expect(statusAt([binding, pause], T2)).toEqual([]);
  });

  // A CONTROL for the governed read: it passes on the base, where `negatedAt` already read validity.
  it("a timed withdrawal by the receiver counts only in its window; a stranger's never does", () => {
    const binding = decision(bindingBody, R, { validFrom: 1 });
    const curse = decision(curseBody, R, { validFrom: 1 });
    const withdrawal = within(makeNegationClaims(receiver, T1, curse.id), R, {
      validFrom: T1,
      validUntil: T2,
    });
    const stranger = signClaims(makeNegationClaims(authorForSeed(X), 5, curse.id), X);
    const all = [binding, curse, withdrawal, stranger];
    expect(statusAt(all, T1 - 1)).toEqual(["media-to-alice:cursed"]);
    expect(statusAt(all, T1)).toEqual(["media-to-alice:selected"]);
    expect(statusAt(all, T2)).toEqual(["media-to-alice:cursed"]);
  });
});

// --- slate.ts and erase.ts: erasure and graveyard records are history ---------------------------

/**
 * A real cut over two members, then the same ground re-built with the graveyard and both erasures
 * re-signed with `validUntil` U. Member A's erasure is also struck by the operator (untimed). A
 * second graveyard copy, struck by the operator, is the bystander a history read must not revive.
 */
async function timedErasureGround(): Promise<{
  r: Reactor;
  grave: Delta;
  struckGrave: Delta;
  a: Delta;
  b: Delta;
  bystander: Delta;
  eraseA: Delta;
  eraseB: Delta;
  strikeA: Delta;
  U: number;
}> {
  const gw = await bootSlateStore();
  const a = observed(FERN, "height", 30, 1000, SLATE_SEED);
  const b = observed(FERN, "height", 31, 1001, SLATE_SEED);
  const bystander = observed(FERN, "tag", "shade", 1100, SLATE_SEED);
  await gw.append([a, b, bystander]);
  const stood = await standSlate(gw, { members: [a, b], closes: ["egress"] });
  const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
  const original = gw.reactor.get(report.graveyard)!;
  const erasureOf = (m: Delta): Delta =>
    gw.reactor.get(report.members.find((x) => x.member === m.id)!.erasure)!;
  const [oldA, oldB] = [erasureOf(a), erasureOf(b)];
  const held = [...gw.reactor.snapshot()];
  const U = Math.max(...held.map((d) => d.claims.validFrom)) + 10_000;
  const timed = (d: Delta): Delta =>
    within(d.claims, SLATE_SEED, { validFrom: d.claims.validFrom, validUntil: U });
  const grave = timed(original);
  const eraseA = timed(oldA);
  const eraseB = timed(oldB);
  const strikeA = signClaims(makeNegationClaims(SLATE_OP, U - 5_000, eraseA.id), SLATE_SEED);
  const struckGrave = signClaims(
    graveyardClaims(
      {
        container: stood.container,
        record: stood.record,
        version: stood.version,
        membershipAt: stood.membershipAt,
        memberCount: 2,
        opened: REQUESTED_AT,
        cutAt: BEFORE_DEADLINE - 1,
        closes: ["egress"],
        affected: [],
        priorErasure: [],
      },
      SLATE_OP,
      U - 6_000,
    ),
    SLATE_SEED,
  );
  const struckGraveStrike = signClaims(
    makeNegationClaims(SLATE_OP, U - 5_500, struckGrave.id),
    SLATE_SEED,
  );
  const drop = new Set([original.id, oldA.id, oldB.id]);
  const r = new Reactor();
  for (const d of held) if (!drop.has(d.id)) r.ingest(d);
  for (const d of [grave, eraseA, eraseB, strikeA, struckGrave, struckGraveStrike]) r.ingest(d);
  await gw.close();
  return { r, grave, struckGrave, a, b, bystander, eraseA, eraseB, strikeA, U };
}

describe("erasure and graveyard records keep counting after their own validUntil", () => {
  it("readGraveyards finds a graveyard after its window; a struck one stays out", async () => {
    const { r, grave, struckGrave, U } = await timedErasureGround();
    // Delta level: both graveyards are held; the timed one's window has ended at U.
    expect(r.get(grave.id)?.claims.validUntil).toBe(U);
    expect(r.get(struckGrave.id)).toBeDefined();
    for (const now of [U - 1, U, U + 1_000_000]) {
      expect(readGraveyards(r, now, SLATE_OP).map((g) => g.id)).toEqual([grave.id]);
    }
  });

  it("the completeness check reports a struck timed erasure as negated after its window", async () => {
    const { r, grave, a, b, strikeA, U } = await timedErasureGround();
    for (const now of [U - 1, U + 1_000_000]) {
      const check = graveyardCompleteness(r, now, SLATE_OP, grave.id);
      expect(check.readable).toBe(true);
      expect(check.members).toEqual([a.id, b.id].sort());
      // Two-sided: A is reported with its strike, and B, the bystander member, is not missing.
      expect(check.negated).toEqual([{ member: a.id, negation: strikeA.id }]);
      expect(check.missing).toEqual([]);
      expect(check.cutCompleted).toBe(true);
    }
  });

  it("refusedIds and standingErasures ignore an erasure's own window", async () => {
    const { r, a, b, bystander, eraseB, U } = await timedErasureGround();
    // Read after every window has ended, so a reader that consulted the clock would drop them.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(U + 1_000_000);
    const refused = refusedIds(r, SLATE_OP);
    // An erased id is refused forever, struck erasure or not; the live bystander is not refused.
    expect(refused.has(a.id)).toBe(true);
    expect(refused.has(b.id)).toBe(true);
    expect(refused.has(bystander.id)).toBe(false);
    for (const now of [U - 1, U + 1_000_000]) {
      expect(standingErasures(r, now, SLATE_OP).map((d) => d.id)).toEqual([eraseB.id]);
    }
  });

  it("a cut finds a graveyard whose window has ended and mints no second one", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, SLATE_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, SLATE_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    // A graveyard for this slate from an earlier, interrupted cut. Its window ended long ago.
    const earlier = within(
      graveyardClaims(
        {
          container: stood.container,
          record: stood.record,
          version: stood.version,
          membershipAt: stood.membershipAt,
          memberCount: 1,
          opened: REQUESTED_AT,
          cutAt: BEFORE_DEADLINE - 1,
          closes: ["egress"],
          affected: [],
          priorErasure: [],
        },
        SLATE_OP,
        60_000,
      ),
      SLATE_SEED,
      { validFrom: 60_000, validUntil: 70_000 },
    );
    await gw.append([earlier]);
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(report.graveyard).toBe(earlier.id);
    expect(gw.graveyards().map((g) => g.id)).toEqual([earlier.id]);
    // Two-sided at the bytes: the member is gone, the bystander is held.
    expect(await gw.backend.holds(member.id)).toBe(false);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});

// --- channel.ts: a drop severs for good ---------------------------------------------------------

describe("a channel drop strikes a record whose only negation is timed", () => {
  it("a record negated only over [T1, T2) stays severed after T2; a bystander channel stays", async () => {
    const T0 = 5_000_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const store = (seed: string) =>
      Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));
    const nothing = { pull: (): Promise<never[]> => Promise.resolve([]) };
    const meSeed = "cd".repeat(32);
    const me = await store(meSeed);
    const OPR = authorForSeed(meSeed);
    try {
      const alice = await me.openChannel({ into: "friends", prefix: "alice", source: nothing });
      vi.setSystemTime(T0 + 10);
      await alice.sync();
      const bram = await me.openChannel({ into: "friends", prefix: "bram", source: nothing });
      const recordsOf = (name: string): Delta[] =>
        [...me.reactor.snapshot()].filter((d) =>
          d.claims.pointers.some(
            (p) =>
              p.target.kind === "entity" &&
              p.target.entity.context === "loam.channel" &&
              p.target.entity.id === `channel:${name}`,
          ),
        );
      const aliceRecords = recordsOf(alice.name);
      expect(aliceRecords.length).toBeGreaterThan(0);
      const T1 = T0 + 100;
      const T2 = T0 + 1_000;
      const timed = aliceRecords.map((d) =>
        within(makeNegationClaims(OPR, T1, d.id), meSeed, { validFrom: T1, validUntil: T2 }),
      );
      await me.append(timed);
      vi.setSystemTime(T1 + 10);
      expect(me.channelStatus(alice.name)).toEqual([]);
      await me.dropChannel(alice.name);

      vi.setSystemTime(T2 + 10);
      // Delta level: every alice record now holds an untimed operator strike.
      for (const d of aliceRecords) {
        const untimed = me.reactor
          .negationsOf(d.id)
          .map((id) => me.reactor.get(id)!)
          .filter((n) => n.claims.author === OPR && n.claims.validUntil === undefined);
        expect(untimed.length).toBeGreaterThan(0);
      }
      // Object level: alice stays severed after the timed strikes end; bram still reads.
      expect(me.channelStatus(alice.name)).toEqual([]);
      expect(me.channelsEver(alice.name)).toHaveLength(1);
      expect(me.channelStatus(bram.name)).toHaveLength(1);
      expect(recordsOf(bram.name).every((d) => me.reactor.negationsOf(d.id).length === 0)).toBe(
        true,
      );
    } finally {
      await me.close();
    }
  });
});

// --- adopt-law.ts: survivalOver reads a strike inside its window -------------------------------

describe("survivalOver counts a shipper's strike only inside its window", () => {
  const S = "5e".repeat(32);
  const X = "6f".repeat(32);
  const shipper = authorForSeed(S);
  const T1 = 1_000;
  const T2 = 2_000;
  const row = (alias: string, ts: number): Delta =>
    signClaims(
      manifestExportClaims(
        { alias, targetAddress: "ab".repeat(32), kind: "renderer" },
        shipper,
        ts,
      ),
      S,
    );

  it("a row withdrawn over [T1, T2) is read outside the window; untimed and stranger strikes hold", () => {
    const timedRow = row("app:timed", 10);
    const struckRow = row("app:struck", 11);
    const strangerRow = row("app:stranger", 12);
    const members = [
      timedRow,
      struckRow,
      strangerRow,
      within(makeNegationClaims(shipper, T1, timedRow.id), S, { validFrom: T1, validUntil: T2 }),
      signClaims(makeNegationClaims(shipper, 20, struckRow.id), S),
      signClaims(makeNegationClaims(authorForSeed(X), 20, strangerRow.id), X),
    ];
    const aliases = (now: number) => readManifest(members, now).map((r) => r.alias);
    expect(aliases(T1 - 1)).toEqual(["app:stranger", "app:timed"]);
    expect(aliases(T1)).toEqual(["app:stranger"]);
    expect(aliases(T2)).toEqual(["app:stranger", "app:timed"]);
  });
});

// --- admin-federation.ts: the grant label and the revoke selection ------------------------------

describe("the connections panel names the true state of a write grant", () => {
  const OP_SEED = "7a".repeat(32);
  const OP = authorForSeed(OP_SEED);
  const key = (n: number) => authorForSeed(n.toString(16).padStart(2, "0").repeat(32));
  const [ACTIVE, EXPIRED, FUTURE, STRUCK, NONE] = [0xa1, 0xa2, 0xa3, 0xa4, 0xa5].map(key);
  const NOW = 5_000_000;

  async function ground(): Promise<{
    gw: Gateway;
    grants: { active: Delta; expired: Delta; future: Delta; struck: Delta };
  }> {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
    const grant = (
      subject: string,
      ts: number,
      window: { validFrom: number; validUntil?: number },
    ) => within(grantClaims(STORE_ENTITY, subject, "write", OP, ts), OP_SEED, window);
    const grants = {
      active: grant(ACTIVE!, 9001, { validFrom: 9001 }),
      expired: grant(EXPIRED!, 9002, { validFrom: 9002, validUntil: NOW - 1 }),
      future: grant(FUTURE!, 9003, { validFrom: NOW + 1 }),
      struck: grant(STRUCK!, 9004, { validFrom: 9004 }),
    };
    await gw.append(Object.values(grants));
    await gw.append([signClaims(makeNegationClaims(OP, 9100, grants.struck.id), OP_SEED)]);
    return { gw, grants };
  }

  it("active, expired, not yet valid, revoked and ungranted each read as themselves", async () => {
    const { gw } = await ground();
    const state = (k: string) => connectionGrantState(gw.reactor, NOW, OP, k);
    expect(state(ACTIVE!)).toBe("active");
    expect(state(EXPIRED!)).toBe("expired");
    expect(state(FUTURE!)).toBe("not yet valid");
    expect(state(STRUCK!)).toBe("revoked");
    expect(state(NONE!)).toBe("ungranted");
    // Across the boundaries: the future grant is active once it starts; the expired one was active.
    expect(connectionGrantState(gw.reactor, NOW + 1, OP, FUTURE!)).toBe("active");
    expect(connectionGrantState(gw.reactor, NOW - 2, OP, EXPIRED!)).toBe("active");
    await gw.close();
  });

  // A CONTROL: this selection was already wider than the door on the base. It pins the name's claim.
  it("the revoke selection names every unnegated operator grant, timed or not", async () => {
    const { gw, grants } = await ground();
    const select = (k: string) => unnegatedOperatorGrantIds(gw.reactor, NOW, OP, k);
    expect(select(EXPIRED!)).toEqual([grants.expired.id]);
    expect(select(FUTURE!)).toEqual([grants.future.id]);
    expect(select(ACTIVE!)).toEqual([grants.active.id]);
    expect(select(STRUCK!)).toEqual([]);
    await gw.close();
  });
});
