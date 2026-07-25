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
const POST_SCHEMA: Schema = {
  props: new Map([["height", pickLatest]]),
  default: pickLatest,
  name: "Post",
};

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

async function moduleWorld(opts: Parameters<typeof moduleWorldInto>[1] = {}): Promise<ModuleWorld> {
  const gw = await boot();
  const built = await moduleWorldInto(gw, opts);
  return { gw, ...built };
}

// The GraphQL door spells a lens's query field lower-camel (gql.ts): the store BINDS the lens
// "Post", the door answers at `post`. Every rail here names the lens and asks the door by this —
// spelling the lens straight into the query would make "the read fails" pass for the wrong reason
// (an unknown field), which is a hollow rail wearing an object-level assertion.
const field = (lens: string): string => lens.replace(/^[A-Z]/, (c) => c.toLowerCase());

const rootResolvesPost = async (gw: Gateway): Promise<boolean> => {
  try {
    const view = await gw.query(`{ ${field("Post")}(entity: "${FERN}") { height } }`);
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
        containerClaims(
          { container: "container:facts", trust: "untrusted", posture: "wall" },
          OP,
          42_000,
        ),
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
    const view = await wall.gateway!.query(`{ ${field("Plant")}(entity: "${FERN}") { height } }`);
    expect((view.data?.[field("Plant")] as { height?: unknown } | undefined)?.height).toBe(30);

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
    const view = await gw.query(`{ ${field("Post")}(entity: "${FERN}") { height } }`);
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
    const sourceTs = [parts.definition, ...parts.registration]
      .map((d) => d.claims.timestamp)
      .sort();
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
  const view = await gw.query(`{ ${field(lens)}(entity: "${FERN}") { height } }`);
  return (view.data?.[field(lens)] as { height?: unknown } | undefined)?.height;
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

// A second wave of module content for the version-bump rails: a Note schema and its manifest
// row, federated into the SAME wall, then re-frozen — social@7 to the first freeze's social@1.
async function bumpModule(
  wall: Container,
  opts: { seed?: string; base?: number; repointFeed?: boolean } = {},
): Promise<{ version: ModuleVersion; noteDefinition: Delta; renderer2?: Delta }> {
  const seed = opts.seed ?? STRANGER_SEED;
  const author = authorForSeed(seed);
  const base = opts.base ?? 44_000;
  const NOTE: HyperSchema = { name: "Note", alg: 1, body: PLANT_BODY };
  const NOTE_SCHEMA: Schema = {
    props: new Map([["tag", pickLatest]]),
    default: pickLatest,
    name: "Note",
  };
  const noteDefinition = signClaims(
    publishHyperSchemaClaims(NOTE, "hyperschema:Note", author, base),
    seed,
  );
  let t = base + 1;
  const reg = registrationDeltaClaims(
    "hyperschema:Note",
    "Note",
    NOTE_SCHEMA,
    [FERN],
    author,
    () => t++,
    undefined,
    undefined,
    undefined,
  );
  const batch: Delta[] = [
    noteDefinition,
    ...[reg.living, reg.snapshot, reg.binding].map((c) => signClaims(c, seed)),
    signClaims(
      manifestExportClaims(
        { alias: "Note", targetEntity: "hyperschema:Note", kind: "schema" },
        author,
        base + 20,
      ),
      seed,
    ),
  ];
  let renderer2: Delta | undefined;
  if (opts.repointFeed) {
    renderer2 = signClaims(
      rendererBindingClaims(
        {
          route: "feed",
          schemaName: "Post" as never,
          consumes: ["height"],
          bundle: "export default (n) => `<em>v2</em>`;",
        },
        undefined,
        author,
        base + 30,
      ),
      seed,
    );
    batch.push(
      renderer2,
      signClaims(
        manifestExportClaims(
          { alias: "Feed", targetAddress: renderer2.id, kind: "renderer" },
          author,
          base + 31,
        ),
        seed,
      ),
    );
  }
  await wall.gateway!.federate(batch, { admit: () => true });
  const version = wall.gateway!.freeze({
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: author } },
    in: "input",
  });
  return { version, noteDefinition, ...(renderer2 === undefined ? {} : { renderer2 }) };
}

describe("T33 criteria 5 & 6 — bless-all is enumeration, and a bump is a delta", () => {
  it("blessAll of the bumped version performs exactly the NEW bindings; unchanged rows witness", async () => {
    const { gw, wall, version } = await moduleWorld();
    await gw.blessAll(version); // social@1 wholesale: Post + Feed
    const lawBefore = [...gw.reactor.snapshot()].filter((d) => d.claims.author === OP).length;

    const bumped = await bumpModule(wall); // social@7 adds Note; Post and Feed unchanged
    const report = await gw.blessAll(bumped.version);
    expect(report.blessed).toContain("Note");
    expect(report.blessed).not.toContain("Post");
    expect(report.witnessed).toEqual(expect.arrayContaining(["Post", "Feed"]));
    // The unchanged rows were RECORDED, never re-published: the only new operator law is Note's.
    const lawAfter = [...gw.reactor.snapshot()].filter(
      (d) => d.claims.author === OP && d.claims.timestamp >= 44_000 && d.claims.timestamp < 44_020,
    );
    expect(lawAfter.length).toBe(4); // Note's definition + living + snapshot + binding
    expect(lawBefore).toBeGreaterThan(0);
    await wall.drop();
    await gw.close();
  });

  it("blessAll's ground is delta-identical to N sequential single adoptions", async () => {
    // Timestamp inheritance makes this assertable by IDENTITY: the same source rows blessed by
    // either gesture mint the very same operator-signed delta ids.
    const one = await moduleWorld();
    await one.gw.blessAll(one.version);
    const bulk = [...one.gw.reactor.snapshot()]
      .filter(
        (d) =>
          d.claims.author === OP && d.claims.timestamp >= 41_000 && d.claims.timestamp < 42_000,
      )
      .map((d) => d.id)
      .sort();
    await one.wall.drop();
    await one.gw.close();

    const two = await moduleWorld();
    await two.gw.adoptLaw(two.version, "Post");
    await two.gw.adoptLaw(two.version, "Feed");
    const single = [...two.gw.reactor.snapshot()]
      .filter(
        (d) =>
          d.claims.author === OP && d.claims.timestamp >= 41_000 && d.claims.timestamp < 42_000,
      )
      .map((d) => d.id)
      .sort();
    expect(bulk).toEqual(single);
    await two.wall.drop();
    await two.gw.close();
  });
});

describe("T33 criteria 9, 15 & 24 — the pen is a different key", () => {
  const PEN_SEED = "4d".repeat(32);
  const PEN = authorForSeed(PEN_SEED);

  async function penWorld(opts: { lyingKind?: boolean } = {}): Promise<ModuleWorld> {
    const gw = await boot();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:penned", trust: "untrusted", posture: "wall" },
          OP,
          45_000,
        ),
        OP_SEED,
      ),
    ]);
    const wall = await gw.openContainer({ name: "container:penned", backend: new MemoryBackend() });
    const definition = signClaims(
      publishHyperSchemaClaims(POST, "hyperschema:Post", STRANGER, 45_100),
      STRANGER_SEED,
    );
    let t = 45_101;
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
    const registration = [reg.living, reg.snapshot, reg.binding].map((c) =>
      signClaims(c, STRANGER_SEED),
    );
    const renderer = signClaims(
      rendererBindingClaims(
        {
          route: "penfeed",
          schemaName: "Post" as never,
          consumes: ["height"],
          bundle: "export default (n) => `<b>pen</b>`;",
          writable: ["height"],
          pen: PEN,
        },
        undefined,
        STRANGER,
        45_110,
      ),
      STRANGER_SEED,
    );
    const manifest = [
      signClaims(
        manifestExportClaims(
          { alias: "Post", targetEntity: "hyperschema:Post", kind: "schema" },
          STRANGER,
          45_120,
        ),
        STRANGER_SEED,
      ),
      signClaims(
        manifestExportClaims(
          // Criterion 15's lie: the pen-holding renderer declared as a harmless schema row.
          {
            alias: "PenFeed",
            targetAddress: renderer.id,
            kind: opts.lyingKind ? "schema" : "renderer",
          },
          STRANGER,
          45_121,
        ),
        STRANGER_SEED,
      ),
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

  it("a pen never rides the sugar: refused without the flag, named; proceeds with it", async () => {
    const { gw, wall, version } = await penWorld();
    await expect(gw.blessAll(version)).rejects.toThrow(/PenFeed|pen/);
    await gw.blessAll(version, { pen: true });
    const served = await gw.serveRoute("penfeed", FERN, "full");
    expect(served.status).toBe(200);
    await wall.drop();
    await gw.close();
  });

  it("a lying manifest cannot smuggle a pen — classification reads the bytes", async () => {
    const { gw, wall, version } = await penWorld({ lyingKind: true });
    await expect(gw.blessAll(version)).rejects.toThrow(/PenFeed|pen/); // the label said schema; the bytes say pen
    await wall.drop();
    await gw.close();
  });

  it("blessing the code never confers the pen: the first form-write refuses until a grant", async () => {
    const { gw, wall, version } = await penWorld();
    await gw.blessAll(version, { pen: true });
    // The renderer SERVES from the root…
    expect((await gw.serveRoute("penfeed", FERN, "full")).status).toBe(200);
    // …and its write path refuses: the pen is not provisioned here and holds no grant. Blessing
    // was one key; the pen is the other.
    const refused = await gw.writeRoute("penfeed", FERN, { height: 41 }, "full");
    expect(refused.status).toBeGreaterThanOrEqual(400);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criteria 10, 19 & 13 — re-points, dangling rows, and skew get eyes", () => {
  it("a re-pointed alias never rides silently; genuinely new rows in the same call proceed", async () => {
    const { gw, wall, version } = await moduleWorld();
    await gw.blessAll(version);
    const bumped = await bumpModule(wall, { repointFeed: true }); // Feed → a NEW bundle address

    const report = await gw.blessAll(bumped.version);
    expect(report.blessed).toContain("Note"); // the new row proceeded
    expect(report.refused.some((r: string) => /Feed/.test(r))).toBe(true); // the re-point did not
    expect((await gw.serveRoute("feed", FERN, "full")).body).toContain("<b>"); // still the OLD bundle

    await gw.blessAll(bumped.version, { repoints: { Feed: bumped.renderer2!.id } });
    expect((await gw.serveRoute("feed", FERN, "full")).body).toContain("v2"); // confirmed, re-pointed
    await wall.drop();
    await gw.close();
  });

  it("a dangling manifest row refuses the whole call; no partial adoption lands", async () => {
    const { gw, wall } = await moduleWorld();
    const dangling = signClaims(
      manifestExportClaims(
        { alias: "Ghost", targetAddress: "0".repeat(64), kind: "schema" },
        STRANGER,
        46_000,
      ),
      STRANGER_SEED,
    );
    await wall.gateway!.federate([dangling], { admit: () => true });
    const version = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });
    const before = [...gw.reactor.snapshot()].length;
    await expect(gw.blessAll(version)).rejects.toThrow(/Ghost/);
    expect([...gw.reactor.snapshot()].length).toBe(before); // a stranger's manifest gets no silent skips
    await wall.drop();
    await gw.close();
  });

  it("adopting across versions reports the skew; matching siblings stay silent", async () => {
    const { gw, wall, version } = await moduleWorld();
    const first = await gw.adoptLaw(version, "Post");
    expect(first.notes.filter((n: string) => /version/.test(n))).toEqual([]); // nothing to say yet

    const bumped = await bumpModule(wall);
    const second = await gw.adoptLaw(bumped.version, "Note");
    expect(second.notes.some((n: string) => /version/.test(n))).toBe(true); // sibling bound from @1
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criteria 11, 17, 18 & 26 — the ledger tells origination from exposure", () => {
  it("a witness is not an adoption, accumulates once, and the walk is positive", async () => {
    const { gw, wall, version, parts } = await moduleWorld();
    await gw.adoptLaw(version, "Post");

    // A SECOND module lists the very same Post definition (shared law, different shipper).
    const rivalSeed = "4e".repeat(32);
    const rival = authorForSeed(rivalSeed);
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:rival", trust: "untrusted", posture: "wall" },
          OP,
          47_000,
        ),
        OP_SEED,
      ),
    ]);
    const rivalWall = await gw.openContainer({
      name: "container:rival",
      backend: new MemoryBackend(),
    });
    await rivalWall.gateway!.federate(
      [
        parts.definition,
        ...parts.registration,
        signClaims(
          manifestExportClaims(
            { alias: "Post", targetEntity: "hyperschema:Post", kind: "schema" },
            rival,
            47_100,
          ),
          rivalSeed,
        ),
      ],
      { admit: () => true },
    );
    const rivalVersion = rivalWall.gateway!.freeze({
      op: "select",
      pred: {
        or: [
          { match: { field: "author", cmp: "eq", const: rival } },
          { match: { field: "author", cmp: "eq", const: STRANGER } },
        ],
      },
      in: "input",
    });

    await gw.adoptLaw(rivalVersion, "Post"); // already bound → witnessed, never adopted-from
    const trail = gw.lawAdoptions();
    const adopted = trail.filter((r) => r.kind === "adopted-from");
    const witnessed = trail.filter((r) => r.kind === "witnessed");
    expect(adopted.length).toBe(1);
    expect(witnessed.length).toBe(1);
    // Criterion 26: the walk is POSITIVE — fields present, and `from` joins the T32 table.
    expect(adopted[0]!.from).toBe("container:social");
    expect(witnessed[0]!.from).toBe("container:rival");
    expect(typeof adopted[0]!.moduleVersion).toBe("string");
    expect(typeof adopted[0]!.at).toBe("number");

    // Criterion 18: the identical witness is minted ONCE — run it twice more, count the ground.
    await gw.adoptLaw(rivalVersion, "Post");
    const countAfterTwo = [...gw.reactor.snapshot()].length;
    await gw.adoptLaw(rivalVersion, "Post");
    expect([...gw.reactor.snapshot()].length).toBe(countAfterTwo);
    expect(gw.lawAdoptions().filter((r) => r.kind === "witnessed").length).toBe(1);
    await rivalWall.drop();
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criteria 12 & 21 — lawFrom is exposure arithmetic, unioned across versions", () => {
  it("reports the surviving bound intersection: negated absent, directly-published present", async () => {
    const { gw, wall, version, parts } = await moduleWorld();
    await gw.blessAll(version); // Post + Feed bound

    // Negate the Feed blessing (the operator withdraws that binding).
    const blessedFeed = [...gw.reactor.snapshot()].find(
      (d) => d.claims.author === OP && d.claims.timestamp === parts.renderer.claims.timestamp,
    )!;
    await gw.append([retraction(blessedFeed.id, OP, OP_SEED, 48_000)]);
    gw.replayRegistrations();

    // Directly publish a third row's identical content: the bumped Note, straight through the
    // ordinary door — no adoption record exists for it, and lawFrom must still report it.
    const bumped = await bumpModule(wall);
    await gw.publishRegistration(
      { name: "Note", alg: 1, body: PLANT_BODY },
      { props: new Map([["tag", pickLatest]]), default: pickLatest, name: "Note" },
      [FERN],
    );

    const exposed = gw.lawFrom([bumped.version]).map((r) => r.alias ?? r.address);
    expect(exposed).toContain("Post");
    expect(exposed).toContain("Note"); // exposure, not provenance
    expect(exposed).not.toContain("Feed"); // negated binding is out of the intersection
    await wall.drop();
    await gw.close();
  });

  it("unions across manifest versions; the narrowing form does not", async () => {
    const { gw, wall, version } = await moduleWorld(); // @1 manifests Post + Feed
    await gw.adoptLaw(version, "Post");
    // @7 keeps Note only — Post dropped from the newer manifest, still bound here.
    const wall2 = await gw
      .openContainer({
        name: "container:social-v7",
        backend: new MemoryBackend(),
      })
      .catch(async () => {
        await gw.append([
          signClaims(
            containerClaims(
              { container: "container:social-v7", trust: "untrusted", posture: "wall" },
              OP,
              49_000,
            ),
            OP_SEED,
          ),
        ]);
        return gw.openContainer({ name: "container:social-v7", backend: new MemoryBackend() });
      });
    const bumped = await bumpModule(wall2, { base: 49_100 });

    const union = gw.lawFrom([version, bumped.version]).map((r) => r.alias ?? r.address);
    expect(union).toContain("Post"); // adopted from @1, dropped by @7 — the union still reports it
    const narrowed = gw.lawFrom([bumped.version]).map((r) => r.alias ?? r.address);
    expect(narrowed).not.toContain("Post");
    await wall2.drop();
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criteria 23 & 25 — one door, and survival at the source", () => {
  it("promote() still refuses law, and its remedy names the door that exists", async () => {
    const { gw, wall, parts } = await moduleWorld();
    await expect(gw.promote(wall.gateway!, parts.definition.id)).rejects.toThrow(
      /promotion refused/,
    );
    await expect(gw.promote(wall.gateway!, parts.definition.id)).rejects.toThrow(/adoptLaw/);
    await wall.drop();
    await gw.close();
  });

  it("a row struck in its own container refuses adoption naming the strike", async () => {
    const { gw, wall, parts } = await moduleWorld();
    // The stranger withdraws their own definition INSIDE the module; the freeze carries the
    // strike (the closure rides Gateway.freeze), so the version itself knows.
    const strike = retraction(parts.definition.id, STRANGER, STRANGER_SEED, 50_000);
    await wall.gateway!.federate([strike], { admit: () => true });
    const version = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });
    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(/struck|retract/i);
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
