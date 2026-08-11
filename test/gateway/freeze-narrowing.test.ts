// §27.2 freeze through the SHARED NARROWING RAIL (hazard H1, T52) — a frozen module version is a
// narrowing operation: it hands a consumer a SUBSET of the ground, which is exactly the class
// `test/gateway/narrowing.ts` exists for. Every case asserts BOTH levels — what is in the members,
// and what `resolvedNode` answers at the destination — because the two come apart exactly when
// suppression is involved, and set membership alone is the weaker shape that passed while the
// original bug shipped:
//
//   - PRESERVES SUPPRESSION: a claim struck at the source must never read as LIVE in a store
//     loaded from the version's members. The object level carries this one: a stranded strike
//     changes what the destination resolves, which membership alone cannot see.
//   - DOES NOT LEAK: the closure runs forward only — a retraction whose target the Term excluded
//     must not surface in the members, and must not drag its target in.
//   - TRANSITIVE: a strike of a strike crosses too, so the destination resolves exactly as the
//     source does, however deep the negation chain.
//
// Membership is the right instrument for the last two, and they use it deliberately: over-eagerness
// and closure DEPTH are properties of the admitted set, and under the substrate's negated-negation
// semantics both source and destination can read the same value while holding different sets.
//
// Deliberately NOT asserted here, each with the rail that would close it:
//   - the address properties (order-freedom, sensitivity, non-drift) — `container-identity.test.ts`.
//   - the PURGED-negation branch (`ingest.ts:201`, §11): no fixture erases a strike before freezing,
//     so a rail here would have to purge one and assert the hole is carried, not silently healed.
//   - the dead-set and §29.3 egress filters, which `freeze` does not apply at all (T90) — a version
//     can therefore ship a delta the store was ordered to forget. That is T90's rail, not this file's.
//   - the SECOND consumer edge: `federate`, where a roster narrows the batch again. `loadVersion`
//     below models the operator-append edge only, which by construction cannot drop a member.

import { describe, expect, it } from "vitest";
import { authorForSeed, type Delta, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import {
  assertClosureDoesNotLeak,
  assertPreservesSuppression,
  isPresent,
  isSuppressed,
  retraction,
} from "./narrowing.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = {
  props: new Map<string, Policy>([
    ["height", pick],
    ["message", pick],
  ]),
  default: pick,
};

const boot = async (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height", "message"] },
      ],
    }),
  );

// A consumer loading the version: a fresh store holding its own genesis law plus the version's
// members, and nothing else of the source's ground — the destination side of the narrowing, where
// a stranded strike would read as live.
const loadVersion = async (members: readonly Delta[]): Promise<Gateway> => {
  const gw = await boot();
  await gw.append([...members]);
  return gw;
};

const byIds = (ids: readonly string[]): unknown => ({
  op: "select",
  pred: { match: { field: "id", cmp: "inSet", const: [...ids] } },
  in: "input",
});

describe("§27.2 freeze is a narrowing operation, and rides the shared H1 rail", () => {
  it("preserves suppression: a struck claim ships with its strike, and the DESTINATION reads it struck", async () => {
    const source = await boot();
    const older = observed(FERN, "height", 25, 900, OP_SEED);
    const struck = observed(FERN, "height", 30, 1000, OP_SEED);
    await source.append([older, struck]);
    await source.append([retraction(struck.id, OP, OP_SEED, 1100)]);

    // The Term names only the two claims; the closure must carry the strike across.
    const version = source.freeze(byIds([older.id, struck.id]));
    const destination = await loadVersion(version.members);

    assertPreservesSuppression({ what: "freeze", source, destination, struckClaim: struck.id });

    // Object level: the destination resolves what the source resolves. If the strike were
    // stranded, the destination would read the withdrawn 30 as the latest height.
    expect(source.resolvedNode("Plant", FERN).view.height).toBe(25);
    expect(destination.resolvedNode("Plant", FERN).view.height).toBe(25);

    await source.close();
    await destination.close();
  });

  it("does not leak: a retraction OUTSIDE the Term's scope stays out, and the admitted member survives", async () => {
    const source = await boot();
    const admitted = observed(FERN, "height", 30, 1000, OP_SEED);
    const excluded = observed(FERN, "message", "withdrawn", 950, OP_SEED);
    await source.append([admitted, excluded]);
    const strikeOfExcluded = retraction(excluded.id, OP, OP_SEED, 1100);
    await source.append([strikeOfExcluded]);

    // The fixture guard `assertClosureDoesNotLeak` cannot carry itself: if `retraction` ever stopped
    // producing something the reactor indexes as a negation, the closure would have nothing to pull
    // and this rail would pass while proving nothing.
    expect(isSuppressed(source, excluded.id)).toBe(true);

    // The Term admits only `admitted`. Nothing in the store negates it, so the closure adds
    // NOTHING: the strike of the excluded claim must not surface, and must not drag its target in.
    const version = source.freeze(byIds([admitted.id]));
    expect(version.members.map((d) => d.id)).toEqual([admitted.id]);

    const destination = await loadVersion(version.members);
    assertClosureDoesNotLeak({
      what: "freeze",
      destination,
      excludedTarget: excluded.id,
      itsRetraction: strikeOfExcluded.id,
    });

    // The other side of the rail: the member the Term DID admit is present, unsuppressed, and
    // resolves — an over-eager fix that shipped strikes wholesale would break this half.
    expect(isPresent(destination, admitted.id)).toBe(true);
    expect(isSuppressed(destination, admitted.id)).toBe(false);
    expect(destination.resolvedNode("Plant", FERN).view.height).toBe(30);
    expect(destination.resolvedNode("Plant", FERN).view.message).toBeUndefined();

    await source.close();
    await destination.close();
  });

  it("is transitive: a strike of a strike crosses, so source and destination agree at any depth", async () => {
    const source = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await source.append([claim]);
    const strike = retraction(claim.id, OP, OP_SEED, 1100);
    await source.append([strike]);
    const counterStrike = retraction(strike.id, OP, OP_SEED, 1200);
    await source.append([counterStrike]);

    // The Term names only the claim; a one-hop closure would ship the strike and strand what
    // struck IT, handing the consumer a different negation state than the source holds.
    const version = source.freeze(byIds([claim.id]));
    expect(version.members.map((d) => d.id).sort()).toEqual(
      [claim.id, strike.id, counterStrike.id].sort(),
    );

    // Both levels agree with the source: the delta-level suppression state of every member, and
    // the object-level reading — whatever the substrate's negated-negation semantics, the
    // destination must not resolve DIFFERENTLY than the store the version was cut from.
    const destination = await loadVersion(version.members);
    for (const id of [claim.id, strike.id, counterStrike.id]) {
      expect(isPresent(destination, id)).toBe(true);
      expect(isSuppressed(destination, id)).toBe(isSuppressed(source, id));
    }
    expect(destination.resolvedNode("Plant", FERN).view.height).toEqual(
      source.resolvedNode("Plant", FERN).view.height,
    );

    await source.close();
    await destination.close();
  });
});
