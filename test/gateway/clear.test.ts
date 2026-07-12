// SPEC §14: clearing is retraction. There is finally a way through the surface to REMOVE a value —
// and it is not `set(null)`, it is the DUAL of resolution: negate the caller's OWN surviving
// contributions in a field's gathered bucket. One mechanism, correct across every Policy because
// the read side does the Policy work — pick falls to the next survivor, an `all` list loses your
// tag, a `merge` withdraws your addend, and a field only you spoke for goes ABSENT, which the
// reader renders per its own `absentAs` (the null-ness lives in the lens, never on a reference).
//
// The decision this suite pins (Myk, 2026-07-12): retract-your-own is the FLOOR AND THE CEILING.
// A clear never touches another author's contribution — to keep OTHERS' claims out of a view you
// filter them in the schema Policy, not by negating a delta you did not sign.

import { describe, expect, it } from "vitest";
import { verifyDelta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, garden, governedBootstrap } from "./fixtures.js";

const KEEPER_SEED = "c3".repeat(32);

// The governed garden: the keeper operates; the gardener and surveyor hold write standing; the
// settled garden already carries BOTH their voices on every policy kind (height/tag/readings).
async function keeperGateway(backend = new MemoryBackend()): Promise<Gateway> {
  const gateway = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  return gateway;
}

const clear = (entity: string, fields: string[]): string =>
  `mutation { clearPlant(entity: "${entity}", fields: [${fields
    .map((f) => `"${f}"`)
    .join(", ")}]) { height tag readings watered } }`;

type PlantView = { height: number | null; tag: string[]; readings: number; watered: boolean };
const viewOf = (r: { data?: unknown }): PlantView =>
  (r.data as { clearPlant: PlantView }).clearPlant;

describe("clear (§14): retraction is the dual of resolution", () => {
  it("pick — retracting your own hands the field to the next survivor, then to absence", async () => {
    const gateway = await keeperGateway();
    // height: gardener@1000=30, surveyor@2000=34; pick-latest → 34.
    let read = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number } }).plant.height).toBe(34);

    // the surveyor withdraws THEIR reading — the field falls to the gardener's, still standing.
    const afterSurveyor = await gateway.query(clear(FERN, ["height"]), undefined, {
      actor: SURVEYOR_SEED,
    });
    expect(afterSurveyor.errors).toBeUndefined();
    expect(viewOf(afterSurveyor).height).toBe(30);

    // the gardener withdraws theirs too — no voice remains, so the key resolves to ABSENCE (null).
    const afterGardener = await gateway.query(clear(FERN, ["height"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(viewOf(afterGardener).height).toBeNull();

    // and a plain re-query agrees: the field is genuinely gone, not a stale mutation echo.
    read = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number | null } }).plant.height).toBeNull();
    await gateway.close();
  });

  it("retract-your-own is scoped: a clear never touches another author's contribution", async () => {
    const gateway = await keeperGateway();
    // tag is an `all` union: gardener=shade, surveyor=fronds.
    const after = await gateway.query(clear(FERN, ["tag"]), undefined, { actor: GARDENER_SEED });
    expect(after.errors).toBeUndefined();
    expect(viewOf(after).tag).toEqual(["fronds"]); // only the gardener's shade withdrew
    await gateway.close();
  });

  it("merge — a clear withdraws your addend, and the reduction recomputes", async () => {
    const gateway = await keeperGateway();
    // readings is `merge count`: gardener + surveyor → 2.
    const read = await gateway.query(`{ plant(entity: "${FERN}") { readings } }`);
    expect((read.data as { plant: { readings: number } }).plant.readings).toBe(2);
    const after = await gateway.query(clear(FERN, ["readings"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(viewOf(after).readings).toBe(1); // the surveyor's reading still counts
    await gateway.close();
  });

  it("absence renders per absentAs — a cleared field falls to the lens's fallback, not null", async () => {
    const gateway = await keeperGateway();
    // watered is absentAs(constant:false). The gardener asserts true, then clears it.
    await gateway.query(
      `mutation { plant(entity: "${FERN}", watered: true) { watered } }`,
      undefined,
      {
        actor: GARDENER_SEED,
      },
    );
    const after = await gateway.query(clear(FERN, ["watered"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(after.errors).toBeUndefined();
    expect(viewOf(after).watered).toBe(false); // the absentAs constant, NOT null — null-ness is the lens's
    await gateway.close();
  });

  it("you clear what you said, not what the world said: a fresh assertion repopulates", async () => {
    const gateway = await keeperGateway();
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: SURVEYOR_SEED });
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: GARDENER_SEED });
    // absent now — but a new claim (the surveyor changed their mind) repopulates it correctly.
    const repopulated = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 50) { height } }`,
      undefined,
      { actor: SURVEYOR_SEED },
    );
    expect((repopulated.data as { plant: { height: number } }).plant.height).toBe(50);
    await gateway.close();
  });

  it("clearing appends a real signed negation, authored by the clearer, honored at the mask", async () => {
    const backend = new MemoryBackend();
    const gateway = await keeperGateway(backend);
    const settled = new Set([...garden, ...governedBootstrap(KEEPER_SEED)].map((d) => d.id));
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: GARDENER_SEED });
    await gateway.flush();
    const fresh = await backend.deltasSince(settled);
    // the gardener contributed exactly one height (30) → exactly one negation, theirs, verified.
    expect(fresh).toHaveLength(1);
    const neg = fresh[0]!;
    expect(verifyDelta(neg)).toBe("verified");
    expect(neg.claims.author).toBe(GARDENER);
    expect(neg.claims.pointers.some((p) => p.role === "negates" && p.target.kind === "delta")).toBe(
      true,
    );
    await gateway.close();
  });

  it("is idempotent: clearing an already-cleared field adds no new negation", async () => {
    const backend = new MemoryBackend();
    const gateway = await keeperGateway(backend);
    const settled = new Set([...garden, ...governedBootstrap(KEEPER_SEED)].map((d) => d.id));
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: GARDENER_SEED });
    await gateway.flush();
    const afterFirst = (await backend.deltasSince(settled)).length;
    await gateway.query(clear(FERN, ["height"]), undefined, { actor: GARDENER_SEED });
    await gateway.flush();
    const afterSecond = (await backend.deltasSince(settled)).length;
    expect(afterSecond).toBe(afterFirst); // the second clear finds only already-negated entries
    await gateway.close();
  });

  it("refuses a field the schema does not resolve — a quiet no-op would lie about clearing", async () => {
    const gateway = await keeperGateway();
    const result = await gateway.query(clear(FERN, ["nonesuch"]), undefined, {
      actor: GARDENER_SEED,
    });
    expect(result.errors?.join(" ")).toMatch(/no field "nonesuch"|nonesuch/);
    await gateway.close();
  });

  it("a seedless, actorless gateway cannot retract any more than it can assert", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    await gateway.append(garden);
    gateway.register(PLANT, PLANT_POLICY, [FERN]);
    const result = await gateway.query(clear(FERN, ["height"]));
    expect(result.errors?.join(" ")).toMatch(/no signing seed/);
    await gateway.close();
  });

  it("a stranger with nothing of their own clears nothing — retraction has no reach beyond you", async () => {
    const gateway = await keeperGateway();
    // the stranger never wrote here; their clear finds no own-contribution and changes nothing.
    const stranger = "e4".repeat(32);
    const after = await gateway.query(clear(FERN, ["height"]), undefined, { actor: stranger });
    expect(after.errors).toBeUndefined();
    expect(viewOf(after).height).toBe(34); // untouched: both real readings still stand
    await gateway.close();
  });
});
