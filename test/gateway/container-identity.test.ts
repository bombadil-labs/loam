import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { assertPreservesSuppression } from "./narrowing.js";

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

    const one = gw.freeze(byIds([a.id, b.id, c.id]));
    const two = gw.freeze(byIds([c.id, a.id, b.id]));
    const three = gw.freeze(byIds([b.id, c.id, a.id]));

    expect(one.id).toBe(two.id);
    expect(two.id).toBe(three.id);
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

    const version = gw.freeze(HEIGHTS);
    const idAtFreeze = version.id;
    const membersAtFreeze = version.members.map((d) => d.id).sort();

    await gw.append([observed(FERN, "height", 31, 1100, OP_SEED)]);
    await gw.append([observed(FERN, "height", 32, 1200, OP_SEED)]);

    expect(version.id).toBe(idAtFreeze);
    expect(version.members.map((d) => d.id).sort()).toEqual(membersAtFreeze);
    expect(version.members).toHaveLength(1);

    expect(gw.freeze(HEIGHTS).id).not.toBe(idAtFreeze);
    await gw.close();
  });

  it("the address is over MEMBERS, not over WHEN the freeze happened", async () => {
    const gw = await boot();
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([a]);

    const first = gw.freeze(byIds([a.id]));
    await new Promise((r) => setTimeout(r, 12));
    const second = gw.freeze(byIds([a.id]));

    expect(second.id).toBe(first.id);
    await gw.close();
  });

  it("a non-dset Term is refused at the door, exactly as select refuses it", async () => {
    const gw = await boot();
    const refused = { op: "group", key: "byTargetContext", in: "input" };
    const admitted = { op: "mask", policy: "drop", in: "input" };

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
    expect(freezeSaid).not.toMatch(/is not a function/);

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

  it("a version carries the NEGATION CLOSURE — it never ships a claim without what struck it", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const retraction = signClaims(
      {
        timestamp: 1100,
        validFrom: 1100,
        author: authorForSeed(OP_SEED),
        pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: claim.id } } }],
      },
      OP_SEED,
    );
    await gw.append([retraction]);

    expect(gw.select(byIds([claim.id])).map((d) => d.id)).toEqual([claim.id]);

    const version = gw.freeze(byIds([claim.id]));
    expect(version.members.map((d) => d.id).sort()).toEqual([claim.id, retraction.id].sort());

    const destination = await boot();
    await destination.append([...version.members]);
    assertPreservesSuppression({ what: "freeze", source: gw, destination, struckClaim: claim.id });
    await destination.close();

    const other = await boot();
    await other.append([claim]);
    expect(other.freeze(byIds([claim.id])).id).not.toBe(version.id);
    await other.close();
    await gw.close();
  });

  it("an EMPTY membership is a lawful version, and a stable one", async () => {
    const gw = await boot();
    const empty = gw.freeze(byIds([]));
    expect(empty.members).toHaveLength(0);
    const other = await boot();
    expect(other.freeze(byIds([])).id).toBe(empty.id);
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([a]);
    expect(gw.freeze(byIds([a.id])).id).not.toBe(empty.id);
    await gw.close();
    await other.close();
  });
});
