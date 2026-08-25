// T232 — a curse is the OPERATOR's retirement, and only the operator can lift it.
//
// `cursesOf` is the single reader behind the standing sync's "do not re-bless" set (§46 criterion
// 11). It scanned the ground for any curse-shaped delta and dropped one the moment ANY surviving
// negation struck its record — no author check on the curse, no lawful-negation check on the strike.
// Found by T217's review and named in `channel-record-trust.test.ts`'s header, both filters missing
// meant a write-granted stranger could append a negation of the operator's curse record and let the
// next poll re-bless the retired lens — at a serving door.
//
// The fix is the SAME two-filter discipline `readChannels` adopted in T217: honor only
// operator-authored curse records, and read their negations through `lawfulNegated` so only the
// operator's own lift retires the curse.
//
// The fix has TWO filters and this file rails BOTH, because a mutation that disables either must
// fail a test (hollow-test found the author filter uncovered when only the lift half was railed):
//   - the LAWFUL-NEGATION filter — a stranger cannot LIFT a curse (criteria a and b); and
//   - the AUTHOR filter — a stranger cannot RECORD a curse this store never made (the (author)
//     test), the mirror of T217's "a stranger cannot invent a channel".
//
// Both lift halves proven red against the author-blind reader:
//   - OBJECT LEVEL (criterion a): after the stranger's negation, the standing sync must not
//     re-bless, `def` must still throw, and the query door must still refuse the lens. The peer
//     REPUBLISHES between the curse and the re-poll — the standing-sync scenario §46.3 exists for,
//     and the one that makes the door observably re-serve on the broken reader (an unchanged peer
//     re-mints the same struck binding id, so the door is protected there by accident, not by the
//     curse — H10).
//   - DELTA LEVEL (criterion b): the stranger's negation really lands in the ground, stands
//     un-negated, and is authored by the stranger — and `cursesOf` still reports the curse in force,
//     so the strike is INERT.
//
// Two-sided on both, so neither can pass by retiring everything or by making curses permanent:
//   - a named bystander lens (`alice:Sprout`) keeps serving throughout; and
//   - the OPERATOR's own lift still retires the curse from `cursesOf` and revives the lens at the
//     door — so the reader reads negations, it just does not read a stranger's.
//
// What this deliberately does NOT assert, and why:
//   - THE LIFT'S BINDING-REVIVAL guard. `curseChannelLawImpl`'s lift branch skips re-negating a
//     binding-strike it reads as "already lifted" through an author-blind PRESENCE check
//     (`negationsOf(negationId).length > 0`) — the same shape this fix corrected on the curse
//     record, one call away and untouched here. A non-operator negation of the operator's
//     binding-strike could make the lift skip its own lawful revival, so the lens stays retired
//     (UNDER-serve, not disclosure). The one-line fix mirrors this one, but an honest two-sided rail
//     turns on whether a stranger's negation can REACH the pool ground where a §47.4 binding-strike
//     lives — an unresolved reachability question this reader could not settle. It is a separate
//     reading with its own blast radius, so it earns its own ticket rather than a rail built here
//     against a shape that may not be reachable.
//
// Erasure standing rule: every store here is this file's own MemoryBackend fixture.

import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Claims } from "@bombadil/rhizomatic";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { cursesOf, type Channel } from "../../src/federation/channel.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const OPERATOR_SEED = "17".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const STRANGER_SEED = "b0".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);
const SPROUT = { name: "Sprout", alg: 1, body: PLANT.body } as typeof PLANT;

const grounds: Gateway[] = [];
afterEach(async () => {
  while (grounds.length > 0) await grounds.pop()!.close();
});

async function store(seed: string): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
  grounds.push(gw);
  return gw;
}

/** A peer serving two lenses at distinct entities — one is cursed, one is the live bystander. */
async function peerWithTwoLenses(): Promise<Gateway> {
  const alice = await store("a1".repeat(32));
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, "hyperschema:Plant");
  await alice.publishRegistration(SPROUT, PLANT_POLICY, [FERN], undefined, "hyperschema:Sprout");
  return alice;
}

/**
 * A store the OPERATOR runs, an ordinary WRITE grant to the stranger, and a channel to `alice`
 * synced once so both lenses bind. The stranger holds standing the door admits on purpose — that is
 * the threat, and it is what makes the delta-level assertions meaningful: the stranger's deltas
 * land, and the reader is the only thing between them and the surface.
 */
async function meAndAlice(): Promise<{ me: Gateway; alice: Gateway; ch: Channel }> {
  const alice = await peerWithTwoLenses();
  const me = await store(OPERATOR_SEED);
  await me.append([
    signClaims(
      grantClaims(STORE_ENTITY, STRANGER, "write", OPERATOR, me.nextTimestamp()),
      OPERATOR_SEED,
    ),
  ]);
  const ch = await me.openChannel({
    into: "friends",
    prefix: "alice",
    source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
  });
  const first = await ch.sync();
  expect(first.bound).toContain("alice:Plant");
  expect(first.bound).toContain("alice:Sprout");
  return { me, alice, ch };
}

/** The stranger's negation of a delta, appended into the store under its write grant. */
async function strangerNegates(me: Gateway, targetId: string): Promise<string> {
  const forged = signClaims(
    makeNegationClaims(STRANGER, me.nextTimestamp(), targetId),
    STRANGER_SEED,
  );
  await me.append([forged]);
  return forged.id;
}

const throws = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const livingNames = (me: Gateway, ch: Channel): string[] =>
  cursesOf(me, ch.name)
    .map((c) => c.living)
    .sort();

describe("T232 — a write-granted stranger cannot lift an operator's curse", () => {
  it("(a) the stranger's negation leaves the lens retired at the door across the next poll", async () => {
    const { me, alice, ch } = await meAndAlice();

    await me.curseChannelLaw(ch.name, "alice:Plant");
    // The curse landed: the lens is off the surface, the bystander is untouched.
    expect(throws(() => me.def("alice:Plant"))).toBe(true);
    expect(me.def("alice:Sprout")).toBeDefined();

    const curseId = cursesOf(me, ch.name).find((c) => c.living === "alice:Plant")!.deltaId;
    const forgedId = await strangerNegates(me, curseId);

    // Delta level: the strike really landed against the curse record, stands un-negated, and is the
    // stranger's — so the object-level assertions below are about the READER, not a door that turned
    // the negation away.
    expect(me.reactor.get(forgedId)).toBeDefined();
    expect(me.reactor.negationsOf(curseId)).toContain(forgedId);
    expect(me.reactor.negationsOf(forgedId)).toHaveLength(0);
    expect(me.reactor.get(forgedId)!.claims.author).toBe(STRANGER);

    // The peer republishes Plant — the standing-sync scenario the record exists to survive. The
    // fresh law re-mints a NEW binding the curse never struck, so nothing but the recorded curse
    // keeps the next poll from serving it.
    await alice.publishRegistration(
      { ...PLANT, alg: 1 },
      PLANT_POLICY,
      [FERN],
      undefined,
      "hyperschema:Plant",
    );
    const again = await ch.sync();

    // Object level: the poll did NOT re-bless, the surface still refuses the lens, and the query
    // door answers no such field. On the author-blind reader all three flip — the lens serves.
    expect(again.bound).not.toContain("alice:Plant");
    expect(throws(() => me.def("alice:Plant"))).toBe(true);
    const answer = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
    expect(answer.errors, JSON.stringify(answer)).toBeDefined();
    expect(answer.data ?? undefined).toBeUndefined();

    // Two-sided — the bystander lens keeps serving, so the retirement is one lens and not a store
    // that stopped answering.
    expect(me.def("alice:Sprout")).toBeDefined();
    const sprout = await me.query(`{ alice_Sprout(entity: "${FERN}") { height } }`);
    expect(sprout.errors, JSON.stringify(sprout)).toBeUndefined();

    // Two-sided — the OPERATOR's own lift still revives the lens, so the fix did not make the curse
    // permanent; it made only the stranger's lift inert.
    await me.curseChannelLaw(ch.name, "alice:Plant", { lift: true });
    const lifted = await ch.sync();
    expect([...lifted.bound, ...lifted.witnessed]).toContain("alice:Plant");
    expect(me.def("alice:Plant")).toBeDefined();
    const revived = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
    expect(revived.errors, JSON.stringify(revived)).toBeUndefined();
  });

  it("(b) the stranger's negation is present in the ground and inert; the operator's lift is not", async () => {
    const { me, ch } = await meAndAlice();

    // Two curses by the operator, so one reading can show both directions at once.
    await me.curseChannelLaw(ch.name, "alice:Plant");
    await me.curseChannelLaw(ch.name, "alice:Sprout");
    const curseP = cursesOf(me, ch.name).find((c) => c.living === "alice:Plant")!.deltaId;
    const curseS = cursesOf(me, ch.name).find((c) => c.living === "alice:Sprout")!.deltaId;

    const forgedId = await strangerNegates(me, curseP);
    await strangerNegates(me, curseS);

    // DELTA LEVEL — present: the negation is really filed against the operator's curse record, is
    // itself un-negated, and is the stranger's. No LAWFUL negation touches the record: every strike
    // on it is the stranger's, so under the negation algebra the curse survives.
    expect(me.reactor.get(forgedId)).toBeDefined();
    expect(me.reactor.negationsOf(curseP)).toContain(forgedId);
    expect(me.reactor.negationsOf(forgedId)).toHaveLength(0);
    expect(me.reactor.get(forgedId)!.claims.author).toBe(STRANGER);
    expect(
      me.reactor.negationsOf(curseP).every((n) => me.reactor.get(n)!.claims.author === STRANGER),
    ).toBe(true);

    // DELTA LEVEL — inert: `cursesOf` still reports BOTH curses in force. On the author-blind reader
    // Plant's curse is gone here, which is the whole defect.
    expect(livingNames(me, ch)).toEqual(["alice:Plant", "alice:Sprout"]);

    // Two-sided, in the SAME reading: the OPERATOR's own lift DOES retire Plant's curse — so
    // `cursesOf` reads negations, it just does not read a stranger's — while Sprout's curse, which
    // the stranger negated too and the operator never lifted, still stands.
    await me.curseChannelLaw(ch.name, "alice:Plant", { lift: true });
    expect(livingNames(me, ch)).toEqual(["alice:Sprout"]);
    expect(me.reactor.get(curseS)).toBeDefined();
  });

  it("(author) a stranger cannot RECORD a curse this store never made", async () => {
    const { me, ch } = await meAndAlice();

    // The operator cursed Plant — a real curse record, whose product shape the forgery below copies
    // exactly rather than hand-rolling one. Sprout is the live bystander the stranger goes after.
    await me.curseChannelLaw(ch.name, "alice:Plant");
    const curseId = cursesOf(me, ch.name).find((c) => c.living === "alice:Plant")!.deltaId;
    const template = me.reactor.get(curseId)!.claims;

    // A curse in the OPERATOR's own shape, retargeted to Sprout and signed by the STRANGER. This is
    // the reachable threat: a write-granted peer can sign any claims, so nothing but the reader's
    // author filter stands between this delta and the sync's "do not re-bless" set.
    const forged: Claims = {
      ...template,
      author: STRANGER,
      timestamp: me.nextTimestamp(),
      pointers: template.pointers.map((p) =>
        p.role === "living" ? { ...p, target: { kind: "primitive", value: "alice:Sprout" } } : p,
      ),
    };
    const strangerCurse = signClaims(forged, STRANGER_SEED);
    await me.append([strangerCurse]);

    // Delta level: the forged curse really landed, stands un-negated, and is the stranger's.
    expect(me.reactor.get(strangerCurse.id)).toBeDefined();
    expect(me.reactor.negationsOf(strangerCurse.id)).toHaveLength(0);
    expect(me.reactor.get(strangerCurse.id)!.claims.author).toBe(STRANGER);

    // DELTA LEVEL — the reader does NOT honor it: `cursesOf` lists only the operator's Plant curse,
    // never the stranger's Sprout curse. On the author-blind reader Sprout appears here, which would
    // tell the standing sync to stop re-blessing a lens the operator never retired.
    expect(livingNames(me, ch)).toEqual(["alice:Plant"]);

    // Two-sided at the door: Sprout keeps serving, and a re-poll leaves it serving — the forged
    // curse changes nothing the reader answers.
    expect(me.def("alice:Sprout")).toBeDefined();
    const before = await me.query(`{ alice_Sprout(entity: "${FERN}") { height } }`);
    expect(before.errors, JSON.stringify(before)).toBeUndefined();
    await ch.sync();
    expect(me.def("alice:Sprout")).toBeDefined();
    const after = await me.query(`{ alice_Sprout(entity: "${FERN}") { height } }`);
    expect(after.errors, JSON.stringify(after)).toBeUndefined();
  });
});
