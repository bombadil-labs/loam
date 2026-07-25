// §27.2 module-version identity, PINNED TO LITERAL ADDRESSES (ticket T48).
//
// Every rail in `container-identity.test.ts` compares two independently-computed ids to each
// other — order-freedom, cross-store agreement, sensitivity. Those hold under ANY preimage, so a
// changed domain tag or a changed separator re-mints every `ModuleVersion.id` in every store and
// leaves that whole suite green. These rails assert the OUTPUT instead: three fixed member sets,
// three literal addresses.
//
// This is a CHARACTERIZATION rail. It PASSED the first time it ran, which is correct and is the
// entire point: it was written against the source while the separator was still two raw 0x00
// bytes, so that rewriting them as escapes could be PROVEN byte-identical rather than assumed.
// The proof that it is not vacuous runs in the other direction — swap the separator for a space
// and all three goldens go red.
//
// The member ids are synthetic on purpose. `addressOf` sees nothing but `d.id`, so freezing real
// signed deltas would bolt a second moving part (rhizomatic's id format) onto a rail whose only
// job is to notice a change in THIS file's preimage. What the real door does is asserted at the
// bottom, against the same pinned function.

import { describe, expect, it } from "vitest";
import { contentAddress, type Delta, type Policy } from "@bombadil/rhizomatic";
import { freezeMembers } from "../../src/gateway/container-identity.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

// Fixed member ids, shaped like the multihash a real delta id is, so the preimage this pins has a
// realistic length and alphabet. Their VALUES are arbitrary and frozen.
const A = "1e20" + "aa".repeat(32);
const B = "1e20" + "bb".repeat(32);
const C = "1e20" + "cc".repeat(32);

// The goldens. Any change to the domain tag, the separator, the sort, or the hash moves these.
const THREE = "1e20292cdf2577672eba7fbdc44ae494b4484fae515c33f2892ace157559f956137a";
const ONE = "1e207a4f320f39f73404260ce007187871e149b15015a4471b153d1e4b7b2c9be4dd";
const EMPTY = "1e203c7a5345ea3ba5281abdd36a74b158ef5dc828374abd4b4cb760d9369b1c67ab";

// `addressOf` reads only `id`; nothing else about a delta reaches the address (§27.2).
const member = (id: string): Delta => ({ id }) as Delta;

const OP_SEED = "0e".repeat(32);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const boot = async (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: { props: new Map<string, Policy>([["height", pick]]), default: pick },
          roots: [FERN],
          writable: ["height"],
        },
      ],
    }),
  );

describe("§27.2 the module-version address is pinned, byte for byte", () => {
  it("a three-member set addresses to its golden, from any argument order", () => {
    expect(freezeMembers([member(A), member(B), member(C)]).id).toBe(THREE);
    // Order-freedom is already railed elsewhere; asserted here so the golden cannot be satisfied
    // by an implementation that happens to agree only on one input permutation.
    expect(freezeMembers([member(C), member(A), member(B)]).id).toBe(THREE);
  });

  it("a one-member set addresses to its golden", () => {
    expect(freezeMembers([member(A)]).id).toBe(ONE);
  });

  it("the empty set addresses to its golden — the domain tag alone", () => {
    expect(freezeMembers([]).id).toBe(EMPTY);
    // Distinct from every populated golden, so the tag is doing work and an empty version is a
    // real thing to pin rather than a degenerate hash of nothing.
    expect(EMPTY).not.toBe(ONE);
    expect(EMPTY).not.toBe(THREE);
  });

  it("the preimage is `loam.container.v1` joined by U+0000, and no other separator reaches it", () => {
    // Built at runtime from a char code, never from an escape in this file's bytes: the escape is
    // exactly what a tool in the chain has been seen to normalize, and a fixture that suffered the
    // same normalization would agree with a broken source for the same wrong reason.
    const NUL = String.fromCharCode(0);
    const preimage = (sep: string): string =>
      `loam.container.v1${sep}${[A, B, C].sort().join(sep)}`;

    expect(contentAddress(new TextEncoder().encode(preimage(NUL)))).toBe(THREE);
    // The negative half — this is what makes the goldens a rail rather than a note. If the control
    // byte is ever silently normalized away, the address lands somewhere else and says so.
    for (const sep of [" ", ",", "|", "", "\\u0000"]) {
      expect(contentAddress(new TextEncoder().encode(preimage(sep)))).not.toBe(THREE);
    }
  });

  it("the id a DOOR serves is that same pinned function of the members it serves", async () => {
    const gw = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    const b = observed(FERN, "height", 31, 1100, OP_SEED);
    await gw.append([a, b]);

    // Object level: the goldens above pin `freezeMembers`, and this is what makes them pin the
    // GATEWAY too — the address a caller receives is `freezeMembers` over the version's own
    // members, not a second address computed some other way inside the door.
    const version = gw.freeze({
      op: "select",
      pred: { match: { field: "id", cmp: "inSet", const: [a.id, b.id] } },
      in: "input",
    });
    expect(version.members).toHaveLength(2);
    expect(version.id).toBe(freezeMembers(version.members).id);
    expect(version.id).not.toBe(freezeMembers([a]).id);
    await gw.close();
  });
});
