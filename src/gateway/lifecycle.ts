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
import { readContainerTable, subtreeUnder } from "./container.js";
import { fenceAdmits } from "./accounts.js";
import { NUL, type Bound, type Gateway, type RequestContext } from "./gateway.js";
import { buildGqlSchema } from "./gql.js";
import {
  lensOf,
  programOf,
  lawfulSnapshot,
  readinglessExpandRole,
  parseClaimTemplates,
  readContestedBindings,
  readRegistrations,
  referenceProps,
  registrationDeltaClaims,
  schemaEntityFor,
  type ClaimTemplates,
  type ContestedBinding,
  type RefSpecs,
  type ResolverSpecs,
  lensNameFor,
} from "./registration.js";
import {
  admitRenderers,
  readRenderers,
  rendererAdmissionBudget,
  reportUnmounted,
} from "./renderers.js";
import {
  interpretBindingPolicy,
  readBindingPolicy,
  type ResolvedBindings,
} from "./binding-policy.js";
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

// What a publish DID (SPEC §21). Two different questions live here and used to be conflated:
//
//   • is this VALID LAW? — answered before anything persists. Invalid law (a body that will not
//     materialize, an `expand` naming no reading, templates its own reads could never show, a
//     GraphQL surface that will not build) is REFUSED, nothing is written, and the caller gets a
//     throw. That discipline is this module's whole opening promise.
//   • is it SHAPING THIS STORE'S SURFACE? — a DOWNSTREAM effect of a valid claim, and not the same
//     question at all. A registration is a claim; binding is one store's local realization of it.
//     A process-local `register()` holding the lens, or an existing lens answering to that GraphQL
//     field, can leave a perfectly good claim unbound HERE while it binds fine on a peer that pulls
//     it. Refusing to persist because of that would let one process's transient memory veto durable,
//     shareable law — so the claim is written, and the outcome is REPORTED rather than thrown.
//
// Hence: reaching a return means `persisted` — always. `bound` says whether the surface moved.
export interface PublishOutcome {
  readonly persisted: true;
  /** The LENS this publish is about (H6): `schema.name ?? hyperschema.name`, decided here so no
   *  caller has to re-derive it. `bound` and `reason` are facts about THIS reading, never about
   *  the program — sibling readings over one program bind independently. */
  readonly lens: string;
  readonly bound: boolean;
  /**
   * When `bound` is false: the proximate cause the fixpoint actually caught. When `bound` is
   * true it may still carry one honest caveat: the surface serves, but only by shedding its
   * mutation templates (T96) — a bound schema missing a declared door is not a clean success.
   */
  readonly reason?: string;
  /**
   * Registration-time cautions (SPEC §51): the publish succeeded, and something about the
   * declaration deserves the author's eye — a reference prop with no declared reciprocal (its
   * link deltas will not fold on the far side), a prop in both `writable` and `refs` (refs
   * wins). Facts about the registration itself, so they ride bound and unbound outcomes alike.
   */
  readonly warnings?: readonly string[];
}

/**
 * The publish door's internal seam (ticket T33) — not a caller-facing option. `adoptLaw` reuses THIS
 * door rather than minting law beside it, so every proof the ordinary path runs (the trial registry,
 * the GraphQL build, the resolver loads) also guards a blessing; these two fields are the only
 * things a blessing needs the door to do differently.
 */
export interface PublishInternals {
  /** Timestamps, consumed in mint order: definition, living Schema, frozen snapshot, binding. */
  readonly clock?: () => number;
  /** Delta ids the binding RETIRES as it takes a living name (§27.8's reversible supersede). */
  readonly negates?: readonly string[];
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
    JSON.stringify(r.refs ?? null),
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

// Every binding this store serves from, root rows first and each attached channel pool's after.
//
// §47 slice 3 — AGGREGATE EACH ATTACHED CHANNEL POOL'S BLESSED BINDINGS. A channel's blessing lands
// in the pool's own ground (bindArrived adopts on the POOL gateway), so the law lives where the
// peer's data lives and a drop takes both. The surface still serves the lens: this fold is what
// carries it up, each row filtered to the channel's own prefix so a pool cannot smuggle a binding
// for a name outside its namespace.
//
// ONE derivation, read by the replay that DROPS a contest's losers and by the reading that NAMES
// them (`contestedNamesImpl` below). A second copy could only drift into a surface that disagrees
// with the store it reports on.
function storeBindings(gw: Gateway): Bound[] {
  const rows: Bound[] = readRegistrations(gw.reactor, gw.operatorAuthor).map((r) => ({
    ...r,
    origin: "store" as const,
  }));
  for (const standing of gw.channelStatus()) {
    const pool = gw.channelPools.get(standing.name)?.gateway;
    if (pool === undefined) continue;
    for (const r of readRegistrations(pool.reactor, pool.operatorAuthor)) {
      if (!lensOf(r).startsWith(`${standing.prefix}:`)) continue;
      rows.push({ ...r, origin: "store" as const, channel: standing.name });
    }
  }
  // AN INBOX POOL'S LAW IS NOT HERE, ON PURPOSE (SPEC §58 position 2, Myk's ruling 2026-09-03: a
  // bound connection's law serves ONLY its container). The root fold is what every principal's
  // surface is built from — the operator's, a plain token's, the public door's — so a row here is
  // served to everyone and evaluated over whatever ground the READER has. A connection's lens over
  // an entity it cannot itself read would then be served, resolved, to the operator (measured). It
  // folds instead into the bound surface below, which only a connection bound inside that
  // container is ever handed.
  return rows;
}

/**
 * The five proofs every binding passes before it serves: the registry groups one hyperschema per
 * program (a rival body throws), a readingless expand can never resolve, the body materializes,
 * its templates are visible, and the GraphQL names do not collide. ONE derivation, called by the
 * root replay and by the bound fold, because two copies of a trial drift into two surfaces that
 * disagree about what binds. Throws with the proximate cause; returns when the candidate may join.
 */
function trialBind(gw: Gateway, accepted: readonly Bound[], candidate: Bound): void {
  const trial = [...accepted, candidate];
  const registry = SchemaRegistry.build(programHyperschemas(trial), programReadings(trial));
  assertReadingsNamed(candidate.hyperschema);
  assertMaterializable(candidate.hyperschema, registry);
  assertTemplatesVisible(
    candidate.hyperschema,
    candidate.mutations,
    registry,
    gw.operatorAuthor ?? "loam:specimen",
  );
  buildGqlSchema(trial, gw.gqlHooks());
}

/** What the bound fold answers: the rows a container's surface serves, and why any candidate was left out. */
export interface BoundFold {
  readonly registered: readonly Bound[];
  readonly registry: SchemaRegistry;
  /**
   * `refusalKey(pool channel, lens)` → the proximate cause, for every pool candidate the trial
   * refused. A refusal belongs to one pool's candidate; a lens-only lookup finds nothing.
   */
  readonly refused: ReadonlyMap<string, string>;
  /** Everything the fold depends on, so a cache can tell whether it moved. */
  readonly key: string;
}

/**
 * THE BOUND FOLD (SPEC §58 position 2). The surface a connection bound to `container` is served:
 * the root's own bound rows — the operator's law is every reader's — PLUS the law published on
 * the inbox pools composed into that container's subtree, each row fenced to ITS OWN container's
 * path and colon on all three names the register door fences (the program, the reading, and the
 * entity), and each passed through the same trial the root replay runs. Nothing here reaches the
 * root fold, so nothing here is served to anyone outside the container.
 *
 * Fenced TWICE on purpose: the door refuses a name outside the container before anything is
 * written, and this refuses it again for law that reached a pool by some other road — a restore,
 * a migration, an operator-signed write out of band.
 */
export function boundBindingsImpl(
  gw: Gateway,
  container: string,
  held?: { readonly key: string; readonly fold: BoundFold },
): BoundFold {
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const reach = new Set(subtreeUnder(table, container));
  const candidates: Bound[] = [];
  for (const [name, inbox] of gw.connectionInboxes) {
    const owner = table.containers.get(name)?.inboxOf;
    if (owner === undefined || !reach.has(owner) || inbox.gateway === undefined) continue;
    const prefix = `${owner}:`;
    for (const r of readRegistrations(inbox.gateway.reactor, inbox.gateway.operatorAuthor)) {
      if (!fenceAdmits(prefix, r.hyperschema.name)) continue; // the program
      if (!fenceAdmits(prefix, lensOf(r))) continue; // the reading
      if (lensOf(r).includes(NUL)) continue; // a reading name is the gateway's alphabet too
      if (r.entity !== undefined && r.entity !== schemaEntityFor(r.hyperschema)) continue; // the entity
      candidates.push({ ...r, origin: "store" as const, channel: name });
    }
  }
  // CONTESTS RESOLVE BY WHO STAKED THE NAME FIRST, never by attach order and never by who touched
  // it last. Two pools in one container may name one lens. Iterating `connectionInboxes` let a
  // later registrant on an earlier-attached inbox displace a sibling, and differently after a
  // reboot. Keying on the LATEST binding let the holder lose the name by republishing — even an
  // identical republish moved its claim later than the rival's, and nothing it did could win it
  // back. The first surviving claim keeps the name; ties break on the pool's name.
  candidates.sort(
    (a, b) =>
      (a.firstBoundAt ?? a.boundAt ?? 0) - (b.firstBoundAt ?? b.boundAt ?? 0) ||
      (a.channel ?? "").localeCompare(b.channel ?? ""),
  );
  // THE KEY IS COMPUTED BEFORE ANY TRIAL, or the cache caches nothing: a trial per candidate is
  // the expensive part, and a key that only exists after it is a receipt, not a shortcut.
  const key = [
    ...gw.registered.map((r) => boundKey(r)),
    NUL,
    ...candidates.map((r) => `${r.channel ?? ""}${NUL}${boundKey(r)}`),
  ].join(NUL);
  if (held !== undefined && held.key === key) return held.fold;

  // THE SORT SETTLES CONTESTS; THE ROUNDS SETTLE DEPENDENCY ORDER, and neither can do the other's
  // job. A first claim never moves, so a republish cannot lose a name — but for the same reason a
  // first claim says nothing about a lens's BODY: a lens staked plain and later EVOLVED to expand
  // into a lens staked after it keeps its early claim, sorts first, and is trialled before the
  // reading it needs exists. A single pass refused it forever, and no republish could recover it.
  // So the trial runs in rounds until nothing more binds, as the root replay does — and the rounds
  // must not reopen the contest the sort closed: a first claimant refused THIS round for want of a
  // reading holds what it staked through the round, and a later claimant contesting any of it
  // waits behind it rather than being trialled into an empty slot. Without that hold, a rival
  // staked second took the name in round one and the holder collided with it in round two, with
  // no republish able to win it back. What is held is whatever the TRIAL'S OWN collision checks
  // say the holder and the rival cannot both have: the fold asks `buildGqlSchema` and
  // `groupPrograms` about the PAIR (`contests`), so the hold cannot drift from the trial. A list
  // of names written here did drift, three times — two spellings mint one query field, a listing
  // field is another reading's query field, one program admits one body, and the mutation
  // namespace has a dozen derived names — and each list let the next rival through. A claimant
  // refused for good keeps holding: the rival is told whose claim it contests, what the trial
  // refuses the pair on, and why that claim is refused. Root rows are already trialled and
  // already serve; a pool row that collides with one loses here exactly as a channel row loses at
  // root — the nearer ground never displaces the operator's law.
  //
  // A refusal is the CANDIDATE'S, keyed by pool and lens (`refusalKey`): two pools refused under
  // one name are refused for two reasons, and the door hands each pool its own.
  //
  // The root replay binds a stored row whose templates alone fail WITHOUT its templates; this fold
  // does not, so such a row is refused whole here while the pool's own replay serves it template-
  // less. The door cannot plant one (it refuses invisible templates before writing), only an
  // out-of-band write can, and the refusal names the template fault.
  const accepted: Bound[] = [...gw.registered];
  const reasons = new Map<Bound, string>();
  let pending = candidates;
  for (;;) {
    const still: Bound[] = [];
    const holders: Bound[] = []; // the earlier claimants refused this round, in claim order
    let progressed = false;
    for (const candidate of pending) {
      const contest = contestedBy(gw, candidate, holders);
      if (contest !== undefined) {
        reasons.set(
          candidate,
          `lens ${lensOf(candidate)}: an earlier claim, ${lensOf(contest.holder)}, contests it — ${contest.on} — and that claim is refused: ${reasons.get(contest.holder) ?? "did not bind"}`,
        );
        holders.push(candidate); // deferred is refused this round: what IT staked is held too
        still.push(candidate);
        continue;
      }
      try {
        trialBind(gw, accepted, candidate);
        accepted.push(candidate);
        progressed = true;
      } catch (err) {
        reasons.set(candidate, err instanceof Error ? err.message : String(err));
        holders.push(candidate);
        still.push(candidate);
      }
    }
    pending = still;
    if (!progressed || pending.length === 0) break;
  }
  const refused = new Map<string, string>();
  for (const left of pending)
    refused.set(refusalKey(left.channel ?? "", lensOf(left)), reasons.get(left) ?? "did not bind");
  const registry = SchemaRegistry.build(programHyperschemas(accepted), programReadings(accepted));
  return { registered: accepted, registry, refused, key };
}

/**
 * What the trial refuses the PAIR on, or undefined when it admits both. Asked of the trial's own
 * checks — one program name, one body (`groupPrograms`); one name per GraphQL field, type, and
 * mutation (`buildGqlSchema`) — with no registry, because a holder waiting on a reading cannot
 * be resolved yet and its NAMES are what the rival contests. A row the trial cannot build alone
 * contests nothing: its fault is its own, and it is refused for it.
 */
function contests(gw: Gateway, holder: Bound, rival: Bound): string | undefined {
  const builds = (rows: readonly Bound[]): string | undefined => {
    try {
      groupPrograms(rows);
      buildGqlSchema(rows, gw.gqlHooks());
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
  if (builds([holder]) !== undefined || builds([rival]) !== undefined) return undefined;
  return builds([holder, rival]);
}

/** The earlier claimant this candidate contests, if one is refused this round. */
function contestedBy(
  gw: Gateway,
  c: Bound,
  holders: readonly Bound[],
): { readonly holder: Bound; readonly on: string } | undefined {
  for (const holder of holders) {
    const on = contests(gw, holder, c);
    if (on !== undefined) return { holder, on };
  }
  return undefined;
}

/** The key a bound fold's `refused` map uses: a refusal belongs to one pool's candidate. */
export const refusalKey = (channel: string, lens: string): string => `${channel}${NUL}${lens}`;

// CROSS-ORIGIN CONTESTS resolve by the declared policy BEFORE the trial fixpoint. Undeclared keeps
// today's shape whole: root rows enter the fixpoint FIRST, so a channel row contesting a root name
// meets the gql collision and is remembered as a bind failure — root wins, exactly as a manual
// override always has. Under a declared mode the loser is dropped there instead, so the fixpoint
// never sees the contest. Rank under byAuthorRank is ORIGIN rank — root over channel — because
// every blessing is operator-SIGNED and raw author rank is vacuous (T202's warning).
//
// `undefined` means NO cross-origin question was asked: no policy is declared, or no pool row is in
// play. That is not the same as "asked and found nothing", and the two must not collapse — the
// reading below reports a contest only where a policy actually withholds a name.
function crossOriginBindings(gw: Gateway, rows: readonly Bound[]): ResolvedBindings | undefined {
  const mode = readBindingPolicy(gw.reactor, gw.operatorAuthor);
  if (mode === undefined || !rows.some((r) => r.channel !== undefined)) return undefined;
  return interpretBindingPolicy(
    rows
      .filter((r) => r.boundId !== undefined)
      .map((r) => ({
        lens: lensOf(r),
        entity: r.entity ?? "",
        author: r.channel === undefined ? (gw.operatorAuthor ?? "") : `channel:${r.channel}`,
        timestamp: r.boundAt ?? 0,
        deltaId: r.boundId!,
      })),
    mode,
    gw.operatorAuthor,
  );
}

/** One contender for a withheld name, plus WHERE its binding lives. */
export interface ContestedName extends ContestedBinding {
  /** `"root"`, or the channel pool's own name — the same origin the cross-origin fold ranks by. A
   * binding a pool holds a COPY of names the ROOT: that is the nearer ground, and the one whose
   * registration a person can actually withdraw. */
  readonly origin: string;
  /** This contender is the one the surface currently serves. At most one row per name carries it. */
  readonly served: boolean;
}

/** What a declared `conflicts` policy is withholding under ONE name. */
export interface ContestedNameReport {
  /** Every contender, in ground order. At most one is `served`. */
  readonly contenders: readonly ContestedName[];
  /** Present when the name IS served by a binding that is NOT one of the contenders — a third
   * definition, or a manual registration carrying no binding delta. The contest is still real and
   * every contender below it is still withheld; the name is simply answered from elsewhere. */
  readonly servedByOther?: { readonly origin: string; readonly entity: string };
}

/**
 * The names a declared `conflicts` policy is withholding, over EVERY ground this store serves law
 * from (§47.1). Composed, never re-derived: each ground's own contests come from
 * `readContestedBindings` under that ground's own declared policy, and the cross-origin contest
 * comes from the same fold the replay resolves with.
 *
 * A contender appears once, under the first origin that names it, so a row that is both a pool's
 * own loser and a cross-origin loser is not counted twice.
 *
 * NOTHING IS EVER DROPPED FROM THIS REPORT. A name the surface serves is still a name two
 * registrations wanted, and the contenders it withholds are still withheld — so what serves is
 * MARKED rather than used to delete the entry. Deleting was worse than the silence it cured:
 * publishing one more rival of your own resolves the other contenders away, leaves a single
 * candidate to win, and would erase the refusal of every contender at once.
 *
 * COST: a replay plus one registration read per ground. Call it per page, not per request.
 */
export function contestedNamesImpl(gw: Gateway): Map<string, ContestedNameReport> {
  // ONE MOMENT for the fold and the reading. `append` never replays, and declaring a policy IS an
  // append — so without this the first read after a declaration describes a surface that predates
  // it, and a struck declaration keeps a name withheld here after the doors revived it. Replay is a
  // set-compare no-op when nothing moved, which is what makes this affordable rather than clever.
  gw.replayRegistrations();

  const drafts = new Map<string, (ContestedBinding & { origin: string })[]>();
  const rows = storeBindings(gw);
  // A pool is seeded with a COPY of the root ground, so one content address can sit in two grounds.
  // The row names the ROOT then: it is the nearer ground, and the only one whose registration a
  // person can withdraw.
  const originOf = (deltaId: string, ground: string): string =>
    gw.reactor.get(deltaId) === undefined ? ground : "root";
  const add = (lens: string, row: ContestedBinding & { origin: string }): void => {
    const list = drafts.get(lens) ?? [];
    if (list.some((held) => held.deltaId === row.deltaId)) return;
    list.push(row);
    drafts.set(lens, list);
  };
  for (const [lens, list] of readContestedBindings(gw.reactor, gw.operatorAuthor)) {
    for (const c of list) add(lens, { ...c, origin: "root" });
  }
  // A pool is a ground of its own: it reads its OWN declared policy, and the prefix filter is the
  // one `storeBindings` aggregates by — a pool cannot name a contest outside its namespace.
  for (const standing of gw.channelStatus()) {
    const pool = gw.channelPools.get(standing.name)?.gateway;
    if (pool === undefined) continue;
    for (const [lens, list] of readContestedBindings(pool.reactor, pool.operatorAuthor)) {
      if (!lens.startsWith(`${standing.prefix}:`)) continue;
      for (const c of list) add(lens, { ...c, origin: originOf(c.deltaId, standing.name) });
    }
  }
  // THE CROSS-ORIGIN CONTEST — a root row against a pool's, which no single ground can see. This is
  // the map the replay resolves its winners from; reading `.contested` beside them is what turns
  // "both contenders silently dropped" into a stated refusal.
  //
  // The candidates carry the ORIGIN rank as their author (`channel:<pool>`), which is a rank and not
  // a signer. The row reports the key that actually signed the binding, and the origin separately.
  const byBinding = new Map<string, Bound>();
  for (const r of rows) {
    // First wins, and root rows come first: a delta both grounds hold is read off the root's row.
    if (r.boundId === undefined || byBinding.has(r.boundId)) continue;
    byBinding.set(r.boundId, r);
  }
  for (const [lens, list] of crossOriginBindings(gw, rows)?.contested ?? []) {
    for (const c of list) {
      // Total by construction: the candidates the contest ranked were built from these very rows.
      const row = byBinding.get(c.deltaId)!;
      add(lens, {
        entity: c.entity,
        // Present wherever `boundId` is: both are read off the same binding delta. A fallback to
        // the candidate's author would report the origin RANK as a signing key.
        author: row.boundBy!,
        timestamp: c.timestamp,
        deltaId: c.deltaId,
        origin: originOf(c.deltaId, row.channel ?? "root"),
      });
    }
  }

  // WHAT SERVES EACH NAME, decided by CONTENT ADDRESS. The fold above was just replayed, so
  // `gw.registered` is this same moment's answer. Two shapes, and they say different things:
  //   - the serving binding IS one of the contenders (the pool's copy of a root binding is the
  //     same delta): mark that row, and the others stay withheld;
  //   - the name is served by something else entirely — a third definition, or a manual
  //     registration with no binding delta: every contender is still withheld, and the report
  //     names what answers instead. Dropping the entry here would suppress a refusal the doors
  //     ARE honouring.
  const out = new Map<string, ContestedNameReport>();
  for (const [lens, list] of drafts) {
    // Ground order within a name, so a reader sees the incumbent before the challenger.
    list.sort(
      (a, b) =>
        a.timestamp - b.timestamp || (a.deltaId < b.deltaId ? -1 : a.deltaId > b.deltaId ? 1 : 0),
    );
    const serving = gw.registered.find((r) => (lensOf(r) as string) === lens);
    const servedRow =
      serving?.boundId === undefined ? undefined : list.find((d) => d.deltaId === serving.boundId);
    out.set(lens, {
      contenders: list.map((d) => ({ ...d, served: d === servedRow })),
      ...(serving === undefined || servedRow !== undefined
        ? {}
        : {
            servedByOther: {
              origin: serving.channel ?? "root",
              // A manual registration files under no entity; its program name is what it answers as.
              entity: serving.entity ?? programOf(serving),
            },
          }),
    });
  }
  return out;
}

export function replayRegistrationsImpl(gw: Gateway): void {
  const manual = gw.registered.filter((r) => r.origin === "manual");
  const accepted: Bound[] = [...manual];
  const rows = storeBindings(gw);
  const resolved = crossOriginBindings(gw, rows);
  let pending: Bound[] =
    resolved === undefined
      ? rows
      : rows.filter((r) => {
          if (r.boundId === undefined) return true; // a manual row never entered the contest
          const winner = resolved.winners.get(lensOf(r));
          // Under `conflicts` a contested name has NO winner and every contender drops (criterion
          // 4); otherwise only the policy's winner proceeds to the trial.
          return winner === r.boundId;
        });
  for (;;) {
    const stillPending: Bound[] = [];
    let progressed = false;
    for (const reg of pending) {
      const attempt = (candidate: Bound): boolean => {
        try {
          trialBind(gw, accepted, candidate);
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
      // A stored registration whose TEMPLATES are the only problem binds WITHOUT THE TEMPLATES
      // and without nothing else — the schema still serves; the surface just lacks the mutation.
      // The fallback sheds exactly one field. Rebuilding the candidate by hand here was T96:
      // `writable` (and the lens name) went down with the templates, so under immutable-by-default
      // (SPEC §14) the store booted with the operator's declared write surface silently revoked —
      // and "quietly absent" is byte-identical to "deliberately locked" for every reader downstream.
      const templateless: Bound = Object.fromEntries(
        Object.entries(reg).filter(([k]) => k !== "mutations" && k !== "mutationsDefect"),
      ) as Bound;
      if (attempt(reg)) {
        progressed = true;
      } else if (reg.mutations !== undefined) {
        // The full candidate's fault is on record now; hold it before the fallback's success
        // erases it. A bind-by-shedding re-records it so the outcome can say what was shed —
        // publishRegistration reads this even on a bound surface (a served schema missing its
        // declared mutations is not an unqualified success).
        const key = failureKey(reg.entity ?? "", lensOf(reg));
        const fault = lastBindFailure(gw, key);
        if (attempt(templateless)) {
          progressed = true;
          rememberBindFailure(
            gw,
            key,
            new Error(`bound without its mutation templates — ${fault ?? "they did not bind"}`),
          );
        } else {
          stillPending.push(reg); // its refs are not registered yet — try again next round
        }
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
  refs?: RefSpecs,
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
      lensName: lensNameFor(hyperschema, schema),
      ...(templates ? { mutations: templates } : {}),
      ...(writable ? { writable } : {}),
      ...(refs ? { refs } : {}),
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
  // Renderer bundles do NOT ride that loader (SPEC §23.9 / T172): a renderer's module body is evaluated
  // in the confined worker realm and never on this thread, so what this call establishes is ADMISSION —
  // which routes may mount — rather than a loaded namespace. Tolerant by construction: one bundle the
  // realm will not admit leaves one route unmounted, and never fails the bind.
  //
  // AND IT SAYS WHICH ONE. A route that goes dark silently is a swallowed error (H9): the operator sees
  // a 404 and has nothing to read that names the cause, which for a federated bundle is the difference
  // between "the peer sent code that reaches for the filesystem" and "my store is broken". The write
  // goes through `reportUnmounted` — host-guarded, because a peer that has no `process` still binds,
  // and both peer-chosen strings scrubbed before a person reads them.
  const bindings = readRenderers(gw.reactor, gw.operatorAuthor);
  const refused = await admitRenderers(
    bindings.map((r) => r.bundle),
    rendererAdmissionBudget(gw),
  );
  for (const { bundle, why } of refused) reportUnmounted(bindings, bundle, why);
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
  refs?: RefSpecs,
  internals?: PublishInternals,
): Promise<PublishOutcome> {
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
  const lensName = lensNameFor(hyperschema, schema);
  // Reference declarations (SPEC §51): a ref rides an existing prop — loud here, at publish, where
  // the schema is known; the surface generator skips a stray quietly on replay. The WARNINGS are
  // the loud-but-not-fatal tier: the publish stands, and the register response says what the
  // author should look at — the spec's exact sentence for an undeclared reciprocal, and the
  // refs-wins overlap with `writable`.
  const warnings: string[] = [];
  if (refs !== undefined) {
    for (const prop of Object.keys(refs)) {
      if (!schema.props.has(prop)) {
        throw new Error(
          `refs "${prop}": no such field in the schema — a reference declaration rides an ` +
            `existing property`,
        );
      }
    }
    const opened = new Set(writable ?? []);
    for (const ref of referenceProps(hyperschema.body, refs).values()) {
      if (opened.has(ref.prop)) {
        warnings.push(
          `"${ref.prop}" on "${lensName}" is declared in both \`writable\` and \`refs\`; ` +
            "refs wins — the prop takes no primitive argument, and its writes are the " +
            "link/unlink mutations. Remove it from `writable`.",
        );
      }
      // Only a prop that MINTS link mutations can author a delta whose far side goes nowhere;
      // a typing-only (prefix/inSet) reference authors nothing, so there is nothing to warn of.
      if (ref.links && ref.reciprocal === undefined) {
        warnings.push(
          `reciprocal context for ${lensName}.${ref.prop} undeclared; link deltas will not ` +
            `fold on the ${ref.target ?? "target"} side`,
        );
      }
    }
  }
  const caveats = warnings.length === 0 ? {} : { warnings };
  const schemaEntity = schemaEntityFor(hyperschema, entity);
  const survivors = gw.registered.filter(
    (r) => !(programOf(r) === hyperschema.name && lensOf(r) === lensName),
  );
  // §47 — UNDER A DECLARED BINDING POLICY, A NAME CONTEST IS NOT A REFUSAL. The trial build's job
  // is to refuse what replay would trip on; with a policy declared, replay RESOLVES a contested
  // name instead of tripping (readRegistrations applies the policy), so the trial is run over the
  // set minus the rival — both registrations land as deltas, and the replay below decides which one
  // serves. The outcome stays honest either way: `bound: false` with the policy named, never a
  // thrown refusal for law that lawfully landed. An UNDECLARED store keeps today's loud collision
  // (criterion 12) — the next line changes nothing for it.
  const mode = readBindingPolicy(gw.reactor, gw.operatorAuthor);
  const trialSurvivors =
    mode === undefined
      ? survivors
      : survivors.filter((r) => !(lensOf(r) === lensName && r.entity !== schemaEntity));
  const trialLenses: Bound[] = [
    ...trialSurvivors,
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
      ...trialSurvivors,
      {
        hyperschema,
        schema,
        roots,
        lensName,
        ...(templates ? { mutations: templates } : {}),
        ...(writable ? { writable } : {}),
        ...(resolvers ? { resolvers } : {}),
        ...(refs ? { refs } : {}),
      },
    ],
    gw.gqlHooks(),
  ); // arg names, field collisions, resolver output types — everything the replay would trip on, NOW

  const author = authorForSeed(seed);
  // The clock is a seam, not a decision: an ordinary publish stamps NOW, and a T33 blessing threads
  // the SOURCE's timestamps through so its twins re-mint the source's ids (see adopt-law.ts's H4
  // note — the tombstone refusal and idempotence both ride that identity).
  const tick = internals?.clock ?? ((): number => gw.nextTimestamp());
  const definition = signClaims(
    publishHyperSchemaClaims(hyperschema, schemaEntity, author, tick()),
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
    tick,
    templates,
    writable,
    resolvers,
    refs,
  );
  // A blessing that TAKES a living name retires the incumbent from the binding itself (§27.8's
  // reversible supersede): its own timestamp is the source's, so it cannot win on recency, and a
  // negation carried here stops counting the moment this binding is struck — which resurfaces the
  // incumbent as the winner, rather than destroying it.
  const filed =
    internals?.negates === undefined || internals.negates.length === 0
      ? binding
      : {
          ...binding,
          pointers: [
            ...internals.negates.map((id) => ({
              role: "negates",
              target: { kind: "delta" as const, deltaRef: { delta: id } },
            })),
            ...binding.pointers,
          ],
        };
  await gw.append([signClaims(living, seed), signClaims(snapshot, seed), signClaims(filed, seed)]);
  replayRegistrationsImpl(gw);
  await preloadResolversImpl(gw);
  // Success must mean BOUND. The deltas are down either way (append-only ground), but a
  // publish the replay could not bind — a name already answered for by another entity, a
  // collision with a manual registration — is not to be reported as a served surface.
  const bound = gw.registered.some(
    (r) => r.origin === "store" && r.entity === schemaEntity && lensOf(r) === lensName,
  );
  if (bound) {
    // Bound, possibly by SHEDDING: the replay may have dropped the templates to bind the rest
    // (T96). A record under this key after a successful bind can only be the shed breadcrumb —
    // a full bind clears it — so surface it rather than report an unqualified success.
    const shed = lastBindFailure(gw, failureKey(schemaEntity, lensName));
    return shed === undefined
      ? { persisted: true, lens: lensName, bound: true, ...caveats }
      : { persisted: true, lens: lensName, bound: true, reason: shed, ...caveats };
  }
  // Valid law, written, not serving HERE. Reported, never thrown: the deltas exist and would bind on
  // a peer that pulls them, or on a later boot without whatever shadows them. Throwing would call a
  // successful write a failure; swallowing it silently would hide a surface the caller expects. The
  // reason is the proximate one the fixpoint caught (a process-local override of this lens, a rival
  // body, a GraphQL field already answered), not a guess.
  return {
    persisted: true,
    lens: lensName,
    bound: false,
    ...caveats,
    reason:
      lastBindFailure(gw, failureKey(schemaEntity, lensName)) ??
      (mode !== undefined && gw.registered.some((r) => lensOf(r) === lensName)
        ? `the declared ${mode} policy resolves "${lensName}" to another registration — the deltas ` +
          `are down, and this one serves if the contest later resolves its way`
        : mode === "conflicts"
          ? `"${lensName}" is contested and the declared conflicts policy serves no contender — ` +
            `the /admin dashboard and gateway.contestedNames() name them all`
          : "it was not among the registrations the store re-derived — check that the operator " +
            "authored it and that its definition survives"),
  };
}
