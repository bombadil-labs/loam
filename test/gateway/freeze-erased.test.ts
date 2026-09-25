// `Gateway.freeze` refuses a Term that selects erased content, rather than leaving it out: a
// version is a permanent name, and a silent omission would change what it names. The erasure run
// re-freezes through `freezeMembers` directly, so this never blocks a cut; the slate tests cover
// that path. Each case checks the bytes are still held, so the refusal is about the erasure, not
// about absence, and a bystander Term still freezes.

import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { eraseClaims } from "../../src/gateway/erase.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { frozenMembershipTerm } from "../../src/gateway/slate.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "8b".repeat(32);

describe("freeze refuses erased content", () => {
  it("refuses a Term that selects an erased claim, and freezes a bystander Term", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
    const op = gw.operatorAuthor!;
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const before = gw.freeze(frozenMembershipTerm([claim.id]));
    expect(before.members.map((d) => d.id)).toContain(claim.id); // control: the Term selects it

    await gw.append([signClaims(eraseClaims(claim.id, op, op, 2000), OP_SEED)]);
    expect(gw.reactor.get(claim.id)).toBeDefined();
    expect(() => gw.freeze(frozenMembershipTerm([claim.id]))).toThrow(/freeze refused/);
    expect(gw.freeze(frozenMembershipTerm([bystander.id])).members.map((d) => d.id)).toContain(
      bystander.id,
    );
    await gw.close();
  });

  it("refuses a Term whose claim is held down by an erased negation", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
    const op = gw.operatorAuthor!;
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const negation = signClaims(makeNegationClaims(op, 2000, claim.id), OP_SEED);
    await gw.append([negation]);
    await gw.append([signClaims(eraseClaims(negation.id, op, op, 3000), OP_SEED)]);
    expect(() => gw.freeze(frozenMembershipTerm([claim.id]))).toThrow(/freeze refused/);
    await gw.close();
  });
});
