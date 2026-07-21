// §27.2 / §27.6 q2 module-version identity rails (ticket T29) — freezing a membership Term to a
// MODULE VERSION: an immutable, content-addressed delta-set whose id is a pure function of its
// MEMBERS. §27.2 decided the shape (order-free, because the members are a CRDT set); this fixes the
// rung — a hash over the SORTED member ids — and rails the five properties that make the id worth
// having: order-freedom, cross-store determinism, sensitivity, non-drift, and no metadata in the
// address.
//
// Written BEFORE the build (P3): every rail here fails on pre-T29 code, where `freeze` does not
// exist. The point of the id is that two stores that froze the same members agree without
// coordinating — dedup, verification, reproducibility. A test that only checked "freeze returns a
// string" would pass without any of that, so each rail below asserts an AGREEMENT or a
// DISAGREEMENT between two independently-reached ids, never the shape of one.

import { describe, expect, it } from "vitest";
import { type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
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

// A membership Term naming an explicit id set — the shape that lets a rail hand the SAME members
// to `freeze` by two different routes.
const byIds = (ids: readonly string[]): unknown => ({
  op: "select",
  pred: { match: { field: "id", cmp: "inSet", const: [...ids] } },
  in: "input",
});

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

describe("§27.2 freeze — a membership Term becomes a content-addressed module version", () => {
  it("the id is ORDER-FREE: the same members reached by differently-ordered Terms agree", async () => {
    const gw = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    const b = observed(FERN, "height", 31, 1100, OP_SEED);
    const c = observed(FERN, "height", 32, 1200, OP_SEED);
    await gw.append([a, b, c]);

    // Same three members, three different orderings of the naming Term. The members are a CRDT
    // set, so nothing about how they were reached may reach the address.
    const one = gw.freeze(byIds([a.id, b.id, c.id]));
    const two = gw.freeze(byIds([c.id, a.id, b.id]));
    const three = gw.freeze(byIds([b.id, c.id, a.id]));

    expect(one.id).toBe(two.id);
    expect(two.id).toBe(three.id);
    // ...and it really is those three, not an empty set agreeing with itself.
    expect(one.members.map((d) => d.id).sort()).toEqual([a.id, b.id, c.id].sort());
    await gw.close();
  });

  it("the id is order-free across a UNION, whichever side is named first", async () => {
    const gw = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    const b = observed(FERN, "message", "hi", 1100, OP_SEED);
    await gw.append([a, b]);

    const left = gw.freeze({ op: "union", left: byIds([a.id]), right: byIds([b.id]) });
    const right = gw.freeze({ op: "union", left: byIds([b.id]), right: byIds([a.id]) });

    expect(left.id).toBe(right.id);
    expect(left.members).toHaveLength(2);
    await gw.close();
  });

  it("two INDEPENDENT stores holding the same members freeze to the same id (no coordination)", async () => {
    const here = await boot();
    const there = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    const b = observed(FERN, "height", 31, 1100, OP_SEED);
    await here.append([a, b]);
    await there.append([a, b]);

    // Each store also holds ground the other does not — the address is over the MEMBERS the Term
    // selected, never over the store they were selected from.
    await here.append([observed(FERN, "message", "only here", 1200, OP_SEED)]);
    await there.federate([observed(FERN, "height", 99, 1300, GARDENER_SEED)]);

    expect(here.freeze(byIds([a.id, b.id])).id).toBe(there.freeze(byIds([a.id, b.id])).id);
    await here.close();
    await there.close();
  });

  it("the id is SENSITIVE: adding or dropping one member changes it", async () => {
    const gw = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    const b = observed(FERN, "height", 31, 1100, OP_SEED);
    const c = observed(FERN, "height", 32, 1200, OP_SEED);
    await gw.append([a, b, c]);

    const pair = gw.freeze(byIds([a.id, b.id])).id;
    const trio = gw.freeze(byIds([a.id, b.id, c.id])).id;
    const swapped = gw.freeze(byIds([a.id, c.id])).id;

    expect(trio).not.toBe(pair);
    expect(swapped).not.toBe(pair);
    expect(swapped).not.toBe(trio);
    await gw.close();
  });

  it("a frozen version does NOT drift as the ground grows underneath it", async () => {
    const gw = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([a]);

    // Frozen against a LIVE term — one that would select more members the moment more land.
    const version = gw.freeze(HEIGHTS);
    const idAtFreeze = version.id;
    const membersAtFreeze = version.members.map((d) => d.id).sort();

    await gw.append([observed(FERN, "height", 31, 1100, OP_SEED)]);
    await gw.append([observed(FERN, "height", 32, 1200, OP_SEED)]);

    // The version is immutable: this is the living→frozen ladder of §27.2. A LIVING container
    // re-evaluates; a version does not.
    expect(version.id).toBe(idAtFreeze);
    expect(version.members.map((d) => d.id).sort()).toEqual(membersAtFreeze);
    expect(version.members).toHaveLength(1);

    // And freezing the same term NOW is a different version — the drift is real, the frozen one
    // just does not participate in it.
    expect(gw.freeze(HEIGHTS).id).not.toBe(idAtFreeze);
    await gw.close();
  });

  it("the address is over MEMBERS, not over WHEN the freeze happened", async () => {
    const gw = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([a]);

    const first = gw.freeze(byIds([a.id]));
    await new Promise((r) => setTimeout(r, 12)); // the wall clock moves between the two freezes
    const second = gw.freeze(byIds([a.id]));

    expect(second.id).toBe(first.id);
    await gw.close();
  });

  it("a non-dset Term is refused at the door, exactly as select refuses it", async () => {
    const gw = await boot();
    // freeze is select + an address; it must not WIDEN what select accepts, and it must not
    // narrow it either. That equivalence is the real property, so assert it directly rather than
    // pinning one error string: for the same Term, the two doors agree — both refuse, with the
    // same voice, or both admit.
    //
    // (Asserting the equivalence also keeps this rail honest. Before this ticket `gw.freeze` did
    // not exist, so a bare `.toThrow()` went green on the TypeError — passing without any of the
    // behavior. Comparing freeze's answer to select's cannot pass that way.)
    const refused = { op: "group", key: "byTargetContext", in: "input" }; // cannot evaluate rootless
    const admitted = { op: "mask", policy: "drop", in: "input" }; // evaluates, and IS a dset

    let selectSaid = "";
    let freezeSaid = "";
    expect(() => gw.select(refused)).toThrow();
    try {
      gw.select(refused);
    } catch (e) {
      selectSaid = (e as Error).message;
    }
    expect(() => gw.freeze(refused)).toThrow();
    try {
      gw.freeze(refused);
    } catch (e) {
      freezeSaid = (e as Error).message;
    }
    expect(freezeSaid).toBe(selectSaid);
    expect(freezeSaid).not.toMatch(/is not a function/); // the door's voice, not a missing method

    // And where select admits, freeze admits — over exactly select's members.
    expect(() => gw.freeze(admitted)).not.toThrow();
    expect(
      gw
        .freeze(admitted)
        .members.map((d) => d.id)
        .sort(),
    ).toEqual(
      gw
        .select(admitted)
        .map((d) => d.id)
        .sort(),
    );
    await gw.close();
  });

  it("an EMPTY membership is a lawful version, and a stable one", async () => {
    const gw = await boot();
    const empty = gw.freeze(byIds([]));
    expect(empty.members).toHaveLength(0);
    // Stable across stores and across calls — an empty module is a real thing to pin, and two
    // people who pin it must agree.
    const other = await boot();
    expect(other.freeze(byIds([])).id).toBe(empty.id);
    // ...and distinguishable from any non-empty one.
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([a]);
    expect(gw.freeze(byIds([a.id])).id).not.toBe(empty.id);
    await gw.close();
    await other.close();
  });
});
