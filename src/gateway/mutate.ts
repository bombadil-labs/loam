// The §14 write verbs (ticket T19: the Gateway's mutation bodies, in their own module). Mutation is
// the DUAL of resolution: assert writes one signed property-claim per provided field; retraction
// negates the caller's OWN surviving contributions and lets the read side re-resolve (the pick falls
// to the next survivor, an `all` list loses your value, a field only you spoke for goes absent). The
// verbs — mutate, clear, remove, link, sever, claim — are all sugar over two motions: sign-and-append
// a claim, or sign-and-append negations of your own claims. Nothing here bypasses a door: every write
// runs through a gateway's `append` (authorize, budgets, validators) — this store's, or a bound
// connection's inbox pool (`sinkFor`, SPEC §58) — and writability is checked at THIS seam
// (`assertWritable` — §14's immutable-by-default) before a delta is ever minted.
//
// These are the implementations behind `Gateway.mutateEntity` and the private clear/remove/link/
// sever/claim hooks — thin delegating methods on the class, bodies here. They reach the gateway only
// through its declared internals seam (the `@internal` members on the class — see the seam note in
// gateway.ts).

import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import type { HVEntry, Primitive } from "@bombadil/rhizomatic";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import { legalNameFor, queryFieldFor, type ClaimPointerSpec, type ResolvedNode } from "./gql.js";
import { edgeRoles, lensOf, referenceProps, type ReferenceProp } from "./registration.js";

// Where a write LANDS (SPEC §58): a bound connection's deltas go into its inbox pool — the pool's
// own door authorizes them on the pool's own grant chain, so the primary never has to grant the key
// anything — and everyone else's into this store. A binding names a connection, so a request that
// carries one and no actor is malformed and refused BEFORE any seed is resolved: the operator's
// seed must never sign into a connection's pool.
function sinkFor(
  gw: Gateway,
  actorSeed: string | undefined,
  binding: ConnectionBinding | undefined,
): Gateway {
  if (binding === undefined) return gw;
  if (actorSeed === undefined) {
    throw new Error(
      `a request bound to ${binding.inbox} names no actor, so it is refused — only the ` +
        `connection's own key writes into its inbox`,
    );
  }
  return gw.poolForBinding(binding);
}

// One signed property-claim delta per provided property, signed as the ACTOR (or the
// operator when no actor is named), appended through the same validated, capability-enforced
// path as everything else.
export async function mutateEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  props: Record<string, Primitive>,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  const sink = sinkFor(gw, actorSeed, binding);
  const seed = actorSeed ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  const entries = Object.entries(props);
  if (entries.length === 0) {
    throw new Error(`mutation of ${entity} names no properties to claim`);
  }
  // Reference first, THEN writability: a refs-declared prop draws the reference refusal even
  // when `writable` never opened it — "read-only: name it in writable" would coach the caller
  // into re-opening the exact fossil path the declaration closed.
  assertNotReference(gw, name, Object.keys(props), binding);
  assertWritable(gw, name, Object.keys(props), binding);
  const author = authorForSeed(seed);
  // Strictly monotonic WITHIN THIS INSTANCE: two mutations from one running gateway never tie
  // on timestamp, so pick-byTimestamp between them is an ordering, not a coin flip on
  // delta-id hashes. Across restarts (or gateways) the wall clock is the only witness.
  const timestamp = gw.nextTimestamp();
  const deltas = entries.map(([prop, value]) =>
    signClaims(
      {
        timestamp,
        author,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: entity, context: prop } } },
          { role: "value", target: { kind: "primitive", value } },
        ],
      },
      seed,
    ),
  );
  await sink.append(deltas);
  return gw.resolvedNode(name, entity, undefined, undefined, binding);
}

// Retraction, the DUAL of resolution (SPEC §14): negate the caller's OWN surviving contributions
// that `keep` selects, and re-resolve — one mechanism, correct across every Policy because the
// read side already does the Policy work (the pick falls to the next survivor, an `all` list loses
// your value, a `merge` withdraws your addend, a field only you spoke for goes ABSENT, rendered
// per its own absentAs). The negations sign and append through the same standing-checked path as
// every write.
//
// The `claims.author === author` filter is the SINGLE load-bearing check of the retract-your-own
// invariant (Myk, 2026-07-12): `append` only proves the negation's author holds write standing,
// NOT that the target is theirs — so a future refactor must never loosen this into negating a
// foreign delta. (`claims.author` is signature-bound by verifyDelta at append, not self-assertable.
// To keep OTHERS' claims out of a view you narrow the schema Policy, not the ground.) The `keep`
// predicate stays lens-agnostic: each DOOR refuses an unknown field against the version it
// addressed, so this never throws on a field an older version named that the latest lens dropped —
// its contributions are still real on the ground; a field with no bucket simply retracts nothing.
async function retract(
  gw: Gateway,
  name: string,
  entity: string,
  actorSeed: string | undefined,
  binding: ConnectionBinding | undefined,
  keep: (field: string, entry: HVEntry) => boolean,
): Promise<ResolvedNode> {
  const sink = sinkFor(gw, actorSeed, binding);
  const seed = actorSeed ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  gw.def(name, binding); // refuses an unknown schema
  const author = authorForSeed(seed);
  // UNNARROWED (SPEC §29.3): a read-closing slate must not turn this strike into a silent no-op —
  // the member would be absent from a narrowed hview, so nothing would be targeted and nothing signed.
  // A bound connection gathers ITS scope: its own claims live in its pool, and a strike it signs
  // lands beside them there.
  const hview = gw.gatherForRetraction(name, entity, binding);
  const targets = new Set<string>();
  for (const [field, entries] of hview.props) {
    for (const entry of entries) {
      if (entry.delta.claims.author === author && !entry.negated && keep(field, entry)) {
        targets.add(entry.delta.id);
      }
    }
  }
  if (targets.size > 0) {
    const timestamp = gw.nextTimestamp();
    const negations = [...targets].map((id) =>
      signClaims(makeNegationClaims(author, timestamp, id), seed),
    );
    await sink.append(negations);
  }
  return gw.resolvedNode(name, entity, undefined, undefined, binding);
}

// Clear whole fields: retract every one of the caller's contributions to each named field.
export function clearEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  fields: readonly string[],
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  if (fields.length === 0) throw new Error(`clear of ${entity} names no fields to retract`);
  assertWritable(gw, name, fields, binding);
  const set = new Set(fields);
  return retract(gw, name, entity, actorSeed, binding, (field) => set.has(field));
}

// Remove ONE value (SPEC §14 amendment): retract only the caller's own contribution(s) to `field`
// whose claimed value is one of `values` — withdraw the single tag you added, a specific `merge`
// addend. The rest of the field, yours and everyone's, stands.
export function removeEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  field: string,
  values: readonly Primitive[],
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  if (values.length === 0) {
    throw new Error(`remove from ${field} of ${entity} names no values to retract`);
  }
  assertWritable(gw, name, [field], binding);
  const wanted = new Set(values.map((v) => JSON.stringify(v)));
  return retract(
    gw,
    name,
    entity,
    actorSeed,
    binding,
    (f, entry) =>
      f === field &&
      entry.delta.claims.pointers.some(
        (p) =>
          p.role === "value" &&
          p.target.kind === "primitive" &&
          wanted.has(JSON.stringify(p.target.value)),
      ),
  );
}

// The single role the §14 verbs would mint for `field`, or undefined: one expand role covers a
// byTargetContext gather's fields; a body with several distinct edge roles disambiguates by the
// field's own name. Shared by `edgeRoleFor` (which turns undefined into a refusal) and the §14
// link authorization below (which must ask the SAME question without throwing) — one selection,
// so the two can never drift into authorizing one role and minting another.
const mintedRole = (roles: readonly string[], field: string): string | undefined =>
  roles.length === 1 ? roles[0] : roles.includes(field) ? field : undefined;

// The edge role a gather declares for `field` (SPEC §14 edge verbs): the pointer role an edge
// write must carry so the body's `expand` follows it into the child's view. Read from the
// PUBLISHED hyperschema gather, never the resolution Schema. A gather with no `expand` resolves no
// edges — link/sever are meaningless there and refuse.
function edgeRoleFor(
  gw: Gateway,
  name: string,
  field: string,
  binding?: ConnectionBinding,
): string {
  const roles = edgeRoles(gw.def(name, binding).hyperschema.body);
  if (roles.length === 0) {
    throw new Error(
      `schema ${name} resolves no edges: its gather has no \`expand\`, so "${field}" takes a ` +
        `value, not a relation`,
    );
  }
  const role = mintedRole(roles, field);
  if (role === undefined) {
    throw new Error(
      `schema ${name} declares several edge roles (${roles.join(", ")}); wave A links a gather ` +
        `whose edge role is unambiguous for "${field}"`,
    );
  }
  return role;
}

// Link an edge (SPEC §14 edge verbs): assert ONE edge delta — the same per-prop write shape, its
// value pointer made an ENTITY target the gather's `expand` follows. Pure sugar over assert: no
// new delta shape, nothing new on the wire. The subject pointer files the edge into the `field`
// bucket (byTargetContext); the edge-role pointer is what `expand` resolves into the child view.
export async function linkEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  field: string,
  target: string,
  context: string | undefined,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  const sink = sinkFor(gw, actorSeed, binding);
  const seed = actorSeed ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  const def = gw.def(name, binding);
  if (!def.schema.props.has(field)) {
    throw new Error(`schema ${name} has no field "${field}" to link`);
  }
  // A refs-declared field is authorized by the declaration itself (SPEC §52, §51.5's rule carried
  // to the §14 verb): a reference prop leaves `writable` — its primitive path is closed — and its
  // edge writes must not die with it. Non-refs fields keep the writable requirement exactly.
  //
  // But ONLY where the declaration and the gather AGREE: the ref mints a pair (`links`) and its
  // declared role is exactly the role this verb would mint. The agreement is load-bearing — a
  // mismatched declaration (a role no expand matches, a prefix/inSet family) bypassing here would
  // mint an edge under some OTHER expand's role, folding into this prop's bucket while the §51
  // unlink matches only the DECLARED role and sever/clear/remove refuse the unwritable prop: a
  // delta writable through exactly one door and retractable through none. Fail closed instead:
  // the mismatch falls back to the writable gate, which refuses in §14's own read-only voice.
  const ref = referenceProps(def.hyperschema.body, def.refs).get(field);
  if (
    ref === undefined ||
    !ref.links ||
    ref.role !== mintedRole(edgeRoles(def.hyperschema.body), field)
  ) {
    assertWritable(gw, name, [field], binding);
  }
  const role = edgeRoleFor(gw, name, field, binding);
  const author = authorForSeed(seed);
  const delta = signClaims(
    {
      timestamp: gw.nextTimestamp(),
      author,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: entity, context: field } } },
        {
          role,
          target: { kind: "entity", entity: { id: target, context: context ?? field } },
        },
      ],
    },
    seed,
  );
  await sink.append([delta]);
  return gw.resolvedNode(name, entity, undefined, undefined, binding);
}

// Sever an edge (SPEC §14 edge verbs): retract YOUR OWN edge deltas in `field` — the dual of link,
// the same retract-your-own reach clear/remove already have. With `targets`, only edges whose
// edge-role pointer lands on one of them are withdrawn (value-scoped, like remove); without,
// every edge you authored in the field. Never touches another author's edge.
export function severEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  field: string,
  targets: readonly string[] | undefined,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  if (!gw.def(name, binding).schema.props.has(field)) {
    throw new Error(`schema ${name} has no field "${field}" to sever`);
  }
  assertWritable(gw, name, [field], binding);
  const role = edgeRoleFor(gw, name, field, binding);
  const wanted = targets !== undefined && targets.length > 0 ? new Set(targets) : undefined;
  return retract(
    gw,
    name,
    entity,
    actorSeed,
    binding,
    (f, entry) =>
      f === field &&
      entry.delta.claims.pointers.some(
        (p) =>
          p.role === role &&
          p.target.kind === "entity" &&
          (wanted === undefined || wanted.has(p.target.entity.id)),
      ),
  );
}

// A REFERENCE PROP refuses a primitive write at the mutate seam (SPEC §51.5): a prop is a
// reference or a primitive, never both. The GraphQL door already drops the argument, but this
// seam is what REST and direct callers reach — an unguarded seam keeps the string-fossil path
// alive on every door that never saw the surface. The refusal names the typed door that exists
// instead, in the caller's own dialect (the generated mutation's mangled name).
function assertNotReference(
  gw: Gateway,
  name: string,
  fields: readonly string[],
  binding?: ConnectionBinding,
): void {
  const def = gw.def(name, binding);
  if (def.refs === undefined) return;
  const marked = referenceProps(def.hyperschema.body, def.refs);
  for (const field of fields) {
    const ref = marked.get(field);
    if (ref === undefined) continue;
    const pair = `link${queryFieldFor(lensOf(def))}_${legalNameFor(field)}`;
    throw new Error(
      `field "${field}" of ${name} is a reference (§51), never a primitive value: ` +
        (ref.links
          ? `link entities with the ${pair} / un${pair} mutations`
          : `its role family mints no single mutation — author the edge as an explicit _claim`),
    );
  }
}

// The declared reference prop behind a generated link/unlink mutation (SPEC §51), or a refusal.
// The classification is re-derived from the def on every call — the same `referenceProps` walk the
// surface generated the mutation from, so the write can never author a shape the surface did not
// advertise. `links: false` (a prefix/inSet role family) refuses too: the surface minted no
// mutation for it, and a door reaching here by hand gets the same answer.
function referencePropFor(
  gw: Gateway,
  name: string,
  prop: string,
  binding?: ConnectionBinding,
): ReferenceProp {
  const def = gw.def(name, binding);
  const ref = referenceProps(def.hyperschema.body, def.refs).get(prop);
  if (ref === undefined || !ref.links) {
    throw new Error(
      `schema ${name} declares no reference prop "${prop}" to link — a link mutation exists ` +
        `only for a prop named in the registration's \`refs\` with a single canonical role (§51)`,
    );
  }
  return ref;
}

// Link a declared reference (SPEC §51.3): assert ONE symmetric two-pointer delta —
// { role R, at target, context C_reciprocal } + { role R_reverse, at entity, context P }.
// The root-side context is always P: that is what folds the delta into the prop. With no
// reciprocal declared, the target-side pointer carries NO context (nothing folds on the far
// side — registration already warned, loudly) and the root-side pointer falls back to the
// store-wide `subject` role every per-prop write carries.
//
// The `refs` declaration IS the write opening for its prop — `writable` is not consulted:
// a prop is a reference or a primitive, never both, and refs wins the overlap (§51.5).
export async function linkRefEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  prop: string,
  target: string,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  const sink = sinkFor(gw, actorSeed, binding);
  const seed = actorSeed ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  const ref = referencePropFor(gw, name, prop, binding);
  const delta = signClaims(
    {
      timestamp: gw.nextTimestamp(),
      author: authorForSeed(seed),
      pointers: [
        {
          role: ref.role,
          target: {
            kind: "entity",
            entity: {
              id: target,
              ...(ref.reciprocal === undefined ? {} : { context: ref.reciprocal.context }),
            },
          },
        },
        {
          role: ref.reciprocal?.role ?? "subject",
          target: { kind: "entity", entity: { id: entity, context: prop } },
        },
      ],
    },
    seed,
  );
  await sink.append([delta]);
  return gw.resolvedNode(name, entity, undefined, undefined, binding);
}

// Unlink a declared reference (SPEC §51.2): retract the caller's OWN link claim(s) for the
// (entity, target) pair — the remove*/clear family's semantics: retraction is a claim, history
// survives, another author's edge stands. Matches on the prop's bucket and the edge role's
// pointer at the target, so a hand-authored _claim of the same shape retracts identically.
//
// THE CHANGED-ROLE STRAND (documented, not decided): the match reads the CURRENT declared role,
// so after an operator republishes `refs` with a different role, the caller's own OLD-role edges
// still fold (the context carries the fold) but no longer match here — and clear/remove refuse a
// refs prop — leaving them unretractable through every typed door. Raw `_claim` plus a manual
// retraction remains the escape hatch. Widening this match to previously-declared roles is a
// behavior decision, not a repair; it goes to review, not into a fixup.
export async function unlinkRefEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  prop: string,
  target: string,
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  const ref = referencePropFor(gw, name, prop, binding);
  return retract(
    gw,
    name,
    entity,
    actorSeed,
    binding,
    (f, entry) =>
      f === prop &&
      entry.delta.claims.pointers.some(
        (p) => p.role === ref.role && p.target.kind === "entity" && p.target.entity.id === target,
      ),
  );
}

// Writability is front-door discipline (SPEC §14, immutable-by-default): a registration names its
// `writable` fields, and ONLY those accept a surface write — assert, clear, remove, link, AND
// sever refuse the rest with a reason. Silence (no `writable`) now means "you may not": absent a
// list, NOTHING is writable (§21's wave flipped the old permissive default, so every registration
// Loam mints names its writable fields explicitly). It disciplines the SURFACE, never the ground:
// a hand-signed or federated delta may still assert into a "read-only" context, and a reader who
// wants the guarantee enforces it with a lens.
function assertWritable(
  gw: Gateway,
  name: string,
  fields: readonly string[],
  binding?: ConnectionBinding,
): void {
  const allowed = new Set(gw.def(name, binding).writable ?? []);
  for (const field of fields) {
    if (!allowed.has(field)) {
      throw new Error(
        `field "${field}" of ${name} is read-only: name it in the registration's \`writable\` ` +
          "list to open it for surface writes",
      );
    }
  }
}

// One signed MULTI-POINTER delta from an explicit pointer list — what every claim template
// is sugar for. The actor signs (or the operator, when none is named); standing is asked by
// append like everywhere else. Returns the receipt: the delta id.
export async function claimEntityImpl(
  gw: Gateway,
  pointers: readonly ClaimPointerSpec[],
  actorSeed?: string,
  binding?: ConnectionBinding,
): Promise<{ delta: string }> {
  const sink = sinkFor(gw, actorSeed, binding);
  const seed = actorSeed ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  if (pointers.length === 0) {
    throw new Error("a claim carries at least one pointer");
  }
  const mapped = pointers.map((p, i) => {
    if (typeof p.role !== "string" || p.role === "") {
      throw new Error(`claim pointer ${i}: a pointer names a role`);
    }
    const hasAt = p.at !== undefined;
    const hasValue = p.value !== undefined;
    if (hasAt === hasValue) {
      throw new Error(`claim pointer ${i} ("${p.role}"): exactly one of at/value`);
    }
    if (hasAt) {
      if (p.at === "") {
        throw new Error(`claim pointer ${i} ("${p.role}"): an entity pointer wants an id`);
      }
      if (p.context === undefined || p.context === "") {
        throw new Error(`claim pointer ${i} ("${p.role}"): an entity pointer wants a context`);
      }
      return {
        role: p.role,
        target: { kind: "entity" as const, entity: { id: p.at, context: p.context } },
      };
    }
    return { role: p.role, target: { kind: "primitive" as const, value: p.value as Primitive } };
  });
  const delta = signClaims(
    { timestamp: gw.nextTimestamp(), author: authorForSeed(seed), pointers: mapped },
    seed,
  );
  await sink.append([delta]);
  return { delta: delta.id };
}
