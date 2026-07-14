// SPEC §14 (edge verbs): link and sever name the relation directly. They are PURE SURFACE SUGAR
// over the two primitives — link is `assert` of an edge delta, sever is `retract` of one — of the
// SAME shape the wire already carries: a per-prop write whose value pointer targets an ENTITY
// rather than a primitive. Nothing new lands on the wire, so no migration rides this.
//
// The `expand` that marks a field as an edge lives in the HYPERSCHEMA's gather body, not the
// resolution Schema — so the surface reads the published gather to learn an edge's target ROLE and
// to know a schema HAS edges at all. A schema whose gather never expands (Plant here) offers no
// entity-pointer write: its `link<Type>` verb does not exist. Edge fields take entity pointers;
// primitive fields do not.

import { describe, expect, it } from "vitest";
import { parseTerm, verifyDelta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import {
  PLANT,
  PLANT_POLICY,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
  pickLatest,
} from "./fixtures.js";

const KEEPER_SEED = "c3".repeat(32);
const BED = "bed:shade";
const MOSS = "plant:moss";

// A Bed gathers everything pointing at it (byTargetContext), then EXPANDS the `plant` role into the
// child's Plant view — so `plants` is an edge field, while `name` stays a plain primitive.
const bedBody = parseTerm({
  op: "expand",
  role: { exact: "plant" },
  schema: "Plant",
  in: {
    op: "group",
    key: "byTargetContext",
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    },
  },
});
const BED_SCHEMA = { name: "Bed", alg: 1, body: bedBody } as const;
const BED_POLICY = {
  props: new Map([
    ["plants", pickLatest],
    ["name", pickLatest],
  ]),
  default: pickLatest,
};

// The garden plus a second plant to link, so a value-scoped sever has something to leave standing.
const world = [...garden, observed(MOSS, "height", 12, 1000, GARDENER_SEED)];

// The governed garden: the keeper operates; the gardener holds write standing; Plant and Bed both
// bind, so the Bed's `plant` expansion resolves against a registered Plant.
async function bedGateway(backend = new MemoryBackend()): Promise<Gateway> {
  const gateway = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append(world);
  gateway.register(PLANT, PLANT_POLICY, [FERN, MOSS], undefined, PLANT_WRITABLE);
  gateway.register(BED_SCHEMA, BED_POLICY, [BED], undefined, ["plants", "name"]);
  return gateway;
}

const link = (entity: string, field: string, target: string): string =>
  `mutation { linkBed(entity: "${entity}", field: "${field}", target: "${target}") { plants name } }`;
const sever = (entity: string, field: string, targets?: string[]): string =>
  `mutation { severBed(entity: "${entity}", field: "${field}"${
    targets === undefined ? "" : `, targets: [${targets.map((t) => `"${t}"`).join(", ")}]`
  }) { plants } }`;

type BedView = { plants: Record<string, unknown> | null; name?: string | null };
const linked = (r: { data?: unknown }): BedView => (r.data as { linkBed: BedView }).linkBed;
const severed = (r: { data?: unknown }): BedView => (r.data as { severBed: BedView }).severBed;

describe("link / sever (§14 edge verbs): assert and retract an edge, named", () => {
  it("link asserts an edge that resolves to the child's view; sever retracts it to absence", async () => {
    const gateway = await bedGateway();
    // Before: nothing planted — the edge field is absent.
    const before = await gateway.query(`{ bed(entity: "${BED}") { plants } }`);
    expect((before.data as { bed: { plants: unknown } }).bed.plants).toBeNull();

    // Link the fern in: the `plants` field now resolves to the fern's nested Plant view.
    const after = await gateway.query(link(BED, "plants", FERN), undefined, {
      actor: GARDENER_SEED,
    });
    expect(after.errors).toBeUndefined();
    expect(linked(after).plants).toMatchObject({ height: 34 }); // the child Plant view, expanded

    // A plain re-query agrees — the edge is real ground, not a mutation echo.
    const reread = await gateway.query(`{ bed(entity: "${BED}") { plants } }`);
    expect((reread.data as { bed: { plants: Record<string, unknown> } }).bed.plants).toMatchObject({
      height: 34,
    });

    // Sever it: the edge is gone, the field falls back to absence.
    const gone = await gateway.query(sever(BED, "plants"), undefined, { actor: GARDENER_SEED });
    expect(gone.errors).toBeUndefined();
    expect(severed(gone).plants).toBeNull();
    await gateway.close();
  });

  it("sever is value-scoped by target: naming one edge leaves the others standing", async () => {
    const gateway = await bedGateway();
    // Link two plants; pick-latest resolves `plants` to the moss (linked last).
    await gateway.query(link(BED, "plants", FERN), undefined, { actor: GARDENER_SEED });
    await gateway.query(link(BED, "plants", MOSS), undefined, { actor: GARDENER_SEED });
    const both = await gateway.query(`{ bed(entity: "${BED}") { plants } }`);
    expect((both.data as { bed: { plants: Record<string, unknown> } }).bed.plants).toMatchObject({
      height: 12,
    });

    // Sever only the moss edge — the fern edge remains and `plants` falls back to it.
    const after = await gateway.query(sever(BED, "plants", [MOSS]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(after.errors).toBeUndefined();
    expect(severed(after).plants).toMatchObject({ height: 34 }); // the fern, still linked
    await gateway.close();
  });

  it("linking appends one real signed edge delta, authored by the linker", async () => {
    const backend = new MemoryBackend();
    const gateway = await bedGateway(backend);
    const settled = new Set([...world, ...governedBootstrap(KEEPER_SEED)].map((d) => d.id));
    await gateway.query(link(BED, "plants", FERN), undefined, { actor: GARDENER_SEED });
    await gateway.flush();
    const fresh = await backend.deltasSince(settled);
    expect(fresh).toHaveLength(1);
    const edge = fresh[0]!;
    expect(verifyDelta(edge)).toBe("verified");
    expect(edge.claims.author).toBe(GARDENER);
    // The edge shape: a subject pointer at the bed's field, and a `plant` role pointing at an ENTITY
    // (not a primitive) — the same per-prop shape, its value made a relation.
    const subject = edge.claims.pointers.find((p) => p.role === "subject");
    const plant = edge.claims.pointers.find((p) => p.role === "plant");
    expect(subject?.target).toMatchObject({
      kind: "entity",
      entity: { id: BED, context: "plants" },
    });
    expect(plant?.target).toMatchObject({ kind: "entity", entity: { id: FERN } });
    await gateway.close();
  });

  it("sever retracts only your own edges — a stranger severs nothing", async () => {
    const gateway = await bedGateway();
    await gateway.query(link(BED, "plants", FERN), undefined, { actor: GARDENER_SEED });
    const stranger = "e4".repeat(32);
    const after = await gateway.query(sever(BED, "plants"), undefined, { actor: stranger });
    expect(after.errors).toBeUndefined();
    expect(severed(after).plants).toMatchObject({ height: 34 }); // the gardener's edge stands
    await gateway.close();
  });

  it("a primitive schema offers no entity-pointer write: link<Type> does not exist", async () => {
    const gateway = await bedGateway();
    // Plant's gather never expands, so it has no edges — `linkPlant` is not a field of the surface.
    const result = await gateway.query(
      `mutation { linkPlant(entity: "${FERN}", field: "height", target: "${MOSS}") { _hex } }`,
    );
    expect(result.errors?.join(" ")).toMatch(/linkPlant/);
    // and its primitive field still takes a primitive through the ordinary per-prop write.
    const ok = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 41) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect((ok.data as { plant: { height: number } }).plant.height).toBe(41);
    await gateway.close();
  });

  it("refuses an edge field the schema does not resolve — a quiet no-op would lie", async () => {
    const gateway = await bedGateway();
    const result = await gateway.query(link(BED, "nonesuch", FERN), undefined, {
      actor: GARDENER_SEED,
    });
    expect(result.errors?.join(" ")).toMatch(/nonesuch/);
    await gateway.close();
  });

  it("a seedless, actorless gateway cannot link any more than it can assert", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    await gateway.append(world);
    gateway.register(PLANT, PLANT_POLICY, [FERN, MOSS], undefined, PLANT_WRITABLE);
    gateway.register(BED_SCHEMA, BED_POLICY, [BED], undefined, ["plants", "name"]);
    const result = await gateway.query(link(BED, "plants", FERN));
    expect(result.errors?.join(" ")).toMatch(/no signing seed/);
    await gateway.close();
  });

  it("writability disciplines edges too: a read-only edge field refuses link and sever", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
    await gateway.append(governedBootstrap(KEEPER_SEED));
    await gateway.append(world);
    gateway.register(PLANT, PLANT_POLICY, [FERN, MOSS], undefined, PLANT_WRITABLE);
    // Only `name` is writable; `plants` is read-only at the surface.
    gateway.register(BED_SCHEMA, BED_POLICY, [BED], undefined, ["name"]);
    const linkRes = await gateway.query(link(BED, "plants", FERN), undefined, {
      actor: GARDENER_SEED,
    });
    expect(linkRes.errors?.join(" ")).toMatch(/read-only/);
    const severRes = await gateway.query(sever(BED, "plants"), undefined, { actor: GARDENER_SEED });
    expect(severRes.errors?.join(" ")).toMatch(/read-only/);
    await gateway.close();
  });
});
