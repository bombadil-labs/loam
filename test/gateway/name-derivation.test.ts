// SPEC §17/§21 — THE STORE HAS TWO NAME DERIVATIONS AND THEY DIFFER BY ONE CHARACTER.
//
// `buildGqlSchema` mangles store-native names into GraphQL-legal ones twice over, and the two are not
// interchangeable:
//
//   `legalNameFor(s)`  — sanitize only. The VIEW TYPE's name, every PROP FIELD, and — the one that
//                        surprises — every per-prop MUTATION ARGUMENT. `Height` stays `Height`.
//   `queryFieldFor(s)` — the same, then initial-lowercased. The QUERY-ROOT and MUTATION-ROOT field of a
//                        lens. Lens `Plant` is served at field `plant`.
//
// WHY THEY ARE EXPORTED. Anything that COMPOSES a document from store-native names needs both, and needs
// to know which goes where. Neither is derivable by eye: `Plant` is the view type's name and `plant` is
// the field's, so a caller carrying one function for both sites spells one of them wrong — and only for
// names whose initial is an uppercase ASCII letter, which is exactly the population a lowercase-only
// fixture cannot see. A caller with only the lowercasing one gets the ARGUMENT wrong, which is the
// quietest possible failure: the read path names no prop, so reads keep working and only writes die.
//
// WHY THESE RAILS EXECUTE. Comparing a derivation against a re-implementation of itself proves nothing —
// and neither does asserting against a stub, which echoes back whatever name it was handed and agrees
// with any spelling. So every document below is executed against the schema the gateway ACTUALLY built,
// and the wrong spelling is asserted refused by that same schema, so no rail here can pass by everything
// working.
//
// WHAT IS DELIBERATELY NOT ASSERTED: which of the two a given CALLER should use. That is each caller's
// own rail. This file pins what the STORE does, so a caller has something true to be checked against.

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
    // The order matters: sanitizing first can PRODUCE a leading underscore, which must not then be
    // lowercased into something else, and a leading digit must be escaped before the initial is judged.
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

// A reading whose writable prop's initial is an UPPERCASE letter — the only population in which the
// two derivations disagree, and therefore the only fixture that can see a caller using the wrong one.
// `Height` and not `height`: the lowercased spelling must have no argument to land on, or the mistake
// would be masked by the very prop it mis-spells into.
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
    // The other spelling — the view type's name — is refused, which is what makes the rail above a
    // measurement rather than a coincidence.
    const wrong = await gw.query(
      `query { ${legalNameFor("Plant")}(entity: ${JSON.stringify(FERN)}) { _entity } }`,
    );
    expect(wrong.errors?.join(" ")).toMatch(/Cannot query field/);
    await gw.close();
  });

  it("names the VIEW TYPE with `legalNameFor` — visible in a type error", async () => {
    const gw = await boot(PLANT_POLICY, ["height"]);
    // Asking for a field the view type does not have makes the schema say the type's own name back.
    const out = await gw.query(`query { ${queryFieldFor("Plant")}(entity: "x") { _nope } }`);
    expect(out.errors?.join(" ")).toContain(`${legalNameFor("Plant")}View`);
    await gw.close();
  });
});

describe("§21: the MUTATION root is `queryFieldFor` and its ARGUMENTS are `legalNameFor`", () => {
  it("accepts a capital-initial prop as a capital-initial ARGUMENT", async () => {
    // The asymmetry, stated as a measurement: the field is lowercased and the argument is not.
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
    // This is the whole point of exporting both. A caller carrying only `queryFieldFor` writes
    // `height:` here and every write dies with `Unknown argument`, while its reads keep working.
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
    // Named because it is the reason this file exists: over `height` the two derivations agree, so a
    // suite whose every writable prop is lowercase-initial cannot tell a correct caller from a broken
    // one. `test/gateway/fixtures.ts`'s PLANT_WRITABLE is entirely lowercase-initial.
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
    // One hyperschema (`Plant`), one reading (`PlantDesc`). The two names no longer coincide, so a
    // derivation applied to the wrong one answers a field the schema never built — and every artifact
    // or client that composes a document from a lens name inherits this.
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
    // The PROGRAM name is not a field. `Plant` shares the hyperschema and is not what is served.
    const byProgram = await gw.query(
      `query { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}) { _entity } }`,
    );
    expect(byProgram.errors?.join(" ")).toMatch(/Cannot query field/);
    await gw.close();
  });
});

// The signing helper is the fixture's; this file only ever needs it to exist.
void signClaims;
