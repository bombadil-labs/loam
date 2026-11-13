import { describe, expect, it } from "vitest";
import { contentAddress, type Delta, type Policy } from "@bombadil/rhizomatic";
import { freezeMembers } from "../../src/gateway/container-identity.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const A = "1e20" + "aa".repeat(32);
const B = "1e20" + "bb".repeat(32);
const C = "1e20" + "cc".repeat(32);

const THREE = "1e20292cdf2577672eba7fbdc44ae494b4484fae515c33f2892ace157559f956137a";
const ONE = "1e207a4f320f39f73404260ce007187871e149b15015a4471b153d1e4b7b2c9be4dd";
const EMPTY = "1e203c7a5345ea3ba5281abdd36a74b158ef5dc828374abd4b4cb760d9369b1c67ab";

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
    expect(freezeMembers([member(C), member(A), member(B)]).id).toBe(THREE);
  });

  it("a one-member set addresses to its golden", () => {
    expect(freezeMembers([member(A)]).id).toBe(ONE);
  });

  it("the empty set addresses to its golden — the domain tag alone", () => {
    expect(freezeMembers([]).id).toBe(EMPTY);
    expect(EMPTY).not.toBe(ONE);
    expect(EMPTY).not.toBe(THREE);
  });

  it("the preimage is `loam.container.v1` joined by U+0000, and no other separator reaches it", () => {
    const NUL = String.fromCharCode(0);
    const preimage = (sep: string): string =>
      `loam.container.v1${sep}${[A, B, C].sort().join(sep)}`;

    const fromSource = freezeMembers([member(A), member(B), member(C)]).id;
    expect(contentAddress(new TextEncoder().encode(preimage(NUL)))).toBe(fromSource);
    expect(fromSource).toBe(THREE);
    for (const sep of [" ", ",", "|", "", "\\u0000"]) {
      expect(contentAddress(new TextEncoder().encode(preimage(sep)))).not.toBe(fromSource);
    }
  });

  it("the id a DOOR serves is that same pinned function of the members it serves", async () => {
    const gw = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    const b = observed(FERN, "height", 31, 1100, OP_SEED);
    await gw.append([a, b]);

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
