// §28.4 / T38 — a filter that narrows a delta-set must carry the NEGATION CLOSURE of what it
// admits, or it does not preserve what survives.
//
// rhizomatic's `negated(d, D)` ranges over the OPERAND SET (SPEC-2 §4.3): suppression is a property
// of the set being evaluated, not of the delta. Keep a claim, drop its negation, and the claim comes
// back UN-SUPPRESSED in the filtered set — pinned substrate-side as the
// `select-then-mask-scopes-to-operand` vector. That is correct substrate behavior; a filter that
// ignores it is what is wrong.
//
// Loam ships two such filters and both are railed here: the quarantine's membership-scoped SEEDING
// EDGE (inward — what a pool sees) and the OFFERED LENS (outward — what a federation peer pulls).
// The second is the same bug pointed at a stranger's store.
//
// §24.8 erasure was always handled — tombstones cross the seeding edge unconditionally
// (quarantine-pool.ts) and `test/gateway/quarantine.test.ts` pins that byte-for-byte. This file is
// about ORDINARY negation: retraction, revocation, any non-tombstone `negates`.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  parseTerm,
  signClaims,
  type Delta,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import {
  assertClosureDoesNotLeak,
  assertPreservesSuppression,
  isPresent,
  isSuppressed,
} from "./narrowing.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = {
  props: new Map<string, Policy>([["height", pick]]),
  default: pick,
};

const boot = async (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height"] }],
    }),
  );

// A retraction in the operator's own voice: a negation delta pointing at a delta.
const strike = (targetId: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      author: OP,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    OP_SEED,
  );

// The Term the rails below filter with. A negation points at a DELTA, never at a context, so it is
// never selected by this Term — which is the ordinary case, not a contrived one.
const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

describe("T38 — the seeding edge carries the negation closure", () => {
  it("a claim retracted in the primary does not read as live in a Term-seeded pool", async () => {
    const gw = await boot();
    // An older LIVE height beneath the struck one, so the reading below has something to fall back
    // to: `null` would also be what a pool that resolved nothing returns.
    const earlier = observed(FERN, "height", 28, 900, OP_SEED);
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([earlier, claim]);
    const retraction = strike(claim.id, 1100);
    await gw.append([retraction]);

    // The Term selects the claim and NOT the retraction. That asymmetry is the whole bug.
    const members = gw.select(HEIGHTS).map((d) => d.id);
    expect(members).toContain(claim.id);
    expect(members).not.toContain(retraction.id);

    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    // The shared H1 rail asks the resolved question — struck at the destination as it was at the
    // source — and checks the fixture is real before believing the answer.
    assertPreservesSuppression({
      what: "the quarantine seeding edge",
      source: gw,
      destination: pool.gateway,
      struckClaim: claim.id,
    });
    // The helper accepts EXCLUSION as a correct outcome, because a narrowing operation stays free
    // to decide what it admits. Here the Term selects the claim, so exclusion is not on the table:
    // pin the crossing separately, or a pool that seeded nothing would satisfy the rail above.
    expect(isPresent(pool.gateway, claim.id)).toBe(true);
    expect(isPresent(pool.gateway, retraction.id)).toBe(true);

    // OBJECT LEVEL, and everything above it is still delta-level structure. `isSuppressed` asks
    // whether a negation is present; this asks what a reader RESOLVES through the Plant Schema
    // inside the pool. Two-sided in one reading: the struck height is gone and the older live one
    // is what survives, so a pool that resolved nothing at all cannot pass.
    // (`test/gateway/closure-inbound.test.ts` does the same for the `admit` PREDICATE knob; this
    // is the membership-Term knob, which no other file reads at this level.)
    pool.gateway.register(PLANT, SCHEMA, [FERN], undefined, ["height"]);
    const seen = await pool.gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(seen.errors).toBeUndefined();
    expect((seen.data as { plant: { height: number | null } }).plant.height).toBe(28);
    await pool.drop();
    await gw.close();
  });

  it("the closure is TRANSITIVE — a struck strike revives, and the revival survives the edge", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const retraction = strike(claim.id, 1100);
    await gw.append([retraction]);
    const counter = strike(retraction.id, 1200); // negating the negation revives the claim
    await gw.append([counter]);

    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    // In the primary the claim is LIVE again. The pool must agree, which requires the closure to
    // have followed TWO links. A one-link closure carries the retraction and stops, leaving the
    // claim wrongly suppressed in the pool — the same class of bug, mirrored.
    expect(isPresent(pool.gateway, retraction.id)).toBe(true);
    expect(isPresent(pool.gateway, counter.id)).toBe(true);
    // Said once more in the shared vocabulary, so the file reads in one voice: the strike is
    // itself struck inside the pool, which is what makes the claim live there. Note this is the
    // same fact as the line above and not a second level — `isSuppressed` asks whether a negation
    // is PRESENT, so it is delta-level too. `assertPreservesSuppression` cannot state the revival
    // case at all; it asks only that a struck claim never reads live.
    expect(isSuppressed(pool.gateway, retraction.id)).toBe(true);
    await pool.drop();
    await gw.close();
  });

  it("the closure does NOT leak — a negation whose target never crossed drags nothing in", async () => {
    const gw = await boot();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const outsider = observed(FERN, "message", "not a member", 1050, OP_SEED);
    await gw.append([member, outsider]);
    const strikesOutsider = strike(outsider.id, 1100);
    await gw.append([strikesOutsider]);

    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    // The closure follows negations OF admitted deltas. It must not run the other direction and
    // pull in a target because something negating it happens to exist. Two-sided: the admitted
    // member survives, or a seeding edge that admitted nothing would pass the leak rail.
    expect(isPresent(pool.gateway, member.id)).toBe(true);
    assertClosureDoesNotLeak({
      what: "the quarantine seeding edge",
      destination: pool.gateway,
      excludedTarget: outsider.id,
      itsRetraction: strikesOutsider.id,
    });
    await pool.drop();
    await gw.close();
  });

  it("a retraction landing AFTER seeding reaches the pool on the next pulse", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    expect(isSuppressed(pool.gateway, claim.id)).toBe(false); // live at seed time
    expect(isPresent(pool.gateway, claim.id)).toBe(true); // ...and really there, not merely absent

    const late = strike(claim.id, 1100);
    await gw.append([late]);
    await pool.reseed();
    // The scope is live; so is what it suppresses.
    assertPreservesSuppression({
      what: "the quarantine seeding edge, on reseed",
      source: gw,
      destination: pool.gateway,
      struckClaim: claim.id,
    });
    // Again the crossing itself, which the helper tolerates losing: a reseed that emptied the pool
    // would pass the rail above and fail here.
    expect(isPresent(pool.gateway, claim.id)).toBe(true);
    expect(isPresent(pool.gateway, late.id)).toBe(true);
    await pool.drop();
    await gw.close();
  });

  it("select() itself is UNCHANGED — the closure belongs to the edge, not the reading surface", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    await gw.append([strike(claim.id, 1100)]);
    // A caller asking "what does this Term select" must still get exactly that answer. Widening
    // select would silently change every membership reading in the system.
    const ids = gw.select(HEIGHTS).map((d) => d.id);
    expect(ids).toEqual([claim.id]);
    await gw.close();
  });
});

describe("T38 — the offered lens carries it too (the same bug, pointed outward)", () => {
  it("a peer pulling through an offered lens receives retractions with their targets", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          { hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height"] },
        ],
      }),
      // The store offers only height claims — and a negation is not a height claim.
      { offeredLens: parseTerm(HEIGHTS) },
    );
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const retraction = strike(claim.id, 1100);
    await gw.append([retraction]);

    const offered = gw.offeredDeltas();
    expect(offered.map((d) => d.id)).toContain(claim.id);

    // A peer federating exactly what we offered must see the claim as retracted. Offering a claim
    // while withholding its retraction republishes something the operator struck — the outward
    // form of the same failure.
    const peer = await boot();
    await peer.federate(offered);
    assertPreservesSuppression({
      what: "the offered lens",
      source: gw,
      destination: peer,
      struckClaim: claim.id,
    });
    // The offer is asserted above to CONTAIN the claim, so the peer must hold both it and the
    // retraction. Exclusion — which the helper would accept — is not a lawful outcome here.
    expect(isPresent(peer, claim.id)).toBe(true);
    expect(isPresent(peer, retraction.id)).toBe(true);
    await peer.close();
    await gw.close();
  });
});
