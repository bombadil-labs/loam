import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { bundleFromPage } from "../../src/gateway/artifact-page.js";
import { esmAddress } from "../../src/gateway/esm.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { RENDER_TIMEOUT_MS } from "../../src/gateway/render-worker.js";
import { artifactClaims, artifactDefect } from "../../src/gateway/artifact.js";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const PEN_SEED = "1a".repeat(32);

const FLOOR_BUNDLE = `export default function (node) {
  var tags = node.view.tag === undefined ? "-" : String(node.view.tag);
  return "<p>h=" + node.view.height + " tag=" + tags + " hex=" + node.hex.slice(0, 8) + "</p>";
}`;

const PEN = authorForSeed(PEN_SEED);

const boot = (over: Record<string, unknown> = {}): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [grantClaims(STORE_ENTITY, PEN, "write", OP, 9_001)],
    }),
    { renderTimeoutMs: 10_000, ...over },
  );

const spec = (over: Record<string, unknown> = {}) => ({
  route: "plant",
  schema: "Plant",
  consumes: ["height"],
  bundle: FLOOR_BUNDLE,
  ...over,
});

const ready = async (over: Record<string, unknown> = {}, gwOver = {}): Promise<Gateway> => {
  const gw = await boot(gwOver);
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer(spec(over));
  await gw.declareArtifact(["plant"]);
  return gw;
};

const pack = (gw: Gateway, opts: Record<string, unknown> = {}) =>
  gw.packArtifact("plant", FERN, { server: "My Loam", ...opts });

describe("§30 criterion 1: one bundle, two hosts, one content address", () => {
  it("the bundle recovered from the page content-addresses EQUAL to the binding's", async () => {
    const gw = await ready();
    const { page } = pack(gw);
    const recovered = bundleFromPage(page);
    expect(recovered).toBe(FLOOR_BUNDLE);
    expect(esmAddress(recovered!)).toBe(esmAddress(gw.renderers()[0]!.bundle));
    const served = await gw.serveRoute("plant", FERN, "full");
    expect(served.status).toBe(200);
    expect(served.body).toContain("h=42 tag=-");
    await gw.close();
  });

  it("no target role exists on the binding — the pre-T79 pointer set, exactly", async () => {
    const gw = await ready();
    const binding = gw.renderers()[0]!;
    const delta = [...gw.reactor.snapshot()].find((d) => d.id === binding.deltaId)!;
    const roles = delta.claims.pointers.map((p) => p.role).sort();
    expect(roles).toEqual(["bundle", "consumes", "renders", "route", "schema"]);
    expect(roles).not.toContain("target");
    expect(roles).not.toContain("reads");
    await gw.close();
  });
});

describe("§30 criterion 3: the page carries no data", () => {
  it("emits neither the sentinel value nor any token or seed", async () => {
    const SENTINEL = "zqx-sentinel-77";
    const gw = await boot({ pens: { editor: PEN_SEED } });
    await gw.append([observed(FERN, "height", SENTINEL, 1000, OP_SEED)]);
    await gw.publishRenderer(spec());
    await gw.declareArtifact(["plant"]);
    const { page } = pack(gw);
    expect((await gw.serveRoute("plant", FERN, "full")).body).toContain(SENTINEL);
    expect(page).not.toContain(SENTINEL);
    for (const secret of [OP_SEED, PEN_SEED, OP]) expect(page).not.toContain(secret);
    await gw.close();
  });
});

describe("§30 criterion 4 (static half): the page requests nothing from an external host", () => {
  it("references no http(s) URL as a request target, and contains no eval or new Function", async () => {
    const gw = await ready();
    const { page } = pack(gw, { storeAddress: "https://example.test/garden/mcp" });
    for (const form of [
      /fetch\s*\(\s*["'`]https?:/,
      /new\s+XMLHttpRequest/,
      /new\s+WebSocket/,
      /import\s*\(\s*["'`]https?:/,
      /\ssrc\s*=\s*["']https?:/,
      /\shref\s*=\s*["']https?:/,
    ]) {
      expect(page).not.toMatch(form);
    }
    expect(page).not.toMatch(/\beval\s*\(/);
    expect(page).not.toMatch(/new\s+Function/);
    expect(page).toMatch(/createObjectURL|data:text\/javascript/);
    await gw.close();
  });
});

describe("§30 criterion 2: publication is a declaration, and it fail-closes both ways", () => {
  it("refuses an undeclared route, emits once declared, and refuses again on the next request", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
    await gw.publishRenderer(spec());
    expect(() => pack(gw)).toThrow(/not declared publishable/);
    await gw.declareArtifact(["plant"]);
    expect(pack(gw).manifest).toContain("loam_query");
    const declaration = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "loam.artifact",
      ),
    )!;
    await gw.append([
      signClaims(makeNegationClaims(OP, 9_000_000, declaration.id, "un-publish plant"), OP_SEED),
    ]);
    expect(gw.artifactRoutes().has("plant")).toBe(false);
    expect(() => pack(gw)).toThrow(/not declared publishable/);
    await gw.close();
  });

  it("a malformed declaration is refused at BOTH doors — it opens nothing while looking open", async () => {
    expect(artifactDefect(artifactClaims([], OP, 1))).toMatch(/at least one route/);
    expect(artifactDefect(artifactClaims(["plant"], OP, 1))).toBeUndefined();
    const gw = await boot();
    const malformed = signClaims(
      withStamp(gw.stamp(OP), (t) => artifactClaims([], OP, t)),
      OP_SEED,
    );
    await expect(gw.append([malformed])).rejects.toThrow(/malformed law/);
    const receipt = await gw.federate([malformed], { admit: () => true });
    expect(receipt.accepted).toBe(0);
    expect(receipt.rejected).toBe(1);
    const good = signClaims(
      withStamp(gw.stamp(OP), (t) => artifactClaims(["plant"], OP, t)),
      OP_SEED,
    );
    const ok = await gw.federate([good], { admit: () => true });
    expect(ok.accepted).toBe(1);
    expect(gw.artifactRoutes().has("plant")).toBe(true);
    await gw.close();
  });
});

describe("§30 criterion 6: the manifest is minimal, enumerated, and never constitutional", () => {
  it("read-only lists loam_query; write-enabled adds loam_mutate; loam_register never appears", async () => {
    const readOnly = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [{ hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN] }],
      }),
      { renderTimeoutMs: 10_000 },
    );
    await readOnly.publishRenderer(spec());
    await readOnly.declareArtifact(["plant"]);
    expect(pack(readOnly).manifest).toEqual(["loam_query"]);
    await readOnly.close();

    const writing = await ready();
    expect(pack(writing).manifest).toEqual(["loam_query", "loam_mutate"]);
    expect(pack(writing).manifest).not.toContain("loam_register");
    await writing.close();
  });
});

describe("§30 criterion 9a: the pen refuses without acknowledgement, and the host route is unchanged", () => {
  it("refuses a pen-holding binding by name, and proceeds once acknowledged", async () => {
    const gw = await ready(
      { writable: [...PLANT_WRITABLE], pen: "editor" },
      { pens: { editor: PEN_SEED } },
    );
    expect(() => pack(gw)).toThrow(/writes as the pen "editor"/);
    expect(() => pack(gw, { acknowledgePen: true })).not.toThrow();
    await gw.close();
  });

  it("refuses a bundle whose SOURCE names a provisioned pen — decidable, the packer holds it", async () => {
    const gw = await ready(
      { bundle: `export default (n) => "<p>writes as editor: " + n.view.height + "</p>";` },
      { pens: { editor: PEN_SEED } },
    );
    expect(() => pack(gw)).toThrow(/source names the pen "editor"/);
    expect(() => pack(gw, { acknowledgePen: true })).not.toThrow();
    await gw.close();
  });

  it("the host route's POST still signs as the pen, unchanged — a regression stays visible", async () => {
    const gw = await ready({ writable: ["height"], pen: "editor" }, { pens: { editor: PEN_SEED } });
    const out = await gw.writeRoute("plant", FERN, { height: 9 }, "full");
    expect(out.status).toBe(200);
    const authors = [...gw.reactor.snapshot()]
      .filter((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "height",
        ),
      )
      .map((d) => d.claims.author);
    expect(authors).toContain(PEN);
    await gw.close();
  });
});

describe("§30 criterion 11: a narrower binding writable does not ride silently", () => {
  it("refuses naming both sets, then proceeds and pins the acknowledged list", async () => {
    const gw = await ready({ writable: ["height"], pen: "editor" }, { pens: { editor: PEN_SEED } });
    expect(() => pack(gw, { acknowledgePen: true })).toThrow(
      /narrows writes to \[height\] while the schema allows \[height, tag, watered, readings\]/,
    );
    const { coordinates } = pack(gw, { acknowledgePen: true, acknowledgeWritable: true });
    expect(coordinates.writable).toEqual(["height"]);
    await gw.close();
  });
});

describe("§30 criterion 12: a version-pinned binding refuses rather than packing the latest", () => {
  it("refuses naming the pinned-read gap, and emits no partial page", async () => {
    const gw = await ready({ version: 1 });
    expect(gw.renderers()[0]!.versionId).toBeDefined();
    let answered: unknown;
    try {
      answered = pack(gw);
    } catch (err) {
      expect((err as Error).message).toMatch(/pins a frozen reading, and MCP has no pinned read/);
      expect((err as Error).message).toMatch(/version argument on loam_query/);
    }
    expect(answered).toBeUndefined();
    await gw.close();
  });
});

describe("§30 criterion 13a: a consumed field the schema DECLARES bytes refuses", () => {
  it("refuses with the CSP reason — provable only for a resolver-backed field", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
            resolvers: {
              height: { rung: "a", type: "bytes", code: "export default () => undefined;" },
            },
          },
        ],
      }),
      { renderTimeoutMs: 10_000 },
    );
    await gw.publishRenderer(spec());
    await gw.declareArtifact(["plant"]);
    expect(() => pack(gw)).toThrow(/declares `bytes`/);
    expect(() => pack(gw)).toThrow(/CSP blocks every external host/);
    await gw.publishRenderer(spec({ route: "tagged", consumes: ["tag"] }));
    await gw.declareArtifact(["tagged"]);
    expect(() => gw.packArtifact("tagged", FERN, { server: "My Loam" })).not.toThrow();
    await gw.close();
  });
});

describe("§30 criterion 14: withdrawal darkens the emission and the route together", () => {
  it("negating the binding refuses the pack AND 404s the route on the next request", async () => {
    const gw = await ready();
    const binding = gw.renderers()[0]!;
    await gw.append([
      signClaims(
        makeNegationClaims(OP, 9_000_000, binding.deltaId, "retire the renderer"),
        OP_SEED,
      ),
    ]);
    expect(() => pack(gw)).toThrow(/no renderer is bound at route "plant"/);
    expect((await gw.serveRoute("plant", FERN, "full")).status).toBe(404);
    await gw.close();
  });

  it("erasing the binding does the same, and the erasure refuses its re-entry", async () => {
    const gw = await ready();
    const binding = gw.renderers()[0]!;
    const delta = [...gw.reactor.snapshot()].find((d) => d.id === binding.deltaId)!;
    await gw.erase(binding.deltaId, { reason: "the renderer is withdrawn" });
    expect(() => pack(gw)).toThrow(/no renderer is bound/);
    expect((await gw.serveRoute("plant", FERN, "full")).status).toBe(404);
    expect([...gw.reactor.snapshot()].some((d) => d.id === binding.deltaId)).toBe(false);
    await expect(gw.append([delta])).rejects.toThrow(
      /an erasure at loam:erasure refuses its return/,
    );
    expect(
      [...gw.reactor.snapshot()].some((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "height",
        ),
      ),
    ).toBe(true);
    await gw.close();
  });
});

describe("§30 criterion 27: an unusable connector display name refuses at pack time", () => {
  it.each([
    ["empty", ""],
    ["whitespace-only", "   "],
    ["over-length", "x".repeat(129)],
  ])("refuses a %s name, naming the constraint", async (_why, server) => {
    const gw = await ready();
    expect(() => gw.packArtifact("plant", FERN, { server })).toThrow(/connector/);
    await gw.close();
  });

  it("a valid name packs, and the page names it", async () => {
    const gw = await ready();
    expect(pack(gw, { server: "Garden Store" }).coordinates.server).toBe("Garden Store");
    await gw.close();
  });
});

describe("§30 criterion 34c: a store that OUTLIVES the realm is refused at pack time", () => {
  it.each(["indexedDB", "caches", "BroadcastChannel", "importScripts"])(
    "refuses a bundle reaching %s, and names THAT channel rather than a boilerplate list",
    async (channel) => {
      const bundle = `export default (n) => { var k = ${channel}; return "<p>" + n.view.height + "</p>"; };`;
      const gw = await ready({ bundle });
      expect(() => pack(gw)).toThrow(new RegExp(`globals — ${channel} \\(worker\\)`));
      await gw.close();
    },
  );
});

describe("§30 criterion 37a: a host-only affordance cannot silently ride", () => {
  it.each([
    [
      "window.claude.mcp",
      'export default (n) => { window.claude.mcp.callTool("s", "t", {}); return "a"; };',
    ],
    [
      "a sendPrompt-class call",
      'export default (n) => { window.claude.sendPrompt("hi"); return "a"; };',
    ],
    [
      "window.claude.downloads",
      'export default (n) => { window.claude.downloads.save({}); return "a"; };',
    ],
  ])(
    "refuses a bundle referencing %s, so an app cannot become artifact-only in silence",
    async (_n, bundle) => {
      const gw = await ready({ bundle });
      expect(() => pack(gw)).toThrow(/host affordance reaches an app by MEDIATION/);
      await gw.close();
    },
  );
});

describe("§30 criterion 23 (delta half) / 26 (delta half): erasure lands, and the door darkens", () => {
  it("after erasing the entity's facts the store serves no pre-erasure value", async () => {
    const gw = await ready();
    const fact = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "height",
      ),
    )!;
    const before = await gw.serveRoute("plant", FERN, "full");
    expect(before.body).toContain("h=42");
    await gw.erase(fact.id, { reason: "the gardener asked" });
    expect([...gw.reactor.snapshot()].some((d) => d.id === fact.id)).toBe(false);
    expect(gw.renderers()).toHaveLength(1);
    expect((await gw.serveRoute("plant", FERN, "full")).body).not.toContain("h=42");
    await gw.close();
  });
});

describe("§30 criterion 21 (the shared-clock half): both hosts carry the SAME number", () => {
  it("the coordinates carry the host's OWN render budget, not a baked constant", () => {
    expect(RENDER_TIMEOUT_MS).toBe(500);
    expect(readFileSync(join(process.cwd(), "src", "gateway", "artifact.ts"), "utf8")).toContain(
      "gw.options.renderTimeoutMs ?? RENDER_TIMEOUT_MS",
    );
  });

  it("a gateway that tightens its clock emits the tightened number, not the default", async () => {
    const gw = await ready({}, { renderTimeoutMs: 250 });
    expect(pack(gw).coordinates.renderTimeoutMs).toBe(250);
    await gw.close();
  });
});

it("the ALREADY-EMITTED bytes are unaffected by a later withdrawal — the accepted residual", async () => {
  const gw = await ready();
  const { page } = pack(gw);
  const binding = gw.renderers()[0]!;
  await gw.append([
    signClaims(makeNegationClaims(OP, 9_000_000, binding.deltaId, "retire the renderer"), OP_SEED),
  ]);
  expect(() => pack(gw)).toThrow();
  expect(bundleFromPage(page)).toBe(FLOOR_BUNDLE);
  expect(page).toContain("loam-app");
  await gw.close();
});

describe("§30: an erase order is still the operator's, and this door widens nothing", () => {
  it("pack never removes a delta — the store's count is unchanged across an emission", async () => {
    const gw = await ready();
    const before = [...gw.reactor.snapshot()].length;
    pack(gw);
    pack(gw);
    expect([...gw.reactor.snapshot()].length).toBe(before);
    await gw.close();
  });
});

void eraseClaims;
