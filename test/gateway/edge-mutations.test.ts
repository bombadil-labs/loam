// SPEC §51 (T245) — lens-derived edge mutations: the write side of a reference prop is generated
// as the adjoint of the read program. A `refs` declaration on the registration envelope marks a
// prop as a REFERENCE; an exact-role `expand` in the hyperschema body supplies the machine-readable
// delta shape; the surface then serves `link<n>_<P>` / `unlink<n>_<P>` with ID! args and drops the
// prop's PrimitiveValue argument, so a cold introspecting client can no longer mint a string
// fossil. The eight criteria of the working spec (.adlc/specs/51-lens-derived-edges.md) are
// transcribed one-to-one below, each asserted at BOTH levels where the spec says so: the raw delta
// in the store, and what a reader resolves through the lens.
//
// Deliberately NOT asserted here: bilateral reciprocal derivation and typed nested view fields
// (both DEFERRED by the spec), and the REST door (this ticket generates the GraphQL surface only).
// All fixtures are MemoryBackend stores; nothing here touches a real home.

import { describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  parseTerm,
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
import type { RefSpecs } from "../../src/gateway/registration.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { observed } from "../spike/garden.js";
import { pickLatest } from "./fixtures.js";

vi.setConfig({ testTimeout: 30_000 }); // one describe drives a real listening server

const OPERATOR_SEED = "0d".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const WRITER_SEED = "d1".repeat(32);
const WRITER = authorForSeed(WRITER_SEED);
const SECOND_SEED = "d2".repeat(32);
const SECOND = authorForSeed(SECOND_SEED);
const SYNC_SEED = "d3".repeat(32); // the scoped connection, granted register over `sync:`
const SYNC = authorForSeed(SYNC_SEED);

const MYK = "person:myk";
const SAGE = "person:sage";
const EXP = "experience:hike";

// The repro's own names (Myk's live `sync:` container): the experience lens expands the
// `experiencer` role into the person's view, and the reciprocal declaration says how the same
// delta speaks on the person's side.
const PERSON = { name: "sync:person", alg: 1, body: entityGatherBody() } as const;
const PERSON_READING: Schema = {
  name: "sync:person",
  props: new Map([
    ["name", pickLatest],
    // The reciprocal context: where a well-formed link delta folds on the PERSON side.
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

// The spec's verbatim warning sentence (criterion e).
const UNDECLARED_WARNING =
  "reciprocal context for sync:experience.experiencers undeclared; " +
  "link deltas will not fold on the sync:person side";

// A governed world: the operator legislates, two granted authors write, two people exist.
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

// Registers the experience lens with the given envelope extras, via the durable door — the same
// door republish/evolution rides.
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

// --- introspection helpers (hand-rendered type strings, so expectations stay literals) -----------

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

// The deltas appended after `settled` — the raw-ground half of a two-level assertion.
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

// A delta's pointers, normalized for structural comparison (H4: ids and signatures differ across
// authors and moments; the SHAPE is what the criterion pins).
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
    // The user story's exact field name: lens `sync:experience` mangles to `sync_experience`.
    const link = fields.get("linksync_experience_experiencers");
    expect(link, [...fields.keys()].join(", ")).toBeDefined();
    expect(link!.args).toEqual({ entity: "ID!", target: "ID!" });
    const unlink = fields.get("unlinksync_experience_experiencers");
    expect(unlink).toBeDefined();
    expect(unlink!.args).toEqual({ entity: "ID!", target: "ID!" });

    // The base mutation: `title` still writes as a primitive; `experiencers` has NO argument —
    // a prop is a reference or a primitive, never both (the fossil path does not regenerate).
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
    // refs WINS: the argument is gone even though `writable` names the prop.
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

    // DELTA level: exactly one new delta, signed by the writer, carrying the spec's two pointers —
    // {role R, at target, context C_reciprocal} + {role R_reverse, at entity, context P}.
    const fresh = await freshDeltas(gateway, backend, settled);
    expect(fresh).toHaveLength(1);
    const edge = fresh[0]!;
    expect(edge.claims.author).toBe(WRITER);
    expect(shapeOf(edge)).toEqual(
      shapeOf({
        id: "x",
        claims: {
          timestamp: 0,
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

    // OBJECT level: the mutation's own answer folds the person into the prop as a nested view,
    // and a plain re-query agrees — the edge is real ground, not a mutation echo.
    expect(linkedView["experiencers"]).toMatchObject([{ name: "Myk" }]);
    const reread = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    expect(view(reread, "sync_experience")["experiencers"]).toMatchObject([{ name: "Myk" }]);

    // And the RECIPROCAL side: the same delta folds into the person's `experiences` prop.
    const person = await gateway.query(`{ sync_person(entity: "${MYK}") { experiences } }`);
    expect(view(person, "sync_person")["experiences"]).toEqual([EXP]);

    // Last: the delta is the SAME shape a hand-authored _claim produces (the folklore the
    // mutation replaces) — the two structures are equal, delta for delta. Authored at SAGE so it
    // cannot contaminate the assertions above; substituting SAGE back to MYK makes them coincide.
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
    // The SECOND author links the SAME pair — the bystander the retraction must not touch.
    await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { _hex } }`,
      undefined,
      { actor: SECOND_SEED },
    );
    const both = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    expect(view(both, "sync_experience")["experiencers"]).toMatchObject([
      { name: "Myk" },
      { name: "Myk" },
    ]);

    const unlinked = await gateway.query(
      `mutation { unlinksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { experiencers } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    // OBJECT level: the writer's edge is gone; the second author's stands (two-sided).
    expect(view(unlinked, "unlinksync_experience_experiencers")["experiencers"]).toMatchObject([
      { name: "Myk" },
    ]);

    // DELTA level: retraction is a CLAIM — the original delta survives in the store beside its
    // negation; nothing was purged. The second author's edge drew no strike at all.
    await gateway.flush();
    const all = await idsOf(backend);
    expect(all.has(writersEdge!.id), "the retracted edge delta still exists — history").toBe(true);
    const strikes = gateway.reactor.negationsOf(writersEdge!.id);
    expect(strikes.length, "the writer's edge is negated").toBeGreaterThan(0);
    for (const strike of strikes) {
      expect(gateway.reactor.get(strike)?.claims.author).toBe(WRITER); // retract-your-OWN
    }
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
    // ROOT side folds (object level): the link mutation generated and works.
    expect(view(linked, "linksync_experience_experiencers")["experiencers"]).toMatchObject([
      { name: "Myk" },
    ]);

    // DELTA level, both pointers asserted: the root-side pointer carries context P (that is what
    // folds it); the target-side pointer carries NO context — nothing to fold on the person side.
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
    expect(
      atExperience?.target.kind === "entity" ? atExperience.target.entity.context : "wrong-kind",
    ).toBe("experiencers");

    // ...and the warning told the truth: the person's side did NOT fold.
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
    // The feature is PRESENT (this half is what makes the bystander half meaningful)...
    expect(fields.has("linksync_experience_experiencers")).toBe(true);
    // ...and _claim is EXACTLY what it always was: one arg, the same pointer input shape.
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

    // A raw _claim edge still folds exactly as before — the general door stays open.
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
    // ACT 1 — the pre-§51 world: `experiencers` is writable, typed PrimitiveValue.
    await registerExperience(gateway, { writable: ["title", "experiencers"] });
    const before = await mutationSurface(gateway);
    expect(before.fields.has("linksync_experience_experiencers")).toBe(false);
    expect(before.fields.get("sync_experience")!.args).toEqual({
      entity: "ID!",
      title: "PrimitiveValue",
      experiencers: "PrimitiveValue",
    });

    // The cold client's natural mistake: a STRING fossil — an inert id expand can never follow.
    const fossil = await gateway.query(
      `mutation { sync_experience(entity: "${EXP}", experiencers: "${MYK}") { experiencers } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(fossil, "sync_experience")["experiencers"]).toEqual([MYK]);

    // ACT 2 — republish WITH refs: the surface regenerates immediately, no reboot.
    const outcome = await registerExperience(gateway, { refs: REFS });
    expect(outcome.bound).toBe(true);
    const after = await mutationSurface(gateway);
    expect(after.fields.has("linksync_experience_experiencers")).toBe(true);
    expect(after.fields.has("unlinksync_experience_experiencers")).toBe(true);
    expect(after.fields.get("sync_experience")!.args).toEqual({
      entity: "ID!",
      title: "PrimitiveValue",
    });

    // The fossil KEEPS resolving — no migration, nothing breaks.
    const still = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    expect(view(still, "sync_experience")["experiencers"]).toEqual([MYK]);

    // A real link lands beside it: the MIXED ARRAY is correct behavior, pinned exactly —
    // the inert string first (older), the resolved person view second.
    await gateway.query(
      `mutation { linksync_experience_experiencers(entity: "${EXP}", target: "${MYK}") { _hex } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const mixed = await gateway.query(`{ sync_experience(entity: "${EXP}") { experiencers } }`);
    const arr = view(mixed, "sync_experience")["experiencers"] as unknown[];
    expect(arr).toHaveLength(2);
    expect(arr[0]).toBe(MYK); // the fossil: still a bare string
    expect(arr[1]).toMatchObject({ name: "Myk" }); // the edge: the person, resolved
    await gateway.close();
  });
});

describe("§51 (h) — a prefix/inSet role expand: a reference for typing only", () => {
  it("drops the primitive argument and names the prop a reference, but mints no link mutation", async () => {
    const { gateway } = await world();
    // The activity lens expands a whole ROLE FAMILY (`rel:*`) — no single canonical role to
    // author, so the declared `rel:knows` reference gets typing but no mutation pair.
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
    // Typed as a reference: NO primitive argument for contacts...
    expect(base!.args).toEqual({ entity: "ID!", note: "PrimitiveValue" });
    // ...and the description says REFERENCE, not read-only — that is the typing the criterion
    // pins, and it is what separates "a reference prop" from "a prop nobody opened".
    expect(base!.description).toContain("Reference props");
    expect(base!.description).toContain("contacts");
    expect(base!.description).not.toMatch(/Read-only here.*contacts/);
    // ...but NO link mutation is generated: there is no single canonical role to author.
    expect(fields.has("linksync_activity_contacts")).toBe(false);
    expect(fields.has("unlinksync_activity_contacts")).toBe(false);
    await gateway.close();
  });
});

// --- (a) — the scoped register door: `refs` is names, and it rides the fence like roots/writable --

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

    // The scoped connection registers BOTH lenses inside its `sync:` fence — refs and all.
    expect((await post("/world/register", "sync-token", personBody())).status).toBe(200);
    const res = await post("/world/register", "sync-token", experienceBody(REFS));
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as {
      registered: string;
      bound: boolean;
      warnings?: string[];
    };
    expect(outcome).toMatchObject({ registered: "sync:experience", bound: true });
    // A declared reciprocal is a clean registration: no warning rides the response.
    expect(outcome.warnings ?? []).toEqual([]);

    // The introspected surface — the cold client's entire documentation — teaches the truth.
    const gql = await post("/world/graphql", "op-token", {
      query: `{ __type(name: "Mutation") { fields { name } } }`,
    });
    const names = (
      (await gql.json()) as { data: { __type: { fields: { name: string }[] } } }
    ).data.__type.fields.map((f) => f.name);
    expect(names).toContain("linksync_experience_experiencers");
    expect(names).toContain("unlinksync_experience_experiencers");

    // And the register response is where the undeclared-reciprocal warning rides (criterion e's
    // door half): a republish without the reciprocal draws the spec's sentence, verbatim.
    const warned = await post("/world/register", "sync-token", experienceBody(REFS_NO_RECIPROCAL));
    expect(warned.status).toBe(200);
    expect(((await warned.json()) as { warnings?: string[] }).warnings).toContain(
      UNDECLARED_WARNING,
    );
    await closeLive();
  });
});
