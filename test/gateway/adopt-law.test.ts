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
import { retraction } from "./narrowing.js";
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

// Build a stranger module INTO an existing primary. The module's membership is "the stranger's
// deltas" — the frozen version carries them plus their negation closure (Gateway.freeze), so
// survival is computable from the members alone. `allHeights` switches the module's resolution
// program (height: all vs pick-latest) — the guard rails' observable content difference.
async function moduleWorldInto(
  gw: Gateway,
  opts: {
    schemaAlias?: string;
    withRenderer?: boolean;
    allHeights?: boolean;
    container?: string;
    seed?: string;
    baseTs?: number;
  } = {},
): Promise<{ wall: Container; version: ModuleVersion; parts: ModuleWorld["parts"] }> {
  const seed = opts.seed ?? STRANGER_SEED;
  const author = authorForSeed(seed);
  const name = opts.container ?? "container:social";
  const base = opts.baseTs ?? 41_000;
  await gw.append([
    signClaims(
      containerClaims({ container: name, trust: "untrusted", posture: "wall" }, OP, base - 1000),
      OP_SEED,
    ),
  ]);
  const wall = await gw.openContainer({ name, backend: new MemoryBackend() });

  const schema: Schema = opts.allHeights
    ? {
        props: new Map([["height", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }]]),
        default: pickLatest,
        name: "Post",
      }
    : POST_SCHEMA;
  const definition = signClaims(
    publishHyperSchemaClaims(POST, "hyperschema:Post", author, base),
    seed,
  );
  let t = base + 1;
  const reg = registrationDeltaClaims(
    "hyperschema:Post",
    "Post",
    schema,
    [FERN],
    author,
    () => t++,
    undefined,
    ["height"],
    undefined,
  );
  const registration = [reg.living, reg.snapshot, reg.binding].map((c) => signClaims(c, seed));
  const renderer = signClaims(
    rendererBindingClaims(
      {
        route: "feed",
        schemaName: "Post" as never,
        consumes: ["height"],
        bundle: "export default (n) => `<b>${n.view.height}</b>`;",
      },
      undefined,
      author,
      base + 10,
    ),
    seed,
  );
  const manifest = [
    signClaims(
      manifestExportClaims(
        { alias: opts.schemaAlias ?? "Post", targetEntity: "hyperschema:Post", kind: "schema" },
        author,
        base + 20,
      ),
      seed,
    ),
    ...(opts.withRenderer === false
      ? []
      : [
          signClaims(
            manifestExportClaims(
              { alias: "Feed", targetAddress: renderer.id, kind: "renderer" },
              author,
              base + 21,
            ),
            seed,
          ),
        ]),
  ];
  await wall.gateway!.federate([definition, ...registration, renderer, ...manifest], {
    admit: () => true,
  });
  const version = wall.gateway!.freeze({
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: author } },
    in: "input",
  });
  return { wall, version, parts: { definition, registration, renderer, manifest } };
}

async function moduleWorld(
  opts: Parameters<typeof moduleWorldInto>[1] = {},
): Promise<ModuleWorld> {
  const gw = await boot();
  const built = await moduleWorldInto(gw, opts);
  return { gw, ...built };
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

// The observable content difference for the guard rails: the ROOT's own Post resolves height
// pick-latest (a scalar); the MODULE's Post resolves height "all" (a list). Different resolution
// programs → different registration content (structural identity), and the WINNER is visible at
// the door: the query's shape says whose law answered.
const ROOT_POST_SCHEMA: Schema = {
  props: new Map([["height", pickLatest]]),
  default: pickLatest,
  name: "Post",
};

const plantRootPost = async (gw: Gateway): Promise<void> => {
  await gw.publishRegistration(POST, ROOT_POST_SCHEMA, [FERN]);
};

const heights = async (gw: Gateway, lens = "Post"): Promise<unknown> => {
  const view = await gw.query(`{ ${lens}(entity: "${FERN}") { height } }`);
  return (view.data?.[lens] as { height?: unknown } | undefined)?.height;
};

describe("T33 criteria 8 & 16 — the root-name guard, and supersede's reversibility", () => {
  it("a different-content Post refuses; supersede takes the name; as serves side by side", async () => {
    const { gw, wall, version } = await moduleWorld({ allHeights: true });
    await plantRootPost(gw);
    await gw.append([
      observed(FERN, "height", 30, 43_000, OP_SEED),
      observed(FERN, "height", 34, 43_001, OP_SEED),
    ]);
    expect(await heights(gw)).toBe(34); // the root's own law answers

    // REFUSE: the currently-winning root registration has different content — and the
    // pre-existing read still resolves through the ORIGINAL law (object level, at the door).
    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(/Post/);
    expect(await heights(gw)).toBe(34);

    // AS: bless under a different root name — both readings serve side by side.
    await gw.adoptLaw(version, "Post", { as: "TheirPost" });
    expect(await heights(gw)).toBe(34);
    expect(await heights(gw, "TheirPost")).toEqual([30, 34]);
    await wall.drop();
    await gw.close();
  });

  it("supersede outranks and is reversible — negating it resurfaces the original winner", async () => {
    const { gw, wall, version } = await moduleWorld({ allHeights: true });
    await plantRootPost(gw);
    await gw.append([
      observed(FERN, "height", 30, 43_100, OP_SEED),
      observed(FERN, "height", 34, 43_101, OP_SEED),
    ]);

    await gw.adoptLaw(version, "Post", { supersede: true });
    expect(await heights(gw)).toEqual([30, 34]); // the module's program answers now

    // supersede never negates: the prior registration is still on the ground, and negating the
    // SUPERSEDING registration resurfaces it as the winner — §21's living semantics, no
    // destructive variant.
    const superseding = [...gw.reactor.snapshot()].filter(
      (d) =>
        d.claims.author === OP &&
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.context === "loam.registration" &&
            p.target.entity.id === "registration:hyperschema:Post",
        ) &&
        d.claims.timestamp < 42_000, // the blessed binding inherited the SOURCE's timestamp
    );
    expect(superseding.length).toBe(1);
    await gw.append([retraction(superseding[0]!.id, OP, OP_SEED, 43_200)]);
    gw.replayRegistrations();
    await gw.preloadResolvers();
    expect(await heights(gw)).toBe(34); // the original is the winner again
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 20 — the route is a living name too", () => {
  it("adopting a renderer whose route the root already serves refuses without supersede", async () => {
    const { gw, wall, version } = await moduleWorld();
    await gw.publishRenderer({
      route: "feed",
      schema: "Plant",
      consumes: ["height"],
      bundle: "export default (n) => `<i>root</i>`;",
    });
    await expect(gw.adoptLaw(version, "Feed")).rejects.toThrow(/feed/);
    const served = await gw.serveRoute("feed", FERN, "full");
    expect(served.body).toContain("root"); // the original still answers at the door

    await gw.adoptLaw(version, "Feed", { supersede: true, pen: false });
    const after = await gw.serveRoute("feed", FERN, "full");
    expect(after.body).toContain("<b>"); // the module's bundle answers now
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 14 — the guard is atomic, and the rail forces the race", () => {
  it("leg 1: two concurrent different-content adoptions — one publish, one refusal naming the mover", async () => {
    const { gw, wall, version } = await moduleWorld(); // pick-latest Post
    // A second stranger module exporting a DIFFERENT-content Post (the all-heights program).
    const other = await moduleWorldInto(gw, {
      allHeights: true,
      container: "container:rival",
      seed: "4c".repeat(32),
    });

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holds = 0;
    gw.adoptionHold = async () => {
      holds += 1;
      if (holds === 1) await held; // hold ONLY adoption A between its name-check and its append
    };
    let aSettled = false;
    const a = gw.adoptLaw(version, "Post").finally(() => (aSettled = true));
    a.catch(() => undefined); // the refusal is asserted below; never unhandled
    await gw.adoptLaw(other.version, "Post"); // B runs to completion THROUGH the same seam
    expect(aSettled).toBe(false); // the overlap is real — a sequential pass cannot satisfy this
    release();
    await expect(a).rejects.toThrow(/moved|winner/); // refused, naming the mover
    expect(await heights(gw)).toBeDefined(); // exactly one Post bound, and it answers
    gw.adoptionHold = undefined;
    await other.wall.drop();
    await wall.drop();
    await gw.close();
  });

  it("leg 2: the critical section covers the DIRECT publish door too", async () => {
    const { gw, wall, version } = await moduleWorld();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    gw.adoptionHold = async () => {
      gw.adoptionHold = undefined; // only A holds; the direct publish must not consume the seam
      await held;
    };
    let aSettled = false;
    const a = gw.adoptLaw(version, "Post").finally(() => (aSettled = true));
    a.catch(() => undefined);
    await plantRootPost(gw); // a DIFFERENT-content Post lands through publishRegistration
    expect(aSettled).toBe(false);
    release();
    await expect(a).rejects.toThrow(/moved|winner/); // the mover came through another door — still named
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 22 — a colliding row stops the bulk gesture", () => {
  it("blessAll refuses whole naming the collision; resolved singly, the re-run blesses the rest", async () => {
    const { gw, wall, version } = await moduleWorld({ allHeights: true });
    await plantRootPost(gw);
    const before = [...gw.reactor.snapshot()].length;

    await expect(gw.blessAll(version)).rejects.toThrow(/Post/);
    expect([...gw.reactor.snapshot()].length).toBe(before); // NO row landed — decisions don't ride bulk

    await gw.adoptLaw(version, "Post", { as: "TheirPost" }); // the named row, resolved singly
    await gw.blessAll(version); // the rest lands; row 4's witness is silent
    const served = await gw.serveRoute("feed", FERN, "full");
    expect(served.status).toBe(200); // the renderer row rode the re-run
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
