// §9/§24 — `translate` re-speaks foreign content in the OPERATOR's voice, so it must refuse the same
// reserved vocabulary `promotionRefusal` refuses at the promote door (ticket T54). The village calls
// `translate(gw, { seed: operatorSeed })`, so an emission lands inside `lawfulSnapshot` where the
// constitutional readers treat it as LAW. `applyTemplate` takes the emitted pointer's entity id from
// the recognized (possibly hostile) source and its context from the operator-blessed template — so a
// spec whose template names a reserved context lets a stranger's delta mint operator-authored LAW.
//
// The footgun in one shape: an operator blesses a spec emitting into `loam.trust`; a stranger sends a
// source pointing at `loam:trust`; the pass signs a `closed` trust declaration AS THE OPERATOR, and
// the whole store's federation door slams shut. The guard refuses the crossing, the same asymmetry
// `promotionRefusal` was written to remove.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { translate, translationClaims } from "../../src/federation/translate.js";
import { readTrustPolicy } from "../../src/gateway/trust.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const MALLORY_SEED = "ee".repeat(32);
const MALLORY = authorForSeed(MALLORY_SEED);

// The operator blesses this spec (data, but operator-authored). Its template names the RESERVED
// `loam.trust` context and pins the mode `closed` — the crossing the guard must refuse.
const TRUST_INJECTION = {
  recognize: { hasPointer: { role: { exact: "ping" } } },
  emit: {
    pointers: [
      { role: "declares", at: { from: { role: "ping" } }, context: "loam.trust" },
      { role: "mode", value: "closed" },
    ],
  },
};

// A stranger's delta whose `ping` points at the reserved trust entity — the id the emission inherits.
const strangerPoke = (): Delta =>
  signClaims(
    {
      timestamp: 5000,
      author: MALLORY,
      pointers: [
        { role: "ping", target: { kind: "entity", entity: { id: "loam:trust", context: "poke" } } },
      ],
    },
    MALLORY_SEED,
  );

describe("§9/§24 — translate refuses to re-speak reserved constitutional vocabulary", () => {
  it("a spec emitting into loam.trust cannot mint an operator-authored trust declaration", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
    await gw.append([
      signClaims(
        translationClaims("evil", TRUST_INJECTION.recognize, TRUST_INJECTION.emit, OP, 1),
        OP_SEED,
      ),
    ]);
    await gw.federate([strangerPoke()], { admit: () => true }); // the stranger's source arrives

    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("open"); // default, before the pass
    await translate(gw, { seed: OP_SEED });

    // OBJECT LEVEL: the store's federation posture must NOT have flipped — the injection was refused.
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("open");
    // DELTA LEVEL: no operator-authored emission carrying the reserved `loam.trust` context landed.
    const reservedEmission = [...gw.reactor.snapshot()].find(
      (d) =>
        d.claims.author === OP &&
        d.claims.pointers.some((p) => p.role === "translates") &&
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "loam.trust",
        ),
    );
    expect(reservedEmission).toBeUndefined();
    await gw.close();
  });
});
