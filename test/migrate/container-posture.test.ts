// The §27.1 posture rename, carried forward (SPEC §20 × §27.1). A container's `posture` says one
// thing — does this container hold its OWN bytes, or is it a reading over ground already held — and
// the words now say exactly that: `wall` → `separate`, `property` → `shared`.
//
// The suite rails the step in BOTH directions the rename can go wrong:
//
//   • FORWARD — a store whose BYTES carry the retired words resolves the same container table it
//     always did (trust, posture semantics, parent, membership), and after migration the table is
//     identical to the table before it. A rename that changed what a store MEANS fails here.
//   • GROW-ONLY — each retired declaration is NEGATED with a `supersededBy` link at its
//     re-expression and a reason; the old delta stays on the record. Nothing vanishes.
//
// The legacy store is minted at the BACKEND, not through `append`: the door refuses a retired word
// on purpose, so bytes-already-on-disk is the only honest way to hold them, and it is also the real
// case — an existing store is replayed at open, never re-validated.
//
// Two-sided on the erasure guard, which is the one place this rename could have quietly cost a
// promise: the step re-signs only SURVIVING law, so a STRUCK declaration keeps its retired word
// forever. The guard must still read that lineage as "this container had a store of its own" (the
// target side), while a container that was only ever SHARED is still no fault (the bystander side).
//
// What this file deliberately does NOT assert: the refusal prose for a well-formed current
// declaration (container-vocab.test.ts owns that) or the byte behavior of a separate store
// (container-wall.test.ts owns that). Here the subject is the vocabulary and the step that moves it.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { migrate } from "../../src/migrate/migrate.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container.js";
import { retraction } from "../gateway/narrowing.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { legacyContainerClaims } from "./legacy.js";

const OP_SEED = "3a".repeat(32);
const OP = authorForSeed(OP_SEED);

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

const GENESIS = assembleGenesis({
  operatorSeed: OP_SEED,
  registrations: [
    { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
  ],
});

// A store whose BYTES are already there — appended at the backend, replayed at open, no door in the
// path. This is what a legacy store on disk is, and the only way to hold a retired posture word.
const openWith = async (extra: readonly Delta[]): Promise<Gateway> => {
  const backend = new MemoryBackend();
  await backend.append([...GENESIS.deltas, ...extra]);
  const gw = await Gateway.open(backend, { seed: OP_SEED });
  gw.replayRegistrations();
  await gw.preloadResolvers();
  return gw;
};

const fact = observed(FERN, "height", 30, 1000, OP_SEED);

// One container of each retired posture. The SHARED one carries a membership (its posture requires
// one) and a parent edge, so the re-sign has to preserve more roles than the posture it rewrites.
const legacySeparate = signClaims(
  legacyContainerClaims(
    { container: "container:arena", trust: "untrusted", posture: "wall" },
    OP,
    8000,
  ),
  OP_SEED,
);
const legacyShared = signClaims(
  legacyContainerClaims(
    {
      container: "container:view",
      trust: "curated",
      posture: "property",
      parent: "container:arena",
      membership: HEIGHTS,
    },
    OP,
    8100,
  ),
  OP_SEED,
);
const legacyStore: Delta[] = [...GENESIS.deltas, fact, legacySeparate, legacyShared];

const postureWordOf = (d: Delta): string | undefined => {
  const p = d.claims.pointers.find((x) => x.role === "posture");
  return p?.target.kind === "primitive" ? String(p.target.value) : undefined;
};

const negationOf = (deltas: readonly Delta[], targetId: string): Delta | undefined =>
  deltas.find((d) =>
    d.claims.pointers.some(
      (p) =>
        p.role === "negates" && p.target.kind === "delta" && p.target.deltaRef.delta === targetId,
    ),
  );

describe("§20 × §27.1 — the posture rename is carried forward, not assumed", () => {
  it("the retired words are what the fixture actually mints", () => {
    // Without this the suite could be green against a store that already spoke the new vocabulary,
    // proving only that the step handles a shape it never sees.
    expect(postureWordOf(legacySeparate)).toBe("wall");
    expect(postureWordOf(legacyShared)).toBe("property");
  });

  it("a store on the retired words resolves the SAME table before and after migration", async () => {
    // BEFORE: the bytes say `wall`/`property` and the reader binds them anyway. `loam migrate` is
    // something a person RUNS, and a container that vanished until they ran it would empty every
    // scope and blind the erasure guard without a word (H9).
    const before = await openWith([fact, legacySeparate, legacyShared]);
    const beforeTable = readContainerTable(before.reactor, OP);
    expect(beforeTable.containers.get("container:arena")).toMatchObject({
      trust: "untrusted",
      posture: "separate",
    });
    expect(beforeTable.containers.get("container:view")).toMatchObject({
      trust: "curated",
      posture: "shared",
      parent: "container:arena",
    });
    expect(beforeTable.containers.get("container:view")?.membership).toEqual(HEIGHTS);
    expect(beforeTable.defects).toEqual([]);
    await before.close();

    // AFTER: the re-expressions bind, the retired declarations are struck, and every resolved field
    // is equal to the reading above — same trust, same posture, same parent, same membership. A
    // rename that shifted meaning cannot pass this.
    const { deltas, report } = migrate(legacyStore, { seed: OP_SEED });
    const after = await openWith(deltas);
    const afterTable = readContainerTable(after.reactor, OP);
    expect([...afterTable.containers.keys()].sort()).toEqual(
      [...beforeTable.containers.keys()].sort(),
    );
    for (const name of afterTable.containers.keys()) {
      expect(afterTable.containers.get(name)).toEqual(beforeTable.containers.get(name));
    }
    expect(afterTable.defects).toEqual([]);

    // OBJECT LEVEL: what a READER gets through the shared container's scope, not what the table says
    // about it. The membership survived the re-sign, so the scope still names the fact.
    expect(after.containerScope({ containers: ["container:view"] }).map((d) => d.id)).toContain(
      fact.id,
    );
    await after.close();

    // The at-rest bytes now speak the current vocabulary, and this is the only step that fired.
    const surviving = deltas.filter(
      (d) => postureWordOf(d) !== undefined && negationOf(deltas, d.id) === undefined,
    );
    expect(surviving.map(postureWordOf).sort()).toEqual(["separate", "shared"]);
    expect(report.applied).toEqual([{ id: "container-posture-storage-words", superseded: 2 }]);
  });

  it("supersedes rather than rewrites: the retired declarations are negated, linked, and kept", () => {
    const { deltas } = migrate(legacyStore, { seed: OP_SEED });
    for (const old of [legacySeparate, legacyShared]) {
      // grow-only: the old bytes are still on the record, exactly as they were signed
      expect(deltas.some((d) => d.id === old.id)).toBe(true);
      const negation = negationOf(deltas, old.id);
      expect(negation, `the ${postureWordOf(old)} declaration is negated`).toBeDefined();
      const link = negation!.claims.pointers.find((p) => p.role === "supersededBy");
      expect(link?.target.kind).toBe("delta");
      // The link points at the RE-EXPRESSION, and the re-expression is the same declaration in the
      // current vocabulary at the same timestamp — not merely "some delta", which a wrong link would
      // also satisfy.
      const replacementId = link?.target.kind === "delta" ? link.target.deltaRef.delta : undefined;
      const replacement = deltas.find((d) => d.id === replacementId);
      expect(replacement).toBeDefined();
      expect(postureWordOf(replacement!)).toBe(
        postureWordOf(old) === "wall" ? "separate" : "shared",
      );
      expect(replacement!.claims.timestamp).toBe(old.claims.timestamp);
      expect(replacement!.claims.author).toBe(OP);
      // Everything else in the declaration is untouched: the re-expression differs from the original
      // in the posture primitive and nothing more.
      expect(replacement!.claims.pointers.length).toBe(old.claims.pointers.length);
      expect(replacement!.claims.pointers.filter((p) => p.role !== "posture")).toEqual(
        old.claims.pointers.filter((p) => p.role !== "posture"),
      );
      expect(negation!.claims.pointers.some((p) => p.role === "reason")).toBe(true);
      expect(negation!.claims.author).toBe(OP);
    }
    // The unrelated fact rode through untouched — the step's reach is the declaration, nothing else.
    expect(deltas.some((d) => d.id === fact.id)).toBe(true);
    expect(negationOf(deltas, fact.id)).toBeUndefined();
  });

  it("is idempotent: a migrated store re-migrates to nothing", () => {
    const first = migrate(legacyStore, { seed: OP_SEED });
    const second = migrate(first.deltas, { seed: OP_SEED });
    expect(new Set(second.deltas.map((d) => d.id))).toEqual(new Set(first.deltas.map((d) => d.id)));
    expect(second.report.applied).toEqual([]);
  });

  it("a WITHDRAWN declaration is not re-expressed — the honest forget stays forgotten", async () => {
    // The `survives` gate is the whole of T41 at this step, and idempotence CANNOT stand in for it:
    // migration is grow-only, so on a second run the struck legacy delta is still present and
    // re-signs to the identical content address, which dedups away — the idempotence rail passes with
    // the gate deleted. This is the rail that does not.
    //
    // TWO-SIDED, because an assertion of pure absence would also pass if the step never ran at all:
    // the forgotten container must NOT come back, and the live one beside it MUST still migrate.
    const struck = retraction(legacySeparate.id, OP, OP_SEED, 8050);
    const { deltas } = migrate([...legacyStore, struck], { seed: OP_SEED });

    // TARGET: nothing in the output declares the forgotten container in the current vocabulary — a
    // re-expression would be live, operator-signed law for an entity the operator deliberately ended,
    // wearing an id its retraction never named.
    const declares = (d: Delta, entity: string): boolean =>
      d.claims.pointers.some(
        (p) =>
          p.role === "container" && p.target.kind === "entity" && p.target.entity.id === entity,
      );
    const revived = deltas.filter(
      (d) => declares(d, "container:arena") && postureWordOf(d) === "separate",
    );
    expect(revived, "the withdrawn declaration was re-expressed").toEqual([]);

    // BYSTANDER: the surviving declaration beside it still migrated, so the emptiness above is a
    // refusal to resurrect and not a step that quietly did nothing.
    const carried = deltas.filter(
      (d) => declares(d, "container:view") && postureWordOf(d) === "shared",
    );
    expect(carried).toHaveLength(1);

    // OBJECT LEVEL: what a READER resolves over the migrated ground, not what the delta set holds —
    // the forgotten container is absent from the table, the live one is present, and no defect was
    // manufactured. This is the level that would catch a revival wearing a shape the filter above
    // did not anticipate.
    const gw = await openWith(deltas);
    const table = readContainerTable(gw.reactor, OP);
    expect(table.containers.has("container:arena")).toBe(false);
    expect(table.containers.get("container:view")?.posture).toBe("shared");
    expect(table.defects).toEqual([]);
    await gw.close();
  });

  it("a store born on the current words is not touched by the step at all", () => {
    const current = signClaims(
      containerClaims(
        { container: "container:new", trust: "untrusted", posture: "separate" },
        OP,
        8200,
      ),
      OP_SEED,
    );
    const store = [...GENESIS.deltas, current];
    const { deltas, report } = migrate(store, { seed: OP_SEED });
    expect(deltas.map((d) => d.id).sort()).toEqual(store.map((d) => d.id).sort());
    expect(report.applied).toEqual([]);
  });

  it("the door refuses a retired word and names the migration", async () => {
    const gw = await openWith([]);
    const retired = (container: string, posture: "wall" | "property", ts: number): Delta =>
      signClaims(
        legacyContainerClaims(
          {
            container,
            trust: "curated",
            posture,
            ...(posture === "property" ? { membership: HEIGHTS } : {}),
          },
          OP,
          ts,
        ),
        OP_SEED,
      );
    await expect(gw.append([retired("container:old", "wall", 8300)])).rejects.toThrow(
      /retired word for "separate"[\s\S]*loam migrate/,
    );
    // ...and the shared word likewise: one refusal per retired value, so neither slips through.
    await expect(gw.append([retired("container:old2", "property", 8400)])).rejects.toThrow(
      /retired word for "shared"[\s\S]*loam migrate/,
    );
    await gw.close();
  });
});

describe("§27.7 — the erasure guard reads a retired lineage, both sides", () => {
  it("a STRUCK retired separate declaration still refuses completeness", async () => {
    // The step re-signs only SURVIVING law, so a struck declaration keeps `wall` on the record
    // forever. Matching the current word alone would have retired this guard for every pre-rename
    // store — and a guard that stops firing reports a completeness it never proved (H7). The
    // earliest declaration is separate and struck; a later SHARED one survives, so the binding
    // posture reads `shared` while a store of its own may still hold bytes.
    const first = signClaims(
      legacyContainerClaims(
        { container: "container:flip", trust: "curated", posture: "wall" },
        OP,
        9400,
      ),
      OP_SEED,
    );
    const gw = await openWith([fact, first]);
    const second = signClaims(
      containerClaims(
        { container: "container:flip", trust: "curated", posture: "shared", membership: HEIGHTS },
        OP,
        9500,
      ),
      OP_SEED,
    );
    await gw.federate([second], { admit: () => true }); // the flip lands as data; the door refuses it
    await gw.append([retraction(first.id, OP, OP_SEED, 9600)]);
    expect(gw.containers().containers.get("container:flip")?.posture).toBe("shared");

    // TARGET SIDE: the lineage is remembered through the RETIRED word, so the erase refuses.
    await expect(gw.erase(fact.id)).rejects.toThrow(/container:flip/);
    // Forgetting the container WHOLE is still the honest exit — the guard is not a dead end.
    await gw.append([retraction(second.id, OP, OP_SEED, 9700)]);
    await expect(gw.erase(fact.id)).resolves.toMatchObject({ erased: fact.id });
    await gw.close();
  });

  it("BYSTANDER: a container that was only ever SHARED is no fault, retired word or not", async () => {
    // The other half. If the guard read every retired word as a store of its own, a legacy
    // `property` container would refuse every erase forever — over-refusing is the mirror of
    // over-claiming, and only this leg can see it.
    const bystander = observed(FERN, "height", 31, 1100, OP_SEED);
    const gw = await openWith([bystander, legacyShared]);
    expect(gw.containers().containers.get("container:view")?.posture).toBe("shared");
    await expect(gw.erase(bystander.id)).resolves.toMatchObject({ erased: bystander.id });
    // The shared container is still declared afterwards — the erase took no container with it.
    expect(gw.containers().containers.has("container:view")).toBe(true);
    await gw.close();
  });
});
