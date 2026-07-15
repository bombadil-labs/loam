// §21 slice 2 at the gateway: the resolution Schema is a first-class entity, and each published
// VERSION freezes against its own content-addressed VersionedSchema snapshot. This is the heart of the
// lift — publishing a lens plants a living `schema:<name>` node AND a frozen snapshot, evolving mints a
// NEW snapshot without disturbing the old (coexist, never supersede), and §17's version door resolves
// each old version against ITS snapshot so a reading, once pinned, answers forever.

import { describe, expect, it } from "vitest";
import {
  DeltaSet,
  authorForSeed,
  loadSchema,
  makeNegationClaims,
  signClaims,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import {
  readRegistrations,
  schemaLivingEntityFor,
  versionedSchemaEntityFor,
} from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

const pickAsc: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "asc" } };
// PLANT_POLICY with a `note` prop added — an evolution that changes the resolution bytes.
const EVOLVED: Schema = {
  ...PLANT_POLICY,
  props: new Map([...PLANT_POLICY.props, ["note", pickAsc]]),
};

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OPERATOR_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

describe("§21 slice 2: the Schema is a first-class entity", () => {
  it("plants a living schema:<name> entity that loadSchema reads back", async () => {
    const gw = await boot();
    const living = loadSchema(
      DeltaSet.from([...gw.reactor.snapshot()]),
      schemaLivingEntityFor("Plant"),
    );
    // the living lens is a genuine domain node now — named, resolvable, carrying the policy
    expect(living.name).toBe("Plant");
    expect([...living.props.keys()].sort()).toEqual([...PLANT_WRITABLE].sort());
    expect(living.props.get("height")?.kind).toBe("pick");
    await gw.close();
  });

  it("evolving mints a NEW snapshot; the old one coexists, never superseded", async () => {
    const gw = await boot();
    const ground = (): DeltaSet => DeltaSet.from([...gw.reactor.snapshot()]);
    const v1Snapshot = versionedSchemaEntityFor("Plant", PLANT_POLICY);
    const v2Snapshot = versionedSchemaEntityFor("Plant", EVOLVED);
    expect(v1Snapshot).not.toBe(v2Snapshot); // different resolution bytes → different content address

    // both snapshots load BEFORE evolution only for v1; v2 does not exist yet
    expect(() => loadSchema(ground(), v2Snapshot)).toThrow();
    expect(loadSchema(ground(), v1Snapshot).name).toBe("Plant");

    // evolve the lens: add `note`
    await gw.publishRegistration(PLANT, EVOLVED, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
      "note",
    ]);

    // BOTH snapshots now answer — the old frozen reading was not disturbed by minting the new one
    const v1 = loadSchema(ground(), v1Snapshot);
    const v2 = loadSchema(ground(), v2Snapshot);
    expect(v1.props.has("note")).toBe(false); // v1 froze before `note` existed
    expect(v2.props.has("note")).toBe(true); // v2 sees it
    // the living entity has moved on to the latest reading
    expect(loadSchema(ground(), schemaLivingEntityFor("Plant")).props.has("note")).toBe(true);
    await gw.close();
  });

  it("each registration VERSION freezes against its own snapshot (§17)", async () => {
    const gw = await boot();
    await gw.publishRegistration(PLANT, EVOLVED, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
      "note",
    ]);
    const versions = gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    // v1's schema is the frozen v1 reading (no `note`); v2's is the evolved one — each resolved from
    // ITS OWN snapshot, not the shared living entity, which is exactly §17's per-version freezing.
    expect(versions[0]!.schema.props.has("note")).toBe(false);
    expect(versions[1]!.schema.props.has("note")).toBe(true);
    await gw.close();
  });

  it("withdrawing the LATEST version reverts the live surface to the prior reading", async () => {
    const gw = await boot();
    await gw.publishRegistration(PLANT, EVOLVED, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
      "note",
    ]);
    // the live lens now reads the evolved schema (has `note`)
    const bound = () =>
      readRegistrations(gw.reactor, OPERATOR).find((r) => r.hyperschema.name === "Plant")!;
    expect(bound().schema.props.has("note")).toBe(true);

    // strike the LATEST registration (v2) — its living-entity publish is NOT itself negated
    const versions = gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant");
    await gw.append([
      signClaims(
        makeNegationClaims(
          OPERATOR,
          9_000_000,
          versions[versions.length - 1]!.deltaId,
          "withdraw v2",
        ),
        OPERATOR_SEED,
      ),
    ]);

    // the live surface must recede to v1's reading (no `note`) — it resolves the surviving binding's
    // snapshot, not the living entity, which still holds v2's bytes
    expect(gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant")).toHaveLength(1);
    expect(bound().schema.props.has("note")).toBe(false);
    // the living entity is unchanged — it is a first-class node, just not the live read path
    expect(
      loadSchema(
        DeltaSet.from([...gw.reactor.snapshot()]),
        schemaLivingEntityFor("Plant"),
      ).props.has("note"),
    ).toBe(true);
    await gw.close();
  });
});
