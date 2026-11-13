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
    expect(text).toMatch(/its appetite,\s*not its bound/);
    await gw.close();
  });

  it("names the TIME axis — the schema is a licence to read history", async () => {
    const gw = await ready({ writable: ["height"] });
    const text = statementOf(gw).join("\n");
    expect(text).toContain("asOf");
    expect(text).toContain("_forgotten");
    expect(text).toMatch(/licence to read the past/);
    expect(text).toMatch(/Erased\s+content stays erased/);
    await gw.close();
  });

  it("names the write TEMPLATES, not only writable", () => {
    const text = withTemplates(["water", "tally"], ["height"]).join("\n");
    expect(text).toMatch(/may write height, and may file these claim templates: tally, water/);
    expect(withTemplates(["water"], []).join("\n")).toMatch(/claim templates: water/);
  });

  it("an immutable-by-default schema says it may write NOTHING", async () => {
    const gw = await ready();
    expect(statementOf(gw).join("\n")).toMatch(/may write nothing/);
    await gw.close();
  });
});

describe("§30 criterion 32c: narrowing the schema narrows the statement, with no second source", () => {
  it("re-registering with a narrower writable narrows the derivation on the next call", async () => {
    const gw = await ready({ writable: ["height", "tag"] });
    expect(statementOf(gw).join("\n")).toMatch(/may write height, tag/);
    await gw.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
      "height",
    ]);
    const narrowed = statementOf(gw).join("\n");
    expect(narrowed).toMatch(/may write height\./);
    expect(narrowed).not.toMatch(/may write height, tag/);
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
    expect(text).toMatch(/holds no key, no pen, and no boundary of its own/);
    await gw.close();
  });
});

describe("§30 criterion 32: the statement names the set THIS PAGE will actually send", () => {
  it("an acknowledged NARROWING is stated, not papered over", async () => {
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
    expect(text).toMatch(/It may write height\./);
    expect(text).toMatch(/NARROWER write set/);
    expect(text).toMatch(/the schema also allows tag/);
    expect(text).toMatch(/receipt of the operator's decision, not a wall/);
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
    expect(text).not.toMatch(/lens \u201cPlant\u201d/);
    expect(coordinates.lens).toBe("PlantDesc");
    await gw.close();
  });
});
