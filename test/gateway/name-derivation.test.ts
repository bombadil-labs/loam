import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { legalNameFor, queryFieldFor } from "../../src/gateway/gql.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, pickLatest } from "./fixtures.js";
import { FERN, GARDENER, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

describe("§21: the two derivations, as pure functions", () => {
  it("agree on every name whose initial is not an uppercase letter", () => {
    for (const name of ["plant", "notesByTag", "_x", "a_b"]) {
      expect(legalNameFor(name), name).toBe(queryFieldFor(name));
    }
  });

  it("DIVERGE on a capital initial — the whole reason there are two", () => {
    expect(legalNameFor("Plant")).toBe("Plant");
    expect(queryFieldFor("Plant")).toBe("plant");
    expect(legalNameFor("Height")).toBe("Height");
    expect(queryFieldFor("Height")).toBe("height");
    expect(legalNameFor("NotesByTag")).toBe("NotesByTag");
    expect(queryFieldFor("NotesByTag")).toBe("notesByTag");
  });

  it("sanitize illegal characters the same way, and only then lowercase", () => {
    expect(legalNameFor("a-b c")).toBe("a_b_c");
    expect(queryFieldFor("a-b c")).toBe("a_b_c");
    expect(legalNameFor("9lives")).toBe("_9lives");
    expect(queryFieldFor("9lives")).toBe("_9lives");
    expect(legalNameFor("Å-tag")).toBe("__tag");
    expect(queryFieldFor("Å-tag")).toBe("__tag");
  });

  it("are idempotent, so a name already mangled survives a second pass", () => {
    for (const name of ["Plant", "a-b c", "9lives", "Height"]) {
      expect(legalNameFor(legalNameFor(name)), name).toBe(legalNameFor(name));
      expect(queryFieldFor(queryFieldFor(name)), name).toBe(queryFieldFor(name));
    }
  });
});

const CAPITAL_PROPS: Schema = {
  ...PLANT_POLICY,
  props: new Map<string, Policy>(
    [...PLANT_POLICY.props].map(([k, v]) => [k === "height" ? "Height" : k, v] as const),
  ),
};

const boot = async (schema: Schema, writable: readonly string[]): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema, roots: [FERN], writable }],
      grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9_001)],
    }),
  );
  return gw;
};

describe("§21: the QUERY root is `queryFieldFor`, executed against the live schema", () => {
  it("serves the lens at the lowercased field, and refuses the view type's name", async () => {
    const gw = await boot(PLANT_POLICY, ["height"]);
    await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
    const served = await gw.query(
      `query { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}) { _entity _hex _view } }`,
    );
    expect(served.errors, JSON.stringify(served.errors)).toBeUndefined();
    expect(JSON.stringify(served.data)).toContain("42");
    const wrong = await gw.query(
      `query { ${legalNameFor("Plant")}(entity: ${JSON.stringify(FERN)}) { _entity } }`,
    );
    expect(wrong.errors?.join(" ")).toMatch(/Cannot query field/);
    await gw.close();
  });

  it("names the VIEW TYPE with `legalNameFor` — visible in a type error", async () => {
    const gw = await boot(PLANT_POLICY, ["height"]);
    const out = await gw.query(`query { ${queryFieldFor("Plant")}(entity: "x") { _nope } }`);
    expect(out.errors?.join(" ")).toContain(`${legalNameFor("Plant")}View`);
    await gw.close();
  });
});

describe("§21: the MUTATION root is `queryFieldFor` and its ARGUMENTS are `legalNameFor`", () => {
  it("accepts a capital-initial prop as a capital-initial ARGUMENT", async () => {
    const gw = await boot(CAPITAL_PROPS, ["Height"]);
    const doc =
      `mutation { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}, ` +
      `${legalNameFor("Height")}: 42) { _entity _hex _view } }`;
    const out = await gw.query(doc);
    expect(out.errors, JSON.stringify(out.errors)).toBeUndefined();
    expect(JSON.stringify(out.data)).toContain("42");
    await gw.close();
  });

  it("and REFUSES the lowercased argument — the mistake a single derivation makes", async () => {
    const gw = await boot(CAPITAL_PROPS, ["Height"]);
    const out = await gw.query(
      `mutation { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}, ` +
        `${queryFieldFor("Height")}: 42) { _entity } }`,
    );
    expect(out.errors?.join(" ")).toMatch(/Unknown argument/);
    expect(out.errors?.join(" ")).toContain(queryFieldFor("Height"));
    await gw.close();
  });

  it("a lowercase-initial prop is the SAME either way, which is why a fixture must carry a capital", async () => {
    const gw = await boot(PLANT_POLICY, ["height"]);
    expect(legalNameFor("height")).toBe(queryFieldFor("height"));
    for (const spelling of [legalNameFor("height"), queryFieldFor("height")]) {
      const out = await gw.query(
        `mutation { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}, ${spelling}: 7) { _entity } }`,
      );
      expect(out.errors, spelling).toBeUndefined();
    }
    await gw.close();
  });
});

describe("§21.7: the derivation keys on the LENS name, never the hyperschema's", () => {
  it("a reading named apart from its hyperschema is served at the READING's field", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: {
              ...PLANT_POLICY,
              name: "PlantDesc",
              props: new Map([["height", pickLatest]]),
            },
            roots: [FERN],
            writable: ["height"],
          },
        ],
      }),
    );
    await gw.append([observed(FERN, "height", 5, 1000, OP_SEED)]);
    expect(queryFieldFor("PlantDesc")).toBe("plantDesc");
    const served = await gw.query(
      `query { ${queryFieldFor("PlantDesc")}(entity: ${JSON.stringify(FERN)}) { _entity _hex } }`,
    );
    expect(served.errors, JSON.stringify(served.errors)).toBeUndefined();
    const byProgram = await gw.query(
      `query { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}) { _entity } }`,
    );
    expect(byProgram.errors?.join(" ")).toMatch(/Cannot query field/);
    await gw.close();
  });
});

void signClaims;
