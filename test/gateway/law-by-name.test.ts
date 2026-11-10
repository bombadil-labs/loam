// A law reader that knows the entity it wants reads that entity's target index and the negation
// chains of what is filed there (`lawfulScopeAt`), never a walk of the store (H8). The readers:
// the three registration readers' definition loads, the incumbent probe a blessing asks, the trial
// a definition publish proves against, and the definition pin of a receiving snapshot.
//
// COST cases count every reactor access. A reader that is one index read opens no whole-store door
// (`snapshot`, `arrivalLog`) and makes the same accesses with 0 and with 1000 unrelated facts. The
// registration readers still walk the store ONCE each, to find their candidates: bindings have no
// anchor to read. Their cases bound that at one walk and hold every other access fixed. The
// receiving snapshot reads a private reactor, so its case counts walks on every reactor and
// compares them with the candidates walk alone.
//
// ANSWER cases hold the result fixed at two levels: what the reader returns, and what the read
// doors serve (`resolvedNode`, `resolvePinned`, the version and withdrawn lists). Each is a
// CONTROL: it passes over a whole-store walk too, because the scope must select exactly what the
// walk selected. The EQUIVALENCE case compares the two operands directly.
//
// Not covered here: the blessing door that asks the incumbent probe is driven in
// adopt-law.test.ts (the entity-capture refusals); this file bounds the probe's read through
// `lawfulScopeAt` and the definition publish that shares it. The receiving snapshot's answers are
// held in receive-snapshot.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HYPER_SCHEMA_SCHEMA,
  Reactor,
  authorForSeed,
  evalTerm,
  makeNegationClaims,
  publishHyperSchemaClaims,
  publishSchemaClaims,
  signClaims,
  type Delta,
  type HyperSchema,
  type Schema,
} from "@bombadil/rhizomatic";
import { freezeMembers } from "../../src/gateway/container-identity.js";
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
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden, governedBootstrap } from "./fixtures.js";

const SEED = "c4".repeat(32);
const OP = authorForSeed(SEED);
const UNRELATED = 1000;
const PLANT_ENTITY = "hyperschema:Plant";
const FAR = 9e15; // a signed time above anything a gateway issues here

// The garden holds heights 30 (said at 1000) and 34 (said at 2000). PLANT_POLICY picks the latest
// (34) and OLDEST picks the first (30), so a served height names the Schema that resolved it.
const OLDEST: Schema = {
  ...PLANT_POLICY,
  props: new Map([
    ...PLANT_POLICY.props,
    ["height", { kind: "pick", order: { kind: "byTimestamp", dir: "asc" } }],
  ]),
};
const WEED: HyperSchema = { ...PLANT, name: "Weed" };

const homes: Gateway[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const gw of homes.splice(0)) await gw.close();
});

// A governed store that serves Plant under PLANT_POLICY, with the garden in it.
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
// The operator's or the gardener's negation of `id`, appended through the door.
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
// The operator's definitions filed at `entity`, as the index holds them, oldest first.
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
// The read's cost on a store with no unrelated facts and on one with UNRELATED of them.
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
      // Two definitions, the two bindings that point at the program, and the strike.
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
      const definition = signClaims(
        publishHyperSchemaClaims(WEED, "hyperschema:Weed", OP, gw.nextTimestamp(OP)),
        SEED,
      );
      return Promise.resolve(async () =>
        expect((await gw.loadHyperSchema([definition], "hyperschema:Weed")).name).toBe("Weed"),
      );
    });
    // The append that lands the definition reads the arrival log by reference, the same number of
    // times at either size. The proof before it is the read this case bounds.
    expect(cost.small.snapshot).toBe(0);
    expect(cost.small.byTarget).toBeGreaterThan(0);
    expect(cost.large).toEqual(cost.small);
  }, 120_000);

  // Each registration reader walks the store once for its candidates. The loads beside that walk
  // are index reads, so one walk is the bound and nothing else grows.
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
  it("the same surviving definitions at every law entity, across strikes, strangers and validity", async () => {
    const gw = await home();
    await evolve(gw);
    const now = gw.validityNow();
    const snapshotEntity = versionedSchemaEntityFor("Plant", OLDEST);
    const [first, second] = filedAt(gw, PLANT_ENTITY);
    // first: struck, and the strike stands. second: struck, the strike struck, so it lives.
    await strike(gw, first!.id);
    const revived = await strike(gw, second!.id);
    await strike(gw, revived.id);
    // A stranger's strike of a standing strike, and of a live definition: neither is law.
    await strike(gw, (await strike(gw, filedAt(gw, snapshotEntity)[0]!.id)).id, GARDENER_SEED);
    await strike(gw, second!.id, GARDENER_SEED);
    await gw.append([
      // A stranger's newer definition at the operator's entity.
      signClaims(publishHyperSchemaClaims(WEED, PLANT_ENTITY, GARDENER, FAR), GARDENER_SEED),
      // The operator's own, not yet valid and already lapsed.
      signClaims(
        { ...publishHyperSchemaClaims(WEED, PLANT_ENTITY, OP, FAR), validFrom: now + 1e9 },
        SEED,
      ),
      signClaims(
        {
          ...publishHyperSchemaClaims(WEED, PLANT_ENTITY, OP, FAR + 1),
          validFrom: 1,
          validUntil: 2,
        },
        SEED,
      ),
    ]);
    const at = gw.validityNow();
    const definitions = (operand: ReturnType<typeof lawfulSnapshot>, entity: string) => {
      const rows = evalTerm(HYPER_SCHEMA_SCHEMA.body, operand, at, entity);
      if (rows.sort !== "hview") throw new Error("expected an hview");
      return (rows.hview.props.get("definition") ?? []).map((e) => e.delta.id);
    };
    const whole = lawfulSnapshot(gw.reactor, at, OP);
    const entities = [PLANT_ENTITY, "schema:Plant", snapshotEntity, "hyperschema:Absent"];
    for (const entity of entities) {
      const scope = lawfulScopeAt(gw.reactor, at, entity, OP);
      expect(definitions(scope, entity), entity).toEqual(definitions(whole, entity));
      for (const d of scope) expect(whole.has(d.id), d.id).toBe(true);
    }
    // The fixture is forceful: one definition struck, one revived, the stranger's absent.
    expect(definitions(whole, PLANT_ENTITY)).toEqual([second!.id]);
    expect(definitions(whole, snapshotEntity)).toEqual([]);
    expect(gw.reactor.byTarget(PLANT_ENTITY).length).toBeGreaterThan(4);
    // Ungoverned, every author's deltas are law, and the scope follows.
    const open = lawfulSnapshot(gw.reactor, at);
    for (const entity of entities) {
      expect(definitions(lawfulScopeAt(gw.reactor, at, entity), entity), entity).toEqual(
        definitions(open, entity),
      );
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
    // Delta level: the strike is held against the definition, and the definition is still held.
    expect(gw.reactor.negationsOf(frozen[0]!.id)).toEqual([negation.id]);
    expect(gw.reactor.get(frozen[0]!.id)).toBeDefined();
    // The latest binding names a Schema that no longer loads, so the lens binds nothing.
    expect(registered(gw)).toEqual([]);
    expect(versions(gw).map((v) => oldestFirst(v.schema))).toEqual(["desc"]);
    expect(() => gw.resolvedNode("Plant", FERN)).toThrow();
    // The bystander version still answers at its own door.
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
    // One definition of two survives: the bystander keeps the lens served and the name nameable.
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
    // Delta level: the store holds the stranger's records at the same entities.
    expect(gw.reactor.byTarget(PLANT_ENTITY)).toContain(theirs[0]!.id);
    expect(gw.reactor.byTarget(snapshotEntity)).toContain(theirs[1]!.id);
    expect(gw.reactor.negationsOf(filedAt(gw, snapshotEntity)[0]!.id)).toHaveLength(1);
    // Reader and door: the operator's program and the operator's Schema, as before.
    expect(registered(gw).map((r) => [r.hyperschema.name, oldestFirst(r.schema)])).toEqual([
      ["Plant", "asc"],
    ]);
    expect(servedHeight(gw)).toBe(30);
    // Read with no governor, the same deltas are everyone's law: the newest definition wins and
    // each strike counts.
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
    const definition = signClaims(
      publishHyperSchemaClaims(WEED, "hyperschema:Weed", OP, gw.nextTimestamp(OP)),
      SEED,
    );
    const bystander = signClaims(
      publishHyperSchemaClaims(WEED, "hyperschema:Moss", OP, gw.nextTimestamp(OP)),
      SEED,
    );
    const negation = await strike(gw, definition.id);
    expect(gw.reactor.negationsOf(definition.id)).toEqual([negation.id]);
    await expect(gw.loadHyperSchema([definition], "hyperschema:Weed")).rejects.toThrow(
      /no surviving schema definition/,
    );
    expect(gw.reactor.get(definition.id)).toBeUndefined();
    // The bystander, with no strike held, proves and lands.
    expect((await gw.loadHyperSchema([bystander], "hyperschema:Moss")).name).toBe("Weed");
    expect(gw.reactor.get(bystander.id)).toBeDefined();
  });
});
