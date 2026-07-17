// The §14 write verbs (ticket T19: the Gateway's mutation bodies, in their own module). Mutation is
// the DUAL of resolution: assert writes one signed property-claim per provided field; retraction
// negates the caller's OWN surviving contributions and lets the read side re-resolve (the pick falls
// to the next survivor, an `all` list loses your value, a field only you spoke for goes absent). The
// verbs — mutate, clear, remove, link, sever, claim — are all sugar over two motions: sign-and-append
// a claim, or sign-and-append negations of your own claims. Nothing here bypasses a door: every write
// runs through `gw.append` (authorize, budgets, validators), and writability is checked at THIS seam
// (`assertWritable` — §14's immutable-by-default) before a delta is ever minted.
//
// These are the implementations behind `Gateway.mutateEntity` and the private clear/remove/link/
// sever/claim hooks — thin delegating methods on the class, bodies here. They reach the gateway only
// through its declared internals seam (the `@internal` members on the class — see the seam note in
// gateway.ts).

import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import type { HVEntry, Primitive } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import type { ClaimPointerSpec, ResolvedNode } from "./gql.js";
import { edgeRoles } from "./registration.js";

// One signed property-claim delta per provided property, signed as the ACTOR (or the
// operator when no actor is named), appended through the same validated, capability-enforced
// path as everything else.
export async function mutateEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  props: Record<string, Primitive>,
  actorSeed?: string,
): Promise<ResolvedNode> {
  const seed = actorSeed ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  const entries = Object.entries(props);
  if (entries.length === 0) {
    throw new Error(`mutation of ${entity} names no properties to claim`);
  }
  assertWritable(gw, name, Object.keys(props));
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
  await gw.append(deltas);
  return gw.resolvedNode(name, entity);
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
  keep: (field: string, entry: HVEntry) => boolean,
): Promise<ResolvedNode> {
  const seed = actorSeed ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  gw.def(name); // refuses an unknown schema
  const author = authorForSeed(seed);
  const hview = gw.gather(name, entity);
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
    await gw.append(negations);
  }
  return gw.resolvedNode(name, entity);
}

// Clear whole fields: retract every one of the caller's contributions to each named field.
export function clearEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  fields: readonly string[],
  actorSeed?: string,
): Promise<ResolvedNode> {
  if (fields.length === 0) throw new Error(`clear of ${entity} names no fields to retract`);
  assertWritable(gw, name, fields);
  const set = new Set(fields);
  return retract(gw, name, entity, actorSeed, (field) => set.has(field));
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
): Promise<ResolvedNode> {
  if (values.length === 0) {
    throw new Error(`remove from ${field} of ${entity} names no values to retract`);
  }
  assertWritable(gw, name, [field]);
  const wanted = new Set(values.map((v) => JSON.stringify(v)));
  return retract(
    gw,
    name,
    entity,
    actorSeed,
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

// The edge role a gather declares for `field` (SPEC §14 edge verbs): the pointer role an edge
// write must carry so the body's `expand` follows it into the child's view. Read from the
// PUBLISHED hyperschema gather, never the resolution Schema. A gather with no `expand` resolves no
// edges — link/sever are meaningless there and refuse. One expand role covers a byTargetContext
// gather's fields; a body with several distinct edge roles disambiguates by the field's own name.
function edgeRoleFor(gw: Gateway, name: string, field: string): string {
  const roles = edgeRoles(gw.def(name).hyperschema.body);
  if (roles.length === 0) {
    throw new Error(
      `schema ${name} resolves no edges: its gather has no \`expand\`, so "${field}" takes a ` +
        `value, not a relation`,
    );
  }
  if (roles.length === 1) return roles[0]!;
  if (roles.includes(field)) return field;
  throw new Error(
    `schema ${name} declares several edge roles (${roles.join(", ")}); wave A links a gather ` +
      `whose edge role is unambiguous for "${field}"`,
  );
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
): Promise<ResolvedNode> {
  const seed = actorSeed ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot write");
  }
  if (!gw.def(name).schema.props.has(field)) {
    throw new Error(`schema ${name} has no field "${field}" to link`);
  }
  assertWritable(gw, name, [field]);
  const role = edgeRoleFor(gw, name, field);
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
  await gw.append([delta]);
  return gw.resolvedNode(name, entity);
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
): Promise<ResolvedNode> {
  if (!gw.def(name).schema.props.has(field)) {
    throw new Error(`schema ${name} has no field "${field}" to sever`);
  }
  assertWritable(gw, name, [field]);
  const role = edgeRoleFor(gw, name, field);
  const wanted = targets !== undefined && targets.length > 0 ? new Set(targets) : undefined;
  return retract(
    gw,
    name,
    entity,
    actorSeed,
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

// Writability is front-door discipline (SPEC §14, immutable-by-default): a registration names its
// `writable` fields, and ONLY those accept a surface write — assert, clear, remove, link, AND
// sever refuse the rest with a reason. Silence (no `writable`) now means "you may not": absent a
// list, NOTHING is writable (§21's wave flipped the old permissive default, so every registration
// Loam mints names its writable fields explicitly). It disciplines the SURFACE, never the ground:
// a hand-signed or federated delta may still assert into a "read-only" context, and a reader who
// wants the guarantee enforces it with a lens.
function assertWritable(gw: Gateway, name: string, fields: readonly string[]): void {
  const allowed = new Set(gw.def(name).writable ?? []);
  for (const field of fields) {
    if (!allowed.has(field)) {
      throw new Error(
        `field "${field}" of ${name} is read-only: the registration does not open it for writes`,
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
): Promise<{ delta: string }> {
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
  await gw.append([delta]);
  return { delta: delta.id };
}
