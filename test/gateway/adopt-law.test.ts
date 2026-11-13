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
import { type Container } from "../../src/gateway/container.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import {
  lensOf,
  registrationDeltaClaims,
  type LensName,
  type ResolverSpecs,
} from "../../src/gateway/registration.js";
import { rendererBindingClaims } from "../../src/gateway/renderers.js";
import { CTX_MANIFEST, manifestExportClaims } from "../../src/gateway/adopt-vocab.js";
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

const byGround = (a: Delta, b: Delta): number =>
  a.claims.timestamp - b.claims.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const shapeOf = (d: Delta): unknown =>
  d.claims.pointers.map((p) => ({ role: p.role, ...p.target }));

const staged = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 400 && !cond(); i += 1) await new Promise((r) => setTimeout(r, 5));
  if (!cond()) throw new Error(`the race never staged: ${what}`);
};

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
  readonly parts: {
    readonly definition: Delta;
    readonly registration: readonly Delta[];
    readonly renderer: Delta;
    readonly manifest: readonly Delta[];
  };
}

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
      containerClaims(
        { container: name, trust: "untrusted", posture: "separate" },
        OP,
        base - 1000,
      ),
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

const field = (lens: string): string => lens.replace(/^[A-Z]/, (c) => c.toLowerCase());

const rootResolvesPost = async (gw: Gateway): Promise<boolean> => {
  try {
    const view = await gw.query(`{ ${field("Post")}(entity: "${FERN}") { height } }`);
    return view.errors === undefined;
  } catch {
    return false;
  }
};

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
          { container: "container:facts", trust: "untrusted", posture: "separate" },
          OP,
          42_000,
        ),
        OP_SEED,
      ),
    ]);
    const wall = await gw.openContainer({ name: "container:facts", backend: new MemoryBackend() });
    const fact = observed(FERN, "height", 30, 42_100, STRANGER_SEED);
    const blob = signClaims(
      {
        timestamp: 42_150,
        validFrom: 42_150,
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

    const view = await wall.gateway!.query(`{ ${field("Plant")}(entity: "${FERN}") { height } }`);
    expect((view.data?.[field("Plant")] as { height?: unknown } | undefined)?.height).toBe(30);

    const served = wall.gateway!.serveBytes(bytesRefOf(BLOB), L("Plant"), FERN, "full");
    expect(served.status).toBe(200);
    expect([...served.body]).toEqual([...BLOB]);
    expect(served.contentType).toBe("image/png");

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
    expect(await rootResolvesPost(gw)).toBe(false);

    await gw.adoptLaw(version, "Post");

    const view = await gw.query(`{ ${field("Post")}(entity: "${FERN}") { height } }`);
    expect(view.errors).toBeUndefined();
    const root = await gw.serveRoute("feed", FERN, "full");
    expect(root.status).toBe(404);
    expect(gw.renderers().some((r) => r.route === "feed")).toBe(false);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 2 — the ordinary publish path, with the source's timestamps", () => {
  it("adoption deltas mirror a direct publish modulo timestamps, and erase-then-re-bless refuses", async () => {
    const { gw, wall, version, parts } = await moduleWorld();
    await gw.adoptLaw(version, "Post");

    const blessed = [...gw.reactor.snapshot()].filter(
      (d) => d.claims.author === OP && d.claims.timestamp >= 41_000 && d.claims.timestamp <= 41_009,
    );
    expect(blessed.length).toBe(4);
    const sourceTs = [parts.definition, ...parts.registration]
      .map((d) => d.claims.timestamp)
      .sort();
    expect(blessed.map((d) => d.claims.timestamp).sort()).toEqual(sourceTs);

    const mirror = await boot();
    await mirror.publishRegistration(
      POST,
      POST_SCHEMA,
      [FERN],
      undefined,
      "hyperschema:Post",
      undefined,
      ["height"],
      undefined,
    );
    const direct = [...mirror.reactor.snapshot()]
      .filter((d) => d.claims.author === OP && d.claims.timestamp > 100_000)
      .sort(byGround);
    expect(direct.length).toBe(4);
    expect([...blessed].sort(byGround).map(shapeOf)).toEqual(direct.map(shapeOf));
    await mirror.close();

    const target = blessed.find((d) => d.claims.timestamp === parts.definition.claims.timestamp)!;
    await gw.erase(target.id, { reason: "the operator withdrew the blessing" });
    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(/erased|erasure/);
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

    await gw.adoptLaw(version, "Post");

    expect(gw.materializationFor("Post")).toBe(matBefore);
    const after = [...gw.reactor.snapshot()].length;
    expect(after - countBefore).toBeLessThanOrEqual(1);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 7 — a blessing crosses a wall only by re-signing", () => {
  it("root-signed twins land; the module's own deltas and its own reading are untouched", async () => {
    const { gw, wall, version, parts } = await moduleWorld();
    const own = wall.gateway!.signer!;
    await wall.gateway!.append([
      own.sign({ ...observed(FERN, "height", 7, 40_500, OP_SEED).claims, author: own.author }),
    ]);
    const moduleGroundBefore = [...wall.gateway!.reactor.snapshot()].map((d) => d.id).sort();
    const moduleReadBefore = await wall.gateway!.query(
      `{ ${field("Plant")}(entity: "${FERN}") { height } }`,
    );
    expect((moduleReadBefore.data?.[field("Plant")] as { height?: unknown })?.height).toBe(7);

    await gw.adoptLaw(version, "Post");

    const moduleGroundAfter = [...wall.gateway!.reactor.snapshot()].map((d) => d.id).sort();
    expect(moduleGroundAfter).toEqual(moduleGroundBefore);
    expect(gw.reactor.get(parts.definition.id)).toBeUndefined();
    expect(wall.gateway!.reactor.get(parts.definition.id)).toBeDefined();
    const moduleReadAfter = await wall.gateway!.query(
      `{ ${field("Plant")}(entity: "${FERN}") { height } }`,
    );
    expect(moduleReadAfter).toEqual(moduleReadBefore);
    expect(wall.gateway!.renderers().length).toBe(0);
    expect((await wall.gateway!.serveRoute("feed", FERN, "full")).status).toBe(404);
    await wall.drop();
    await gw.close();
  });
});

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
    expect(await heights(gw)).toBe(34);

    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(
      /already answered here by DIFFERENT-content law/,
    );
    await expect(gw.adoptLaw(version, "Post")).rejects.toThrow(/the name "Post"/);
    expect(await heights(gw)).toBe(34);

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
    expect(await heights(gw)).toEqual([30, 34]);

    const superseding = [...gw.reactor.snapshot()].filter(
      (d) =>
        d.claims.author === OP &&
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.context === "loam.registration" &&
            p.target.entity.id === "registration:hyperschema:Post",
        ) &&
        d.claims.timestamp < 42_000,
    );
    expect(superseding.length).toBe(1);
    await gw.append([retraction(superseding[0]!.id, OP, OP_SEED, 43_200)]);
    gw.replayRegistrations();
    await gw.preloadResolvers();
    expect(await heights(gw)).toBe(34);
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
    expect(served.body).toContain("root");

    await gw.adoptLaw(version, "Feed", { supersede: true, pen: false });
    const after = await gw.serveRoute("feed", FERN, "full");
    expect(after.body).toContain("<b>");
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criterion 14 — the guard is atomic, and the rail forces the race", () => {
  it("leg 1: two concurrent different-content adoptions — one publish, one refusal naming the mover", async () => {
    const { gw, wall, version } = await moduleWorld();
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
      if (holds === 1) await held;
    };
    let aSettled = false;
    const a = gw.adoptLaw(version, "Post").finally(() => (aSettled = true));
    a.catch(() => undefined);
    await gw.adoptLaw(other.version, "Post");
    expect(aSettled).toBe(false);
    release();
    await expect(a).rejects.toThrow(/moved|winner/);
    expect(gw.registrationVersions().filter((v) => lensOf(v) === "Post").length).toBe(1);
    expect(await heights(gw)).toBeDefined();
    gw.adoptionHold = undefined;
    await other.wall.drop();
    await wall.drop();
    await gw.close();
  });

  it("leg 1b: released TOGETHER, past their checks, they still resolve to exactly one publish", async () => {
    const { gw, wall, version } = await moduleWorld();
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
      gw.adoptionHold = undefined;
      await held;
    };
    let aSettled = false;
    const a = gw.adoptLaw(version, "Post").finally(() => (aSettled = true));
    a.catch(() => undefined);
    await plantRootPost(gw);
    expect(aSettled).toBe(false);
    release();
    await expect(a).rejects.toThrow(/moved|winner/);
    await wall.drop();
    await gw.close();
  });

  it("leg 3: it is ONE queue, and both direct doors chain on it", async () => {
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
    const { gw, wall } = await moduleWorld({ allHeights: true });
    const bumped = await bumpModule(wall);
    await plantRootPost(gw);
    const before = [...gw.reactor.snapshot()].length;

    await expect(gw.blessAll(bumped.version)).rejects.toThrow(/NOTHING was blessed/);
    await expect(gw.blessAll(bumped.version)).rejects.toThrow(/a collision is a per-row DECISION/);
    expect([...gw.reactor.snapshot()].length).toBe(before);
    expect(gw.registered.some((r) => lensOf(r) === "Note")).toBe(false);

    await gw.adoptLaw(bumped.version, "Post", { as: "TheirPost" });
    const report = await gw.blessAll(bumped.version);
    expect(report.blessed).toEqual(expect.arrayContaining(["Feed", "Note"]));
    expect(report.witnessed).toContain("Post");
    const served = await gw.serveRoute("feed", FERN, "full");
    expect(served.status).toBe(200);
    await wall.drop();
    await gw.close();
  });
});

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
    await gw.blessAll(version);
    const lawBefore = [...gw.reactor.snapshot()].filter((d) => d.claims.author === OP).length;

    const bumped = await bumpModule(wall);
    const report = await gw.blessAll(bumped.version);
    expect(report.blessed).toContain("Note");
    expect(report.blessed).not.toContain("Post");
    expect(report.witnessed).toEqual(expect.arrayContaining(["Post", "Feed"]));
    const lawAfter = [...gw.reactor.snapshot()].filter(
      (d) => d.claims.author === OP && d.claims.timestamp >= 44_000 && d.claims.timestamp < 44_020,
    );
    expect(lawAfter.length).toBe(4);
    expect(lawBefore).toBeGreaterThan(0);
    await wall.drop();
    await gw.close();
  });

  it("blessAll's ground is delta-identical to N sequential single adoptions", async () => {
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
    const gw = await boot(opts.provisionPen === true ? { pens: { [PEN]: PEN_SEED } } : undefined);
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:penned", trust: "untrusted", posture: "separate" },
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
    await expect(gw.blessAll(version)).rejects.toThrow(/PenFeed|pen/);
    await wall.drop();
    await gw.close();
  });

  it("blessing the code never confers the pen: the first form-write refuses for lack of STANDING, then a grant opens it", async () => {
    const { gw, wall, version } = await penWorld({ provisionPen: true });
    await gw.blessAll(version, { pen: true });
    expect((await gw.serveRoute("penfeed", FERN, "full")).status).toBe(200);

    const refused = await gw.writeRoute("penfeed", FERN, { height: 41 }, "full");
    expect(refused.status).toBe(403);
    expect(refused.body).not.toContain("read-only");
    expect(refused.body).not.toContain("not provisioned");

    await gw.append([signClaims(grantClaims(STORE_ENTITY, PEN, "write", OP, 45_500), OP_SEED)]);
    const wrote = await gw.writeRoute("penfeed", FERN, { height: 41 }, "full");
    expect(wrote.status).toBe(200);
    const landed = [...gw.reactor.snapshot()].find(
      (d) =>
        d.claims.author === PEN &&
        d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === 41),
    );
    expect(landed).toBeDefined();
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criteria 10, 19 & 13 — re-points, dangling rows, and skew get eyes", () => {
  it("a re-pointed alias never rides silently; genuinely new rows in the same call proceed", async () => {
    const { gw, wall, version } = await moduleWorld();
    await gw.blessAll(version);
    const bumped = await bumpModule(wall, { repointFeed: true });

    const report = await gw.blessAll(bumped.version);
    expect(report.blessed).toContain("Note");
    expect(report.refused.some((r: string) => /Feed/.test(r))).toBe(true);
    expect((await gw.serveRoute("feed", FERN, "full")).body).toContain("<b>");

    await gw.blessAll(bumped.version, { repoints: { Feed: bumped.renderer2!.id } });
    expect((await gw.serveRoute("feed", FERN, "full")).body).toContain("v2");
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
    expect([...gw.reactor.snapshot()].length).toBe(before);
    await wall.drop();
    await gw.close();
  });

  it("adopting across versions reports the skew; matching siblings stay silent", async () => {
    const { gw, wall, version } = await moduleWorld();
    const first = await gw.adoptLaw(version, "Post");
    expect(first.notes.filter((n: string) => /version/.test(n))).toEqual([]);

    const bumped = await bumpModule(wall);
    const second = await gw.adoptLaw(bumped.version, "Note");
    expect(second.notes.some((n: string) => /version/.test(n))).toBe(true);
    await wall.drop();
    await gw.close();
  });
});

describe("T33 criteria 11, 17, 18 & 26 — the ledger tells origination from exposure", () => {
  it("a witness is not an adoption, accumulates once, and the walk is positive", async () => {
    const { gw, wall, version, parts } = await moduleWorld();
    await gw.adoptLaw(version, "Post");

    const rivalSeed = "4e".repeat(32);
    const rival = authorForSeed(rivalSeed);
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:rival", trust: "untrusted", posture: "separate" },
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

    await gw.adoptLaw(rivalVersion, "Post");
    const trail = gw.lawAdoptions();
    const adopted = trail.filter((r) => r.kind === "adopted-from");
    const witnessed = trail.filter((r) => r.kind === "witnessed");
    expect(adopted.length).toBe(1);
    expect(witnessed.length).toBe(1);
    expect(adopted[0]!.from).toBe("container:social");
    expect(witnessed[0]!.from).toBe("container:rival");
    expect(typeof adopted[0]!.moduleVersion).toBe("string");
    expect(typeof adopted[0]!.at).toBe("number");

    expect(gw.lawFrom([version]).map((r) => r.alias)).toContain("Post");
    expect(gw.lawFrom([rivalVersion]).map((r) => r.alias)).toContain("Post");
    expect(gw.registrationVersions().filter((v) => lensOf(v) === "Post").length).toBe(1);

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
    await gw.blessAll(version);

    const blessedFeed = [...gw.reactor.snapshot()].find(
      (d) => d.claims.author === OP && d.claims.timestamp === parts.renderer.claims.timestamp,
    )!;
    await gw.append([retraction(blessedFeed.id, OP, OP_SEED, 48_000)]);
    gw.replayRegistrations();

    const bumped = await bumpModule(wall);
    await gw.publishRegistration(
      { name: "Note", alg: 1, body: PLANT_BODY },
      { props: new Map([["tag", pickLatest]]), default: pickLatest, name: "Note" },
      [FERN],
    );

    const exposed = gw.lawFrom([bumped.version]).map((r) => r.alias ?? r.address);
    expect(exposed).toContain("Post");
    expect(exposed).toContain("Note");
    expect(exposed).not.toContain("Feed");
    expect(exposed).not.toContain("Plant");
    expect(gw.registered.some((r) => lensOf(r) === "Plant")).toBe(true);
    await wall.drop();
    await gw.close();
  });

  it("unions across manifest versions; the narrowing form does not", async () => {
    const { gw, wall, version } = await moduleWorld();
    await gw.adoptLaw(version, "Post");
    const wall2 = await gw
      .openContainer({
        name: "container:social-v7",
        backend: new MemoryBackend(),
      })
      .catch(async () => {
        await gw.append([
          signClaims(
            containerClaims(
              { container: "container:social-v7", trust: "untrusted", posture: "separate" },
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
    expect(union).toContain("Post");
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

async function resolverTrapWorld(): Promise<{
  gw: Gateway;
  wall: Container;
  version: ModuleVersion;
}> {
  const gw = await boot();
  await gw.append([
    signClaims(
      containerClaims(
        { container: "container:trap", trust: "untrusted", posture: "separate" },
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
    expect(failure!.message).toMatch(/refused the remainder at "Beta"/);
    expect(failure!.message).toMatch(/LANDED: Alpha/);
    expect(failure!.message).toMatch(/no such field in the schema/);
    expect(gw.registered.some((r) => lensOf(r) === "Alpha")).toBe(true);
    expect(gw.registered.some((r) => lensOf(r) === "Beta")).toBe(false);
    expect((await gw.query(`{ ${field("Alpha")}(entity: "${FERN}") { height } }`)).errors).toBe(
      undefined,
    );
    const again = await gw.blessAll(version).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(again!.message).toMatch(/refused the remainder at "Beta"/);
    expect(again!.message).toMatch(/LANDED: nothing/);
    await wall.drop();
    await gw.close();
  });
});

const BY_ROLE_BODY: Term = parseTerm({
  op: "group",
  key: "byRole",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
});

async function captureWorld(
  defTs: number,
): Promise<{ gw: Gateway; wall: Container; version: ModuleVersion }> {
  const gw = await boot();
  await gw.append([
    signClaims(
      containerClaims(
        { container: "container:capture", trust: "untrusted", posture: "separate" },
        OP,
        50_000,
      ),
      OP_SEED,
    ),
  ]);
  const wall = await gw.openContainer({ name: "container:capture", backend: new MemoryBackend() });
  const definition = signClaims(
    {
      ...publishHyperSchemaClaims(
        { name: "Post", alg: 1, body: BY_ROLE_BODY },
        "hyperschema:Plant",
        STRANGER,
        defTs,
      ),
      validFrom: 0,
    },
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
    expect(await heights(gw, "Plant")).toBe(30);

    await expect(gw.adoptLaw(version, "Innocent")).rejects.toThrow(/hyperschema:Plant/);
    await expect(gw.adoptLaw(version, "Innocent")).rejects.toThrow(
      /A module may not name one of your entities/,
    );
    await expect(gw.blessAll(version)).rejects.toThrow(/NOTHING was blessed/);

    expect(await heights(gw, "Plant")).toBe(30);
    expect(gw.registered.some((r) => lensOf(r) === "Innocent")).toBe(false);
    expect(gw.lawAdoptions().length).toBe(0);
    await wall.drop();
    await gw.close();
  };

  it("a HIGHER stranger timestamp — the body that would win the entity race — is refused", async () => {
    await capture(9_000_000_000_000);
  });

  it("a LOWER stranger timestamp — the mirror, where the blessing silently binds nothing — is refused", async () => {
    await capture(0);
  });
});

describe("T33 criterion 25 × H1 — WHOSE strike withdraws a module's law", () => {
  it("a FOREIGN negation of the author's own retraction cannot revive it", async () => {
    const { gw, wall, parts } = await moduleWorld();
    const strike = retraction(parts.definition.id, STRANGER, STRANGER_SEED, 50_000);
    const foreignSeed = "4f".repeat(32);
    const revive = retraction(strike.id, authorForSeed(foreignSeed), foreignSeed, 50_001);
    await wall.gateway!.federate([strike, revive], { admit: () => true });
    const version = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });
    expect(version.members.some((d) => d.id === revive.id)).toBe(true);
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
    expect(version.members.some((d) => d.id === hostile.id)).toBe(true);
    await gw.adoptLaw(version, "Post");
    expect(gw.registered.some((r) => lensOf(r) === "Post")).toBe(true);
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

    const strike = retraction(parts.definition.id, STRANGER, STRANGER_SEED, 51_000);
    await wall.gateway!.federate([strike], { admit: () => true });
    const after = wall.gateway!.freeze({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
      in: "input",
    });
    expect(gw.registered.some((r) => lensOf(r) === "Post")).toBe(true);

    const row = gw.lawFrom([after]).find((r) => r.alias === "Post");
    expect(row).toBeDefined();
    expect(row!.withdrawnAtSource).toBe(true);
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
    expect((await ask()).status).toBe(200);

    await gw.adoptLaw(version, "Post", { supersede: true });

    expect(gw.withdrawnRegistrations().some((w) => w.deltaId === incumbent)).toBe(true);
    expect((await ask()).status).toBe(410);
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
    expect(gw.lawAdoptions().length).toBe(0);
    const before = [...gw.reactor.snapshot()].length;

    await gw.adoptLaw(version, "Post");

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
    const row = { targetEntity: "hyperschema:Post", kind: "schema" as const };
    expect(() => manifestExportClaims({ ...row, alias: "" }, STRANGER, 60_000)).toThrow(/alias/);
    expect(() => manifestExportClaims({ ...row, alias: "Po\u0000st" }, STRANGER, 60_001)).toThrow(
      /NUL/,
    );
    expect(() => manifestExportClaims({ ...row, alias: "Post" }, STRANGER, 60_002)).not.toThrow();
  });
});
