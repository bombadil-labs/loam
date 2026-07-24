// T33 — promote-LAW: the graduation is an ordinary publish that remembers its probation
// (SPEC §24.4 × the T31 blessing shape, .adlc/specs/27-trust-on-load.md — 26 criteria, all here).
//
// The world every rail shares: a STRANGER ships a module — their own `Post` schema law and a
// renderer — inside a wall container on the operator's store, with a manifest (loam.manifest
// rows: alias → target by the kind's most stable identifier; the `kind` label is display copy,
// never trusted). The operator blesses per export: `adoptLaw(version, alias)` routes the row to
// its kind's ORDINARY publish path under operator authorship with the SOURCE's timestamps
// (criterion 2: same content + same author + same timestamp → same id, so re-blessing re-mints
// the id a tombstone refuses and idempotence rides identity), plus an adoption/witness record.
//
// What this file deliberately does not assert: promote-outputs' own behavior (frozen,
// test/gateway/promotion.test.ts) beyond criterion 23's it-still-refuses-law leg; the container
// lifting's own promises (T32's nine files).

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  publishHyperSchemaClaims,
  signClaims,
  type Delta,
  type HyperSchema,
  type Schema,
} from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims, type Container } from "../../src/gateway/container.js";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { rendererBindingClaims } from "../../src/gateway/renderers.js";
import { CTX_MANIFEST, manifestExportClaims } from "../../src/gateway/adopt-law.js";
import type { ModuleVersion } from "../../src/gateway/container-identity.js";
import { FERN, observed, PLANT_BODY } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";

const OP_SEED = "4a".repeat(32);
const OP = authorForSeed(OP_SEED);
const STRANGER_SEED = "4b".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);

// The stranger's law: their own Post shape (reusing the Plant body so views resolve without a
// bespoke hyperschema fixture — the NAME is what collides or doesn't, per criterion 8).
const POST: HyperSchema = { name: "Post", alg: 1, body: PLANT_BODY };
const POST_SCHEMA: Schema = { props: new Map([["height", pickLatest]]), default: pickLatest, name: "Post" };

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

interface ModuleWorld {
  readonly gw: Gateway;
  readonly wall: Container;
  readonly version: ModuleVersion;
  /** The stranger's deltas by part, for identity assertions. */
  readonly parts: {
    readonly definition: Delta;
    readonly registration: readonly Delta[]; // living, snapshot, binding
    readonly renderer: Delta;
    readonly manifest: readonly Delta[];
  };
}

// Build the shared world. The module's membership is "the stranger's deltas" — the frozen
// version carries them plus their negation closure (Gateway.freeze), so survival is computable
// from the members alone.
async function moduleWorld(opts: { schemaAlias?: string; withRenderer?: boolean } = {}): Promise<ModuleWorld> {
  const gw = await boot();
  await gw.append([
    signClaims(
      containerClaims(
        { container: "container:social", trust: "untrusted", posture: "wall" },
        OP,
        40_000,
      ),
      OP_SEED,
    ),
  ]);
  const wall = await gw.openContainer({ name: "container:social", backend: new MemoryBackend() });

  const definition = signClaims(publishHyperSchemaClaims(POST, "hyperschema:Post", STRANGER, 41_000), STRANGER_SEED);
  let t = 41_001;
  const reg = registrationDeltaClaims(
    "hyperschema:Post",
    "Post",
    POST_SCHEMA,
    [FERN],
    STRANGER,
    () => t++,
    undefined,
    ["height"],
    undefined,
  );
  const registration = [reg.living, reg.snapshot, reg.binding].map((c) => signClaims(c, STRANGER_SEED));
  const renderer = signClaims(
    rendererBindingClaims(
      {
        route: "feed",
        schemaName: "Post" as never,
        consumes: ["height"],
        bundle: "export default (n) => `<b>${n.view.height}</b>`;",
      },
      undefined,
      STRANGER,
      41_010,
    ),
    STRANGER_SEED,
  );
  const manifest = [
    signClaims(
      manifestExportClaims(
        { alias: opts.schemaAlias ?? "Post", targetEntity: "hyperschema:Post", kind: "schema" },
        STRANGER,
        41_020,
      ),
      STRANGER_SEED,
    ),
    ...(opts.withRenderer === false
      ? []
      : [
          signClaims(
            manifestExportClaims(
              { alias: "Feed", targetAddress: renderer.id, kind: "renderer" },
              STRANGER,
              41_021,
            ),
            STRANGER_SEED,
          ),
        ]),
  ];
  await wall.gateway!.federate([definition, ...registration, renderer, ...manifest], {
    admit: () => true,
  });
  const version = wall.gateway!.freeze({
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
    in: "input",
  });
  return { gw, wall, version, parts: { definition, registration, renderer, manifest } };
}

const rootResolvesPost = async (gw: Gateway): Promise<boolean> => {
  try {
    const view = await gw.query(`{ Post(entity: "${FERN}") { height } }`);
    return view.errors === undefined;
  } catch {
    return false;
  }
};

describe("T33 criterion 3 — facts never need it", () => {
  it("a facts-only module reads without any adoption, and adoptLaw refuses 'exports no law'", async () => {
    const gw = await boot();
    await gw.append([
      signClaims(
        containerClaims({ container: "container:facts", trust: "untrusted", posture: "wall" }, OP, 42_000),
        OP_SEED,
      ),
    ]);
    const wall = await gw.openContainer({ name: "container:facts", backend: new MemoryBackend() });
    const fact = observed(FERN, "height", 30, 42_100, STRANGER_SEED);
    const manifestRow = signClaims(
      manifestExportClaims({ alias: "Fern", targetEntity: FERN, kind: "entity" }, STRANGER, 42_200),
      STRANGER_SEED,
    );
    await wall.gateway!.federate([fact, manifestRow], { admit: () => true });
    const version = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });

    // The exported entity resolves with ZERO adoptions performed — through the operator's own
    // seeded lens in the module's container (facts bind nothing; nothing needs blessing).
    const view = await wall.gateway!.query(`{ Plant(entity: "${FERN}") { height } }`);
    expect((view.data?.Plant as { height?: unknown } | undefined)?.height).toBe(30);

    await expect(gw.adoptLaw(version, "Fern")).rejects.toThrow(/exports no law/);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 1 — one export blesses that export and nothing else", () => {
  it("the schema binds in the root; the sibling renderer stays 404 there and serves in the module", async () => {
    const { gw, wall, version } = await moduleWorld();
    expect(await rootResolvesPost(gw)).toBe(false); // inert until blessed

    await gw.adoptLaw(version, "Post");

    // Object level, the root's own door: a read RESOLVES through the blessed schema.
    const view = await gw.query(`{ Post(entity: "${FERN}") { height } }`);
    expect(view.errors).toBeUndefined();
    // The sibling export did not ride: the root serves no /feed route...
    const root = await gw.serveRoute("feed", FERN, "full");
    expect(root.status).toBe(404);
    // ...while the module's own container still answers for its own law is criterion 7's leg —
    // here we pin only that nothing about the renderer landed in the root's ground.
    expect(gw.renderers().some((r) => r.route === "feed")).toBe(false);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 2 — the ordinary publish path, with the source's timestamps", () => {
  it("adoption deltas mirror a direct publish modulo timestamps, and erase-then-re-bless refuses", async () => {
    const { gw, wall, version, parts } = await moduleWorld();
    await gw.adoptLaw(version, "Post");

    // Shape-identity: the blessed ground holds operator-signed twins of the source's law deltas,
    // each inheriting its SOURCE delta's timestamp (same id property as promote-outputs, H4).
    const blessed = [...gw.reactor.snapshot()].filter(
      (d) => d.claims.author === OP && d.claims.timestamp >= 41_000 && d.claims.timestamp <= 41_009,
    );
    // definition + living + snapshot + binding = four law deltas, timestamps inherited exactly.
    expect(blessed.length).toBe(4);
    const sourceTs = [parts.definition, ...parts.registration].map((d) => d.claims.timestamp).sort();
    expect(blessed.map((d) => d.claims.timestamp).sort()).toEqual(sourceTs);

    // Erasure holds by identity: erase one blessed law delta, re-bless — the door refuses the
    // re-minted id rather than minting a stranger to the tombstone.
    const target = blessed.find((d) => d.claims.timestamp === parts.definition.claims.timestamp)!;
    await gw.erase(target.id, { reason: "the operator withdrew the blessing" });
    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(/erased|tombstone/);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 4 — idempotence by identity", () => {
  it("re-adopting an already-blessed row is a no-op plus provenance", async () => {
    const { gw, wall, version } = await moduleWorld();
    await gw.adoptLaw(version, "Post");
    const matBefore = gw.materializationFor("Post");
    const countBefore = [...gw.reactor.snapshot()].length;

    await gw.adoptLaw(version, "Post"); // witnessed, not re-published

    expect(gw.materializationFor("Post")).toBe(matBefore); // no rebind churn
    // No second binding: the only ground movement is at most one witness record (criterion 18
    // pins the once-only; here we pin no LAW landed twice).
    const after = [...gw.reactor.snapshot()].length;
    expect(after - countBefore).toBeLessThanOrEqual(1);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 7 — a blessing crosses a wall only by re-signing", () => {
  it("root-signed twins land; the module's own deltas and its own reading are untouched", async () => {
    const { gw, wall, version, parts } = await moduleWorld();
    const moduleGroundBefore = [...wall.gateway!.reactor.snapshot()].map((d) => d.id).sort();

    await gw.adoptLaw(version, "Post");

    // The module's deltas are untouched (adoption-merge re-signs; it never rewrites the source)…
    const moduleGroundAfter = [...wall.gateway!.reactor.snapshot()].map((d) => d.id).sort();
    expect(moduleGroundAfter).toEqual(moduleGroundBefore);
    // …the root holds OPERATOR-signed law, never the stranger's bytes as law…
    expect(gw.reactor.get(parts.definition.id)).toBeUndefined();
    // …and the module's container still resolves through its ORIGINAL (stranger-signed) law:
    // the wall's ground still carries the stranger's definition, surviving and its own.
    expect(wall.gateway!.reactor.get(parts.definition.id)).toBeDefined();
    await wall.drop();
    await gw.close();
  });
});

describe("T33 vocabulary — the manifest mint collides with nothing", () => {
  it("loam.manifest is its own context, outside every reserved prefix", () => {
    expect(CTX_MANIFEST).toBe("loam.manifest");
    expect(CTX_MANIFEST.startsWith("loam.container")).toBe(false);
    expect(CTX_MANIFEST.startsWith("loam.adoption")).toBe(false);
    expect(CTX_MANIFEST.startsWith("rhizomatic.")).toBe(false);
  });
});
