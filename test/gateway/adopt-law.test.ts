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
//
// NAMED GAP — §28.1's effectiveness attenuation is NOT built, so no rail here may claim it. The
// spec's "a loaded module RUNS, fully, inside its container: its law binds there" needs a container
// gateway whose LAWFUL slice is the module's own authorship; `openWall` gives the wall the PRIMARY's
// operator seed (§24.1), and lawfulness is authorship (§7), so a stranger's schema and renderer are
// inert inside the wall exactly as they are outside it. Criterion 7 therefore asserts what is true —
// the module's ground and its reading are UNTOUCHED by a blessing — and states the missing leg
// rather than implying it. The rail that would close it: a container whose lawful slice is the
// module's, asserted by the module's own door serving its own renderer at 200.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  parseTerm,
  publishHyperSchemaClaims,
  signClaims,
  type Delta,
  type HyperSchema,
  type Policy,
  type Schema,
  type Term,
} from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { bytesRefOf } from "../../src/gateway/bytes.js";
import { isAdoption } from "../../src/gateway/adopt.js";
import { containerClaims, type Container } from "../../src/gateway/container.js";
import {
  lensOf,
  registrationDeltaClaims,
  type LensName,
  type ResolverSpecs,
} from "../../src/gateway/registration.js";
import { rendererBindingClaims } from "../../src/gateway/renderers.js";
import { CTX_MANIFEST, manifestExportClaims } from "../../src/gateway/adopt-law.js";
import type { ModuleVersion } from "../../src/gateway/container-identity.js";
import { handleRest } from "../../src/surface/rest.js";
import { retraction } from "./narrowing.js";
import { FERN, observed, PLANT_BODY } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";

const OP_SEED = "4a".repeat(32);
const OP = authorForSeed(OP_SEED);
const STRANGER_SEED = "4b".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);
const L = (n: string): LensName => n as LensName;

// Ground order, the tie-break every latest-wins reader here uses.
const byGround = (a: Delta, b: Delta): number =>
  a.claims.timestamp - b.claims.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// A delta's SHAPE: its pointer list, role by role, in order. Timestamps live nowhere in it — which
// is what makes a comparison over this exactly "modulo timestamps" (criterion 2's named method).
const shapeOf = (d: Delta): unknown =>
  d.claims.pointers.map((p) => ({ role: p.role, ...p.target }));

// Let the event loop turn until a staged condition holds, and FAIL LOUDLY if it never does — a race
// rail that quietly proceeds on an unstaged race is a rail that proves nothing.
const staged = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 400 && !cond(); i += 1) await new Promise((r) => setTimeout(r, 5));
  if (!cond()) throw new Error(`the race never staged: ${what}`);
};

// The stranger's law: their own Post shape (reusing the Plant body so views resolve without a
// bespoke hyperschema fixture — the NAME is what collides or doesn't, per criterion 8).
const POST: HyperSchema = { name: "Post", alg: 1, body: PLANT_BODY };
const POST_SCHEMA: Schema = {
  props: new Map([["height", pickLatest]]),
  default: pickLatest,
  name: "Post",
};

const boot = (opts?: { pens?: Record<string, string> }): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    opts,
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

// A blob the facts module exports, and a reading that NAMES a bytes field so the byte-door has a
// view to re-resolve through (§23.7's proof-of-read: the lens+entity is the authorization).
const BLOB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const AVATAR_SCHEMA: Schema = {
  props: new Map<string, Policy>([
    ["height", pickLatest],
    ["avatar", pickLatest],
  ]),
  default: pickLatest,
};

describe("T33 criterion 3 — facts never need it", () => {
  it("a facts-only module reads AND serves its blob without any adoption; adoptLaw refuses 'exports no law'", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: AVATAR_SCHEMA,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
      }),
    );
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
    // The blob: a stranger's bytes leaf in the `avatar` bucket, cited by the manifest at its CONTENT
    // ADDRESS — §27.8's stable identifier for a byte-blob, which is not a delta id.
    const blob = signClaims(
      {
        timestamp: 42_150,
        author: STRANGER,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "avatar" } } },
          { role: "value", target: { kind: "bytes", mime: "image/png", value: BLOB } },
        ],
      },
      STRANGER_SEED,
    );
    const manifestRows = [
      signClaims(
        manifestExportClaims(
          { alias: "Fern", targetEntity: FERN, kind: "entity" },
          STRANGER,
          42_200,
        ),
        STRANGER_SEED,
      ),
      signClaims(
        manifestExportClaims(
          { alias: "Avatar", targetAddress: bytesRefOf(BLOB), kind: "bytes" },
          STRANGER,
          42_201,
        ),
        STRANGER_SEED,
      ),
    ];
    await wall.gateway!.federate([fact, blob, ...manifestRows], { admit: () => true });
    const version = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });

    // The exported entity resolves with ZERO adoptions performed — through the operator's own
    // seeded lens in the module's container (facts bind nothing; nothing needs blessing).
    const view = await wall.gateway!.query(`{ ${field("Plant")}(entity: "${FERN}") { height } }`);
    expect((view.data?.[field("Plant")] as { height?: unknown } | undefined)?.height).toBe(30);

    // …and so does the BYTE DOOR: 200, and the correct bytes, still with zero adoptions.
    const served = wall.gateway!.serveBytes(bytesRefOf(BLOB), L("Plant"), FERN, "full");
    expect(served.status).toBe(200);
    expect([...served.body]).toEqual([...BLOB]);
    expect(served.contentType).toBe("image/png");

    // Both rows are FACTS, and a blessing has nothing to do: the blob's address must classify as a
    // blob (its bytes are right there in the members), never as a crafted dangling row.
    await expect(gw.adoptLaw(version, "Fern")).rejects.toThrow(/exports no law/);
    await expect(gw.adoptLaw(version, "Avatar")).rejects.toThrow(/exports no law/);
    await expect(gw.blessAll(version)).rejects.toThrow(/exports no law/);
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
    // The sibling export did not ride: the root serves no /feed route, at the door...
    const root = await gw.serveRoute("feed", FERN, "full");
    expect(root.status).toBe(404);
    // ...and nothing about the renderer landed in the root's ground either (both levels).
    expect(gw.renderers().some((r) => r.route === "feed")).toBe(false);
    // The module's own door is criterion 7's leg — and see this file's header: it 404s there too,
    // because §28.1's attenuation is unbuilt, so no rail claims a 200 nobody implemented.
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

    // THE NAMED VERIFICATION — "diffing the two grounds delta-for-delta modulo timestamps". A count
    // and a timestamp set pin neither the SHAPE nor the payloads: dropping `roots`, `writable`,
    // `mutations`, or `resolvers` from the blessing leaves exactly four deltas at exactly those
    // timestamps while silently narrowing the law. So a SECOND store publishes the same schema
    // through the ordinary door, and the two grounds are compared pointer-for-pointer, in order.
    // Timestamps appear nowhere in a pointer list — that is precisely what "modulo timestamps"
    // means here, so nothing is excused by construction.
    const mirror = await boot();
    await mirror.publishRegistration(
      POST,
      POST_SCHEMA,
      [FERN],
      undefined,
      "hyperschema:Post",
      undefined,
      ["height"], // the module's own writable — the field a shape-blind rail lets a blessing drop
      undefined,
    );
    const direct = [...mirror.reactor.snapshot()]
      .filter((d) => d.claims.author === OP && d.claims.timestamp > 100_000)
      .sort(byGround);
    expect(direct.length).toBe(4); // the ordinary door mints exactly the four this blessing did
    expect([...blessed].sort(byGround).map(shapeOf)).toEqual(direct.map(shapeOf));
    await mirror.close();

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
    await wall.gateway!.append([observed(FERN, "height", 7, 40_500, OP_SEED)]);
    const moduleGroundBefore = [...wall.gateway!.reactor.snapshot()].map((d) => d.id).sort();
    // OBJECT LEVEL at the module's own door, before the blessing.
    const moduleReadBefore = await wall.gateway!.query(
      `{ ${field("Plant")}(entity: "${FERN}") { height } }`,
    );
    expect((moduleReadBefore.data?.[field("Plant")] as { height?: unknown })?.height).toBe(7);

    await gw.adoptLaw(version, "Post");

    // The module's deltas are untouched (adoption-merge re-signs; it never rewrites the source)…
    const moduleGroundAfter = [...wall.gateway!.reactor.snapshot()].map((d) => d.id).sort();
    expect(moduleGroundAfter).toEqual(moduleGroundBefore);
    // …the root holds OPERATOR-signed law, never the stranger's bytes as law…
    expect(gw.reactor.get(parts.definition.id)).toBeUndefined();
    // …the wall's ground still carries the stranger's definition, surviving and its own…
    expect(wall.gateway!.reactor.get(parts.definition.id)).toBeDefined();
    // …and OBJECT LEVEL, the module's own door answers exactly as it did: a blessing crosses the
    // wall one way, and the crossing changes nothing on the far side.
    const moduleReadAfter = await wall.gateway!.query(
      `{ ${field("Plant")}(entity: "${FERN}") { height } }`,
    );
    expect(moduleReadAfter).toEqual(moduleReadBefore);
    // The honest shape of "the module still runs its own law" today (see this file's header): the
    // stranger's renderer is inert inside the wall too, because the wall shares the primary's
    // OPERATOR (§24.1) and lawfulness is authorship (§7). Asserted so the gap is a tested fact
    // rather than a comment — when §28.1's attenuation lands, THIS is the line that must flip.
    expect(wall.gateway!.renderers().length).toBe(0);
    expect((await wall.gateway!.serveRoute("feed", FERN, "full")).status).toBe(404);
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
    // Matched on the GUARD'S OWN sentence, not on the lens name: `/Post/` would be satisfied by any
    // error that happens to mention the lens, including a guard firing for the wrong condition.
    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(
      /already answered here by DIFFERENT-content law/,
    );
    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(/the name "Post"/);
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
    await expect(gw.adoptLaw(version, "Feed")).rejects.toThrow(
      /the route "feed" is already answered here by DIFFERENT-content law/,
    );
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
    // Exactly ONE Post bound, COUNTED. `toBeDefined()` on a query result counts nothing: two
    // registrations for one lens still answer, and latest-wins would hide the second entirely.
    expect(gw.registrationVersions().filter((v) => lensOf(v) === "Post").length).toBe(1);
    expect(await heights(gw)).toBeDefined(); // …and the one that bound answers at the door
    gw.adoptionHold = undefined;
    await other.wall.drop();
    await wall.drop();
    await gw.close();
  });

  it("leg 1b: released TOGETHER, past their checks, they still resolve to exactly one publish", async () => {
    // The shape leg 1 cannot force: BOTH adoptions park past their name-check, observing the same
    // (empty) winner, and are released in the same turn. Nothing is serialized by the fixture — only
    // the door's own critical section stands between them, and without it both re-checks see nothing
    // bound and BOTH append, which is the "never two publishes" the spec forbids.
    const { gw, wall, version } = await moduleWorld(); // pick-latest Post
    const other = await moduleWorldInto(gw, {
      allHeights: true,
      container: "container:rival",
      seed: "4c".repeat(32),
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let arrived = 0;
    gw.adoptionHold = async () => {
      arrived += 1;
      await gate;
    };
    const a = gw.adoptLaw(version, "Post");
    const b = gw.adoptLaw(other.version, "Post");
    a.catch(() => undefined);
    b.catch(() => undefined);
    await staged(() => arrived === 2, "both adoptions past their name-check, neither appended");
    expect(gw.registrationVersions().filter((v) => lensOf(v) === "Post").length).toBe(0);

    release();
    const settled = await Promise.allSettled([a, b]);
    expect(settled.filter((s) => s.status === "fulfilled").length).toBe(1);
    expect(settled.filter((s) => s.status === "rejected").length).toBe(1);
    const refusal = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(String((refusal.reason as Error).message)).toMatch(/MOVED between/);
    // The ground agrees with the report: one publish, not two.
    expect(gw.registrationVersions().filter((v) => lensOf(v) === "Post").length).toBe(1);
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

  it("leg 3: it is ONE queue, and both direct doors chain on it", async () => {
    // Leg 2 shows the adoption NOTICES a mover from another door — which its post-hold re-check does
    // unaided. What binds the shared critical section itself is this: block the queue, and a DIRECT
    // publish cannot proceed. Nothing else in the repo asserts `livingNames`, so without this leg the
    // seam could be deleted from both publish doors and every other rail would stay green.
    const { gw, wall } = await moduleWorld();
    let release!: () => void;
    gw.livingNames = new Promise<void>((r) => (release = r));

    let registered = false;
    let rendered = false;
    const reg = gw.publishRegistration(POST, ROOT_POST_SCHEMA, [FERN]).then(() => {
      registered = true;
    });
    const rend = gw
      .publishRenderer({
        route: "held",
        schema: "Plant",
        consumes: ["height"],
        bundle: "export default () => `<i>held</i>`;",
      })
      .then(() => {
        rendered = true;
      });
    // Give both every chance to run. They are WAITING on the shared queue, not on their own work.
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(registered).toBe(false);
    expect(rendered).toBe(false);

    release();
    await Promise.all([reg, rend]);
    expect(registered).toBe(true);
    expect(rendered).toBe(true);
    expect(gw.registered.some((r) => lensOf(r) === "Post")).toBe(true);
    expect((await gw.serveRoute("held", FERN, "full")).status).toBe(200);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 22 — a colliding row stops the bulk gesture", () => {
  it("blessAll refuses the WHOLE call even with blessable rows ahead of the collision; the re-run blesses the rest", async () => {
    // The collider must sit BEHIND blessable rows, or "refuses the whole call" is indistinguishable
    // from "refuses at the first row" — the spec says row 4 deliberately. Rows are enumerated in
    // alias order, so the manifest is Feed, Note, Post with the collision on "Post", LAST: two rows
    // were fully planned before the refusal, and the ground must still be untouched afterwards.
    const { gw, wall } = await moduleWorld({ allHeights: true });
    const bumped = await bumpModule(wall); // adds the Note row — blessable, and ahead of Post
    await plantRootPost(gw); // the root's own different-content Post: the collision
    const before = [...gw.reactor.snapshot()].length;

    // Matched on the pre-flight's OWN verdict rather than on a lens name that any error may mention.
    await expect(gw.blessAll(bumped.version)).rejects.toThrow(/NOTHING was blessed/);
    await expect(gw.blessAll(bumped.version)).rejects.toThrow(/a collision is a per-row DECISION/);
    expect([...gw.reactor.snapshot()].length).toBe(before); // NO row landed — decisions don't ride bulk
    expect(gw.registered.some((r) => lensOf(r) === "Note")).toBe(false); // not even the blessable one

    await gw.adoptLaw(bumped.version, "Post", { as: "TheirPost" }); // the named row, resolved singly
    const report = await gw.blessAll(bumped.version); // the rest lands; the named row witnesses
    expect(report.blessed).toEqual(expect.arrayContaining(["Feed", "Note"]));
    expect(report.witnessed).toContain("Post");
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
    // The COUNT first: if timestamp inheritance ever stops, BOTH filters select nothing and
    // `expect([]).toEqual([])` passes while proving the opposite of what it claims. Seven deltas —
    // Post's definition + living + snapshot + binding, Feed's renderer binding, and the two
    // provenance records, which inherit their manifest row's timestamp for the same H4 reason.
    expect(bulk.length).toBe(7);
    expect(bulk).toEqual(single);
    await two.wall.drop();
    await two.gw.close();
  });
});

describe("T33 criteria 9, 15 & 24 — the pen is a different key", () => {
  const PEN_SEED = "4d".repeat(32);
  const PEN = authorForSeed(PEN_SEED);

  async function penWorld(
    opts: { lyingKind?: boolean; provisionPen?: boolean } = {},
  ): Promise<ModuleWorld> {
    // `provisionPen` puts the pen's SEED in config — CUSTODY, the operator's own configuration, and
    // deliberately NOT authorization: §6's two keys stay two.
    const gw = await boot(opts.provisionPen === true ? { pens: { [PEN]: PEN_SEED } } : undefined);
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

  it("blessing the code never confers the pen: the first form-write refuses for lack of STANDING, then a grant opens it", async () => {
    const { gw, wall, version } = await penWorld({ provisionPen: true });
    await gw.blessAll(version, { pen: true });
    // The renderer SERVES from the root…
    expect((await gw.serveRoute("penfeed", FERN, "full")).status).toBe(200);

    // …and its write path refuses with 403 — the pen holds no write GRANT. The status is asserted
    // EXACTLY, because `>= 400` conflates this with writeRoute's 405 "this route is read-only": a
    // blessing that silently stripped `writable`/`pen` off the binding would answer 405 and satisfy
    // a loose assertion while having deleted the entire write surface it claims to have blessed.
    const refused = await gw.writeRoute("penfeed", FERN, { height: 41 }, "full");
    expect(refused.status).toBe(403);
    expect(refused.body).not.toContain("read-only");
    expect(refused.body).not.toContain("not provisioned"); // custody is present; standing is not

    // …until a SEPARATE, deliberate operator grant lands. Then it writes — and the delta is signed
    // by the PEN, which is what proves the blessed binding really carries the pen it was flagged for.
    await gw.append([signClaims(grantClaims(STORE_ENTITY, PEN, "write", OP, 45_500), OP_SEED)]);
    const wrote = await gw.writeRoute("penfeed", FERN, { height: 41 }, "full");
    expect(wrote.status).toBe(200);
    const landed = [...gw.reactor.snapshot()].find(
      (d) =>
        d.claims.author === PEN &&
        d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === 41),
    );
    expect(landed).toBeDefined(); // the pen signed it — never the operator, never the caller
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

    // Criterion 17, PERFORMED rather than described: the shared Post is bound ONCE and reports as
    // exposure under BOTH modules — "am I exposed through M?" is set membership, not origination —
    // while the record kinds above still say which module originated it.
    expect(gw.lawFrom([version]).map((r) => r.alias)).toContain("Post");
    expect(gw.lawFrom([rivalVersion]).map((r) => r.alias)).toContain("Post");
    expect(gw.registrationVersions().filter((v) => lensOf(v) === "Post").length).toBe(1);

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
    // The INTERSECTION half, without which every assertion above is satisfied by an implementation
    // that simply lists everything the root binds: the genesis `Plant` is bound throughout this
    // world and appears in NO manifest, so it must not be reported as exposure through this module.
    expect(exposed).not.toContain("Plant");
    expect(gw.registered.some((r) => lensOf(r) === "Plant")).toBe(true); // …and it really is bound
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

// A module whose SECOND schema row passes every pre-flight check and dies at the PUBLISH door: its
// registration declares a resolver over a field its own schema does not have. `parseResolvers`
// validates shape only, so classification accepts it; `publishRegistration` refuses field-existence.
// That is the one failure the pre-flight cannot hoist, and therefore the only honest fixture for
// criterion 6's second clause.
async function resolverTrapWorld(): Promise<{
  gw: Gateway;
  wall: Container;
  version: ModuleVersion;
}> {
  const gw = await boot();
  await gw.append([
    signClaims(
      containerClaims(
        { container: "container:trap", trust: "untrusted", posture: "wall" },
        OP,
        50_500,
      ),
      OP_SEED,
    ),
  ]);
  const wall = await gw.openContainer({ name: "container:trap", backend: new MemoryBackend() });
  const rowFor = (name: string, base: number, resolvers?: ResolverSpecs): Delta[] => {
    const hs: HyperSchema = { name, alg: 1, body: PLANT_BODY };
    let t = base + 1;
    const reg = registrationDeltaClaims(
      `hyperschema:${name}`,
      name,
      { props: new Map([["height", pickLatest]]), default: pickLatest, name },
      [FERN],
      STRANGER,
      () => t++,
      undefined,
      undefined,
      resolvers,
    );
    return [
      signClaims(
        publishHyperSchemaClaims(hs, `hyperschema:${name}`, STRANGER, base),
        STRANGER_SEED,
      ),
      ...[reg.living, reg.snapshot, reg.binding].map((c) => signClaims(c, STRANGER_SEED)),
      signClaims(
        manifestExportClaims(
          { alias: name, targetEntity: `hyperschema:${name}`, kind: "schema" },
          STRANGER,
          base + 10,
        ),
        STRANGER_SEED,
      ),
    ];
  };
  await wall.gateway!.federate(
    [
      ...rowFor("Alpha", 51_000),
      ...rowFor("Beta", 52_000, {
        ghost: { rung: "a", type: "string", code: "export default () => 'x';" },
      }),
    ],
    { admit: () => true },
  );
  const version = wall.gateway!.freeze({
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
    in: "input",
  });
  return { gw, wall, version };
}

describe("T33 criterion 6 (second clause) — a mid-flight failure refuses the REMAINDER and reports what landed", () => {
  it("Alpha lands, Beta refuses at the publish door, and the message names both", async () => {
    const { gw, wall, version } = await resolverTrapWorld();
    const failure = await gw.blessAll(version).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(failure).toBeDefined();
    // Aliases are enumerated in order, so Alpha is blessed before Beta is attempted. The pre-flight
    // cannot hoist this one — field existence needs the schema the publish door holds — so the
    // contract here is the OTHER half of §27.8's split: refuse the remainder LOUDLY, and say what
    // landed, because a silent half-install is the failure this clause exists to prevent.
    expect(failure!.message).toMatch(/refused the remainder at "Beta"/);
    expect(failure!.message).toMatch(/LANDED: Alpha/);
    expect(failure!.message).toMatch(/no such field in the schema/); // the proximate cause, not a guess
    // The report is TRUE at both levels: Alpha binds and serves, Beta binds nothing.
    expect(gw.registered.some((r) => lensOf(r) === "Alpha")).toBe(true);
    expect(gw.registered.some((r) => lensOf(r) === "Beta")).toBe(false);
    expect((await gw.query(`{ ${field("Alpha")}(entity: "${FERN}") { height } }`)).errors).toBe(
      undefined,
    );
    // Re-running IS the recovery: what landed witnesses silently, and the broken row still refuses.
    const again = await gw.blessAll(version).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(again!.message).toMatch(/refused the remainder at "Beta"/);
    expect(again!.message).toMatch(/LANDED: nothing/); // Alpha did not re-publish; it witnessed
    await wall.drop();
    await gw.close();
  });
});

// A gather body that buckets by ROLE instead of by target context. Under it `height` is not a bucket
// at all, so a lens resolving through it answers ABSENT where the operator's own body answers 30 —
// which is what makes an entity capture observable at the door rather than only in a registry.
const BY_ROLE_BODY: Term = parseTerm({
  op: "group",
  key: "byRole",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
});

// The capture attempt: a definition at the OPERATOR'S OWN entity `hyperschema:Plant`, under a NEW
// program name (so the publish door's rival-body trial, which keys on the program, passes) and a FREE
// lens name (so the living-name guard, which keys on the lens, passes). `defTs` decides whether the
// stranger's body wins or loses the latest-wins race at that entity — both directions are attacks.
async function captureWorld(
  defTs: number,
): Promise<{ gw: Gateway; wall: Container; version: ModuleVersion }> {
  const gw = await boot();
  await gw.append([
    signClaims(
      containerClaims(
        { container: "container:capture", trust: "untrusted", posture: "wall" },
        OP,
        50_000,
      ),
      OP_SEED,
    ),
  ]);
  const wall = await gw.openContainer({ name: "container:capture", backend: new MemoryBackend() });
  const definition = signClaims(
    publishHyperSchemaClaims(
      { name: "Post", alg: 1, body: BY_ROLE_BODY },
      "hyperschema:Plant",
      STRANGER,
      defTs,
    ),
    STRANGER_SEED,
  );
  let t = 50_100;
  const reg = registrationDeltaClaims(
    "hyperschema:Plant",
    "Innocent",
    { props: new Map([["height", pickLatest]]), default: pickLatest, name: "Innocent" },
    [FERN],
    STRANGER,
    () => t++,
    undefined,
    undefined,
    undefined,
  );
  await wall.gateway!.federate(
    [
      definition,
      ...[reg.living, reg.snapshot, reg.binding].map((c) => signClaims(c, STRANGER_SEED)),
      signClaims(
        manifestExportClaims(
          { alias: "Innocent", targetEntity: "hyperschema:Plant", kind: "schema" },
          STRANGER,
          50_200,
        ),
        STRANGER_SEED,
      ),
    ],
    { admit: () => true },
  );
  const version = wall.gateway!.freeze({
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
    in: "input",
  });
  return { gw, wall, version };
}

describe("T33 §21 — the guard defends the ENTITY too, not only the living name", () => {
  const capture = async (defTs: number): Promise<void> => {
    const { gw, wall, version } = await captureWorld(defTs);
    await gw.append([observed(FERN, "height", 30, 50_900, OP_SEED)]);
    expect(await heights(gw, "Plant")).toBe(30); // the operator's own body answers

    // The row asks to land an OPERATOR-SIGNED definition at the operator's own definition entity.
    // Neither existing guard sees it: the program name is new, the lens name is free.
    await expect(gw.adoptLaw(version, "Innocent")).rejects.toThrow(/hyperschema:Plant/);
    await expect(gw.adoptLaw(version, "Innocent")).rejects.toThrow(
      /A module may not name one of your entities/,
    );
    await expect(gw.blessAll(version)).rejects.toThrow(/NOTHING was blessed/);

    // OBJECT LEVEL, through the operator's OWN lens: still their own gather program. Under the
    // stranger's by-role body this read answers undefined, so a captured Plant cannot pass here.
    expect(await heights(gw, "Plant")).toBe(30);
    expect(gw.registered.some((r) => lensOf(r) === "Innocent")).toBe(false);
    expect(gw.lawAdoptions().length).toBe(0); // and no provenance was minted for a refused blessing
    await wall.drop();
    await gw.close();
  };

  it("a HIGHER stranger timestamp — the body that would win the entity race — is refused", async () => {
    // 9e12 is past any wall clock, so `loadHyperSchema`'s latest-wins would hand the operator's own
    // Plant lens the stranger's gather body. This leg is what the entity guard exists for.
    await capture(9_000_000_000_000);
  });

  it("a LOWER stranger timestamp — the mirror, where the blessing silently binds nothing — is refused", async () => {
    // Genesis published the operator's Plant definition at timestamp 1, so a stranger definition at 0
    // LOSES the race: the blessing would persist, `publishRegistration` would report bound (it checks
    // (entity, lens) and never the body), and the lens would resolve through the operator's body —
    // provenance over law the store did not bind (H7). The entity guard refuses it here; if that
    // guard were removed, the post-publish address check is what still catches this direction.
    await capture(0);
  });
});

describe("T33 criterion 25 × H1 — WHOSE strike withdraws a module's law", () => {
  it("a FOREIGN negation of the author's own retraction cannot revive it", async () => {
    const { gw, wall, parts } = await moduleWorld();
    // The shipper takes their own law back…
    const strike = retraction(parts.definition.id, STRANGER, STRANGER_SEED, 50_000);
    // …and ANY other author negates that retraction. `withNegationClosure` is transitive and
    // author-blind — that is its job — so BOTH land in the frozen members under a single-author
    // freeze term. Unscoped, the algebra reads this as a revival and the blessing re-speaks law its
    // author withdrew; scoped, a foreigner's word about somebody else's strike counts for nothing.
    const foreignSeed = "4f".repeat(32);
    const revive = retraction(strike.id, authorForSeed(foreignSeed), foreignSeed, 50_001);
    await wall.gateway!.federate([strike, revive], { admit: () => true });
    const version = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });
    expect(version.members.some((d) => d.id === revive.id)).toBe(true); // the closure really admits it
    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(/struck|retract/i);
    expect(gw.registered.some((r) => lensOf(r) === "Post")).toBe(false);
    await wall.drop();
    await gw.close();
  });

  it("a HOSTILE co-tenant's strike cannot block a lawful adoption", async () => {
    const { gw, wall, parts } = await moduleWorld();
    const hostileSeed = "5a".repeat(32);
    const hostile = retraction(
      parts.definition.id,
      authorForSeed(hostileSeed),
      hostileSeed,
      50_100,
    );
    await wall.gateway!.federate([hostile], { admit: () => true });
    const version = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });
    expect(version.members.some((d) => d.id === hostile.id)).toBe(true); // it IS in the members…
    await gw.adoptLaw(version, "Post"); // …and it withdraws nothing
    expect(gw.registered.some((r) => lensOf(r) === "Post")).toBe(true);
    // The shipper's OWN strike still works, on the very same law — the scope narrows who may speak,
    // never whether a withdrawal is honored.
    const own = retraction(parts.definition.id, STRANGER, STRANGER_SEED, 50_200);
    await wall.gateway!.federate([own], { admit: () => true });
    const after = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });
    await expect(gw.adoptLaw(after, "Post")).rejects.toThrow(/struck|retract/i);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 12 × H9 — lawFrom must not go blind when the upstream withdraws", () => {
  it("a row its author retracted upstream is still reported, FLAGGED — never dropped", async () => {
    const { gw, wall, version, parts } = await moduleWorld();
    await gw.adoptLaw(version, "Post");
    expect(gw.lawFrom([version]).map((r) => r.alias)).toContain("Post");

    // The shipper withdraws the law INSIDE their container, after the blessing. Nothing about the
    // root changed: the blessed twin is operator-signed, still bound, still serving.
    const strike = retraction(parts.definition.id, STRANGER, STRANGER_SEED, 51_000);
    await wall.gateway!.federate([strike], { admit: () => true });
    const after = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });
    expect(gw.registered.some((r) => lensOf(r) === "Post")).toBe(true);

    // "Am I exposed through this module?" must answer YES here, and say the author withdrew it.
    // Classifying for SURVIVAL made the row unclassifiable and the query answered "not exposed" —
    // the safe-sounding word at the one moment the honest one is "yes, and look at this".
    const row = gw.lawFrom([after]).find((r) => r.alias === "Post");
    expect(row).toBeDefined();
    expect(row!.withdrawnAtSource).toBe(true);
    // The BLESSING still refuses it — survival is the blessing's question, exposure is lawFrom's.
    await expect(gw.adoptLaw(after, "Post")).rejects.toThrow(/struck|retract/i);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 §17 — supersede's negation is read as WITHDRAWAL at the version door", () => {
  it("the incumbent's own hash goes 200 → 410, a named consequence of the strike riding the binding", async () => {
    const { gw, wall, version } = await moduleWorld({ allHeights: true });
    await plantRootPost(gw);
    await gw.append([
      observed(FERN, "height", 30, 53_000, OP_SEED),
      observed(FERN, "height", 34, 53_001, OP_SEED),
    ]);
    const incumbent = gw.registrationVersions().find((v) => lensOf(v) === "Post")!.deltaId;
    const ask = (): Promise<{ status: number }> =>
      handleRest(gw, "full", "GET", [`@${incumbent}`, "Post", FERN], undefined, OP_SEED);
    expect((await ask()).status).toBe(200); // the operator's own registration, served by hash

    await gw.adoptLaw(version, "Post", { supersede: true });

    // `supersede` carries its negation ON the blessed binding — the only shape in which ONE strike
    // reverses ONE blessing (see adopt-law.ts's header). The cost, stated and tested rather than
    // discovered: `survivingCandidates` files a struck registration into the WITHDRAWN list, which
    // is the sole source of §17's 410, so the operator's own live hash now answers "withdrawn by the
    // operator" though the operator performed no §14 act. Bounded to the full door — the anonymous
    // door pins by deltaId and fails closed either way.
    expect(gw.withdrawnRegistrations().some((w) => w.deltaId === incumbent)).toBe(true);
    expect((await ask()).status).toBe(410);
    // And the takeover still holds at the door: the module's program is what answers now.
    expect(await heights(gw)).toEqual([30, 34]);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 18 × §14 — a struck provenance record stays struck", () => {
  it("re-adopting mints no fresh id, so the operator's retraction is never stranded", async () => {
    const { gw, wall, version } = await moduleWorld();
    await gw.adoptLaw(version, "Post");
    expect(gw.lawAdoptions().length).toBe(1);

    const rec = [...gw.reactor.snapshot()].find(
      (d) => d.claims.author === OP && isAdoption(d.claims),
    )!;
    await gw.append([retraction(rec.id, OP, OP_SEED, 52_000)]);
    expect(gw.lawAdoptions().length).toBe(0); // the operator withdrew the provenance
    const before = [...gw.reactor.snapshot()].length;

    await gw.adoptLaw(version, "Post"); // already bound → the witness path

    // A wall-clock `at` would mint a FRESH id here: the record would reappear in the trail while the
    // retraction sat pointing at an id nobody mints again. Inheriting the manifest row's timestamp
    // re-mints the SAME id, so the re-append is a no-op the standing strike still covers.
    expect(gw.lawAdoptions().length).toBe(0);
    expect([...gw.reactor.snapshot()].length).toBe(before);
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

  it("a malformed alias refuses — EACH shape alone, not only both together", () => {
    // The mutation gate's surviving mutant was `alias === "" && alias.includes(NUL)`: with `&&`,
    // an empty alias alone passes and a NUL alias alone passes, and no rail noticed. Each shape
    // gets its own leg, because a conjunction is satisfied by neither.
    const row = { targetEntity: "hyperschema:Post", kind: "schema" as const };
    expect(() => manifestExportClaims({ ...row, alias: "" }, STRANGER, 60_000)).toThrow(/alias/);
    expect(() => manifestExportClaims({ ...row, alias: "Po\u0000st" }, STRANGER, 60_001)).toThrow(
      /NUL/,
    );
    // The positive leg, so the refusals cannot be satisfied by rejecting every alias.
    expect(() => manifestExportClaims({ ...row, alias: "Post" }, STRANGER, 60_002)).not.toThrow();
  });
});
