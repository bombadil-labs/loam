import { describe, expect, it } from "vitest";
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf, type ClaimTemplates } from "../../src/gateway/registration.js";
import { authorForSeed, publishHyperSchemaClaims, signClaims } from "@bombadil/rhizomatic";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

const HALF_CONVERTED = {
  water: {
    pointers: [
      { role: "subject", at: { arg: "plant" }, context: "watered" },
      { role: "value", context: "watered", value: true },
    ],
  },
} as unknown as ClaimTemplates;

const UNREADABLE = {
  water: { pointers: [{ role: "value" }] },
} as unknown as ClaimTemplates;

const UNREADABLE_JSON = '{"water":{"pointers":"watered"}}';

const INVISIBLE: ClaimTemplates = {
  orphanNote: { pointers: [{ role: "note", value: { arg: "note" } }] },
};

const WELL_FORMED: ClaimTemplates = {
  water: {
    pointers: [
      { role: "subject", at: { arg: "plant" }, context: "watered" },
      { role: "value", value: true },
    ],
  },
};

const genesisWith = (mutations: ClaimTemplates) =>
  assembleGenesis({
    operatorSeed: OPERATOR_SEED,
    registrations: [
      {
        hyperschema: PLANT,
        schema: { ...PLANT_POLICY, name: "PlantView" },
        roots: [FERN],
        writable: ["height", "tag"],
        mutations,
      },
    ],
    grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2)],
  });

describe("T96: a template fault never narrows the write surface", () => {
  it("a mutations payload that cannot be read faithfully refuses at the mint, defect named", () => {
    expect(() => genesisWith(UNREADABLE)).toThrow(
      /genesis: lens "PlantView" carries a mutations payload that cannot be read faithfully/,
    );
    expect(() => genesisWith(UNREADABLE)).toThrow(/exactly one of at\/value/);
  });

  it("a stray context beside a literal value still binds and still serves its door", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), genesisWith(HALF_CONVERTED));
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(Object.keys(reg?.mutations ?? {})).toEqual(["water"]);
    expect(reg!.mutationsDefect).toBeUndefined();
    const watered = await gw.query(`mutation { water(plant: "${FERN}") { delta } }`, undefined, {
      actor: GARDENER_SEED,
    });
    expect(watered.errors).toBeUndefined();
    await gw.close();
  });

  it("a minted template that cannot bind costs the templates; writable survives, at both levels", async () => {
    const genesis = genesisWith(INVISIBLE);

    const binding = genesis.deltas.find((d) =>
      d.claims.pointers.some((p) => p.role === "writable"),
    );
    expect(binding).toBeDefined();
    const payload = (role: string): unknown => {
      const p = binding!.claims.pointers.find((x) => x.role === role);
      return p?.target.kind === "primitive" ? JSON.parse(String(p.target.value)) : undefined;
    };
    expect(payload("writable")).toEqual(["height", "tag"]);
    expect(payload("mutations")).toHaveProperty("orphanNote");

    const gw = await Gateway.boot(new MemoryBackend(), genesis);
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]);
    expect(reg!.lensName).toBe("PlantView");
    expect(reg!.mutations).toBeUndefined();

    const shed = await gw.query(`mutation { orphanNote(note: "n") { delta } }`, undefined, {
      actor: GARDENER_SEED,
    });
    expect(shed.errors?.join(" ")).toMatch(/orphanNote/);

    const write = await gw.query(
      `mutation { plantView(entity: "${FERN}", height: 40) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(write.errors).toBeUndefined();
    expect((write.data as { plantView: { height: number } }).plantView.height).toBe(40);
    await gw.close();
  });

  it("a well-formed template still binds whole: templates AND writable, exactly as declared", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), genesisWith(WELL_FORMED));
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]);
    expect(Object.keys(reg!.mutations ?? {})).toEqual(["water"]);

    const watered = await gw.query(`mutation { water(plant: "${FERN}") { delta } }`, undefined, {
      actor: GARDENER_SEED,
    });
    expect(watered.errors).toBeUndefined();
    await gw.close();
  });

  const plantBinding = async (mutationsJson: string): Promise<Gateway> => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
    ]);
    const { living, snapshot, binding } = registrationDeltaClaims(
      "hyperschema:Plant",
      "PlantView",
      { ...PLANT_POLICY, name: "PlantView" },
      [FERN],
      OPERATOR,
      () => 3,
      undefined,
      ["height", "tag"],
    );
    await gw.append([
      signClaims(publishHyperSchemaClaims(PLANT, "hyperschema:Plant", OPERATOR, 2), OPERATOR_SEED),
      signClaims(living, OPERATOR_SEED),
      signClaims(snapshot, OPERATOR_SEED),
      signClaims(
        {
          ...binding,
          pointers: [
            ...binding.pointers,
            {
              role: "mutations",
              target: { kind: "primitive", value: mutationsJson },
            },
          ],
        },
        OPERATOR_SEED,
      ),
    ]);
    gw.replayRegistrations();
    return gw;
  };

  it("a stored template that cannot BIND costs the templates: writable alive, at both levels", async () => {
    const gw = await plantBinding(JSON.stringify(INVISIBLE));
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]);
    expect(reg!.lensName).toBe("PlantView");
    expect(reg!.mutations).toBeUndefined();
    const write = await gw.query(
      `mutation { plantView(entity: "${FERN}", height: 41) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(write.errors).toBeUndefined();
    await gw.close();
  });

  it("a stored template that cannot PARSE costs the templates too, and says so", async () => {
    const gw = await plantBinding(UNREADABLE_JSON);
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]);
    expect(reg!.mutations).toBeUndefined();
    expect(reg!.mutationsDefect).toMatch(/wants \{ pointers: \[\.\.\.\] \}/);
    const write = await gw.query(
      `mutation { plantView(entity: "${FERN}", height: 42) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(write.errors).toBeUndefined();
    await gw.close();
  });
});
