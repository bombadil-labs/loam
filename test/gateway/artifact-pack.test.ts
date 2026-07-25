// SPEC §30 — the pack door: `loam.artifact` as a declaration, and the emitted page as a build PRODUCT
// re-derived from surviving law on every call.
//
// WHAT THIS FILE ASSERTS, at both levels. DELTA level: the binding's pointer roles are the PRE-T79 set
// (nobody smuggled a `target` or a `reads` role in, so §20 owes no migration and §23.5's latest-per-route
// law is untouched); the declaration is a union over surviving lawful deltas; an erasure lands. OBJECT
// level: what the door EMITS — the recovered bundle content-addresses equal to the binding's, the page
// carries no view data, the manifest is enumerated, and every one of the six refusals fires with its own
// reason.
//
// WHAT IT DELIBERATELY DOES NOT ASSERT. "The emitted page contains the pen name nowhere" — unsatisfiable
// against a verbatim-riding bundle for exactly the bindings that COMPLY with §23.3, since a compliant
// renderer must SHOW which pen it writes under. The pen's SEED is the custody question, it lives in
// `GatewayOptions.pens`, and the negative sweep over the token table below is what covers it. The
// runtime half of that obligation — the host's writer-identity statement as the LAST claim in the DOM —
// is `test/site/artifact-shell.test.ts`'s.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { esmAddress } from "../../src/gateway/esm.js";
import { RENDER_TIMEOUT_MS } from "../../src/gateway/render-worker.js";
import { bundleFromPage, coordinatesFromPage } from "../../src/gateway/artifact-page.js";
import { artifactClaims, artifactDefect } from "../../src/gateway/artifact.js";
import { HOST_GLOBALS, scanHostReferences } from "../../src/gateway/artifact-scan.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const PEN_SEED = "1a".repeat(32);

// The FLOOR fixture: a pure function of its node, reaching for no host global. It reads a `consumes`
// field, `hex`, AND `tag` — a prop OUTSIDE `consumes` — which is the load-bearing part rather than a
// flourish: the host route hands the bundle the WHOLE resolved view, so a shell that asked only for
// `consumes` would render differently here, and a fixture reading only `consumes` could never see it.
const FLOOR_BUNDLE = `export default function (node) {
  var tags = node.view.tag === undefined ? "-" : String(node.view.tag);
  var keys = Object.keys(node.reads).sort().join(",");
  return "<p>h=" + node.view.height + " tag=" + tags + " hex=" + node.hex.slice(0, 8) +
    " reads=[" + keys + "] page=" + (node.state.page === undefined ? "0" : node.state.page) + "</p>";
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
      // §6's two keys: the pen's SEED is custody (config, below) and this is the other half — an
      // operator grant of write standing. Provisioning is not authorization.
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

// A store ready to pack: a fact, a renderer, and the route declared publishable.
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
    // …and the SAME binding still serves its HTML unchanged at the host route.
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
    // Delta level. The whole point of Recommendation 1: the duality is a property of the HOST, so the
    // binding carries no target vocabulary and no per-target bundle role — one hash, no signed-vs-
    // executed gap, and §23.5's latest-per-route law untouched because no new key is introduced.
    expect(roles).toEqual(["bundle", "consumes", "renders", "route", "schema"]);
    expect(roles).not.toContain("target");
    expect(roles).not.toContain("reads");
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
    expect(pack(gw).page).toContain("<!doctype html>");
    // Strike the declaration: the door stops emitting on the very next call, with no restart. The
    // declaration is a derived view over deltas, so removal is an ordinary lawful negation.
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
    // Delta level: `artifactDefect` is the validator, and it is wired into the append door and the
    // ingest door alike, so the two cannot disagree about what lawful loam:artifact data is.
    expect(artifactDefect(artifactClaims([], OP, 1))).toMatch(/at least one route/);
    expect(artifactDefect(artifactClaims(["plant"], OP, 1))).toBeUndefined();
    const gw = await boot();
    const malformed = signClaims(artifactClaims([], OP, gw.nextTimestamp()), OP_SEED);
    await expect(gw.append([malformed])).rejects.toThrow(/malformed law/);
    // …and the INGEST door refuses the very same bytes. A declaration OPENS something, so a
    // malformed one must be refused wherever it arrives; the two doors disagreeing is how a store
    // ends up holding law no reader will honour. Ingest counts rather than throws — a peer's bad
    // delta is rejected, not an error thrown at the operator.
    const receipt = await gw.federate([malformed], { admit: () => true });
    expect(receipt.accepted).toBe(0);
    expect(receipt.rejected).toBe(1);
    // A WELL-FORMED one lands through the same door, so this is not a rail that passes by refusing
    // everything.
    const good = signClaims(artifactClaims(["plant"], OP, gw.nextTimestamp()), OP_SEED);
    const ok = await gw.federate([good], { admit: () => true });
    expect(ok.accepted).toBe(1);
    expect(gw.artifactRoutes().has("plant")).toBe(true);
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
    // The value is legible through the door and ABSENT from the emitted bytes.
    expect((await gw.serveRoute("plant", FERN, "full")).body).toContain(SENTINEL);
    expect(page).not.toContain(SENTINEL);
    // Negatively over the WHOLE token/seed table, so a renamed field cannot hide a leak. The pen's
    // SEED is what was ever at risk here, and it is safe by construction: it lives server-side in
    // GatewayOptions.pens, and no artifact has a server.
    for (const secret of [OP_SEED, PEN_SEED, OP]) expect(page).not.toContain(secret);
    await gw.close();
  });
});

describe("§30 criterion 4 (static half): the page requests nothing from an external host", () => {
  it("references no http(s) URL as a request target, and contains no eval or new Function", async () => {
    const gw = await ready();
    const { page } = pack(gw, { storeAddress: "https://example.test/garden/mcp" });
    // No code path builds a request at an external host. The store address appears only as the
    // human-readable onboarding copy a viewer READS — never as a target the page requests.
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
    // The three names DO appear once each — inside the confined realm's scrub list, which exists to
    // REMOVE them. A rail matching the bare token would have to be satisfied by not naming the thing
    // being taken away, which is the opposite of what this criterion wants.
    expect(page).not.toMatch(/\beval\s*\(/);
    expect(page).not.toMatch(/new\s+Function/);
    // The mount mechanism is a data:/blob: module import — the bytes the operator signed are the
    // bytes that run. A textual rewrite would reintroduce the signed-vs-executed gap §23.1 closes.
    expect(page).toMatch(/createObjectURL|data:text\/javascript/);
    await gw.close();
  });
});

describe("§30 criterion 6: the manifest is minimal, enumerated, and never constitutional", () => {
  it("read-only lists loam_query; write-enabled adds loam_mutate; loam_register never appears", async () => {
    // A store whose schema names NO writable field: immutable-by-default, so nothing may be written.
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
    // Constitutional, in every emission: loam_register would ask a viewer for store-shaping
    // authority in order to draw a view.
    const { page, manifest } = pack(writing);
    expect(manifest).not.toContain("loam_register");
    expect(page).not.toContain("loam_register");
    await writing.close();
  });
});

describe("§30 criterion 9a: the pen refuses without acknowledgement, and the host route is unchanged", () => {
  it("refuses a pen-holding binding by name, and proceeds once acknowledged", async () => {
    // A pen over the schema's WHOLE writable set, so this rail sees the pen refusal alone —
    // criterion 11's narrowing refusal is a separate look, and bundling them would let either pass
    // for the other.
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
    // Delta level: the author of what landed is the PEN, not the operator and not a viewer.
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
    // The schema allows four fields; this binding narrows to one. `writeRoute` enforces the binding's
    // own list at the door, atop the schema's; `loam_mutate` does not go through `writeRoute`, so on
    // this host only the schema's list binds. Not a widening of anyone's authority — but it IS a
    // difference between two hosts serving one route, and it is decidable here.
    const gw = await ready({ writable: ["height"], pen: "editor" }, { pens: { editor: PEN_SEED } });
    expect(() => pack(gw, { acknowledgePen: true })).toThrow(
      /narrows writes to \[height\] while the schema allows \[height, tag, watered, readings\]/,
    );
    const { page } = pack(gw, { acknowledgePen: true, acknowledgeWritable: true });
    expect(coordinatesFromPage(page)!.writable).toEqual(["height"]);
    await gw.close();
  });
});

describe("§30 criterion 12: a version-pinned binding refuses rather than packing the latest", () => {
  it("refuses naming the pinned-read gap, and emits no partial page", async () => {
    const gw = await ready({ version: 1 });
    expect(gw.renderers()[0]!.versionId).toBeDefined();
    let page: string | undefined;
    try {
      page = pack(gw).page;
    } catch (err) {
      expect((err as Error).message).toMatch(/pins a frozen reading, and MCP has no pinned read/);
      expect((err as Error).message).toMatch(/version argument on loam_query/);
    }
    // No partial emission: nothing is written before every refusal has run.
    expect(page).toBeUndefined();
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
    // The decidability is NARROWER than it sounds: `type` is declared on a RESOLVER, so a plain
    // policy-shaped field carries no declared type at all, and `gql.ts` types the envelope at the
    // VALUE level too. A `tag`-consuming renderer over the same store packs — pack-time refusal for
    // the subset we can prove, and the shell's legible degrade for the rest.
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

  it("erasing the binding does the same, and the tombstone refuses its re-entry", async () => {
    const gw = await ready();
    const binding = gw.renderers()[0]!;
    const delta = [...gw.reactor.snapshot()].find((d) => d.id === binding.deltaId)!;
    await gw.erase(binding.deltaId, { reason: "the renderer is withdrawn" });
    expect(() => pack(gw)).toThrow(/no renderer is bound/);
    expect((await gw.serveRoute("plant", FERN, "full")).status).toBe(404);
    // Delta level, both directions: the target is gone AND the door remembers the hole — a re-send
    // of the very bytes is refused rather than quietly re-admitted.
    expect([...gw.reactor.snapshot()].some((d) => d.id === binding.deltaId)).toBe(false);
    await expect(gw.append([delta])).rejects.toThrow(
      /a tombstone at loam:erasure refuses its return/,
    );
    // …and a named live bystander survives: the fact the renderer read is untouched.
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

// EVERY name the refusal set owes, written out here rather than read from `HOST_GLOBALS`. Deriving the
// expectation from the table under test is what let seven of them go unexercised: `pack()` was the only
// reach into the scan, so deleting `navigator` (or `claude`, or `location`) from the table left the whole
// suite green while a bundle reaching `navigator.storage` packed silently. This is the discipline
// `artifact-realm.test.ts`'s MUST_SEAL already runs, applied to the second list this change ships.
const MUST_REFUSE: Readonly<Record<string, readonly string[]>> = {
  browser: [
    "window",
    "document",
    "claude",
    "localStorage",
    "sessionStorage",
    "navigator",
    "location",
  ],
  node: ["require", "Buffer", "process", "module", "__dirname", "__filename"],
  worker: [
    "indexedDB",
    "caches",
    "BroadcastChannel",
    "importScripts",
    "self",
    "globalThis",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
  ],
  eval: ["eval", "Function"],
};

describe("§30 criterion 20: the refusal set covers every name it owes", () => {
  it("the shipped table names each one, in its own family", () => {
    for (const [family, names] of Object.entries(MUST_REFUSE)) {
      for (const name of names) {
        expect(HOST_GLOBALS[family], `${family}/${name}`).toContain(name);
      }
    }
  });

  it("and the SCAN reports each one, by name and family, from a bare reference", () => {
    // Driven through `scanHostReferences` directly, so a name is exercised whether or not a pack
    // fixture happens to reach it. Nothing else in this suite touched the scan's own surface.
    for (const [family, names] of Object.entries(MUST_REFUSE)) {
      for (const name of names) {
        const source = `export default function (node) { var held = ${name}; return "<p>" + node.view.height + "</p>"; }`;
        const found = scanHostReferences(source);
        expect(
          found.map((r) => r.name),
          name,
        ).toContain(name);
        expect(found.find((r) => r.name === name)?.family, name).toBe(family);
      }
    }
  });

  it("a conforming pure RenderFn reaches NOTHING — the two-sided half", () => {
    // Without this, a scan that reported every identifier would satisfy the loop above.
    expect(
      scanHostReferences('export default (node) => "<p>" + node.view.height + "</p>";'),
    ).toEqual([]);
  });
});

describe("§30 criterion 20: a reference scan, not a substring scan", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["window", 'export default (n) => window.claude ? "a" : "b";'],
    ["document", 'export default (n) => { document.title = "x"; return "a"; };'],
    ["import(", 'export default (n) => { import("./x.js"); return "a"; };'],
    ["require", 'export default (n) => { require("fs"); return "a"; };'],
    ["node:", 'import { readFileSync } from "node:fs";\nexport default (n) => "a";'],
    ["Buffer", 'export default (n) => Buffer.from("x").toString();'],
    ["process", "export default (n) => process.cwd();"],
    ["module", 'export default (n) => { module.exports = n; return "a"; };'],
    ["__dirname", 'export default (n) => __dirname + "/x";'],
    ["__filename", 'export default (n) => __filename + "/x";'],
    // Not in §30's own three families, and refused anyway: code that evaluates a string it built has
    // a signed-vs-executed gap of its own making, which is the exact property §23.1's attestation
    // exists to close. Naming it here is the widening said out loud rather than assumed.
    ["eval", 'export default (n) => eval("1 + 1") + "a";'],
    ["Function", 'export default (n) => new Function("return 1")() + "a";'],
    ["indexedDB", 'export default (n) => { indexedDB.open("keep"); return "a"; };'],
    ["caches", 'export default (n) => { caches.open("keep"); return "a"; };'],
    ["BroadcastChannel", 'export default (n) => { new BroadcastChannel("k"); return "a"; };'],
    ["importScripts", 'export default (n) => { importScripts("x.js"); return "a"; };'],
    ["self", "export default (n) => String(self.name);"],
    ["globalThis", 'export default (n) => { globalThis.keep = n; return "a"; };'],
    ["fetch", 'export default (n) => { fetch("/x"); return "a"; };'],
  ];

  it.each(cases)("refuses a bundle reaching %s, naming it", async (name, bundle) => {
    const gw = await ready({ bundle });
    expect(() => pack(gw)).toThrow(
      new RegExp(`reaches for host-specific globals — ${name.replace("(", "\\(")}`),
    );
    await gw.close();
  });

  it("a conforming pure RenderFn packs, and so does REAL bundler output", async () => {
    // (b) is the half that makes this rail honest. A criterion measuring only true positives stays
    // green while the door refuses nearly every real bundle — and §23.2 names "a React renderer
    // bundles its own React and returns renderToString(...)" as the target shape. This fixture is
    // that shape's output: a `process.env.NODE_ENV` guard, a `globalThis` polyfill behind a typeof
    // check, a `typeof document !== "undefined"` branch, and the identifiers `processNote` /
    // `documentTitle` that a substring scan would have refused outright.
    const BUNDLED_REACT = `var __globalThis = typeof globalThis !== "undefined" ? globalThis : {};
var __dev = typeof process !== "undefined" && process.env.NODE_ENV !== "production";
function processNote(text) { return "<em>" + text + "</em>"; }
function documentTitle(node) { return "plant " + node.entity; }
function h(tag, children) { return "<" + tag + ">" + children + "</" + tag + ">"; }
function renderToString(el) { return el; }
if (typeof document !== "undefined") { document.title = documentTitle({ entity: "boot" }); }
export default function (node) {
  return renderToString(h("section",
    h("h2", documentTitle(node)) + processNote("height " + node.view.height)));
}`;
    const gw = await ready({ bundle: BUNDLED_REACT });
    // The header records the honest limit: even a reference scan is defeated by string construction
    // (globalThis["win" + "dow"]), so this is the CHEAP half of confinement and never the enforcing
    // one — criterion 19's realm boundary is. Both, not either.
    expect(() => pack(gw)).not.toThrow();
    expect(pack(gw).page).toContain("processNote");
    await gw.close();
  });

  it("a token inside a comment or a string is not a reference", async () => {
    const gw = await ready({
      bundle: `// this renderer does not touch window or document
export default (n) => "<p>" + "process".length + n.view.height + "</p>";`,
    });
    expect(() => pack(gw)).not.toThrow();
    await gw.close();
  });

  it("a member name and a LOCALLY BOUND name are not reaches", async () => {
    const gw = await ready({
      bundle: `export default function (node) {
  var process = { env: {} };
  var box = { window: 1, document: 2 };
  return "<p>" + process.env.X + box.window + node.view.height + "</p>";
}`,
    });
    expect(() => pack(gw)).not.toThrow();
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
    // The header records what is NOT refusable: two publishers telling viewers to name their
    // connector the same thing is a collision the packer cannot see — it has no way to know what
    // else a viewer installed. Its runtime face is `selection_required` (criterion 15), so the
    // hazard is documentation plus a degraded state, never a refusal.
    const gw = await ready();
    const { page } = pack(gw, { server: "Garden Store" });
    expect(coordinatesFromPage(page)!.server).toBe("Garden Store");
    expect(page).toContain("Garden Store");
    await gw.close();
  });
});

describe("§30 criterion 34c: a store that OUTLIVES the realm is refused at pack time", () => {
  // A worker global scope has no `window` and no `localStorage` — which is what made the realm look
  // sufficient — but it DOES have these, as bare identifiers, so `terminate()` alone does NOT empty
  // the compartment. A byte-scan over one conforming page could never have seen it.
  it.each(["indexedDB", "caches", "BroadcastChannel", "importScripts"])(
    "refuses a bundle reaching %s, and names THAT channel rather than a boilerplate list",
    async (channel) => {
      // The refusal message also interpolates the first three worker-family names as prose, so a bare
      // `new RegExp(channel)` matched boilerplate present regardless of what the scan reported — a scan
      // that always named the wrong global passed this for three of the four cases. Anchored on the
      // scan's own report instead, which is the only part that varies.
      const bundle = `export default (n) => { var k = ${channel}; return "<p>" + n.view.height + "</p>"; };`;
      expect(scanHostReferences(bundle).map((r) => r.name)).toEqual([channel]);
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
      // The design decision this defends: a host affordance reaches an app by MEDIATION — a gesture the
      // shell honors — never by ambient reach. T79 ships the seam without shipping a prompt verb.
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
    // Delta level: the bytes are gone, and a named live bystander — the renderer binding itself —
    // survives, so this is not a rail that could pass by over-purging.
    expect([...gw.reactor.snapshot()].some((d) => d.id === fact.id)).toBe(false);
    expect(gw.renderers()).toHaveLength(1);
    // Object level: the door no longer serves the value.
    expect((await gw.serveRoute("plant", FERN, "full")).body).not.toContain("h=42");
    await gw.close();
  });

  it("the ALREADY-EMITTED bytes are unaffected by a later withdrawal — the accepted residual", async () => {
    // Criterion 26's delta half. The page a stranger already holds is the one thing withdrawal cannot
    // reach, and that is ACCEPTED and pinned here rather than implied: the DATA never outlives its
    // source (criterion 3 proves it at the bytes) and the CODE always does. The follow-on that would
    // close it is a `loam_manifest(route)` read over constitutional publication state, checked before
    // mounting — a new disclosure decision, and not this ticket's. If it lands, this inverts.
    const gw = await ready();
    const { page } = pack(gw);
    const binding = gw.renderers()[0]!;
    await gw.append([
      signClaims(
        makeNegationClaims(OP, 9_000_000, binding.deltaId, "retire the renderer"),
        OP_SEED,
      ),
    ]);
    expect(() => pack(gw)).toThrow();
    // The bytes in hand still carry the whole app. `test/site/artifact-shell.test.ts` drives them.
    expect(bundleFromPage(page)).toBe(FLOOR_BUNDLE);
    expect(page).toContain("loam-app");
    await gw.close();
  });
});

describe("§30 criterion 21 (the shared-clock half): both hosts carry the SAME number", () => {
  it("the emitted page states the host's own render budget, and the browser peer mirrors it", () => {
    // The artifact host adopts the server host's budget so the two are visibly the same clock — a
    // renderer that fits on one fits on the other, and an operator cannot ship an app that only works
    // where they happened to test it. The TERMINATION half (a spinning bundle killed within the
    // budget) needs the shell harness and is named in the report as not yet built.
    expect(RENDER_TIMEOUT_MS).toBe(500);
    // The browser peer's stub re-declares the constant because the Node worker module cannot ride
    // into a zero-`node:` bundle. Two clocks that disagreed would be a divergence behind one content
    // address, which is the whole reason that export exists.
    const stub = readFileSync(
      join(process.cwd(), "scripts", "browser-render-worker-stub.mjs"),
      "utf8",
    );
    expect(stub).toContain(`export const RENDER_TIMEOUT_MS = ${RENDER_TIMEOUT_MS};`);
  });

  it("a gateway that tightens its clock emits the tightened number, not the default", async () => {
    const gw = await ready({}, { renderTimeoutMs: 250 });
    expect(coordinatesFromPage(pack(gw).page)!.renderTimeoutMs).toBe(250);
    await gw.close();
  });
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

// A tombstone's shape is erase.ts's; this file only ever asks it to exist.
void eraseClaims;
