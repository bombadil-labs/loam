import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HYPER_SCHEMA_SCHEMA,
  Reactor,
  authorForSeed,
  evalTerm,
  makeNegationClaims,
  parseTerm,
  publishHyperSchemaClaims,
  publishSchemaClaims,
  signClaims,
  type Delta,
  type HyperSchema,
  type Schema,
} from "@bombadil/rhizomatic";
import { manifestExportClaims } from "../../src/gateway/adopt-vocab.js";
import { freezeMembers, type ModuleVersion } from "../../src/gateway/container-identity.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import type { Ground } from "../../src/gateway/ground.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { lawfulScopeAt, lawfulSnapshot } from "../../src/gateway/lawful.js";
import { selectReceivingSnapshot } from "../../src/gateway/receive-snapshot.js";
import {
  lensOf,
  readRegistrationVersions,
  readRegistrations,
  readWithdrawnRegistrations,
  registrationDeltaClaims,
  versionedSchemaEntityFor,
} from "../../src/gateway/registration.js";
import { withStamp } from "../../src/gateway/stamp.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import {
  PLANT,
  PLANT_POLICY,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
  pickLatest,
} from "./fixtures.js";

const SEED = "c4".repeat(32);
const OP = authorForSeed(SEED);
const UNRELATED = 1000;
const PLANT_ENTITY = "hyperschema:Plant";
const FAR = 9e15;

const OLDEST: Schema = {
  ...PLANT_POLICY,
  props: new Map([
    ...PLANT_POLICY.props,
    ["height", { kind: "pick", order: { kind: "byTimestamp", dir: "asc" } }],
  ]),
};
const WEED: HyperSchema = { ...PLANT, name: "Weed" };
const SHIPPER_SEED = "5d".repeat(32);
const SHIPPER = authorForSeed(SHIPPER_SEED);
const POST: HyperSchema = { ...PLANT, name: "Post" };
const OTHER_BODY = parseTerm({
  op: "group",
  key: "byRole",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
const homes: Gateway[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const gw of homes.splice(0)) await gw.close();
});

async function home(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  homes.push(gw);
  await gw.append(governedBootstrap(SEED));
  await gw.append(garden);
  return gw;
}
const evolve = (gw: Gateway) =>
  gw.publishRegistration(PLANT, OLDEST, [FERN], undefined, undefined, undefined, [
    ...PLANT_WRITABLE,
  ]);
const bystanders = (gw: Gateway, count: number) =>
  count === 0
    ? Promise.resolve()
    : gw.append(
        Array.from({ length: count }, (_, n) =>
          observed(`plant:other-${n}`, "height", n, 1000 + n, GARDENER_SEED),
        ),
      );
const defined = (gw: Gateway, schema: HyperSchema, entity: string, seed = SEED): Delta =>
  signClaims(
    withStamp(gw.stamp(authorForSeed(seed)), (t) =>
      publishHyperSchemaClaims(schema, entity, authorForSeed(seed), t),
    ),
    seed,
  );
async function strike(gw: Gateway, id: string, seed = SEED, timestamp = FAR): Promise<Delta> {
  const now = gw.validityNow();
  const negation = signClaims(
    { ...makeNegationClaims(authorForSeed(seed), timestamp, id), validFrom: now },
    seed,
  );
  await gw.append([negation]);
  gw.replayRegistrations();
  return negation;
}
const filedAt = (gw: Gateway, entity: string): Delta[] =>
  gw.reactor
    .byTarget(entity)
    .map((id) => gw.reactor.get(id)!)
    .filter(
      (d) =>
        d.claims.author === OP &&
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.id === entity &&
            p.target.entity.context === "definition",
        ),
    )
    .sort((a, b) => a.claims.timestamp - b.claims.timestamp);

let modules = 0;
async function moduleAt(gw: Gateway, entity: string, name: string): Promise<ModuleVersion> {
  const container = `container:module-${modules++}`;
  await gw.append([
    signClaims(
      withStamp(gw.stamp(OP), (t) =>
        containerClaims({ container, trust: "untrusted", posture: "separate" }, OP, t),
      ),
      SEED,
    ),
  ]);
  const wall = await gw.openContainer({ name: container, backend: new MemoryBackend() });
  let t = 41_000;
  const reg = registrationDeltaClaims(
    entity,
    name,
    { props: new Map([["height", pickLatest]]), default: pickLatest, name },
    [FERN],
    SHIPPER,
    () => t++,
    undefined,
    ["height"],
  );
  await wall.gateway!.federate(
    [
      signClaims(
        publishHyperSchemaClaims({ ...POST, name }, entity, SHIPPER, 40_999),
        SHIPPER_SEED,
      ),
      ...[reg.living, reg.snapshot, reg.binding].map((c) => signClaims(c, SHIPPER_SEED)),
      signClaims(
        manifestExportClaims(
          { alias: name, targetEntity: entity, kind: "schema" },
          SHIPPER,
          41_100,
        ),
        SHIPPER_SEED,
      ),
    ],
    { admit: () => true },
  );
  return wall.gateway!.freeze({
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: SHIPPER } },
    in: "input",
  });
}
const serves = (gw: Gateway, lens: string): boolean =>
  gw.registered.some((r) => lensOf(r) === lens);

const registered = (gw: Gateway) =>
  readRegistrations(gw.reactor, gw.validityNow(), OP).filter((r) => lensOf(r) === "Plant");
const versions = (gw: Gateway) =>
  readRegistrationVersions(gw.reactor, gw.validityNow(), OP).filter((v) => lensOf(v) === "Plant");
const servedHeight = (gw: Gateway) => gw.resolvedNode("Plant", FERN).view["height"];
const oldestFirst = (s: Schema) => {
  const height = s.props.get("height");
  return height?.kind === "pick" && height.order.kind === "byTimestamp" && height.order.dir;
};

const ACCESSES = [
  "get",
  "targets",
  "negators",
  "byTarget",
  "negationsOf",
  "snapshot",
  "arrivalLog",
] as const;
type Accesses = Record<(typeof ACCESSES)[number], number>;
async function accesses(gw: Gateway, read: () => unknown): Promise<Accesses> {
  const spies = ACCESSES.map((m) => [m, vi.spyOn(gw.reactor, m)] as const);
  await read();
  const counts = Object.fromEntries(spies.map(([m, s]) => [m, s.mock.calls.length]));
  vi.restoreAllMocks();
  return counts as Accesses;
}
async function costOf(
  prepare: (gw: Gateway) => Promise<() => unknown>,
): Promise<{ small: Accesses; large: Accesses }> {
  const out: Accesses[] = [];
  for (const count of [0, UNRELATED]) {
    const gw = await home();
    const read = await prepare(gw);
    await bystanders(gw, count);
    out.push(await accesses(gw, read));
  }
  return { small: out[0]!, large: out[1]! };
}

describe("COST: a definition read by name opens no whole-store door", () => {
  it("lawfulScopeAt reads the index only, the same with 0 and with 1000 unrelated facts", async () => {
    const cost = await costOf(async (gw) => {
      await evolve(gw);
      await strike(gw, filedAt(gw, PLANT_ENTITY)[0]!.id);
      return () =>
        expect(lawfulScopeAt(gw.reactor, gw.validityNow(), PLANT_ENTITY, OP).size).toBe(5);
    });
    expect(cost.small.snapshot).toBe(0);
    expect(cost.small.arrivalLog).toBe(0);
    expect(cost.small.byTarget).toBe(1);
    expect(cost.large).toEqual(cost.small);
  }, 120_000);

  it("Gateway.loadHyperSchema proves a definition with no walk of the store", async () => {
    const cost = await costOf((gw) => {
      const definition = defined(gw, WEED, "hyperschema:Weed");
      return Promise.resolve(async () =>
        expect((await gw.loadHyperSchema([definition], "hyperschema:Weed")).name).toBe("Weed"),
      );
    });
    expect(cost.small.snapshot).toBe(0);
    expect(cost.small.byTarget).toBeGreaterThan(0);
    expect(cost.large).toEqual(cost.small);
  }, 120_000);

  it("adoptLaw asks for the incumbent with no walk of its own, and no more with 1000 unrelated facts", async () => {
    const out: Accesses[] = [];
    for (const count of [0, UNRELATED]) {
      const gw = await home();
      const version = await moduleAt(gw, "hyperschema:Post", "Post");
      await bystanders(gw, count);
      out.push(
        await accesses(gw, async () => {
          await gw.adoptLaw(version, "Post");
        }),
      );
      expect(serves(gw, "Post")).toBe(true);
    }
    expect(out[0]!.snapshot).toBeLessThanOrEqual(11);
    expect(out[0]!.byTarget).toBeGreaterThan(0);
    expect(out[1]).toEqual(out[0]);
  }, 120_000);

  const readers: [string, (gw: Gateway) => unknown][] = [
    ["readRegistrations", (gw) => expect(registered(gw)).toHaveLength(1)],
    ["readRegistrationVersions", (gw) => expect(versions(gw)).toHaveLength(2)],
    [
      "readWithdrawnRegistrations",
      (gw) => expect(readWithdrawnRegistrations(gw.reactor, gw.validityNow(), OP)).toHaveLength(1),
    ],
  ];
  for (const [name, read] of readers) {
    it(`${name} walks the store at most once, and its other accesses do not grow`, async () => {
      const cost = await costOf(async (gw) => {
        await evolve(gw);
        await evolve(gw);
        await strike(gw, versions(gw)[2]!.deltaId);
        return () => read(gw);
      });
      expect(cost.small.snapshot).toBeLessThanOrEqual(1);
      expect(cost.small.arrivalLog).toBe(0);
      expect(cost.small.byTarget).toBeGreaterThan(0);
      expect(cost.large).toEqual(cost.small);
    }, 120_000);
  }

  it("a receiving snapshot pins its two definitions with no walk beyond the candidates walk", () => {
    const author = authorForSeed(GARDENER_SEED);
    const claims = registrationDeltaClaims(
      PLANT_ENTITY,
      "Plant",
      PLANT_POLICY,
      [FERN],
      author,
      () => 10,
    );
    const members = [
      signClaims(publishHyperSchemaClaims(PLANT, PLANT_ENTITY, author, 10), GARDENER_SEED),
      ...[claims.living, claims.snapshot, claims.binding].map((c) => signClaims(c, GARDENER_SEED)),
      ...Array.from({ length: UNRELATED }, (_, n) =>
        observed(`plant:other-${n}`, "height", n, 1000 + n, GARDENER_SEED),
      ),
    ];
    const source = new Reactor();
    for (const d of members) source.ingest(d);
    const walks = (read: () => void): number => {
      const spy = vi.spyOn(Reactor.prototype, "snapshot");
      read();
      const count = spy.mock.calls.length;
      vi.restoreAllMocks();
      return count;
    };
    const candidatesWalk = walks(() =>
      expect(readRegistrations(source, 100, author)).toHaveLength(1),
    );
    const select = walks(() =>
      expect(
        selectReceivingSnapshot(
          source,
          { source: "source", sourceAuthor: author, entity: PLANT_ENTITY, reading: "Plant" },
          {
            source: "source",
            registrationId: members[3]!.id,
            memberIds: members.map((d) => d.id),
            versionId: freezeMembers(members).id,
          },
          false,
          100,
        ).status,
      ).toBe("selected"),
    );
    expect(candidatesWalk).toBeGreaterThan(0);
    expect(select).toBe(candidatesWalk);
  }, 120_000);
});

describe("EQUIVALENCE: the scope and the whole lawful set give one answer", () => {
  const gathered = (operand: ReturnType<typeof lawfulSnapshot>, at: number, entity: string) => {
    const rows = evalTerm(HYPER_SCHEMA_SCHEMA.body, operand, at, entity);
    if (rows.sort !== "hview") throw new Error("expected an hview");
    return [...rows.hview.props]
      .map(([prop, entries]) => [prop, entries.map((e) => e.delta.id)] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1));
  };
  const definitionsOf = (operand: ReturnType<typeof lawfulSnapshot>, at: number, entity: string) =>
    gathered(operand, at, entity).find(([prop]) => prop === "definition")?.[1] ?? [];
  const negatesAll = (author: string, seed: string, timestamp: number, ...ids: string[]) => ({
    ...makeNegationClaims(author, timestamp, ids[0]!),
    validFrom: 1,
    pointers: ids.map((id) => ({
      role: "negates",
      target: { kind: "delta" as const, deltaRef: { delta: id } },
    })),
    seed,
  });
  const sign = ({ seed, ...claims }: ReturnType<typeof negatesAll>): Delta =>
    signClaims(claims, seed);

  it("the same hview at every law entity, across strikes, strangers and validity", async () => {
    const gw = await home();
    await evolve(gw);
    await evolve(gw);
    const snapshotEntity = versionedSchemaEntityFor("Plant", OLDEST);
    const [first, second, third] = filedAt(gw, PLANT_ENTITY);
    await strike(gw, first!.id);
    const revived = await strike(gw, second!.id);
    await strike(gw, revived.id);
    for (const d of filedAt(gw, snapshotEntity)) {
      await strike(gw, (await strike(gw, d.id)).id, GARDENER_SEED);
    }
    await strike(gw, second!.id, GARDENER_SEED);
    const at = gw.validityNow() + 1e6;
    const weedAt = (timestamp: number, validFrom: number, validUntil?: number) =>
      signClaims(
        {
          ...publishHyperSchemaClaims(WEED, PLANT_ENTITY, OP, timestamp),
          validFrom,
          ...(validUntil === undefined ? {} : { validUntil }),
        },
        SEED,
      );
    const startsNow = weedAt(FAR + 2, at);
    const endsNow = weedAt(FAR + 3, 1, at);
    const double = sign(
      negatesAll(OP, SEED, FAR + 4, third!.id, gw.reactor.negationsOf(first!.id)[0]!),
    );
    const idle = [
      { ...negatesAll(OP, SEED, FAR + 5, startsNow.id), validFrom: at + 1 },
      { ...negatesAll(OP, SEED, FAR + 6, startsNow.id), validUntil: 2 },
      { ...negatesAll(OP, SEED, FAR + 7, startsNow.id), validUntil: at },
    ].map(sign);
    const pointed = negatesAll(OP, SEED, FAR + 8, second!.id);
    const pointing = sign({
      ...pointed,
      pointers: [
        ...pointed.pointers,
        {
          role: "about",
          target: { kind: "entity", entity: { id: PLANT_ENTITY, context: "note" } },
        },
      ] as never,
    });
    await gw.append([
      signClaims(publishHyperSchemaClaims(WEED, PLANT_ENTITY, GARDENER, FAR), GARDENER_SEED),
      weedAt(FAR, at + 1e9),
      weedAt(FAR + 1, 1, 2),
      startsNow,
      endsNow,
      double,
      ...idle,
      pointing,
    ]);
    const whole = lawfulSnapshot(gw.reactor, at, OP);
    const entities = [PLANT_ENTITY, "schema:Plant", snapshotEntity, "hyperschema:Absent"];
    for (const entity of entities) {
      const scope = lawfulScopeAt(gw.reactor, at, entity, OP);
      expect(gathered(scope, at, entity), entity).toEqual(gathered(whole, at, entity));
      for (const d of scope) expect(whole.has(d.id), d.id).toBe(true);
    }
    expect(definitionsOf(whole, at, PLANT_ENTITY).sort()).toEqual([first!.id, startsNow.id].sort());
    expect(whole.has(endsNow.id)).toBe(false);
    expect(gathered(whole, at, PLANT_ENTITY).map(([prop]) => prop)).toContain("note");
    expect(definitionsOf(whole, at, snapshotEntity)).toEqual([]);
    const open = lawfulSnapshot(gw.reactor, at);
    for (const entity of entities) {
      expect(gathered(lawfulScopeAt(gw.reactor, at, entity), at, entity), entity).toEqual(
        gathered(open, at, entity),
      );
    }
  });

  it("a trial set built from the scope and a batch gathers what the whole set and the batch gather", async () => {
    const gw = await home();
    const entity = "hyperschema:Weed";
    const at = gw.validityNow() + 1e6;
    const weed = (timestamp: number, seed = SEED) =>
      signClaims(
        { ...publishHyperSchemaClaims(WEED, entity, authorForSeed(seed), timestamp), validFrom: 1 },
        seed,
      );
    const held = weed(FAR);
    const [struck, strangerStruck, revived, lapsedStruck, clean, theirs] = [1, 2, 3, 4, 5, 6].map(
      (n) => weed(FAR + n, n === 6 ? GARDENER_SEED : SEED),
    ) as [Delta, Delta, Delta, Delta, Delta, Delta];
    const strikeOfRevived = sign(negatesAll(OP, SEED, FAR + 10, revived.id));
    const ofHeld = sign(negatesAll(OP, SEED, FAR + 20, held.id));
    await gw.append([
      held,
      sign(negatesAll(OP, SEED, FAR + 11, struck.id)),
      sign(negatesAll(GARDENER, GARDENER_SEED, FAR + 12, strangerStruck.id)),
      strikeOfRevived,
      sign(negatesAll(OP, SEED, FAR + 13, strikeOfRevived.id)),
      sign({ ...negatesAll(OP, SEED, FAR + 14, lapsedStruck.id), validUntil: at }),
      sign(negatesAll(OP, SEED, FAR + 15, theirs.id)),
    ]);
    const batches: [string, Delta[], string[]][] = [
      ["a held strike", [struck], [held.id]],
      ["a stranger's held strike", [strangerStruck], [held.id, strangerStruck.id]],
      ["a held strike that is struck", [revived], [held.id, revived.id]],
      ["a held strike that ends at the read time", [lapsedStruck], [held.id, lapsedStruck.id]],
      ["no strike", [clean], [clean.id, held.id]],
      ["a stranger's definition under the operator's strike", [theirs], [held.id]],
      ["a strike of a held definition", [ofHeld, clean], [clean.id]],
      ["a delta the ground holds", [held], [held.id]],
      ["all at once", [struck, strangerStruck, revived, lapsedStruck, clean, theirs, ofHeld], []],
    ];
    for (const [name, batch, live] of batches) {
      const whole = lawfulSnapshot(gw.reactor, at, OP);
      const scope = lawfulScopeAt(
        gw.reactor,
        at,
        entity,
        OP,
        batch.map((d) => d.id),
      );
      for (const d of scope) expect(whole.has(d.id), `${name}: ${d.id}`).toBe(true);
      for (const d of batch) {
        whole.add(d);
        scope.add(d);
      }
      expect(gathered(scope, at, entity), name).toEqual(gathered(whole, at, entity));
      if (name !== "all at once") {
        expect(definitionsOf(whole, at, entity).sort(), name).toEqual([...live].sort());
      }
    }
  });
});

describe("REFUSAL: a ground that disagrees with its own index is not read", () => {
  const definition = signClaims(publishHyperSchemaClaims(WEED, "hyperschema:Weed", OP, 10), SEED);
  const ground = (over: Partial<Ground>): Ground => ({
    get: (id) => (id === definition.id ? definition : undefined),
    byTarget: () => [definition.id],
    negationsOf: () => [],
    negationWitnesses: () => () => [],
    negationPredicate: () => () => false,
    ...over,
  });

  it("lawfulScopeAt refuses an id the target index names and the ground does not hold", () => {
    expect(lawfulScopeAt(ground({}), 100, "hyperschema:Weed", OP).size).toBe(1);
    expect(() =>
      lawfulScopeAt(
        ground({ byTarget: () => [definition.id, "gone"] }),
        100,
        "hyperschema:Weed",
        OP,
      ),
    ).toThrow(/names delta gone at hyperschema:Weed.*refusing to read law/);
  });

  it("lawfulScopeAt refuses a strike the negation index names and the ground does not hold", () => {
    const struck = ground({ negationsOf: (id) => (id === definition.id ? ["gone"] : []) });
    expect(() => lawfulScopeAt(struck, 100, "hyperschema:Weed", OP)).toThrow(
      /refusing to read law/,
    );
    expect(() =>
      lawfulScopeAt(
        ground({ negationsOf: (id) => (id === "batch" ? ["gone"] : []) }),
        100,
        "x",
        OP,
        ["batch"],
      ),
    ).toThrow(/refusing to read law/);
  });

  it("the three registration readers refuse; they do not read the registration as unbound", async () => {
    const gw = await home();
    await strike(gw, versions(gw)[0]!.deltaId);
    const lost = filedAt(gw, PLANT_ENTITY)[0]!.id;
    const now = gw.validityNow();
    const get = gw.reactor.get.bind(gw.reactor);
    const readers = [readRegistrations, readRegistrationVersions, readWithdrawnRegistrations];
    await evolve(gw);
    for (const read of readers) expect(() => read(gw.reactor, now + 1e6, OP)).not.toThrow();
    vi.spyOn(gw.reactor, "get").mockImplementation((id) => (id === lost ? undefined : get(id)));
    for (const read of readers) {
      expect(() => read(gw.reactor, now + 1e6, OP), read.name).toThrow(/refusing to read law/);
    }
  });
});

describe("ANSWER (controls: these pass over a whole-store walk too)", () => {
  it("an old version beside a new one: each resolves through its own Schema, at the reader and at the doors", async () => {
    const gw = await home();
    expect(servedHeight(gw)).toBe(34);
    await evolve(gw);
    expect(registered(gw).map((r) => oldestFirst(r.schema))).toEqual(["asc"]);
    expect(versions(gw).map((v) => oldestFirst(v.schema))).toEqual(["desc", "asc"]);
    expect(servedHeight(gw)).toBe(30);
    expect(gw.resolvePinned(versions(gw)[0]!, FERN).view["height"]).toBe(34);
    expect(gw.resolvePinned(versions(gw)[1]!, FERN).view["height"]).toBe(30);
  });

  it("a struck Schema definition unbinds its version; striking the strike binds it again", async () => {
    const gw = await home();
    await evolve(gw);
    const frozen = filedAt(gw, versionedSchemaEntityFor("Plant", OLDEST));
    expect(frozen).toHaveLength(1);
    const negation = await strike(gw, frozen[0]!.id);
    expect(gw.reactor.negationsOf(frozen[0]!.id)).toEqual([negation.id]);
    expect(gw.reactor.get(frozen[0]!.id)).toBeDefined();
    expect(registered(gw)).toEqual([]);
    expect(versions(gw).map((v) => oldestFirst(v.schema))).toEqual(["desc"]);
    expect(() => gw.resolvedNode("Plant", FERN)).toThrow();
    expect(gw.resolvePinned(versions(gw)[0]!, FERN).view["height"]).toBe(34);

    await strike(gw, negation.id);
    expect(registered(gw).map((r) => oldestFirst(r.schema))).toEqual(["asc"]);
    expect(servedHeight(gw)).toBe(30);
  });

  it("a withdrawn registration is named while a definition survives, and not after every one is struck", async () => {
    const gw = await home();
    await evolve(gw);
    const latest = versions(gw)[1]!.deltaId;
    await strike(gw, latest);
    expect(gw.withdrawnRegistrations()).toEqual([{ deltaId: latest, lensName: "Plant" }]);
    expect(servedHeight(gw)).toBe(34);

    const [first, second] = filedAt(gw, PLANT_ENTITY);
    await strike(gw, first!.id);
    expect(gw.withdrawnRegistrations()).toEqual([{ deltaId: latest, lensName: "Plant" }]);
    expect(servedHeight(gw)).toBe(34);
    await strike(gw, second!.id);
    expect(gw.withdrawnRegistrations()).toEqual([]);
    expect(registered(gw)).toEqual([]);
    expect(versions(gw)).toEqual([]);
    expect(() => gw.resolvedNode("Plant", FERN)).toThrow();
  });

  it("a stranger's definitions and strikes at the operator's entities are not law", async () => {
    const gw = await home();
    await evolve(gw);
    const snapshotEntity = versionedSchemaEntityFor("Plant", OLDEST);
    const theirs = [
      signClaims(publishHyperSchemaClaims(WEED, PLANT_ENTITY, GARDENER, FAR), GARDENER_SEED),
      signClaims(
        publishSchemaClaims(
          { ...PLANT_POLICY, name: "Plant", alg: 1 },
          snapshotEntity,
          GARDENER,
          FAR,
        ),
        GARDENER_SEED,
      ),
    ];
    await gw.append(theirs);
    for (const d of [...filedAt(gw, PLANT_ENTITY), ...filedAt(gw, snapshotEntity)]) {
      await strike(gw, d.id, GARDENER_SEED);
    }
    gw.replayRegistrations();
    expect(gw.reactor.byTarget(PLANT_ENTITY)).toContain(theirs[0]!.id);
    expect(gw.reactor.byTarget(snapshotEntity)).toContain(theirs[1]!.id);
    expect(gw.reactor.negationsOf(filedAt(gw, snapshotEntity)[0]!.id)).toHaveLength(1);
    expect(registered(gw).map((r) => [r.hyperschema.name, oldestFirst(r.schema)])).toEqual([
      ["Plant", "asc"],
    ]);
    expect(servedHeight(gw)).toBe(30);
    expect(readRegistrations(gw.reactor, gw.validityNow())).toEqual([]);
  });

  it("the operator's definition that is not yet valid binds at its start, not before", async () => {
    const gw = await home();
    const now = gw.validityNow();
    await gw.append([
      signClaims(
        { ...publishHyperSchemaClaims(WEED, PLANT_ENTITY, OP, FAR), validFrom: now + 1e9 },
        SEED,
      ),
    ]);
    gw.replayRegistrations();
    expect(registered(gw).map((r) => r.hyperschema.name)).toEqual(["Plant"]);
    expect(servedHeight(gw)).toBe(34);
    const later = readRegistrations(gw.reactor, now + 2e9, OP);
    expect(later.map((r) => r.hyperschema.name)).toEqual(["Weed"]);
  });

  it("a definition whose strike is already held is refused, and nothing lands", async () => {
    const gw = await home();
    const definition = defined(gw, WEED, "hyperschema:Weed");
    const bystander = defined(gw, WEED, "hyperschema:Moss");
    const negation = await strike(gw, definition.id);
    expect(gw.reactor.negationsOf(definition.id)).toEqual([negation.id]);
    await expect(gw.loadHyperSchema([definition], "hyperschema:Weed")).rejects.toThrow(
      /no surviving schema definition/,
    );
    expect(gw.reactor.get(definition.id)).toBeUndefined();
    expect((await gw.loadHyperSchema([bystander], "hyperschema:Moss")).name).toBe("Weed");
    expect(gw.reactor.get(bystander.id)).toBeDefined();
  });

  it("a stranger's held strike of a definition does not refuse its publish; the operator's does", async () => {
    const gw = await home();
    const [theirs, ours] = ["hyperschema:Weed", "hyperschema:Moss"].map((entity) =>
      defined(gw, WEED, entity),
    ) as [Delta, Delta];
    const forged = await strike(gw, theirs.id, GARDENER_SEED);
    await strike(gw, ours.id);
    expect(gw.reactor.negationsOf(theirs.id)).toEqual([forged.id]);
    expect((await gw.loadHyperSchema([theirs], "hyperschema:Weed")).name).toBe("Weed");
    expect(gw.reactor.get(theirs.id)).toBeDefined();
    await expect(gw.loadHyperSchema([ours], "hyperschema:Moss")).rejects.toThrow(
      /no surviving schema definition/,
    );
    expect(gw.reactor.get(ours.id)).toBeUndefined();
  });

  it("a stranger's definition at an entity is no incumbent for a blessing; the operator's own is", async () => {
    const gw = await home();
    const theirs = defined(gw, { ...POST, body: OTHER_BODY }, "hyperschema:Post", GARDENER_SEED);
    const ours = defined(gw, { ...POST, name: "Moss", body: OTHER_BODY }, "hyperschema:Moss");
    await gw.append([theirs, ours]);
    expect(gw.reactor.byTarget("hyperschema:Post")).toEqual([theirs.id]);
    expect(gw.reactor.byTarget("hyperschema:Moss")).toEqual([ours.id]);

    await gw.adoptLaw(await moduleAt(gw, "hyperschema:Post", "Post"), "Post");
    expect(serves(gw, "Post")).toBe(true);
    expect(gw.resolvedNode("Post", FERN).view["height"]).toBe(34);

    await expect(
      gw.adoptLaw(await moduleAt(gw, "hyperschema:Moss", "Moss"), "Moss"),
    ).rejects.toThrow(/A module may not name one of your entities/);
    expect(serves(gw, "Moss")).toBe(false);
  });
});
