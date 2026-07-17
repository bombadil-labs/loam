// §27.6 membership rails (ticket T15) — membership is a QUERY, first-class: a rhizomatic Term →
// dset, static (`select`) or live (`watch`), and the quarantine's seeding edge generalized to a
// membership Term with the old `admit` predicate as its degenerate case (§24.10: same knob,
// generalized, no new mechanism). The composability 0.6.0 bought is proven where it matters — a
// NESTED difference evaluating through the seeding edge and live-following the ground.
//
// Written BEFORE the build (P3): every rail here failed on the pre-T15 code (no select, no watch,
// no membership knob) except the reused §24.8 erasure law, which must hold against a Term-seeded
// pool exactly as it held against a predicate-seeded one.

import { describe, expect, it } from "vitest";
import { authorForSeed, evalTerm, parseTerm, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { readTombstones } from "../../src/gateway/erase.js";
import { PLANT } from "./fixtures.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

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

// The operator's own domain claims — the select() every rail below carves from.
const OPERATOR_CLAIMS = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OP } },
  in: "input",
};
const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

const holds = (gw: Gateway, id: string): boolean =>
  [...gw.reactor.snapshot()].some((d) => d.id === id);

describe("§27.6 select — evaluate a membership Term over this store's ground, once", () => {
  it("select returns exactly the Term's dset over the real ground", async () => {
    const gw = await boot();
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    const m = observed(FERN, "message", "hello", 1100, OP_SEED);
    await gw.append([h, m]);
    const got = gw
      .select(HEIGHTS)
      .map((d) => d.id)
      .sort();
    const expected = evalTerm(parseTerm(HEIGHTS), gw.reactor.snapshot());
    if (expected.sort !== "dset") throw new Error("fixture term must be dset");
    expect(got).toEqual([...expected.set].map((d) => d.id).sort());
    expect(got).toContain(h.id);
    expect(got).not.toContain(m.id);
    await gw.close();
  });

  it("a non-dset Term is refused loudly at the door", async () => {
    const gw = await boot();
    // Both refusal voices are the door's: a term that cannot even evaluate rootless (a group needs
    // an ambient root) is refused by the evaluator itself; one that evaluates to a non-dset sort
    // is refused by select's own check. Either way: loud, and nothing lands.
    const grouping = { op: "group", key: "byTargetContext", in: "input" };
    expect(() => gw.select(grouping)).toThrow();
    const masked = { op: "mask", policy: "drop", in: "input" }; // evaluates fine — and IS a dset
    expect(() => gw.select(masked)).not.toThrow();
    await gw.close();
  });
});

describe("§27.6 watch — the same Term, live", () => {
  it("watch emits the current members, then follows the ground as it moves", async () => {
    const gw = await boot();
    const h1 = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([h1]);
    const stream = gw.watch(HEIGHTS);
    const first = await stream.next();
    expect((first.value as { id: string }[]).map((d) => d.id)).toContain(h1.id);
    const h2 = observed(FERN, "height", 31, 2000, OP_SEED);
    await gw.append([h2]);
    const second = await stream.next();
    const ids = (second.value as { id: string }[]).map((d) => d.id);
    expect(ids).toContain(h1.id);
    expect(ids).toContain(h2.id);
    await stream.return?.(undefined);
    await gw.close();
  });
});

describe("§24.10 the seeding edge takes a membership Term (admit is the degenerate case)", () => {
  it("a membership-Term-seeded pool admits exactly the members", async () => {
    const gw = await boot();
    const mine = observed(FERN, "height", 30, 1000, OP_SEED);
    const theirs = observed(FERN, "height", 99, 1100, GARDENER_SEED);
    await gw.append([mine]);
    await gw.federate([theirs]);
    const q = await gw.openQuarantine({ membership: OPERATOR_CLAIMS });
    expect(holds(q.gateway, mine.id)).toBe(true); // a member
    expect(holds(q.gateway, theirs.id)).toBe(false); // not selected — never seen
    await q.drop();
    await gw.close();
  });

  it("the §24.8 erasure law holds against a Term-seeded pool, byte-for-byte", async () => {
    const FORGOTTEN = "term-scoped-pools-forget-like-any-other";
    const gw = await boot();
    const secret = observed(FERN, "message", FORGOTTEN, 1500, OP_SEED);
    await gw.append([secret]);
    const poolBackend = new MemoryBackend();
    const q = await gw.openQuarantine({ backend: poolBackend, membership: OPERATOR_CLAIMS });
    expect(holds(q.gateway, secret.id)).toBe(true);

    await gw.erase(secret.id, {
      reason: "the scope narrows what a pool sees, never what it forgets",
    });

    expect(readTombstones(q.gateway.reactor, OP).has(secret.id)).toBe(true);
    expect(holds(q.gateway, secret.id)).toBe(false);
    const atRest = await poolBackend.deltasSince(new Set());
    expect(atRest.some((d) => d.id === secret.id)).toBe(false);
    expect(JSON.stringify(atRest)).not.toContain(FORGOTTEN);
    await q.drop();
    await gw.close();
  });

  it("a NESTED difference evaluates through the seeding edge and live-follows", async () => {
    const gw = await boot();
    const opHeight = observed(FERN, "height", 30, 1000, OP_SEED);
    const opMessage = observed(FERN, "message", "mine", 1100, OP_SEED);
    await gw.append([opHeight, opMessage]);
    // The scope the depth-1 idiom could never say: the operator's claims MINUS (the operator's
    // claims MINUS the heights) — i.e. exactly the operator's heights, said the long way round,
    // difference against difference.
    const scope = {
      op: "difference",
      of: OPERATOR_CLAIMS,
      without: { op: "difference", of: OPERATOR_CLAIMS, without: HEIGHTS },
    };
    const q = await gw.openQuarantine({ membership: scope });
    expect(holds(q.gateway, opHeight.id)).toBe(true);
    expect(holds(q.gateway, opMessage.id)).toBe(false);

    // Live-follow: a new height lands in the primary; the pulse carries it through the SAME scope.
    const later = observed(FERN, "height", 44, 2000, OP_SEED);
    await gw.append([later]);
    await q.reseed();
    expect(holds(q.gateway, later.id)).toBe(true); // the composed scope followed the ground
    const noise = observed(FERN, "message", "still not in scope", 2100, OP_SEED);
    await gw.append([noise]);
    await q.reseed();
    expect(holds(q.gateway, noise.id)).toBe(false);
    await q.drop();
    await gw.close();
  });
});
