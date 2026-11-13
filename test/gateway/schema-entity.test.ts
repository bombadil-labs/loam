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
      Date.now(),
    );
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
    expect(v1Snapshot).not.toBe(v2Snapshot);

    expect(() => loadSchema(ground(), v2Snapshot, Date.now())).toThrow();
    expect(loadSchema(ground(), v1Snapshot, Date.now()).name).toBe("Plant");

    await gw.publishRegistration(PLANT, EVOLVED, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
      "note",
    ]);

    const v1 = loadSchema(ground(), v1Snapshot, Date.now());
    const v2 = loadSchema(ground(), v2Snapshot, Date.now());
    expect(v1.props.has("note")).toBe(false);
    expect(v2.props.has("note")).toBe(true);
    expect(loadSchema(ground(), schemaLivingEntityFor("Plant"), Date.now()).props.has("note")).toBe(
      true,
    );
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
    const bound = () =>
      readRegistrations(gw.reactor, gw.validityNow(), OPERATOR).find(
        (r) => r.hyperschema.name === "Plant",
      )!;
    expect(bound().schema.props.has("note")).toBe(true);

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

    expect(gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant")).toHaveLength(1);
    expect(bound().schema.props.has("note")).toBe(false);
    expect(
      loadSchema(
        DeltaSet.from([...gw.reactor.snapshot()]),
        schemaLivingEntityFor("Plant"),
        Date.now(),
      ).props.has("note"),
    ).toBe(true);
    await gw.close();
  });
});
