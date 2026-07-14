// SPEC §26's contract: as-of reads. The substrate is temporal, and this suite reads it
// temporally. Four laws under test: THE PAST IS A READING (an optional `asOf` resolves the same
// program over the ground as it stood at T — timestamp order and negation order both honored by
// one filter); ERASURE WINS EVEN IN THE PAST (a purged delta can never reappear, no matter how
// far back T points — §11 is the stronger promise, in every door); THE ANNOTATION (a since-erased
// fact leaves an honest count, never its content); and ORTHOGONALITY (a present read is unchanged,
// so every query written before §26 keeps its meaning).

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { handleRest } from "../../src/surface/rest.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OP_SEED);

// A governed Plant store, booted from genesis so Plant is a real REGISTERED-AS-DATA version (v1) —
// both doors answer it. The gardener holds write standing; the caller seeds the facts it needs.
async function bootPlant(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2)],
    }),
  );
}

// The height a GraphQL read answers (present or as-of), and its as-of annotation.
async function readGql(
  gateway: Gateway,
  asOf?: number,
): Promise<{ height: number | null; asOf: number | null; forgotten: number[] | null }> {
  const arg = asOf === undefined ? "" : `, asOf: ${asOf}`;
  const res = await gateway.query(`{ plant(entity: "${FERN}"${arg}) { height _asOf _forgotten } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  const plant = (res.data as { plant: Record<string, unknown> }).plant;
  return {
    height: plant["height"] as number | null,
    asOf: plant["_asOf"] as number | null,
    forgotten: plant["_forgotten"] as number[] | null,
  };
}

// The tombstone the erase left, so a test can read its timestamp (when the ground forgot).
function tombstoneFor(gateway: Gateway, id: string): Delta {
  const tomb = [...gateway.reactor.snapshot()].find((d) =>
    d.claims.pointers.some((p) => p.target.kind === "delta" && p.target.deltaRef.delta === id),
  );
  expect(tomb).toBeDefined();
  return tomb!;
}

describe("the past is a reading, not an archive (SPEC §26)", () => {
  it("resolves the ground as it stood at T — an older pick, and the present unchanged", async () => {
    const gateway = await bootPlant();
    await gateway.append([observed(FERN, "height", 10, 1000, GARDENER_SEED)]);
    await gateway.append([observed(FERN, "height", 20, 2000, GARDENER_SEED)]);

    expect((await readGql(gateway, 1500)).height).toBe(10); // between the two: the earlier wins
    expect((await readGql(gateway, 2500)).height).toBe(20); // after both: the later wins
    expect((await readGql(gateway, 500)).height).toBeNull(); // before either: nothing was said yet
    expect((await readGql(gateway)).height).toBe(20); // the present is untouched — pick-latest

    // The pin and mark ride the response beside the view; a present read carries neither.
    const past = await readGql(gateway, 1500);
    expect(past.asOf).toBe(1500);
    expect(past.forgotten).toEqual([]); // nothing forgotten
    const now = await readGql(gateway);
    expect(now.asOf).toBeNull();
    expect(now.forgotten).toBeNull();
    await gateway.close();
  });

  it("honors negation order: a retraction not yet spoken at T leaves the fact standing", async () => {
    const gateway = await bootPlant();
    const fact = observed(FERN, "height", 10, 1000, GARDENER_SEED);
    await gateway.append([fact]);
    await gateway.append([signClaims(makeNegationClaims(GARDENER, 3000, fact.id), GARDENER_SEED)]);

    expect((await readGql(gateway, 2000)).height).toBe(10); // negation (t=3000) not yet in force
    expect((await readGql(gateway, 4000)).height).toBeNull(); // negation now stands: fact gone
    expect((await readGql(gateway)).height).toBeNull(); // present: negated
    await gateway.close();
  });
});

describe("erasure wins even in the past (SPEC §26 / §11) — in every door", () => {
  it("a purged delta never reappears — not at a T after its birth, not one strictly before", async () => {
    const gateway = await bootPlant();
    const fact = observed(FERN, "height", 50, 1000, GARDENER_SEED);
    await gateway.append([fact]);

    // Before erasure, the fact genuinely stands at a T after its authorship — so its later
    // ABSENCE is the erasure at work, not merely the timestamp filter hiding a not-yet-born fact.
    expect((await readGql(gateway, 2000)).height).toBe(50);

    await gateway.erase(fact.id); // the operator forgets it

    // GraphQL door: purged even at a T where the fact WAS in force (2000 ≥ its birth 1000)…
    expect((await readGql(gateway, 2000)).height).toBeNull();
    // …and at a T strictly before its authorship (the required scenario) — no T resurrects it.
    expect((await readGql(gateway, 500)).height).toBeNull();

    // REST door: the same purged silence, through the second witness.
    for (const t of [2000, 500]) {
      const rest = await handleRest(
        gateway,
        "full",
        "GET",
        ["v1", "Plant", FERN],
        undefined,
        OP_SEED,
        String(t),
      );
      expect(rest.status).toBe(200);
      const view = (rest.body as { view: { height?: number } }).view;
      expect(view.height ?? null).toBeNull();
    }
    await gateway.close();
  });
});

describe("the erasure annotation — the exception is visible even when its content is not", () => {
  it("flags and enumerates a fact forgotten SINCE the moment; a settled past needs no mark", async () => {
    const gateway = await bootPlant();
    const fact = observed(FERN, "height", 50, 1000, GARDENER_SEED);
    await gateway.append([fact]);

    // Before any erasure the window is clean.
    expect((await readGql(gateway, 2000)).forgotten).toEqual([]);

    await gateway.erase(fact.id);
    const forgotAt = tombstoneFor(gateway, fact.id).claims.timestamp; // when the ground forgot

    // Reading the moment T=2000, the erasure was spoken AFTER it (forgotAt ≫ 2000): the past this
    // read reconstructs may be missing a since-erased fact, so it confesses — the discontinuity named.
    const past = await readGql(gateway, 2000);
    expect(past.height).toBeNull(); // the content stays forgotten
    expect(past.forgotten).toEqual([forgotAt]); // …but THAT it was forgotten, and WHEN, is honest

    // Reading a moment at or after the erasure, the forgetting is already baked into the moment's
    // honest absence — a settled past needs no mark.
    expect((await readGql(gateway, forgotAt)).forgotten).toEqual([]);
    await gateway.close();
  });
});
