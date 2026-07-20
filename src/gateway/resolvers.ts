// Custom resolvers (SPEC §22), the read side. A resolver is the optional last step of a lens:
// `resolve(bucket) → value`, downstream of the Policy. The Policy keeps the epistemics — WHICH claims
// survive, in what order; the resolver overrides only what the survivors MEAN as a value. v1 builds
// RUNG (a) alone: bucket-pure, a function of the field's gathered deltas and nothing else — so it is
// deterministic, reproducible on any peer, and cacheable, and it can never observe anything the gather
// did not already select. This module loads a resolver's ESM, applies it over a field's bucket, and
// memoizes the result so an erasure invalidates it BY CONSTRUCTION.
//
// EXECUTION: a resolver at rest is directly-runnable ESM (§22.3) — `export default (bucket) => value`.
// It is loaded once, asynchronously, from a `data:` URL and cached by content address; the resolve
// path itself stays synchronous (rung (a) resolvers are pure sync functions, pre-loaded at bind time).
// v1 runs the operator's OWN code in a governed store — only the operator's law binds (§7), so a
// federated stranger's resolver never executes here. The confinement story for UNTRUSTED executable
// law (SES / Worker / wasm) is §24's quarantine and §23's renderer trust; a bucket-pure resolver is
// the safe floor beneath it, and this module deliberately does not invent a parallel sandbox.
//
// KNOWN v1 BOUNDARIES (deferred, not bugs): (1) an UNGOVERNED store binds any verified author's law by
// design, so it would execute a federated resolver too — the multi-tenant default (§7) is governed, and
// untrusted execution is §24's; (2) no compute budget or timeout — a runaway resolver is the operator's
// own footgun in v1, and resource discipline is §24 (question 5); (3) the memo is grow-only within a
// ground (cleared on erase / re-seat) — bounded eviction is a later optimization, never a correctness
// need, because the key already forbids serving a value the ground no longer supports.

import { isBytesView } from "./bytes.js";
import {
  contentAddress,
  resolveView,
  schemaHash,
  type Delta,
  type HVEntry,
  type HView,
  type Policy,
  type Schema,
  type View,
} from "@bombadil/rhizomatic";
import { importEsm } from "./esm.js";
import type { ResolverOutputType, ResolverSpecs } from "./registration.js";

// The projection a resolver sees for one bucket delta: the value the Policy would read (extracted the
// same way rhizomatic's resolveView does — the non-filing pointers), plus the provenance a bucket-pure
// computation legitimately depends on (when, and by whom). No rhizomatic internals leak across the
// boundary, so a resolver author writes against a stable shape, not the delta wire format.
export interface BucketEntry {
  readonly value: View;
  readonly timestamp: number;
  readonly author: string;
}

// A rung-(a) resolver: the field's bucket in, the field's value out. Pure and synchronous.
export type ResolveFn = (bucket: readonly BucketEntry[]) => View;

// The content address of a resolver's ESM — its identity, part of the memo key and (via the binding
// it rides) part of the version. Two peers with the same source agree; a changed byte is a new key.
export const resolverAddress = (code: string): string =>
  contentAddress(new TextEncoder().encode(code));

// Render one non-filing pointer target to a value, mirroring rhizomatic's candidateValue (R1):
// primitives pass through, entity/delta targets render to their id, bytes to a {mime,value} leaf.
//
// EXCEPT when the pointer was EXPANDED (SPEC §22.8, ticket T31). Then it renders as the CHILD'S OWN
// RESOLVED VIEW, through the reading the `expand` named — not as a bare entity id. This is what lets a
// resolver compute over what its own gather already gathered: a recipe that expands its ingredients
// has the pantry's stock sitting in its hyperview, and before this the resolver could only see
// `["item:flour"]`. It stays rung (a) — §22.1 defines bucket-pure as "a function of the SELECTED
// deltas only … it cannot observe anything the algebra did not already gather", and an expansion is
// precisely something the algebra already gathered (`expand` is a gather-side operator, and the child
// hview is sitting on this very entry). No sibling fields, no store access, no effects.
//
// The child is POLICY-resolved, not resolver-decorated: a resolver sees the child's Schema applied to
// the child's evidence, and never another resolver's output. That keeps rung (a) free of
// resolver-calls-resolver reentrancy and ordering, and it is stated in §22.8 rather than left to be
// discovered.
const renderTarget = (
  e: HVEntry,
  i: number,
  t: Delta["claims"]["pointers"][number]["target"],
): View => {
  const expansion = e.expanded?.get(i);
  const reading = e.readings?.get(i);
  if (expansion !== undefined && reading !== undefined) {
    return resolveView(reading, expansion);
  }
  switch (t.kind) {
    case "primitive":
      return t.value;
    case "entity":
      return t.entity.id;
    case "delta":
      return t.deltaRef.delta;
    case "bytes":
      return { mime: t.mime, value: t.value };
  }
};

// The value the Policy would see for a bucket entry: the pointers that do NOT file the delta under the
// root entity. One → that value; none → the bare fact of the edge (`true`); many → an object by role.
const candidateValue = (e: HVEntry, root: string): View => {
  const nonFiling: Array<[string, View]> = [];
  e.delta.claims.pointers.forEach((p, i) => {
    if (p.target.kind === "entity" && p.target.entity.id === root) return;
    nonFiling.push([p.role, renderTarget(e, i, p.target)]);
  });
  if (nonFiling.length === 0) return true;
  if (nonFiling.length === 1) return nonFiling[0]![1];
  const obj: Record<string, View> = {};
  for (const [role, v] of nonFiling) {
    const existing = obj[role];
    if (existing === undefined) obj[role] = v;
    else
      obj[role] = Array.isArray(existing) ? [...(existing as readonly View[]), v] : [existing, v];
  }
  return obj;
};

// A reading's content address, memoized per Schema object (stable per binding), so the memo key can
// name WHICH reading resolved a child without hashing it on every read.
const readingIds = new WeakMap<Schema, string>();
const readingId = (schema: Schema): string => {
  let id = readingIds.get(schema);
  if (id === undefined) {
    id = schemaHash(schema);
    readingIds.set(schema, id);
  }
  return id;
};

// Everything a bucket entry's VALUE depends on, as memo-key material. Its own delta id, and — since
// §22.8 projects an expanded pointer as the child's resolved view — the child's reading and every
// surviving delta in the child's hview, transitively.
//
// This is not optional detail: a recipe's `ingredient` bucket is the LINK deltas, and those do not
// change when the flour's stock does. A child-aware projection with the old key would serve a stale
// answer — "yes, you can make pasta" over flour that is gone — which is exactly §22.5's promise
// (the memo invalidates precisely when the ground does) and §11's (never serve a value distilled from
// bytes that no longer exist) broken in one stroke. The reading is in the key too, because a child
// lens that evolves changes the child's view without touching a single delta id.
const dependencyIds = (e: HVEntry, into: string[]): void => {
  into.push(e.delta.id);
  if (e.expanded === undefined) return;
  for (const [i, child] of e.expanded) {
    const reading = e.readings?.get(i);
    if (reading !== undefined) into.push(readingId(reading));
    for (const entries of child.props.values()) {
      for (const childEntry of entries) {
        if (childEntry.negated) continue; // the SURVIVING child ground, mirroring the projection
        dependencyIds(childEntry, into);
      }
    }
  }
};

// The surviving bucket for one field: the non-negated gathered deltas, each projected to a BucketEntry.
// This IS the "selected delta set" §22.5 keys the cache on — an erased delta simply is not here — now
// reaching through expansions, so a child's ground counts as part of what the value was distilled from.
export function bucketOf(
  hview: HView,
  field: string,
  root: string,
): { entries: BucketEntry[]; deltaIds: string[] } {
  const entries: BucketEntry[] = [];
  const deltaIds: string[] = [];
  for (const e of hview.props.get(field) ?? []) {
    if (e.negated) continue;
    entries.push({
      value: candidateValue(e, root),
      timestamp: e.delta.claims.timestamp,
      author: e.delta.claims.author,
    });
    dependencyIds(e, deltaIds);
  }
  return { entries, deltaIds };
}

// The loaded-resolver cache, keyed by content address. Loading ESM is async (a `data:` import); the
// resolve path is sync, so resolvers are pre-loaded (loadResolvers) before any read applies them.
const loaded = new Map<string, ResolveFn>();

// Load one resolver's ESM to a callable, cached by content address. `export default` must be a
// function; anything else is a malformed resolver and throws (the publisher surfaces it loudly).
export async function loadResolver(code: string): Promise<ResolveFn> {
  const address = resolverAddress(code);
  const hit = loaded.get(address);
  if (hit !== undefined) return hit;
  const mod = await importEsm(code); // the shared content-addressed ESM loader (SPEC §22.3)
  if (typeof mod.default !== "function") {
    throw new Error("a resolver's ESM must `export default` a function (bucket) => value");
  }
  const fn = mod.default as ResolveFn;
  loaded.set(address, fn);
  return fn;
}

// Pre-load every resolver across a set of specs (idempotent — the cache dedups by content address).
// Called at bind time and publish time so the synchronous resolve path always finds its functions.
export async function loadResolvers(
  specsList: ReadonlyArray<ResolverSpecs | undefined>,
): Promise<void> {
  const codes = new Set<string>();
  for (const specs of specsList) {
    if (specs === undefined) continue;
    for (const spec of Object.values(specs)) codes.add(spec.code);
  }
  await Promise.all([...codes].map((code) => loadResolver(code)));
}

// The memo: `(resolver-content-address, bucket-delta-set)` → value (SPEC §22.5). Keyed on the surviving
// bucket, so it invalidates EXACTLY when the bucket recomputes — including when a fact is FORGOTTEN
// (§11): an erased delta drops from the bucket, the key changes, the memo misses, the resolver re-runs
// over the surviving ground, and its old value — distilled from bytes that no longer exist — can never
// be served again. Erasure invalidation is not bolted on; it falls straight out of the key.
//
// The ROOT is part of the key because the bucket's PROJECTION depends on it: `candidateValue`
// strips whichever pointer files a delta under the root, so ONE delta yields DIFFERENT values for
// different roots. A symmetric edge (one delta naming two entities) lands in both entities' buckets
// from the same delta id — without the root those two reads collide on one key and the second is
// served the first's value. Child decoration (§22.7) shares one memo across every entity in a read
// tree, which made that collision reachable inside a single query; the root closes it.
export type ResolverMemo = Map<string, View>;
export const newResolverMemo = (): ResolverMemo => new Map();

const memoKey = (address: string, root: string, deltaIds: readonly string[]): string =>
  `${address} ${root} ${[...deltaIds].sort().join(",")}`;

// Apply a lens's resolvers over a resolved view (SPEC §22): for each field a resolver names, replace
// the Policy's value with `resolve(bucket)`. Synchronous — resolvers are pre-loaded. A resolver whose
// ESM is not loaded, or that throws at runtime, leaves the field's Policy value standing (availability
// over a surprise): a bad resolver narrows to its own field, never a broken read. Returns a NEW view;
// the input is not mutated.
// Does a resolver's returned value match its DECLARED output type (SPEC §22.6)? The six declared
// shapes, checked structurally: `bytes` is the §23.7 BytesView ({ mime, value: Uint8Array }) —
// the shape the envelope machinery downstream expects; `object` is a plain object (not an array,
// not bytes); `list` is an array of anything (the element type is the resolver's own business).
function matchesDeclaredType(value: unknown, type: ResolverOutputType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "list":
      return Array.isArray(value);
    case "bytes":
      return isBytesView(value);
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value) && !isBytesView(value)
      );
    default:
      return false; // unreachable: parseResolvers admits only the six declared types
  }
}

export function applyResolvers(
  resolvers: ResolverSpecs | undefined,
  view: Record<string, View>,
  hview: HView,
  root: string,
  memo: ResolverMemo,
): Record<string, View> {
  if (resolvers === undefined) return view;
  const out: Record<string, View> = { ...view };
  for (const [field, spec] of Object.entries(resolvers)) {
    const fn = loaded.get(resolverAddress(spec.code));
    if (fn === undefined) continue; // not loaded → fall back to the Policy value
    const { entries, deltaIds } = bucketOf(hview, field, root);
    const key = memoKey(resolverAddress(spec.code), root, deltaIds);
    const cached = memo.get(key);
    if (cached !== undefined) {
      out[field] = cached;
      continue;
    }
    try {
      const value = fn(entries);
      // The declared type BINDS (SPEC §22.6, ticket T18): the signed definition names what this
      // field's value IS, the doors advertise it, and this seam — the ONE place every door
      // inherits — is where the promise is kept. A mismatch does exactly what a throwing
      // resolver does: the field falls back to its Policy value, blast radius of one field,
      // and GraphQL and REST keep answering the SAME thing (§17's two-doors-agree).
      if (!matchesDeclaredType(value, spec.type)) continue;
      memo.set(key, value);
      out[field] = value;
    } catch {
      // a resolver that throws leaves its field's Policy value — the read still answers
    }
  }
  return out;
}

// ---- resolvers reach EXPANDED CHILDREN (SPEC §22.7, ticket T26) ----------------------------------
//
// A resolver rides a binding and decorates a lens's OWN top-level fields (applyResolvers, above). But
// an entity embedded as an expanded child of another lens's gather is a whole little view, resolved on
// its own — and since rhizomatic 0.8 (issue #23) it resolves through its OWN reading, named in the
// expand term. This is where the CHILD reading's resolvers reach it. The hard part is identity: the
// resolved child view is a bare Record with no id. We recover it without reimplementing any of
// rhizomatic's ordering: resolve the same hview a SECOND time with every expansion stripped, and each
// (formerly expanded) pointer renders as the child's entity ID — in the identical Policy order, so the
// stripped view aligns element-for-element with the resolved one. That alignment IS the identity.

// A child as the term actually identifies it: the POINTER that expanded it — its role and its target
// — together with the reading that pointer named. Role matters because one entry may expand the SAME
// entity under two roles through two different readings; target matters because the stripped resolve
// renders a pointer as its entity id, and that id is how the splice finds this child again.
type ChildRef = {
  readonly hview: HView;
  readonly reading: Schema;
  readonly root: string;
  readonly role: string;
};

// Every expansion each field embeds, PER FIELD — two fields may embed the same entity through
// different readings, so one global map would decorate one of them through the other's lens (and the
// winner would depend on Map order). Per-field scoping also keeps a plain string value in some other
// field from being mistaken for a child to decorate.
const expandedChildrenByField = (hview: HView): Map<string, ChildRef[]> => {
  const byField = new Map<string, ChildRef[]>();
  for (const [field, entries] of hview.props) {
    for (const e of entries) {
      if (e.expanded === undefined) continue;
      for (const [i, childHView] of e.expanded) {
        const reading = e.readings?.get(i);
        const ptr = e.delta.claims.pointers[i];
        if (reading === undefined || ptr?.target.kind !== "entity") continue;
        const refs = byField.get(field) ?? byField.set(field, []).get(field)!;
        refs.push({ hview: childHView, reading, root: ptr.target.entity.id, role: ptr.role });
      }
    }
  }
  return byField;
};

// A copy of an hview with every entry's expansion stripped — so resolveView renders each formerly
// expanded pointer as the child's entity ID rather than recursing into its view.
const stripExpansions = (hview: HView): HView => ({
  id: hview.id,
  props: new Map(
    [...hview.props].map(([field, entries]) => [
      field,
      entries.map((e) => ({ delta: e.delta, negated: e.negated })),
    ]),
  ),
});

// The stripped/full alignment (below) is only sound when the field's Policy selects and orders the
// SAME entries in BOTH resolves. `pick` and `all` do (they neither dedup nor fold). `conflicts` dedups
// by each value's canonical hex — child VIEWS and child IDS dedup differently, so the two lists can
// end up the same length but element-misaligned, which would decorate a child with the WRONG one's
// resolvers. `merge` folds to primitives, dropping child views entirely. So decoration is gated to the
// position-preserving policies; under any other, the child is left resolved-but-undecorated (honest,
// never wrong). `absentAs` is transparent — it decorates iff the policy it wraps does.
const alignsUnderStripping = (policy: Policy | undefined): boolean => {
  switch (policy?.kind) {
    case "pick":
    case "all":
      return true;
    case "absentAs":
      return alignsUnderStripping(policy.then);
    default:
      return false;
  }
};

// True for a plain object view — not an array, and not the §23.7 bytes leaf ({mime, value}).
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !isBytesView(v);

// The one child a (root, role) position names — or undefined when this field has no such expansion, or
// when the position is genuinely ambiguous (the same entity expanded under one role through two
// different readings, which no honest decoration could pick between).
const childAt = (refs: readonly ChildRef[], root: string, role?: string): ChildRef | undefined => {
  const hits = refs.filter((r) => r.root === root && (role === undefined || r.role === role));
  if (hits.length === 0) return undefined;
  const readings = new Set(hits.map((r) => r.reading.name ?? ""));
  return readings.size === 1 ? hits[0] : undefined;
};

// ONE child, decorated: the view rhizomatic ALREADY resolved through this child's reading, with that
// reading's own resolvers applied, then recursed for grandchildren. Reusing the resolved view is not
// only cheaper — re-resolving would repeat the exact work the parent's `resolveView` just did, once
// per child per level.
const decorateOne = (
  childView: Record<string, View>,
  ref: ChildRef,
  readingResolvers: (name: string) => ResolverSpecs | undefined,
  memo: ResolverMemo,
): Record<string, View> => {
  const withOwn = applyResolvers(
    ref.reading.name === undefined ? undefined : readingResolvers(ref.reading.name),
    childView,
    ref.hview,
    ref.root,
    memo,
  );
  return decorateChildren(withOwn, ref.hview, ref.reading, readingResolvers, memo);
};

// Splice by aligning a field's resolved value with its stripped (id) counterpart: same shape, same
// order. A scalar id that names one of THIS FIELD's children decorates it; a list aligns element-wise;
// an OBJECT — what `candidateValue` returns when an entry carries several non-filing pointers — recurses
// key-by-key, and since those keys ARE the pointer roles, each child is matched by (role, target) and
// therefore through its own reading. Anything else is left exactly as it was.
const spliceField = (
  value: View,
  idValue: unknown,
  refs: readonly ChildRef[],
  readingResolvers: (name: string) => ResolverSpecs | undefined,
  memo: ResolverMemo,
  role?: string,
): View => {
  if (typeof idValue === "string") {
    const ref = childAt(refs, idValue, role);
    if (ref === undefined || !isPlainObject(value)) return value;
    return decorateOne(value, ref, readingResolvers, memo);
  }
  if (Array.isArray(idValue) && Array.isArray(value) && idValue.length === value.length) {
    return value.map((v, k) =>
      spliceField(v as View, idValue[k], refs, readingResolvers, memo, role),
    );
  }
  if (isPlainObject(idValue) && isPlainObject(value)) {
    const out: Record<string, View> = { ...(value as Record<string, View>) };
    for (const k of Object.keys(out)) {
      if (k in idValue) {
        out[k] = spliceField(out[k]!, idValue[k], refs, readingResolvers, memo, k);
      }
    }
    return out;
  }
  return value;
};

// Decorate a resolved view's expanded children with their own reading's resolvers, recursively. The
// caller resolves through the Policy first; this reaches one level down and repeats. The lens's OWN
// resolvers are applied AFTER this (see reads.ts), so a resolver a lens declares on an expanding field
// has the last word rather than being silently overwritten by the decoration.
export function decorateChildren(
  view: Record<string, View>,
  hview: HView,
  schema: Schema,
  readingResolvers: (name: string) => ResolverSpecs | undefined,
  memo: ResolverMemo,
): Record<string, View> {
  const byField = expandedChildrenByField(hview);
  if (byField.size === 0) return view;

  // The identity alignment: the same fields, resolved with expansions stripped to entity ids.
  const idView = resolveView(schema, stripExpansions(hview)) as Record<string, unknown>;
  const out: Record<string, View> = { ...view };
  for (const [field, refs] of byField) {
    if (!(field in out)) continue;
    if (!alignsUnderStripping(schema.props.get(field) ?? schema.default)) continue;
    out[field] = spliceField(out[field]!, idView[field], refs, readingResolvers, memo);
  }
  return out;
}
