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

const TRUST_INJECTION = {
  recognize: { hasPointer: { role: { exact: "ping" } } },
  emit: {
    pointers: [
      { role: "declares", at: { from: { role: "ping" } }, context: "loam.trust" },
      { role: "mode", value: "closed" },
    ],
  },
};

const strangerPoke = (): Delta =>
  signClaims(
    {
      timestamp: 5000,
      validFrom: 5000,
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
    await gw.federate([strangerPoke()], { admit: () => true });

    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("open");
    const report = await translate(gw, { seed: OP_SEED });
    expect(report.refused).toBe(1);

    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("open");
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
