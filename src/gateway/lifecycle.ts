// Lifecycle & binding (ticket T19: the Gateway's registration machinery, in its own module — the
// last and most entangled concern of the decomposition, moved once every other seam was known).
// This is how a surface comes to BE: register (the in-process binding), publishRegistration (the
// same binding as data, so the surface survives reopen with no code), replayRegistrations (the
// fixpoint that re-derives the store's slice of the surface from surviving definitions), rebind
// (a whole desired set under a fresh generation), and the materialization naming that ties a
// schema to the reactor. Everything that can refuse refuses BEFORE any state changes — a failed
// registration leaves the gateway exactly as it was, and "registered" never means "silently
// missing its mutations".
//
// What did NOT move — the spine: the constructor, attachPersistence, open/boot (static factories
// on the private constructor — the class's irreducible job is being born), and reseat (the
// re-birth after an erasure). Those are the class itself; this module is what the born class does
// to serve a surface. The bodies here reach the gateway only through its declared internals seam
// (the `@internal` members on the class — see the seam note in gateway.ts).

import {
  DeltaSet,
  SchemaRegistry,
  authorForSeed,
  evalTerm,
  loadHyperSchema,
  makeDelta,
  schemaToJson,
  publishHyperSchemaClaims,
  signClaims,
  termHash,
  type Delta,
  type HyperSchema,
  type Primitive,
  type Schema,
} from "@bombadil/rhizomatic";
import { NUL, type Bound, type Gateway, type RequestContext } from "./gateway.js";
import { buildGqlSchema } from "./gql.js";
import {
  lensOf,
  lawfulSnapshot,
  readinglessExpandRole,
  parseClaimTemplates,
  readRegistrations,
  registrationDeltaClaims,
  schemaEntityFor,
  type ClaimTemplates,
  type ResolverSpecs,
} from "./registration.js";
import { loadRenderers, readRenderers } from "./renderers.js";
import { loadResolvers } from "./resolvers.js";

// Every claim template must be VISIBLE to its own schema: substitute sentinels for the arg
// holes, build the specimen delta, and require that at least one entity the template touches
// can see it through this schema's gather. A mutation whose writes its own reads would never
// show is refused before it can mislead anyone. Fidelity limits, stated plainly: the
// specimen is authored as the OPERATOR (so governed-store author lenses judge it honestly)
// with sentinel values — a body that predicates on facets the template cannot carry (exotic
// value ranges, exact timestamps) is judged best-effort.
function assertTemplatesVisible(
  schema: HyperSchema,
  templates: ClaimTemplates | undefined,
  registry: SchemaRegistry,
  specimenAuthor: string,
): void {
  for (const [name, template] of Object.entries(templates ?? {})) {
    const pointers = template.pointers.map((p) => {
      if (p.at !== undefined) {
        return {
          role: p.role,
          target: {
            kind: "entity" as const,
            entity: { id: `loam:specimen:${p.at.arg}`, context: p.context ?? p.role },
          },
        };
      }
      const value =
        typeof p.value === "object" && p.value !== null ? "loam:specimen" : (p.value as Primitive);
      return { role: p.role, target: { kind: "primitive" as const, value } };
    });
    const specimen = makeDelta({ timestamp: 1, author: specimenAuthor, pointers });
    const ground = DeltaSet.from([specimen]);
    const sentinels = [
      ...new Set(pointers.flatMap((p) => (p.target.kind === "entity" ? [p.target.entity.id] : []))),
    ];
    const seen = sentinels.some((root) => {
      const result = evalTerm(schema.body, ground, root, registry);
      if (result.sort !== "hview") return false;
      for (const entries of result.hview.props.values()) {
        if (entries.some((e) => e.delta.id === specimen.id)) return true;
      }
      return false;
    });
    if (!seen) {
      throw new Error(
        `schema ${schema.name}: template "${name}" emits a delta this schema cannot see ` +
          `from any entity it touches — a write its own reads would never show`,
      );
    }
  }
}

// A body must MATERIALIZE (yield an HView): SchemaRegistry and buildGqlSchema never evaluate
// it, and reactor.register throws for anything else — after state has begun to change. The
// sort of a term is content-independent (the offeredLens trick), so trial-eval it empty and
// refuse a dset-sort body before it can persist, half-bind, or corrupt a boot.
function assertMaterializable(schema: HyperSchema, registry: SchemaRegistry): void {
  const trial = evalTerm(schema.body, DeltaSet.from([]), "loam:trial", registry);
  if (trial.sort !== "hview") {
    throw new Error(
      `schema ${schema.name}: its body must yield a hyperview (a group over the gathered ` +
        `deltas), not a ${trial.sort}`,
    );
  }
}

// Every `expand` must NAME the child's reading (rhizomatic 0.8 / issue #23) — refused here, at the
// door, because nothing else catches it in time. An UNKNOWN reading name is refused by
// SchemaRegistry.build; an ABSENT one is refused by nothing: `parseTerm` accepts the legacy shape,
// `collectReadingRefs` has no ref to resolve, and `assertMaterializable` trial-evals over an EMPTY
// delta set, so no expansion is ever produced and no error is raised. Such a body would persist on
// append-only ground, bind, advertise its type — and then throw on the first read of an entity that
// actually carries a child pointer, permanently and un-appendably. The absent case now gets the same
// loud refusal the wrong-name case always had; a store holding such a body from before 0.8 is healed
// by the §20 `expand-reading` migration instead of being served broken.
function assertReadingsNamed(schema: HyperSchema): void {
  const role = readinglessExpandRole(schema.body);
  if (role === undefined) return;
  throw new Error(
    `schema ${schema.name}: its \`expand\` of role "${role}" names no \`reading\` — an expanded ` +
      `child resolves through its OWN resolution Schema (rhizomatic issue #23), so the gather must ` +
      `name it; a pre-0.8 body is migrated (SPEC §20), not served`,
  );
}

// Everything that shapes the surface, as one comparable key.
export function boundKey(r: Bound): string {
  return [
    r.hyperschema.name,
    termHash(r.hyperschema.body),
    JSON.stringify(schemaToJson(r.schema)),
    JSON.stringify(r.roots),
    JSON.stringify(r.mutations ?? null),
    JSON.stringify(r.writable ?? null),
    JSON.stringify(r.resolvers ?? null),
    r.entity ?? "",
    r.origin,
  ].join(NUL);
}

// The materialization naming (the bodies of `Gateway.matName` / `lazyMatName` / `matFor`).
// Internal names are generation-qualified: the reactor has no deregister, so an evolved schema
// binds a FRESH materialization under a bumped generation and the superseded one is left behind.
// Lazy names live in a NUL-separated namespace no schema name can enter (register() refuses NUL).
export function matNameImpl(gw: Gateway, name: string): string {
  return ["", `g${gw.generation}`, name].join(NUL);
}

export function lazyMatNameImpl(gw: Gateway, name: string, entity: string): string {
  return [matNameImpl(gw, name), entity].join(NUL);
}

const MAX_LAZY_MATS = 1024;
const DEFAULT_MAX_PUBLIC_WATCHES = 256;

// The materialization watching (schema, entity) — the schema's own when the entity is a
// registered root, a lazily-created cached one otherwise. The caps keep an unauthenticated
// reader from growing the reactor without bound: every watched entity costs memory and
// per-ingest CPU for the gateway's lifetime, and the public door draws on its own, smaller
// budget so a stranger's exhaustion degrades only the stranger's door.
export function matForImpl(
  gw: Gateway,
  name: string,
  entity: string,
  door: "full" | "public" = "full",
): string {
  const def = gw.def(name);
  // One materialization per PROGRAM (§21.7): sibling lenses watch the same gather, so the mat —
  // registered and lazy alike — keys on the hyperschema's name, not the lens the caller named.
  const program = def.hyperschema.name;
  if (def.roots.includes(entity)) return matNameImpl(gw, program);
  const matName = lazyMatNameImpl(gw, program, entity);
  if (!gw.lazyMats.has(matName)) {
    // The reactor has no deregister, so every watched entity costs memory and per-ingest CPU
    // for the gateway's lifetime. The cap keeps an unauthenticated reader from growing the
    // reactor without bound; raising it is a deploy decision, not a default.
    if (gw.lazyMats.size >= MAX_LAZY_MATS) {
      throw new Error(
        `this gateway already watches ${MAX_LAZY_MATS} unregistered entities — ` +
          `register the roots you mean to hold live`,
      );
    }
    if (door === "public") {
      const cap = gw.options.maxPublicWatches ?? DEFAULT_MAX_PUBLIC_WATCHES;
      if (gw.publicLazyMats.size >= cap) {
        throw new Error(
          `the public door already holds ${cap} unregistered entities live — ` +
            `query instead, or ask the operator to register the roots that matter`,
        );
      }
      gw.publicLazyMats.add(matName);
    }
    gw.reactor.register(matName, def.hyperschema.body, [entity], gw.registry);
    gw.lazyMats.add(matName);
  }
  return matName;
}

// ── The grouped serving surface (§21.7) — dedup is a data structure, not a discipline ──────────
// ONE derivation from the surviving bindings; every consumer iterates the groups. A PROGRAM is a
// hyperschema plus every lens bound over it: the registry takes one hyperschema per group, the
// reactor registers one materialization per program over the UNION of its members' roots, and the
// doors (GraphQL family, REST segment, loam.public, the §17 ladder) key per LENS.
export interface Program {
  readonly hyperschema: HyperSchema;
  readonly roots: readonly string[]; // the union of member bindings' roots
  readonly lenses: Map<string, Bound>; // lens name -> its binding
}

// Group a bound set into programs. THE REFUSAL AT THE SEAM: two bindings naming one hyperschema
// with DIFFERENT bodies (termHash mismatch) are refused loudly, before any state changes — one
// name, one gather; a rival body is a different schema wanting a different name.
export function groupPrograms(regs: readonly Bound[]): Map<string, Program> {
  const programs = new Map<
    string,
    { hyperschema: HyperSchema; hash: string; roots: Set<string>; lenses: Map<string, Bound> }
  >();
  for (const reg of regs) {
    const name = reg.hyperschema.name;
    const hash = termHash(reg.hyperschema.body);
    const lens = lensOf(reg);
    const group = programs.get(name);
    if (group === undefined) {
      programs.set(name, {
        hyperschema: reg.hyperschema,
        hash,
        roots: new Set(reg.roots),
        lenses: new Map([[lens, reg]]),
      });
      continue;
    }
    if (group.hash !== hash) {
      throw new Error(
        `hyperschema "${name}": two bindings carry DIFFERENT bodies (termHash ${group.hash.slice(0, 12)}… vs ` +
          `${hash.slice(0, 12)}…) — one name, one gather; a rival body is a different schema and wants a different name`,
      );
    }
    for (const r of reg.roots) group.roots.add(r);
    group.lenses.set(lens, reg); // latest-per-lens upstream keeps this single-valued
  }
  const out = new Map<string, Program>();
  for (const [name, g] of programs) {
    out.set(name, { hyperschema: g.hyperschema, roots: [...g.roots], lenses: g.lenses });
  }
  return out;
}

// One hyperschema per program — what SchemaRegistry.build takes (it refuses duplicate names, so
// the flat lens list can never be handed to it directly once siblings exist).
const programHyperschemas = (regs: readonly Bound[]): HyperSchema[] =>
  [...groupPrograms(regs).values()].map((p) => p.hyperschema);

// The registry's SECOND half since rhizomatic 0.8 / issue #23: the readings — every bound resolution
// Schema, by name — so an `expand` term that names its child's reading (`reading: "Post"`) resolves
// that name at eval time. A reading is a lens: its name is the lens name, distinct within a program
// (latest-per-lens keeps it single-valued), so keying by name dedups cleanly and the registry never
// sees a spurious `duplicate reading name`. An anonymous Schema cannot be referenced as a reading, so
// it is dropped here rather than handed to a build that would reject it. EVERY lens's Schema is
// included, not one-per-program: a feed in one program expands posts whose reading lives in ANOTHER.
const programReadings = (regs: readonly Bound[]): Schema[] => {
  const byName = new Map<string, Schema>();
  // Read the winning lens from the GROUPING, not from the flat list. Both would agree today — the
  // flat list is append-ordered and `groupPrograms` keeps latest-per-lens — but agreeing by
  // coincidence is not the same as having one rule. It matters because a flat list legitimately
  // holds TWO bindings for one lens: `registerImpl` evolves a lens in place with
  // `[...gw.registered, theNewOne]`, so the old and new Schemas are both present. Anything that
  // "refused a duplicate lens name" here would break evolution; anything that picked by array order
  // would be picking the same winner for a different, unstated reason. Deferring to the grouping
  // means the reading an `expand` resolves through is BY CONSTRUCTION the lens the surface serves.
  for (const program of groupPrograms(regs).values()) {
    for (const [lens, bound] of program.lenses) {
      // Key on the LENS name, and re-stamp it: a Schema may be anonymous (`register(PLANT,
      // PLANT_POLICY, …)` binds and serves lens `Plant` with an unnamed Schema), and everything else
      // in the system identifies a lens by `lensOf`. Keying on `schema.name` dropped exactly those —
      // a lens you could serve, query and decorate, but that no body could name as a `reading`.
      byName.set(lens, bound.schema.name === lens ? bound.schema : { ...bound.schema, name: lens });
    }
  }
  return [...byName.values()];
};

// Bind a whole desired set at once, under a fresh generation of materializations. The set was
// validated by the caller (the fixpoint), so nothing here can half-apply. Superseded
// materializations stay behind (the reactor has no deregister); superseded lazy watches stop
// counting against the cap.
export function rebindImpl(gw: Gateway, next: Bound[]): void {
  const programs = groupPrograms(next); // refuses a rival body before any state changes
  const registry = SchemaRegistry.build(
    [...programs.values()].map((p) => p.hyperschema),
    programReadings(next),
  );
  const gql = buildGqlSchema(next, gw.gqlHooks());
  gw.generation += 1;
  for (const program of programs.values()) {
    gw.reactor.register(
      matNameImpl(gw, program.hyperschema.name),
      program.hyperschema.body,
      program.roots,
      registry,
    );
  }
  gw.lazyMats.clear(); // generation-stale by construction — new watches re-create their own
  gw.publicLazyMats.clear();
  gw.registered = next;
  gw.registry = registry;
  gw.gql = gql;
}

// Re-derive the store's slice of the surface and follow it (the body of
// `Gateway.replayRegistrations`). The desired set is the manual registrations (this process's
// own) plus every store registration whose schema GENERATES from surviving definitions — so an
// evolved definition reshapes the surface, and a negated one retires its type. Store
// registrations install in fixpoint rounds: a schema that refs another must validate after it,
// and timestamp order is not enough (ties, same millisecond). One that never resolves — or whose
// body cannot materialize — is left unbound rather than crashing the boot. A purely-additive
// change binds incrementally under the current generation; only a change or a retirement pays
// for a rebind.
// Why a candidate failed to bind, remembered per gateway. The fixpoint MUST swallow these — a
// registration that cannot bind is left unbound rather than crashing a boot, and one bad candidate
// may not take the others down. But swallowing the error and then GUESSING at the cause is how an
// operator gets told something false about their own store: the publish path used to answer every
// failure with "another hyperschema already answers to <name>", which is wrong whenever the real
// cause was anything else (a missing reading, a manual binding shadowing the published one, a body
// that will not materialize). So the reason is kept here, and the one caller that can act on it —
// publishRegistration, which just wrote to append-only ground — reports it verbatim.
const bindFailures = new WeakMap<Gateway, Map<string, string>>();
const failureKey = (entity: string, lens: string): string => [entity, lens].join(NUL);
const rememberBindFailure = (gw: Gateway, key: string, err: unknown): void => {
  const seen = bindFailures.get(gw) ?? new Map<string, string>();
  bindFailures.set(gw, seen);
  seen.set(key, err instanceof Error ? err.message : String(err));
};
const forgetBindFailure = (gw: Gateway, key: string): void => {
  bindFailures.get(gw)?.delete(key);
};
const lastBindFailure = (gw: Gateway, key: string): string | undefined =>
  bindFailures.get(gw)?.get(key);

export function replayRegistrationsImpl(gw: Gateway): void {
  const manual = gw.registered.filter((r) => r.origin === "manual");
  const accepted: Bound[] = [...manual];
  let pending: Bound[] = readRegistrations(gw.reactor, gw.operatorAuthor).map((r) => ({
    ...r,
    origin: "store" as const,
  }));
  for (;;) {
    const stillPending: Bound[] = [];
    let progressed = false;
    for (const reg of pending) {
      const attempt = (candidate: Bound): boolean => {
        try {
          const trial = [...accepted, candidate];
          const registry = SchemaRegistry.build(programHyperschemas(trial), programReadings(trial)); // groups: one hyperschema per program; a rival body throws here
          assertReadingsNamed(candidate.hyperschema); // a readingless expand can never resolve
          assertMaterializable(candidate.hyperschema, registry); // reactor.register would throw
          assertTemplatesVisible(
            candidate.hyperschema,
            candidate.mutations,
            registry,
            gw.operatorAuthor ?? "loam:specimen",
          );
          buildGqlSchema(trial, gw.gqlHooks()); // GraphQL name collisions
          accepted.push(candidate);
          forgetBindFailure(gw, failureKey(candidate.entity ?? "", lensOf(candidate)));
          return true;
        } catch (err) {
          // Swallowed on purpose (one bad candidate must not fail the boot) — but REMEMBERED, so
          // publishRegistration can tell the operator what actually happened instead of guessing.
          rememberBindFailure(gw, failureKey(candidate.entity ?? "", lensOf(candidate)), err);
          return false;
        }
      };
      // A stored registration whose TEMPLATES are the only problem binds without them —
      // the schema still serves; the surface just lacks the mutation.
      const templateless: Bound = {
        hyperschema: reg.hyperschema,
        schema: reg.schema,
        roots: reg.roots,
        origin: reg.origin,
        ...(reg.entity === undefined ? {} : { entity: reg.entity }),
        ...(reg.resolvers === undefined ? {} : { resolvers: reg.resolvers }),
      };
      if (attempt(reg) || (reg.mutations !== undefined && attempt(templateless))) {
        progressed = true;
      } else {
        stillPending.push(reg); // its refs are not registered yet — try again next round
      }
    }
    if (!progressed || stillPending.length === 0) break;
    pending = stillPending;
  }

  const currentKeys = new Set(gw.registered.map((r) => boundKey(r)));
  const acceptedKeys = new Set(accepted.map((r) => boundKey(r)));
  if (
    acceptedKeys.size === currentKeys.size &&
    [...currentKeys].every((k) => acceptedKeys.has(k))
  ) {
    return; // nothing moved
  }
  if ([...currentKeys].every((k) => acceptedKeys.has(k))) {
    // Purely additive at the BINDING level. THE REBIND RULE (§21.7) decides at the PROGRAM level:
    // a new lens whose roots are a SUBSET of its program's existing union rides this additive
    // path (the shared materialization already gathers them); one that WIDENS the union — or a
    // program the reactor has never seen — needs its materialization (re)registered, and a
    // widened EXISTING program forces a generation rebind (the reactor has no deregister).
    const prior = groupPrograms(gw.registered);
    const next = groupPrograms(accepted); // refuses a rival body before any state changes
    let widened = false;
    const fresh: Program[] = [];
    for (const [name, program] of next) {
      const before = prior.get(name);
      if (before === undefined) {
        fresh.push(program);
        continue;
      }
      const covered = new Set(before.roots);
      if (!program.roots.every((r) => covered.has(r))) widened = true;
    }
    if (widened) {
      rebindImpl(gw, accepted);
      return;
    }
    const registry = SchemaRegistry.build(
      [...next.values()].map((p) => p.hyperschema),
      programReadings(accepted),
    );
    const gql = buildGqlSchema(accepted, gw.gqlHooks());
    for (const program of fresh) {
      gw.reactor.register(
        matNameImpl(gw, program.hyperschema.name),
        program.hyperschema.body,
        program.roots,
        registry,
      );
    }
    gw.registered = accepted;
    gw.registry = registry;
    gw.gql = gql;
    return;
  }
  rebindImpl(gw, accepted);
}

// Register a (HyperSchema, Schema) pair over the given roots (the body of `Gateway.register`): a
// live materialization per root, and a GraphQL surface rebuilt to include it. Everything that can
// refuse — duplicate names, unresolved refs, GraphQL field collisions — refuses BEFORE any state
// changes, so a failed registration leaves the gateway exactly as it was. Register dependencies
// first: earlier schemas are visible to later refs.
export function registerImpl(
  gw: Gateway,
  hyperschema: HyperSchema,
  schema: Schema,
  roots: readonly string[],
  mutations?: ClaimTemplates,
  writable?: readonly string[],
): void {
  if (hyperschema.name.includes(NUL)) {
    throw new Error("a schema name may not contain NUL — that alphabet is the gateway's own");
  }
  // Normalize through the parser so every invariant the wire form promises (usable names,
  // contexts present, each on entities only) holds for hand-built templates too.
  const templates = mutations === undefined ? undefined : parseClaimTemplates(mutations);
  const next: Bound[] = [
    ...gw.registered,
    {
      hyperschema,
      schema,
      roots,
      origin: "manual",
      lensName: schema.name ?? hyperschema.name,
      ...(templates ? { mutations: templates } : {}),
      ...(writable ? { writable } : {}),
    },
  ];
  const registry = SchemaRegistry.build(programHyperschemas(next), programReadings(next)); // groups: refs + the rival-body refusal
  assertReadingsNamed(hyperschema); // refuses an expand that names no child reading (#23)
  assertMaterializable(hyperschema, registry); // refuses a body that yields no hyperview
  assertTemplatesVisible(hyperschema, templates, registry, gw.operatorAuthor ?? "loam:specimen"); // refuses invisible writes
  const gql = buildGqlSchema(next, gw.gqlHooks()); // refuses collisions
  // Incremental: the PROGRAM's materialization registers over its (possibly union-widened) roots,
  // under the current generation. register() is the in-process path; the replay's rebind rule
  // governs the durable one.
  const program = groupPrograms(next).get(hyperschema.name)!;
  gw.reactor.register(matNameImpl(gw, hyperschema.name), hyperschema.body, program.roots, registry);
  gw.registered = next;
  gw.registry = registry;
  gw.gql = gql;
}

// Meta-resolve schema-defining deltas via HYPER_SCHEMA_SCHEMA into a HyperSchema (the body of
// `Gateway.loadHyperSchema`). The definition is proven against a TRIAL set first — the store is
// append-only, so nothing lands until the deltas are known to define what the caller says they
// define. The trial reads the LAWFUL slice (the operator's, in a governed store): a federated
// foreign definition at the same entity — newer, or malformed — must not shadow what the operator
// is proving.
export async function loadHyperSchemaImpl(
  gw: Gateway,
  deltas: Iterable<Delta>,
  entity: string,
): Promise<HyperSchema> {
  const batch = [...deltas];
  const trial = lawfulSnapshot(gw.reactor, gw.operatorAuthor);
  for (const d of batch) trial.add(d);
  const schema = loadHyperSchema(trial, entity); // throws here → nothing was persisted
  await gw.append(batch);
  return schema;
}

// Load every resolver's ESM (SPEC §22) into the content-addressed cache (the body of
// `Gateway.preloadResolvers`) — the live lenses AND every answerable version's, so both the warm
// path and a pinned version-door read find their functions synchronously. Async (a `data:`
// import); idempotent (the cache dedups by content address). Called after every (re)bind and
// every publish, so a newly-arrived resolver is runnable by the next read.
export async function preloadResolversImpl(gw: Gateway): Promise<void> {
  const specs: Array<ResolverSpecs | undefined> = [
    ...gw.registered.map((r) => r.resolvers),
    ...gw.registrationVersions().map((v) => v.resolvers),
  ];
  await loadResolvers(specs);
  // Renderer bundles ride the same content-addressed ESM loader (SPEC §23/§22.3), pre-loaded here so
  // the synchronous serve path always finds its function.
  await loadRenderers(readRenderers(gw.reactor, gw.operatorAuthor).map((r) => r.bundle));
}

// Publish a schema and its registration as data, then bind them (the body of
// `Gateway.publishRegistration`), so the surface survives reopen with no code. Two deltas: the
// DEFINITION (schema-schema claims at the schema entity — proven by loadHyperSchema before
// anything lands) and the REFERENCE that registers it. Republishing at the same entity is
// evolution: the running surface rebinds to the latest surviving definition. Any granted author
// could APPEND such deltas (writes are open), but only the operator's ever bind — so this refuses
// non-operators up front rather than persist deltas that would look registered while shaping
// nothing.
export async function publishRegistrationImpl(
  gw: Gateway,
  hyperschema: HyperSchema,
  schema: Schema,
  roots: readonly string[],
  context?: RequestContext,
  entity?: string,
  mutations?: ClaimTemplates,
  writable?: readonly string[],
  resolvers?: ResolverSpecs,
): Promise<void> {
  const seed = context?.actor ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot publish a registration");
  }
  // A governed store binds only the OPERATOR's law (readRegistrations filters on it), so
  // refuse a non-operator publish here rather than persist deltas that would look
  // registered but silently never shape the surface.
  if (gw.operatorAuthor !== undefined && authorForSeed(seed) !== gw.operatorAuthor) {
    throw new Error("append rejected: only the operator may publish a registration");
  }
  if (hyperschema.name.includes(NUL)) {
    throw new Error("a hyperschema name may not contain NUL — that alphabet is the gateway's own");
  }
  // Prove the WHOLE registration before anything persists — the refs must resolve against
  // what is bound (minus the same name, which this publish may be evolving), the body must
  // materialize, the templates must be well-formed AND visible AND buildable into a GraphQL
  // surface. Loud here, quiet on replay: a bad delta on append-only ground cannot be
  // taken back, and "registered" must never mean "silently missing its mutations".
  const templates = mutations === undefined ? undefined : parseClaimTemplates(mutations);
  // A resolver may only name a field the schema HAS (SPEC §22) — a resolver over a phantom field
  // would advertise a door the lens can never fill. Loud here, at publish, where the schema is known
  // (parseResolvers checked shape/rung; this checks existence). Rung (e) synthetics — fields with no
  // Policy at all — are design-only in v1, so every resolved field must already be in the schema.
  if (resolvers !== undefined) {
    for (const field of Object.keys(resolvers)) {
      if (!schema.props.has(field)) {
        throw new Error(
          `resolver "${field}": no such field in the schema — a resolver rides an existing ` +
            `property (synthetic fields with no Policy are SPEC §22 rung (e), not built in v1)`,
        );
      }
    }
    // Prove the ESM actually loads to a function NOW, so "registered" never means "carries a
    // resolver the doors cannot run" — the same loud-here/quiet-on-replay discipline as templates.
    await loadResolvers([resolvers]);
  }
  const lensName = schema.name ?? hyperschema.name;
  const survivors = gw.registered.filter(
    (r) => !(r.hyperschema.name === hyperschema.name && lensOf(r) === lensName),
  );
  const trialLenses: Bound[] = [
    ...survivors,
    { hyperschema, schema, roots, origin: "store", lensName },
  ];
  const trialRegistry = SchemaRegistry.build(
    programHyperschemas(trialLenses),
    programReadings(trialLenses),
  ); // groups: one hyperschema per program, and the rival-body refusal fires HERE, loudly
  assertReadingsNamed(hyperschema); // loud HERE: append-only ground cannot take it back
  assertMaterializable(hyperschema, trialRegistry);
  assertTemplatesVisible(
    hyperschema,
    templates,
    trialRegistry,
    gw.operatorAuthor ?? authorForSeed(seed),
  );
  buildGqlSchema(
    [
      ...survivors,
      {
        hyperschema,
        schema,
        roots,
        lensName,
        ...(templates ? { mutations: templates } : {}),
        ...(writable ? { writable } : {}),
        ...(resolvers ? { resolvers } : {}),
      },
    ],
    gw.gqlHooks(),
  ); // arg names, field collisions, resolver output types — everything the replay would trip on, NOW

  const author = authorForSeed(seed);
  const schemaEntity = schemaEntityFor(hyperschema, entity);
  const definition = signClaims(
    publishHyperSchemaClaims(hyperschema, schemaEntity, author, gw.nextTimestamp()),
    seed,
  );
  await loadHyperSchemaImpl(gw, [definition], schemaEntity); // proves, then persists the definition
  // The Schema is lifted to a first-class entity (SPEC §21): publish it as the LIVING
  // `schema:<name>` (single-lens — its name is the hyperschema's) AND freeze a content-addressed
  // VersionedSchema snapshot, then file the binding that references both. All three ride down
  // together so `loadSchema` finds the entities the binding names.
  const { living, snapshot, binding } = registrationDeltaClaims(
    schemaEntity,
    lensName, // the LIVING entity is schema:<lens> — the name in the bytes IS the grouping key
    schema,
    roots,
    author,
    () => gw.nextTimestamp(),
    templates,
    writable,
    resolvers,
  );
  await gw.append([
    signClaims(living, seed),
    signClaims(snapshot, seed),
    signClaims(binding, seed),
  ]);
  replayRegistrationsImpl(gw);
  await preloadResolversImpl(gw);
  // Success must mean BOUND. The deltas are down either way (append-only ground), but a
  // publish the replay could not bind — a name already answered for by another entity, a
  // collision with a manual registration — is not to be reported as a served surface.
  if (
    !gw.registered.some(
      (r) => r.origin === "store" && r.entity === schemaEntity && lensOf(r) === lensName,
    )
  ) {
    const why = lastBindFailure(gw, failureKey(schemaEntity, lensName));
    throw new Error(
      `the registration persisted but did not bind` +
        (why === undefined
          ? `: it was not among the registrations the store re-derived — check that the operator ` +
            `authored it and that its definition survives`
          : `: ${why}`),
    );
  }
}
