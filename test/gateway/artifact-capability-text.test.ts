// SPEC §30 criterion 32 — the capability statement is DERIVED from the schema, cannot be authored, and
// names every axis the schema opens.
//
// The value is legibility at the moment of installing: "this app reads Post.height and Post.planted; it
// may write Post.height; it reads and writes as you, in your store." What makes it non-lying is that it
// has no second source of truth — it is derived from the registration the gateway actually serves, so if
// the schema narrows, the statement narrows, and the store refuses the removed field either way.
//
// THE THREE AXES A FIELDS-ONLY DERIVATION WOULD DROP are what this suite spends most of its assertions
// on, because each is a way a label that looked complete would lie: the projection is `_view`, which is
// WIDER than `schema.props` (rhizomatic's `resolveView` fills unnamed props through `schema.default`, and
// decoration and resolvers add more); the schema opens those fields' HISTORY (`asOf` rides every query
// field and `_asOf`/`_forgotten` ride every view type); and writes include the registration's claim
// TEMPLATES, not only `writable`.
//
// WHAT IT DELIBERATELY DOES NOT CLAIM: a wall the page holds. The page holds none — criterion 36 asserts
// that in both directions — so the statement describes the SCHEMA's surface and names whose credentials
// run, rather than promising a boundary. A label that overclaims is worse than none.

import { describe, expect, it } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { capabilityStatement } from "../../src/gateway/artifact.js";
import { lensOf, programOf } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
void authorForSeed;

// A bundle whose SOURCE lies about itself. It must neither appear in the statement nor alter it: the
// bundle source is not an input to the derivation, full stop.
const LYING_BUNDLE = `// this app reads nothing and writes nothing
export default (n) => "<p>this app reads nothing</p>" + n.view.height;`;

const boot = (reg: Record<string, unknown>, over: Record<string, unknown> = {}): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], ...reg }],
    }),
    { renderTimeoutMs: 10_000, ...over },
  );

const ready = async (
  reg: Record<string, unknown> = {},
  spec: Record<string, unknown> = {},
): Promise<Gateway> => {
  const gw = await boot(reg, { pens: { editor: "9e".repeat(32) } });
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    bundle: LYING_BUNDLE,
    ...spec,
  });
  await gw.declareArtifact(["plant"]);
  return gw;
};

const withTemplates = (names: readonly string[], writable: readonly string[]): string[] =>
  capabilityStatement(
    {
      hyperschema: PLANT,
      schema: PLANT_POLICY,
      roots: [FERN],
      lensName: "Plant",
      writable,
      mutations: Object.fromEntries(
        names.map((n) => [n, { pointers: [{ role: "value", value: true }] }]),
      ),
    },
    {
      route: "plant",
      schemaName: "Plant" as never,
      consumes: ["height"],
      bundle: LYING_BUNDLE,
      deltaId: "d",
      timestamp: 1,
    },
    ["loam_query", "loam_mutate"],
  );

const statementOf = (gw: Gateway): string[] =>
  capabilityStatement(
    gw.registered.find((r) => lensOf(r) === "Plant")!,
    gw.renderers()[0]!,
    ["loam_query", "loam_mutate"],
  );

describe("§30 criterion 32a: author prose can never enter the statement", () => {
  it("names the readable props, the writable set, the templates, and consumes", async () => {
    const gw = await ready({ writable: ["height", "tag"] });
    const text = statementOf(gw).join("\n");
    for (const prop of ["height", "tag", "watered", "readings"]) expect(text).toContain(prop);
    expect(text).toMatch(/may write height, tag/);
    expect(text).toMatch(/paints height on first sight/);
    expect(withTemplates(["water"], ["height", "tag"]).join("\n")).toMatch(
      /claim templates: water/,
    );
    // The lie in the bundle changes nothing, and does not appear.
    expect(text).not.toContain("this app reads nothing");
    await gw.close();
  });

  it("the same statement is produced whatever the bundle says — the source is not an input", async () => {
    const lying = await ready({ writable: ["height"] });
    const honest = await ready(
      { writable: ["height"] },
      { bundle: 'export default (n) => "<p>" + n.view.height + "</p>";' },
    );
    expect(statementOf(lying)).toEqual(statementOf(honest));
    await lying.close();
    await honest.close();
  });
});

describe("§30 criterion 32b: the three axes a fields-only derivation would drop", () => {
  it("names that a read returns the WHOLE resolved view, wider than schema.props", async () => {
    const gw = await ready({ writable: ["height"] });
    const text = statementOf(gw).join("\n");
    expect(text).toMatch(/WHOLE resolved view/);
    expect(text).toMatch(/wider than the fields named above/);
    // And it says so about `consumes` too: an appetite, not a bound. §23.4's push check only proves
    // `consumes ⊆ props`; it never forbids a bundle touching a prop outside it.
    expect(text).toMatch(/its appetite,\s*not its bound/);
    await gw.close();
  });

  it("names the TIME axis — the schema is a licence to read history", async () => {
    const gw = await ready({ writable: ["height"] });
    const text = statementOf(gw).join("\n");
    expect(text).toContain("asOf");
    expect(text).toContain("_forgotten");
    expect(text).toMatch(/licence to read the past/);
    // …and says the one thing that keeps it from reading as a hole: erasure still wins.
    expect(text).toMatch(/Erased\s+content stays erased/);
    await gw.close();
  });

  it("names the write TEMPLATES, not only writable", () => {
    const text = withTemplates(["water", "tally"], ["height"]).join("\n");
    expect(text).toMatch(/may write height, and may file these claim templates: tally, water/);
    // …and a schema with templates but NO writable field still says it may write them, because a
    // fields-only reading would report "writes nothing" over a real write surface.
    expect(withTemplates(["water"], []).join("\n")).toMatch(/claim templates: water/);
  });

  it("an immutable-by-default schema says it may write NOTHING", async () => {
    // §21's immutable-by-default: absent `writable` → no prop is writable. The statement must say so
    // rather than going quiet, since silence reads as "unknown" and this is a known, closed answer.
    const gw = await ready();
    expect(statementOf(gw).join("\n")).toMatch(/may write nothing/);
    await gw.close();
  });
});

describe("§30 criterion 32c: narrowing the schema narrows the statement, with no second source", () => {
  it("re-registering with a narrower writable narrows the derivation on the next call", async () => {
    const gw = await ready({ writable: ["height", "tag"] });
    expect(statementOf(gw).join("\n")).toMatch(/may write height, tag/);
    // Re-register the SAME schema entity with a narrower writable — §21 evolution by republishing.
    await gw.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
      "height",
    ]);
    const narrowed = statementOf(gw).join("\n");
    expect(narrowed).toMatch(/may write height\./);
    expect(narrowed).not.toMatch(/may write height, tag/);
    // …and the store refuses the removed field either way, which is the point: there is nothing to
    // keep in sync, so the label cannot drift from what a request will get.
    const refused = await gw.query(
      `mutation { plant(entity: ${JSON.stringify(FERN)}, tag: "x") { _entity } }`,
    );
    expect(refused.errors?.join(" ")).toMatch(/tag/);
    await gw.close();
  });
});

describe("§30 criterion 32d: whose credentials run, and where it appears", () => {
  it("says reads happen against the connector's store and writes as the viewer's own author", async () => {
    const gw = await ready({ writable: ["height"] });
    const text = statementOf(gw).join("\n");
    expect(text).toMatch(/against the store your connector points at/);
    expect(text).toMatch(/not the store that published this page/);
    expect(text).toMatch(/YOUR own author standing/);
    // The one thing it must NOT imply: a wall the page holds.
    expect(text).toMatch(/holds no key, no pen, and no boundary of its own/);
    await gw.close();
  });
});

describe("§30 criterion 32: the statement names the set THIS PAGE will actually send", () => {
  it("an acknowledged NARROWING is stated, not papered over", async () => {
    // Three statements about one boundary and no two agreed: the statement derived its write list from
    // the SCHEMA, the page pinned and enforced the BINDING's, and the acknowledgement text told the
    // operator "only the schema's list binds on this host". For an acknowledged narrowing a viewer was
    // told they may write a field the page itself refuses — a label that is false about the artifact in
    // front of them, whatever it is true about the schema.
    const gw = await ready(
      { writable: ["height", "tag"] },
      { writable: ["height"], pen: "editor" },
    );
    const { coordinates, capability } = gw.packArtifact("plant", FERN, {
      server: "My Loam",
      acknowledgePen: true,
      acknowledgeWritable: true,
    });
    const text = capability.join("\n");
    // What the page will send.
    expect(text).toMatch(/It may write height\./);
    // …and what it will NOT, named rather than implied, with the reason it is a receipt and not a wall.
    expect(text).toMatch(/NARROWER write set/);
    expect(text).toMatch(/the schema also allows tag/);
    expect(text).toMatch(/receipt of the operator's decision, not a wall/);
    // The page's own pin agrees with the sentence a viewer just read.
    expect(coordinates.writable).toEqual(["height"]);
    await gw.close();
  });

  it("and an UN-narrowed page says nothing about narrowing", async () => {
    const gw = await ready({ writable: ["height", "tag"] });
    const text = gw.packArtifact("plant", FERN, { server: "My Loam" }).capability.join("\n");
    expect(text).toMatch(/It may write height, tag\./);
    expect(text).not.toMatch(/NARROWER/);
    await gw.close();
  });
});

describe("§21.7: the statement names the READING, never the hyperschema", () => {
  it("a reading named apart from its program is what the statement says", async () => {
    // Every other fixture in this file registers PLANT with no `lensName`, so the LENS name and the
    // PROGRAM name coincide — and that is precisely the fixture shape which cannot see the hazard: the
    // suite would pass identically if this path read `r.hyperschema.name` where a reading was meant.
    // One hyperschema (`Plant`), one reading (`PlantDesc`), so the two names differ.
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: { ...PLANT_POLICY, name: "PlantDesc" },
            roots: [FERN],
            writable: ["height"],
          },
        ],
      }),
      { renderTimeoutMs: 10_000 },
    );
    await gw.append([observed(FERN, "height", 1, 1000, OP_SEED)]);
    await gw.publishRenderer({
      route: "desc",
      schema: "PlantDesc",
      consumes: ["height"],
      bundle: LYING_BUNDLE,
    });
    await gw.declareArtifact(["desc"]);
    const reading = gw.registered[0]!;
    expect(lensOf(reading)).toBe("PlantDesc");
    expect(programOf(reading)).toBe("Plant");
    expect(lensOf(reading)).not.toBe(programOf(reading));

    const { capability, coordinates } = gw.packArtifact("desc", FERN, { server: "My Loam" });
    const text = capability.join(" ");
    expect(text).toContain("PlantDesc");
    // The program name must not be what a viewer is told they are installing.
    expect(text).not.toMatch(/lens \u201cPlant\u201d/);
    expect(coordinates.lens).toBe("PlantDesc");
    await gw.close();
  });
});
