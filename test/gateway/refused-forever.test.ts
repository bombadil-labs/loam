// An erasure is eternal: the store refuses an erased id forever, even after its tombstone is
// struck, and even when the tombstone and its target arrive in one batch. Asked at the append path,
// the federate path and the offer. Every case names a bystander that must still land.
//
// Append is atomic, so a batch that carries a refused id lands nothing. Federate admits per delta,
// so only the refused id is dropped.
//
// Deliberately not asserted here: receipts and as-of reads. A struck tombstone stops being standing
// testimony there, which `test/gateway/erase.test.ts` covers.

import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { eraseClaims, refusedIds, survivingTombstones } from "../../src/gateway/erase.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "5e".repeat(32);

async function boot(): Promise<Gateway> {
  return Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
}

const tombstoneFor = (gw: Gateway, target: Delta, t: number): Delta =>
  signClaims(eraseClaims(target.id, target.claims.author, gw.operatorAuthor!, t), OP_SEED);

const held = (gw: Gateway, d: Delta): boolean => gw.reactor.get(d.id) !== undefined;

describe("an erased id is refused forever", () => {
  it("striking the tombstone retracts the record, and the id still never returns", async () => {
    const gw = await boot();
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([fact]);
    await gw.erase(fact.id);
    const [tomb] = survivingTombstones(gw.reactor, gw.operatorAuthor);
    await gw.append([signClaims(makeNegationClaims(gw.operatorAuthor!, 5000, tomb!.id), OP_SEED)]);

    expect(survivingTombstones(gw.reactor, gw.operatorAuthor)).toEqual([]); // no longer standing
    expect(refusedIds(gw.reactor, gw.operatorAuthor).has(fact.id)).toBe(true); // still refused

    await expect(gw.append([fact])).rejects.toThrow(/erased/);
    await gw.federate([fact, bystander]);
    expect(held(gw, fact)).toBe(false);
    expect(held(gw, bystander)).toBe(true);
    expect(gw.offeredDeltas().some((d) => d.id === fact.id)).toBe(false);
    await gw.close();
  });

  it.each([
    ["tombstone first", true],
    ["target first", false],
  ])("append refuses a batch carrying a tombstone and its target (%s)", async (_, tombFirst) => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const tomb = tombstoneFor(gw, target, 2000);
    await expect(gw.append(tombFirst ? [tomb, target] : [target, tomb])).rejects.toThrow(/erased/);
    expect(held(gw, tomb)).toBe(false); // atomic: nothing in the refused batch lands
    expect(held(gw, target)).toBe(false);

    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([tomb, bystander]); // unrelated work still lands
    expect(held(gw, bystander)).toBe(true);
    await expect(gw.append([target])).rejects.toThrow(/erased/);
    expect(held(gw, target)).toBe(false);
    await gw.close();
  });

  it.each([
    ["tombstone first", true],
    ["target first", false],
  ])("federate drops the target of a tombstone in the same offer (%s)", async (_, tombFirst) => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    const tomb = tombstoneFor(gw, target, 2000);
    await gw.federate(tombFirst ? [tomb, target, bystander] : [target, tomb, bystander]);
    expect(held(gw, target)).toBe(false);
    expect(held(gw, tomb)).toBe(true);
    expect(held(gw, bystander)).toBe(true);
    await gw.close();
  });

  it("a tombstone with the wrong spoken-by does not refuse its target in the same batch", async () => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const wrong = signClaims(
      eraseClaims(target.id, "ed25519:" + "00".repeat(32), gw.operatorAuthor!, 2000),
      OP_SEED,
    );
    expect(refusedIds(gw.reactor, gw.operatorAuthor, [wrong, target]).has(target.id)).toBe(false);
    await gw.close();
  });
});
