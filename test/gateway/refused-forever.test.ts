// An erasure is eternal: the store refuses an erased id forever, even after its erasure is
// negated, and even when the erasure and its target arrive in one batch. Asked at the append path,
// the federate path and the offer. Every case names a bystander that must still land.
//
// Append is atomic, so a batch that carries a refused id lands nothing. Federate admits per delta,
// so only the refused id is dropped.
//
// Deliberately not asserted here: receipts and as-of reads. A negated erasure stops being standing
// testimony there, which `test/gateway/erase.test.ts` covers.

import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import {
  eraseClaims,
  erasedInBatch,
  refusedIds,
  standingErasures,
} from "../../src/gateway/erase.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "5e".repeat(32);

async function boot(): Promise<Gateway> {
  return Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
}

const erasureOf = (gw: Gateway, target: Delta, t: number): Delta =>
  signClaims(eraseClaims(target.id, target.claims.author, gw.operatorAuthor!, t), OP_SEED);

const held = (gw: Gateway, d: Delta): boolean => gw.reactor.get(d.id) !== undefined;

describe("an erased id is refused forever", () => {
  it("negating the erasure retracts the record, and the id still never returns", async () => {
    const gw = await boot();
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([fact]);
    await gw.erase(fact.id);
    const [tomb] = standingErasures(gw.reactor, gw.operatorAuthor);
    await gw.append([signClaims(makeNegationClaims(gw.operatorAuthor!, 5000, tomb!.id), OP_SEED)]);

    expect(standingErasures(gw.reactor, gw.operatorAuthor)).toEqual([]); // no longer standing
    expect(refusedIds(gw.reactor, gw.operatorAuthor).has(fact.id)).toBe(true); // still refused

    await expect(gw.append([fact])).rejects.toThrow(/erased/);
    await gw.federate([fact, bystander]);
    expect(held(gw, fact)).toBe(false);
    expect(held(gw, bystander)).toBe(true);
    expect(gw.offeredDeltas().some((d) => d.id === fact.id)).toBe(false);
    await gw.close();
  });

  it.each([
    ["erasure first", true],
    ["target first", false],
  ])("append refuses a batch carrying an erasure and its target (%s)", async (_, tombFirst) => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const tomb = erasureOf(gw, target, 2000);
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
    ["erasure first", true],
    ["target first", false],
  ])("federate drops the target of an erasure in the same offer (%s)", async (_, tombFirst) => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    const tomb = erasureOf(gw, target, 2000);
    await gw.federate(tombFirst ? [tomb, target, bystander] : [target, tomb, bystander]);
    expect(held(gw, target)).toBe(false);
    expect(held(gw, tomb)).toBe(true);
    expect(held(gw, bystander)).toBe(true);
    await gw.close();
  });

  it("an erasure with the wrong spoken-by does not refuse its target in the same batch", async () => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const wrong = signClaims(
      eraseClaims(target.id, "ed25519:" + "00".repeat(32), gw.operatorAuthor!, 2000),
      OP_SEED,
    );
    expect(erasedInBatch([wrong, target], gw.operatorAuthor).has(target.id)).toBe(false);
    await gw.close();
  });

  // Only an erasure the federate path actually admits can refuse its target in the same offer.
  it("a forged erasure in the offer does not suppress its target", async () => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    // A real erasure carrying another delta's signature: operator-shaped, and not verified.
    const genuine = erasureOf(gw, target, 2000);
    const forged: Delta = { ...genuine, sig: erasureOf(gw, target, 2001).sig! };
    await gw.federate([forged, target]);
    expect(held(gw, forged)).toBe(false);
    expect(held(gw, target)).toBe(true);
    await gw.close();
  });

  it("an erasure the caller's admit rule turns away does not suppress its target", async () => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const tomb = erasureOf(gw, target, 2000);
    await gw.federate([tomb, target], { admit: (d) => d.id !== tomb.id });
    expect(held(gw, tomb)).toBe(false);
    expect(held(gw, target)).toBe(true);
    await gw.close();
  });

  it.each([
    ["erasure, target, forged copy", [0, 1, 2]],
    ["forged copy, erasure, target", [2, 0, 1]],
    ["target, forged copy, erasure", [1, 2, 0]],
  ])("a forged copy under the target's id cannot let the target in (%s)", async (_, order) => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const forgedCopy: Delta = {
      ...target,
      claims: { ...target.claims, author: "ed25519:" + "11".repeat(32) },
    };
    const tomb = erasureOf(gw, target, 2000);
    const members = [tomb, target, forgedCopy];
    await gw.federate(order.map((k) => members[k]!));
    expect(held(gw, target)).toBe(false);
    expect(held(gw, tomb)).toBe(true);
    await gw.close();
  });

  // An erasure is never itself erased (§11). Otherwise a chain in one offer could drop the erasure that
  // refuses D, and D could come back later.
  it("an erasure that erases an erasure cannot undo the erasure, in one offer or later", async () => {
    const gw = await boot();
    const d = observed(FERN, "height", 30, 1000, OP_SEED);
    const t1 = erasureOf(gw, d, 2000);
    const t2 = erasureOf(gw, t1, 3000);
    await gw.federate([d, t1, t2]);
    expect(held(gw, t1)).toBe(true);
    expect(held(gw, t2)).toBe(false);
    expect(held(gw, d)).toBe(false);
    await gw.federate([d]);
    await expect(gw.append([d])).rejects.toThrow(/erased/);
    expect(held(gw, d)).toBe(false);

    await expect(gw.append([erasureOf(gw, t1, 4000)])).rejects.toThrow(/cannot itself be erased/);
    await gw.close();
  });

  it("append refuses a batch in which an erasure erases another erasure", async () => {
    const gw = await boot();
    const d = observed(FERN, "height", 30, 1000, OP_SEED);
    const t1 = erasureOf(gw, d, 2000);
    const t2 = erasureOf(gw, t1, 3000);
    await expect(gw.append([t1, t2])).rejects.toThrow(/cannot itself be erased/);
    expect(held(gw, t1)).toBe(false);
    expect(held(gw, t2)).toBe(false);
    await gw.close();
  });
});
