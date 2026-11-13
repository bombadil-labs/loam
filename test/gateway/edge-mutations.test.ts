import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  parseTerm,
  publishHyperSchemaClaims,
  signClaims,
  type Delta,
  type Schema,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import {
  entityGatherBody,
  entityGatherJson,
  expandedGatherBody,
} from "../../src/gateway/gather.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  lensOf,
  parseRegistrationInput,
  registrationDeltaClaims,
  type RefSpecs,
} from "../../src/gateway/registration.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { observed } from "../spike/garden.js";
import { pickLatest } from "./fixtures.js";

vi.setConfig({ testTimeout: 30_000 });

const OPERATOR_SEED = "0d".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const WRITER_SEED = "d1".repeat(32);
const WRITER = authorForSeed(WRITER_SEED);
const SECOND_SEED = "d2".repeat(32);
const SECOND = authorForSeed(SECOND_SEED);
const SYNC_SEED = "d3".repeat(32);
const SYNC = authorForSeed(SYNC_SEED);
const STRANGER_SEED = "d4".repeat(32);

const MYK = "person:myk";
const SAGE = "person:sage";
const EXP = "experience:hike";
const TRIP = "trip:ridge";

const PERSON = { name: "sync:person", alg: 1, body: entityGatherBody() } as const;
const PERSON_READING: Schema = {
  name: "sync:person",
  props: new Map([
    ["name", pickLatest],
    ["experiences", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }],
  ]),
  default: pickLatest,
};

const EXPERIENCE = {
  name: "sync:experience",
  alg: 1,
  body: expandedGatherBody({ role: "experiencer", schema: "sync:person", reading: "sync:person" }),
} as const;
const EXPERIENCE_READING: Schema = {
  name: "sync:experience",
  props: new Map([
    ["experiencers", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }],
    ["title", pickLatest],
  ]),
  default: pickLatest,
};

const REFS = {
  experiencers: {
    role: "experiencer",
    reciprocal: { role: "experienced", context: "experiences" },
  },
} as const;
const REFS_NO_RECIPROCAL = { experiencers: { role: "experiencer" } } as const;

const UNDECLARED_WARNING =
  "reciprocal context for sync:experience.experiencers undeclared; " +
  "link deltas will not fold on the sync:person side";

async function world(): Promise<{ gateway: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, WRITER, "write", OPERATOR, 9_001), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SECOND, "write", OPERATOR, 9_002), OPERATOR_SEED),
  ]);
  await gateway.append([
    observed(MYK, "name", "Myk", 1_000, WRITER_SEED),
    observed(SAGE, "name", "Sage", 1_001, WRITER_SEED),
  ]);
  await gateway.publishRegistration(PERSON, PERSON_READING, [MYK, SAGE]);
  return { gateway, backend };
}

async function registerExperience(
  gateway: Gateway,
  opts: { writable?: string[]; refs?: RefSpecs } = {},
): Promise<{ warnings?: readonly string[]; bound: boolean }> {
  return gateway.publishRegistration(
    EXPERIENCE,
    EXPERIENCE_READING,
    [EXP],
    undefined,
    undefined,
    undefined,
    opts.writable ?? ["title"],
    undefined,
    opts.refs,
  );
}

interface TypeRefJson {
  kind: string;
  name: string | null;
  ofType?: TypeRefJson | null;
}
const renderType = (t: TypeRefJson): string =>
  t.kind === "NON_NULL"
    ? `${renderType(t.ofType!)}!`
    : t.kind === "LIST"
      ? `[${renderType(t.ofType!)}]`
      : (t.name ?? "?");

interface FieldJson {
  name: string;
  description: string | null;
  args: { name: string; type: TypeRefJson }[];
}

const INTROSPECT = `{
  mutation: __type(name: "Mutation") {
    fields {
      name
      description
      args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
    }
  }
  pointer: __type(name: "PointerInput") {
    inputFields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
  }
}`;

async function mutationSurface(gateway: Gateway): Promise<{
  fields: Map<string, { description: string | null; args: Record<string, string> }>;
  pointerInput: Record<string, string>;
}> {
  const result = await gateway.query(INTROSPECT);
  expect(result.errors).toBeUndefined();
  const data = result.data as {
    mutation: { fields: FieldJson[] };
    pointer: { inputFields: { name: string; type: TypeRefJson }[] };
  };
  const fields = new Map(
    data.mutation.fields.map((f) => [
      f.name,
      {
        description: f.description,
        args: Object.fromEntries(f.args.map((a) => [a.name, renderType(a.type)])),
      },
    ]),
  );
  const pointerInput = Object.fromEntries(
    data.pointer.inputFields.map((f) => [f.name, renderType(f.type)]),
  );
  return { fields, pointerInput };
}

async function freshDeltas(
  gateway: Gateway,
  backend: MemoryBackend,
  settled: ReadonlySet<string>,
): Promise<Delta[]> {
  await gateway.flush();
  return backend.deltasSince(settled);
}
const idsOf = async (backend: MemoryBackend): Promise<Set<string>> =>
  new Set((await backend.deltasSince(new Set())).map((d) => d.id));

const shapeOf = (d: Delta): unknown[] =>
  [...d.claims.pointers]
    .map((p) => ({
      role: p.role,
      target:
        p.target.kind === "entity"
          ? { id: p.target.entity.id, context: p.target.entity.context }
          : p.target,
    }))
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

const view = (
  r: { data?: unknown; errors?: unknown[] },
  field: string,
): Record<string, unknown> => {
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  return (r.data as Record<string, Record<string, unknown>>)[field]!;
};

describe("§51 (b) — introspection teaches the truth: link/unlink serve, the primitive argument is gone", () => {
  it("serves link<n>_<P> and unlink<n>_<P> with ID! args; the base mutation offers no experiencers argument", async () => {
    const { gateway } = await world();
    const outcome = await registerExperience(gateway, { refs: REFS });
    expect(outcome.bound).toBe(true);

    const { fields } = await mutationSurface(gateway);
    const link = fields.get("linksync_experience_experiencers");
    expect(link, [...fields.keys()].join(", ")).toBeDefined();
    expect(link!.args).toEqual({ entity: "ID!", target: "ID!" });
    const unlink = fields.get("unlinksync_experience_experiencers");
    expect(unlink).toBeDefined();
    expect(unlink!.args).toEqual({ entity: "ID!", target: "ID!" });

    const base = fields.get("sync_experience");
    expect(base).toBeDefined();
    expect(base!.args).toEqual({ entity: "ID!", title: "PrimitiveValue" });
    await gateway.close();
  });

  it("a prop in both writable and refs draws a warning, and refs wins", async () => {
    const { gateway } = await world();
    const outcome = await registerExperience(gateway, {
      writable: ["title", "experiencers"],
      refs: REFS,
    });
    expect(outcome.bound).toBe(true);
    expect(outcome.warnings ?? []).toContain(
      '"experiencers" on "sync:experience" is declared in both `writable` and `refs`; refs wins — ' +
        "the prop takes no primitive argument, and its writes are the link/unlink mutations. " +
        "Remove it from `writable`.",
    );
    const { fields } = await mutationSurface(gateway);
    expect(fields.get("sync_experience")!.args).toEqual({ entity: "ID!", title: "PrimitiveValue" });
    expect(fields.has("linksync_experience_experiencers")).toBe(true);
    await gateway.close();
  });
});

describe("§51 (c) — the link mutation authors the symmetric two-pointer delta, and the view folds", () => {
  it("delta level: the pointer structure equals the hand-authored _claim shape; object level: the target folds", async () => {
    const { gateway, backend } = await world();
    await registerExperience(gateway, { refs: REFS });
    const settled = await idsOf(backend);

    const linked = await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { experiencers } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const linkedView = view(linked, "linksync_experience_experiencers");

    const fresh = await freshDeltas(gateway, backend, settled);
    expect(fresh).toHaveLength(1);
    const edge = fresh[0]!;
    expect(edge.claims.author).toBe(WRITER);
    expect(shapeOf(edge)).toEqual(
      shapeOf({
        id: "x",
        claims: {
          timestamp: 0,
          validFrom: 0,
          author: WRITER,
          pointers: [
            {
              role: "experiencer",
              target: { kind: "entity", entity: { id: MYK, context: "experiences" } },
            },
            {
              role: "experienced",
              target: { kind: "entity", entity: { id: EXP, context: "experiencers" } },
            },
          ],
        },
      }),
    );

    expect(linkedView["experiencers"]).toMatchObject([{ name: "Myk" }]);
    const reread = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    expect(view(reread, "sync_experience")["experiencers"]).toMatchObject([{ name: "Myk" }]);

    const person = await gateway.query(`{ sync_person(entity: "${MYK}") { experiences } }`);
    expect(view(person, "sync_person")["experiences"]).toEqual([EXP]);

    const claimed = await gateway.query(
      `mutation { _claim(pointers: [
        { role: "experiencer", at: "${SAGE}", context: "experiences" },
        { role: "experienced", at: "${EXP}", context: "experiencers" }
      ]) { delta } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const claimId = (view(claimed, "_claim") as { delta?: string }).delta;
    const byHand = gateway.reactor.get(claimId!)!;
    expect(JSON.stringify(shapeOf(byHand)).replaceAll(SAGE, MYK)).toBe(
      JSON.stringify(shapeOf(edge)),
    );
    await gateway.close();
  });
});

describe("§51 (d) — unlink retracts the caller's own link; history and bystanders survive", () => {
  it("the view drops the edge, the original delta and the retraction remain, a second author's link stands", async () => {
    const { gateway, backend } = await world();
    await registerExperience(gateway, { refs: REFS });

    const settled = await idsOf(backend);
    await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { _hex } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const [writersEdge] = await freshDeltas(gateway, backend, settled);
    const afterWriter = await idsOf(backend);
    await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { _hex } }`,
      undefined,
      { actor: SECOND_SEED },
    );
    const [secondsEdge] = await freshDeltas(gateway, backend, afterWriter);
    const both = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    expect(view(both, "sync_experience")["experiencers"]).toMatchObject([
      { name: "Myk" },
      { name: "Myk" },
    ]);
    const farBefore = await gateway.query(`{ sync_person(entity: "${MYK}") { experiences } }`);
    expect(view(farBefore, "sync_person")["experiences"]).toEqual([EXP, EXP]);

    const unlinked = await gateway.query(
      `mutation { unlinksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { experiencers } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(unlinked, "unlinksync_experience_experiencers")["experiencers"]).toMatchObject([
      { name: "Myk" },
    ]);
    const farAfter = await gateway.query(`{ sync_person(entity: "${MYK}") { experiences } }`);
    expect(view(farAfter, "sync_person")["experiences"]).toEqual([EXP]);

    await gateway.flush();
    const all = await idsOf(backend);
    expect(all.has(writersEdge!.id), "the retracted edge delta still exists — history").toBe(true);
    const strikes = gateway.reactor.negationsOf(writersEdge!.id);
    expect(strikes.length, "the writer's edge is negated").toBeGreaterThan(0);
    for (const strike of strikes) {
      expect(gateway.reactor.get(strike)?.claims.author).toBe(WRITER);
    }
    expect(gateway.reactor.negationsOf(secondsEdge!.id)).toEqual([]);
    await gateway.close();
  });
});

describe("§51 (e) — an undeclared reciprocal: the mutation still generates, loud at register time", () => {
  it("warns with the specified sentence; the delta folds on the root side and carries no target-side context", async () => {
    const { gateway, backend } = await world();
    const outcome = await registerExperience(gateway, { refs: REFS_NO_RECIPROCAL });
    expect(outcome.bound).toBe(true);
    expect(outcome.warnings ?? []).toContain(UNDECLARED_WARNING);

    const settled = await idsOf(backend);
    const linked = await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { experiencers } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(linked, "linksync_experience_experiencers")["experiencers"]).toMatchObject([
      { name: "Myk" },
    ]);

    const [edge] = await freshDeltas(gateway, backend, settled);
    const atPerson = edge!.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.id === MYK,
    );
    const atExperience = edge!.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.id === EXP,
    );
    expect(atPerson?.role).toBe("experiencer");
    expect(
      atPerson?.target.kind === "entity" ? atPerson.target.entity.context : "wrong-kind",
    ).toBeUndefined();
    expect(atExperience?.role).toBe("subject");
    expect(
      atExperience?.target.kind === "entity" ? atExperience.target.entity.context : "wrong-kind",
    ).toBe("experiencers");

    const person = await gateway.query(`{ sync_person(entity: "${MYK}") { experiences } }`);
    expect(view(person, "sync_person")["experiences"]).toBeNull();
    await gateway.close();
  });
});

describe("§51 (f) — _claim is untouched, and a raw _claim edge still folds (bystander)", () => {
  it("the _claim surface is byte-for-byte the pre-§51 shape while the link mutations serve beside it", async () => {
    const { gateway } = await world();
    await registerExperience(gateway, { refs: REFS });

    const { fields, pointerInput } = await mutationSurface(gateway);
    expect(fields.has("linksync_experience_experiencers")).toBe(true);
    const claim = fields.get("_claim");
    expect(claim).toBeDefined();
    expect(claim!.args).toEqual({ pointers: "[PointerInput!]!" });
    expect(claim!.description).toBe(
      "Emit one signed delta from an explicit pointer list — the general form every " +
        "template is sugar for. Each pointer is entity (at + context) or primitive (value).",
    );
    expect(pointerInput).toEqual({
      role: "String!",
      at: "ID",
      context: "String",
      value: "PrimitiveValue",
    });

    const claimed = await gateway.query(
      `mutation { _claim(pointers: [
        { role: "experiencer", at: "${SAGE}", context: "experiences" },
        { role: "experienced", at: "${EXP}", context: "experiencers" }
      ]) { delta } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(claimed.errors).toBeUndefined();
    const reread = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    expect(view(reread, "sync_experience")["experiencers"]).toMatchObject([{ name: "Sage" }]);
    await gateway.close();
  });
});

describe("§51 (g) — evolution: republish with refs regenerates at once; the fossil keeps resolving", () => {
  it("the repro's exact state, pinned: fossil first, then the mixed array after the republish", async () => {
    const { gateway } = await world();
    await registerExperience(gateway, { writable: ["title", "experiencers"] });
    const before = await mutationSurface(gateway);
    expect(before.fields.has("linksync_experience_experiencers")).toBe(false);
    expect(before.fields.get("sync_experience")!.args).toEqual({
      entity: "ID!",
      title: "PrimitiveValue",
      experiencers: "PrimitiveValue",
    });

    const fossil = await gateway.query(
      `mutation { sync_experience(entity: "${EXP}", experiencers: "${MYK}") { experiencers } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(fossil, "sync_experience")["experiencers"]).toEqual([MYK]);

    const outcome = await registerExperience(gateway, { refs: REFS });
    expect(outcome.bound).toBe(true);
    const after = await mutationSurface(gateway);
    expect(after.fields.has("linksync_experience_experiencers")).toBe(true);
    expect(after.fields.has("unlinksync_experience_experiencers")).toBe(true);
    expect(after.fields.get("sync_experience")!.args).toEqual({
      entity: "ID!",
      title: "PrimitiveValue",
    });

    const still = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    expect(view(still, "sync_experience")["experiencers"]).toEqual([MYK]);

    await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { _hex } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const mixed = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    const arr = view(mixed, "sync_experience")["experiencers"] as unknown[];
    expect(arr).toHaveLength(2);
    expect(arr[0]).toBe(MYK);
    expect(arr[1]).toMatchObject({ name: "Myk" });
    await gateway.close();
  });
});

describe("§51 (h) — a prefix/inSet role expand: a reference for typing only", () => {
  it("drops the primitive argument and names the prop a reference, but mints no link mutation", async () => {
    const { gateway } = await world();
    const activity = {
      name: "sync:activity",
      alg: 1,
      body: parseTerm({
        op: "expand",
        role: { prefix: "rel:" },
        schema: "sync:person",
        reading: "sync:person",
        in: entityGatherJson(),
      }),
    };
    const reading: Schema = {
      name: "sync:activity",
      props: new Map([
        ["contacts", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }],
        ["note", pickLatest],
      ]),
      default: pickLatest,
    };
    const outcome = await gateway.publishRegistration(
      activity,
      reading,
      ["activity:walk"],
      undefined,
      undefined,
      undefined,
      ["note"],
      undefined,
      { contacts: { role: "rel:knows" } },
    );
    expect(outcome.bound).toBe(true);

    const { fields } = await mutationSurface(gateway);
    const base = fields.get("sync_activity");
    expect(base).toBeDefined();
    expect(base!.args).toEqual({ entity: "ID!", note: "PrimitiveValue" });
    expect(base!.description).toContain("Reference props");
    expect(base!.description).toContain("contacts");
    expect(base!.description).not.toMatch(/Read-only here.*contacts/);
    expect(fields.has("linksync_activity_contacts")).toBe(false);
    expect(fields.has("unlinksync_activity_contacts")).toBe(false);

    const hooks = gateway.gqlHooks();
    await expect(
      hooks.linkRef("sync:activity", "activity:walk", "contacts", MYK, WRITER_SEED),
    ).rejects.toThrow(/declares no reference prop "contacts" to link/);
    await expect(
      hooks.unlinkRef("sync:activity", "activity:walk", "contacts", MYK, WRITER_SEED),
    ).rejects.toThrow(/declares no reference prop "contacts" to link/);
    await expect(
      hooks.linkRef("sync:activity", "activity:walk", "note", MYK, WRITER_SEED),
    ).rejects.toThrow(/declares no reference prop "note" to link/);
    await gateway.close();
  });
});

describe("§51 — the write scalar refuses a non-primitive VARIABLE value", () => {
  it("PrimitiveValue.parseValue guards the variables path, not only literals", async () => {
    const { gateway } = await world();
    await registerExperience(gateway, { refs: REFS });
    const result = await gateway.query(
      `mutation ($v: PrimitiveValue) { sync_experience(entity: "${EXP}", title: $v) { title } }`,
      { v: { an: "object" } },
      { actor: WRITER_SEED },
    );
    expect(result.errors?.join(" ")).toMatch(
      /a property value must be a string, number, or boolean/,
    );
    await gateway.close();
  });
});

describe("§51 — the refs envelope parse refuses malformed declarations loudly", () => {
  it("names the defect: a non-object refs, a roleless prop, a half reciprocal", () => {
    const pick = { pick: { order: { byTimestamp: "desc" } } };
    const body = {
      hyperschema: { name: "sync:thing", alg: 1, body: entityGatherJson() },
      schema: { props: { owner: pick }, default: pick },
      roots: ["thing:1"],
    };
    expect(() => parseRegistrationInput({ ...body, refs: 42 })).toThrow(
      "refs must be an object of per-prop reference declarations",
    );
    expect(() => parseRegistrationInput({ ...body, refs: null })).toThrow(
      "refs must be an object of per-prop reference declarations",
    );
    expect(() => parseRegistrationInput({ ...body, refs: { owner: {} } })).toThrow(
      'refs "owner": role must be a non-empty string',
    );
    expect(() =>
      parseRegistrationInput({ ...body, refs: { owner: { role: "owned-by", reciprocal: {} } } }),
    ).toThrow('refs "owner": reciprocal wants { role, context }, both non-empty strings');
    expect(() =>
      parseRegistrationInput({
        ...body,
        refs: JSON.parse('{"__proto__":{"role":"x"}}') as unknown,
      }),
    ).toThrow('refs: "__proto__" is not a usable prop name');
  });
});

describe("§51 — a corrupted at-rest refs payload drops the pair AND says so", () => {
  it("replay keeps the lens, sheds the pair, records the defect; a valid sibling serves whole", async () => {
    const { gateway } = await world();
    let tick = 5_000;
    const clock = (): number => (tick += 1);

    const poisoned = registrationDeltaClaims(
      "hyperschema:sync:experience",
      "sync:experience",
      EXPERIENCE_READING,
      [EXP],
      OPERATOR,
      clock,
      undefined,
      ["title", "experiencers"],
    );
    const trek = {
      name: "sync:trip",
      alg: 1,
      body: expandedGatherBody({
        role: "experiencer",
        schema: "sync:person",
        reading: "sync:person",
      }),
    };
    const healthy = registrationDeltaClaims(
      "hyperschema:sync:trip",
      "sync:trip",
      { ...EXPERIENCE_READING, name: "sync:trip" },
      [TRIP],
      OPERATOR,
      clock,
      undefined,
      ["title"],
      undefined,
      REFS,
    );
    await gateway.append([
      signClaims(
        publishHyperSchemaClaims(EXPERIENCE, "hyperschema:sync:experience", OPERATOR, clock()),
        OPERATOR_SEED,
      ),
      signClaims(poisoned.living, OPERATOR_SEED),
      signClaims(poisoned.snapshot, OPERATOR_SEED),
      signClaims(
        {
          ...poisoned.binding,
          pointers: [
            ...poisoned.binding.pointers,
            { role: "refs", target: { kind: "primitive", value: '{"experiencers":42}' } },
          ],
        },
        OPERATOR_SEED,
      ),
      signClaims(
        publishHyperSchemaClaims(trek, "hyperschema:sync:trip", OPERATOR, clock()),
        OPERATOR_SEED,
      ),
      signClaims(healthy.living, OPERATOR_SEED),
      signClaims(healthy.snapshot, OPERATOR_SEED),
      signClaims(healthy.binding, OPERATOR_SEED),
    ]);
    gateway.replayRegistrations();

    const reg = gateway.registered.find((r) => lensOf(r) === "sync:experience");
    expect(reg).toBeDefined();
    expect(reg!.refs).toBeUndefined();
    expect(reg!.refsDefect).toMatch(/refs "experiencers": wants \{ role, reciprocal\? \}/);

    const { fields } = await mutationSurface(gateway);
    expect(fields.has("linksync_experience_experiencers")).toBe(false);
    expect(fields.get("sync_experience")!.args).toEqual({
      entity: "ID!",
      title: "PrimitiveValue",
      experiencers: "PrimitiveValue",
    });

    const control = gateway.registered.find((r) => lensOf(r) === "sync:trip");
    expect(control?.refsDefect).toBeUndefined();
    expect(control?.refs).toEqual(REFS);
    expect(fields.has("linksync_trip_experiencers")).toBe(true);
    expect(fields.get("sync_trip")!.args).toEqual({ entity: "ID!", title: "PrimitiveValue" });
    await gateway.close();
  });
});

describe("§51 — refs wins at the MUTATE SEAM, not only on the GraphQL surface", () => {
  it("a primitive write to a refs prop refuses on every door; a plain writable prop beside it writes", async () => {
    const { gateway } = await world();
    await registerExperience(gateway, { writable: ["title", "experiencers"], refs: REFS });
    const hooks = gateway.gqlHooks();
    await expect(
      hooks.mutate("sync:experience", EXP, { experiencers: MYK }, WRITER_SEED),
    ).rejects.toThrow(/is a reference \(§51\).*linksync_experience_experiencers/);
    const ok = await hooks.mutate("sync:experience", EXP, { title: "The hike" }, WRITER_SEED);
    expect(ok.view["title"]).toBe("The hike");

    await registerExperience(gateway, { writable: ["title"], refs: REFS });
    await expect(
      gateway.gqlHooks().mutate("sync:experience", EXP, { experiencers: MYK }, WRITER_SEED),
    ).rejects.toThrow(/is a reference \(§51\)/);
    await gateway.close();
  });
});

describe("§51 — the persisted refs survive a REBOOT: replay re-derives the pair", () => {
  it("close, reopen over the same store file: link/unlink serve and the primitive arg stays gone", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t245-reboot-"));
    const gateway = await Gateway.open(new SqliteBackend(join(home, "store.sqlite")), {
      seed: OPERATOR_SEED,
    });
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, WRITER, "write", OPERATOR, 9_001), OPERATOR_SEED),
    ]);
    await gateway.append([observed(MYK, "name", "Myk", 1_000, WRITER_SEED)]);
    await gateway.publishRegistration(PERSON, PERSON_READING, [MYK, SAGE]);
    await registerExperience(gateway, { refs: REFS });
    await gateway.close();

    const reborn = await Gateway.open(new SqliteBackend(join(home, "store.sqlite")), {
      seed: OPERATOR_SEED,
    });
    const { fields } = await mutationSurface(reborn);
    expect(fields.has("linksync_experience_experiencers")).toBe(true);
    expect(fields.has("unlinksync_experience_experiencers")).toBe(true);
    expect(fields.get("sync_experience")!.args).toEqual({ entity: "ID!", title: "PrimitiveValue" });

    const linked = await reborn.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { experiencers } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(linked, "linksync_experience_experiencers")["experiencers"]).toMatchObject([
      { name: "Myk" },
    ]);
    await reborn.close();
  });
});

describe("§51 — a ref must ride an existing prop, refused loudly at publish", () => {
  it("a phantom prop refuses with the field named; a valid declaration beside it publishes", async () => {
    const { gateway } = await world();
    await expect(
      gateway.publishRegistration(
        EXPERIENCE,
        EXPERIENCE_READING,
        [EXP],
        undefined,
        undefined,
        undefined,
        ["title"],
        undefined,
        { phantom: { role: "experiencer" } },
      ),
    ).rejects.toThrow('refs "phantom": no such field in the schema');
    const outcome = await registerExperience(gateway, { refs: REFS });
    expect(outcome.bound).toBe(true);
    const { fields } = await mutationSurface(gateway);
    expect(fields.has("linksync_experience_experiencers")).toBe(true);
    await gateway.close();
  });
});

describe("§51 — sibling readings and a capital-initial prop (H6's documented blind spot)", () => {
  it("each reading mints its own pair under ITS name; the delta carries store-native names", async () => {
    const { gateway, backend } = await world();
    await gateway.publishRegistration(
      PERSON,
      { name: "PersonCard", props: new Map([["name", pickLatest]]), default: pickLatest },
      [MYK, SAGE],
    );
    const TREK = {
      name: "sync:trek",
      alg: 1,
      body: expandedGatherBody({ role: "companion", schema: "sync:person", reading: "PersonCard" }),
    } as const;
    const allAsc = { kind: "all", order: { kind: "byTimestamp", dir: "asc" } } as const;
    const trekOutcome = await gateway.publishRegistration(
      TREK,
      {
        name: "Trek",
        props: new Map([
          ["Companions", allAsc],
          ["title", pickLatest],
        ]),
        default: pickLatest,
      },
      [TRIP],
      undefined,
      undefined,
      undefined,
      ["title"],
      undefined,
      { Companions: { role: "companion", reciprocal: { role: "companion-of", context: "treks" } } },
    );
    expect(trekOutcome.bound).toBe(true);
    const voyageOutcome = await gateway.publishRegistration(
      TREK,
      { name: "Voyage", props: new Map([["Companions", allAsc]]), default: pickLatest },
      [TRIP],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { Companions: { role: "companion" } },
    );
    expect(voyageOutcome.bound).toBe(true);
    expect(voyageOutcome.warnings ?? []).toContain(
      "reciprocal context for Voyage.Companions undeclared; " +
        "link deltas will not fold on the PersonCard side",
    );

    const { fields } = await mutationSurface(gateway);
    expect(fields.has("linktrek_Companions")).toBe(true);
    expect(fields.has("unlinktrek_Companions")).toBe(true);
    expect(fields.has("linkvoyage_Companions")).toBe(true);
    expect(fields.has("unlinkvoyage_Companions")).toBe(true);
    expect(fields.has("linksync_trek_Companions")).toBe(false);

    const settled = await idsOf(backend);
    const linked = await gateway.query(
      `mutation { linktrek_Companions(entity: "${TRIP}", target: "${MYK}") { Companions } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(linked, "linktrek_Companions")["Companions"]).toMatchObject([{ name: "Myk" }]);
    const [edge] = await freshDeltas(gateway, backend, settled);
    expect(shapeOf(edge!)).toEqual(
      shapeOf({
        id: "x",
        claims: {
          timestamp: 0,
          validFrom: 0,
          author: WRITER,
          pointers: [
            {
              role: "companion",
              target: { kind: "entity", entity: { id: MYK, context: "treks" } },
            },
            {
              role: "companion-of",
              target: { kind: "entity", entity: { id: TRIP, context: "Companions" } },
            },
          ],
        },
      }),
    );
    await gateway.close();
  });
});

describe("§51 — a republish where ONLY refs changes regenerates the surface", () => {
  it("same schema, same roots, same writable — adding refs alone mints the pair", async () => {
    const { gateway } = await world();
    await registerExperience(gateway, {});
    const before = await mutationSurface(gateway);
    expect(before.fields.has("linksync_experience_experiencers")).toBe(false);

    await registerExperience(gateway, { refs: REFS });
    const after = await mutationSurface(gateway);
    expect(after.fields.has("linksync_experience_experiencers")).toBe(true);
    expect(after.fields.has("unlinksync_experience_experiencers")).toBe(true);
    await gateway.close();
  });
});

describe("§51 — link signs as the actor, and standing still gates the append", () => {
  it("an ungranted actor's link refuses at the door; the granted writer's lands", async () => {
    const { gateway } = await world();
    await registerExperience(gateway, { refs: REFS });
    const denied = await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { _hex } }`,
      undefined,
      { actor: STRANGER_SEED },
    );
    expect(denied.errors?.join(" ")).toMatch(/append rejected/);
    const granted = await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { experiencers } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(granted, "linksync_experience_experiencers")["experiencers"]).toMatchObject([
      { name: "Myk" },
    ]);
    await gateway.close();
  });
});

describe("§51 (a) — a scoped register grant carries a refs registration through the door", () => {
  let live: ServerHandle | undefined;
  let liveGateway: Gateway | undefined;
  const closeLive = async (): Promise<void> => {
    await live?.close();
    await liveGateway?.close();
    live = undefined;
    liveGateway = undefined;
  };

  const PICK = { pick: { order: { byTimestamp: "desc" } } };
  const ALL_ASC = { all: { order: { byTimestamp: "asc" } } };
  const personBody = (): Record<string, unknown> => ({
    hyperschema: { name: "sync:person", alg: 1, body: entityGatherJson() },
    schema: { name: "sync:person", props: { name: PICK, experiences: ALL_ASC }, default: PICK },
    roots: [MYK],
  });
  const experienceBody = (refs: unknown): Record<string, unknown> => ({
    hyperschema: {
      name: "sync:experience",
      alg: 1,
      body: {
        op: "expand",
        role: { exact: "experiencer" },
        schema: "sync:person",
        reading: "sync:person",
        in: entityGatherJson(),
      },
    },
    schema: {
      name: "sync:experience",
      props: { experiencers: ALL_ASC, title: PICK },
      default: PICK,
    },
    roots: [EXP],
    writable: ["title"],
    refs,
  });

  it("succeeds with NO operator token, and the surface serves the derived mutations", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    const handle = await serve({
      mounts: { world: gateway },
      tokens: { "op-token": { operator: true }, "sync-token": { actor: SYNC_SEED } },
      port: 0,
      host: "127.0.0.1",
    });
    live = handle;
    liveGateway = gateway;
    await gateway.append([
      signClaims(
        grantClaims(STORE_ENTITY, SYNC, "register", OPERATOR, 9_100, "sync:"),
        OPERATOR_SEED,
      ),
    ]);
    const post = (path: string, token: string, body: unknown): Promise<Response> =>
      fetch(`${handle.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    expect((await post("/world/register", "sync-token", personBody())).status).toBe(200);
    const res = await post("/world/register", "sync-token", experienceBody(REFS));
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as {
      registered: string;
      bound: boolean;
      warnings?: string[];
    };
    expect(outcome).toMatchObject({ registered: "sync:experience", bound: true });
    expect(outcome.warnings ?? []).toEqual([]);

    const gql = await post("/world/graphql", "op-token", {
      query: `{ __type(name: "Mutation") { fields { name } } }`,
    });
    const names = (
      (await gql.json()) as { data: { __type: { fields: { name: string }[] } } }
    ).data.__type.fields.map((f) => f.name);
    expect(names).toContain("linksync_experience_experiencers");
    expect(names).toContain("unlinksync_experience_experiencers");

    const warned = await post("/world/register", "sync-token", experienceBody(REFS_NO_RECIPROCAL));
    expect(warned.status).toBe(200);
    expect(((await warned.json()) as { warnings?: string[] }).warnings).toContain(
      UNDECLARED_WARNING,
    );
    await closeLive();
  });
});
