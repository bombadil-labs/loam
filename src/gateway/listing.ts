// The listing door (ticket T110): a kind's entities, served. Nothing here invents a type — an
// entity has no type, and any entity reads through any registered lens — so "all the Plants" is
// an EVIDENCE-level question: which entities hold claims in the buckets this hyperschema's
// readings resolve into fields. The maintained answer is A CONTAINER (the decided shape): the
// hyperschema is backed by a shared container whose membership Term is the gather's selection,
// un-rooted — every delta carrying a pointer in one of the sibling lenses' prop contexts. A
// container is already a governed, erasure-reachable, freezable maintained set, so the candidate
// set rides the container algebra it was born into: exclusion narrows it, `freeze` names it,
// and the scope read closes negations over it (H1).
//
// One container per HYPERSCHEMA, N collection doors per LENS: the container answers "which
// entities have relevant evidence"; which VIEW each entity resolves to depends on the schema the
// caller asked through. The §14 edge rides along: an entity can hold evidence yet resolve sparse
// under a given lens — the door returns views, and absence stays absence.
//
// AUTHED DOOR ONLY (Myk, 2026-07-26): the read/public projection never builds a listing field.
// Enumeration is exactly what the uniform-404 discipline prevents elsewhere — a public listing
// door can inventory a store — so public enumeration waits for §12's per-lens `enumerable` flag.

import {
  evalPred,
  parseTerm,
  signClaims,
  termToJson,
  type Delta,
  type Pred,
  type Reactor,
  type Term,
} from "@bombadil/rhizomatic";
import {
  containerClaims,
  isContainerLaw,
  readContainerTable,
  type ContainerTable,
} from "./container.js";
import type { Gateway } from "./gateway.js";
import { groupPrograms } from "./lifecycle.js";
import { programOf, type ProgramName } from "./registration.js";
import type { ResolvedNode } from "../surface/surface.js";

// WHAT A PAGE COSTS. Every page pays three separate costs, and two of them are now independent
// of the store's size (H8, ticket T163):
//
//   1. the candidate set — MAINTAINED, not re-evaluated: a per-container index of the distinct
//      entities the members point at, folded forward from the reactor's arrival log by a swept
//      high-water mark (`ListingIndex` below). A plain claim advances it in O(1); anything that
//      could remove or re-admit a member (a strike, operator law) rebuilds it from the container
//      scope, so it is never a guess. Between law changes a page costs O(new deltas), not O(ground).
//   2. the cursor — a binary search into the sorted index, then `limit` ids: O(log N + limit),
//      whatever the page size and wherever the cursor stands.
//   3. one cold resolution per listed entity, still O(ground) — `resolvedNode` is the point door's
//      own cost, and it dominates a page: at a 10k-delta ground ~640ms per entity, of which two
//      full-snapshot walks in the read-closure probe are ~55% and the gather eval ~30%. That is the
//      point door's cost to fix; this door only stops multiplying it by anything but the page size.
//
// The bounds below are pinned as literals in the rails and are a MEASUREMENT: they were sized when a
// page also paid costs 1 and 2 in full, and `resolvedNode` is synchronous, so a page holds the event
// loop for its resolutions (the door yields BETWEEN them, so what remains is the caller's latency).
// They may rise on re-measurement, not by preference.
export const LISTING_DEFAULT_LIMIT = 10;
export const LISTING_MAX_LIMIT = 25;

export interface ListOptions {
  /** Page size: 1..LISTING_MAX_LIMIT; defaults to LISTING_DEFAULT_LIMIT. */
  readonly limit?: number;
  /** The cursor: the last `_entity` of the previous page, exclusive. Entities order ascending. */
  readonly after?: string | undefined;
}

/** The container that backs a hyperschema's enumeration, by the §27.1 naming convention. */
export const listingContainerName = (program: string): string => `container:hyperschema:${program}`;

// The prop contexts every sibling lens of this hyperschema resolves into fields — the union,
// because one hyperschema serves many schemas and the single maintained candidate set feeds
// every lens reading over it. Sorted, so the same registration set always mints the same Term
// (and therefore re-declares nothing). Read from the GROUPING, never the flat list: the flat
// list legitimately holds a superseded binding beside its evolution, and a union drawn from it
// would keep admitting contexts no SURVIVING lens reads (the H6 family's shape — a membership
// nobody's current reading declares).
export function listingContexts(gw: Gateway, program: ProgramName): string[] {
  const group = groupPrograms(gw.registered).get(program);
  const contexts = new Set<string>();
  for (const r of group?.lenses.values() ?? []) {
    for (const prop of r.schema.props.keys()) contexts.add(prop);
  }
  return [...contexts].sort();
}

// The negation posture the PROGRAM reads under, lifted out of its own body. The candidate set and
// the reading must suppress by the same rule or an entity can vanish from the enumeration while
// still resolving through the point door — and "absent from the list" reads as "there is no such
// entity", which is a strictly bigger claim than any single read makes. A hardcoded "drop" was
// exactly that bug: `governedGatherBody` exists to make a stranger's strike inert (the heckler's
// veto), and a `drop` candidate set handed the veto straight back at the enumeration.
//
// Lifted rather than recomputed, so the two can never drift: one hyperschema per program is
// enforced (`groupPrograms` refuses a rival body), so the program HAS one body, and its mask is
// the one the readings run under whatever computed it. `undefined` means the body masks nothing —
// then the membership masks nothing either, rather than inventing a suppression the reading does
// not perform.
export function programMaskJson(body: Term): unknown {
  const policies = new Map<string, unknown>();
  // Follow the TERM's own operand positions and nothing else. A trust policy's predicate carries
  // an `inView.term` with a mask of its own (`lawfulStrikersJson` has one: the grants survive only
  // the operator's strikes), and that mask is part of the PREDICATE, not the body's posture — a
  // blind walk over every key finds it and reports the governed gather as masking two ways.
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    const rec = node as Record<string, unknown>;
    if (rec.op === "mask" && "policy" in rec) policies.set(JSON.stringify(rec.policy), rec.policy);
    for (const key of ["in", "left", "right", "of", "without"]) walk(rec[key]);
  };
  walk(termToJson(body));
  if (policies.size > 1) {
    throw new Error(
      `the hyperschema body masks negations ${policies.size} different ways, and a listing has ` +
        `one candidate set — it cannot suppress by two rules at once. Give the program a single ` +
        `mask, or leave this hyperschema unlisted.`,
    );
  }
  return [...policies.values()][0];
}

// The membership Term: the gather's selection, un-rooted. The per-root gather selects deltas
// pointing at ONE root and buckets them byTargetContext; this selects every delta carrying a
// pointer in one of those buckets, for ANY root — the pre-filtered candidate set. The mask is the
// PROGRAM'S OWN (`programMaskJson`), so a strike removes a claim from the candidate set exactly
// when it removes it from the reading; `undefined` selects over the raw input, masking nothing.
export function listingMembershipJson(
  contexts: readonly string[],
  mask: unknown,
): Record<string, unknown> {
  return {
    op: "select",
    pred: { hasPointer: { context: { inSet: [...contexts].sort() } } },
    in: mask === undefined ? "input" : { op: "mask", policy: mask, in: "input" },
  };
}

// Ensure the backing container's declaration is current: absent, declare it; present with a
// different membership (a sibling lens arrived and widened the context union), re-declare —
// membership is a latest-wins knob (§27.1), so the refresh is one more declaration, never an
// edit. Same-membership is a no-op: reads stay reads.
//
// Two refusals guard the read BEFORE any short-circuit, because the door's own validator only
// runs on the re-declare path (a P5 lens's finding):
//   - the name is taken by a container with OTHER knobs — a separate-posture container here
//     would make the listing read a pool's snapshot as "the Plants"; refuse rather than serve
//     through a container this door did not shape (trust/posture are immutable, §28.4, so a
//     re-declare could never repair it silently either);
//   - the container is DETACHED — a detached container contributes nothing to a scope read by
//     design, which for a caller who never named a container would turn "off the record" into a
//     complete-looking empty page; the exclusion knob is the deliberate way to empty a listing,
//     and it stays honored downstream;
//   - the standing membership lives at a published ADDRESS rather than inline — this door compares
//     the INLINE Term to decide whether anything changed, so an addressed one never matches and
//     every read would mint one more operator-signed declaration, forever. A refusal is the honest
//     answer to a container this door cannot tell is already correct.
//
// The re-declaration CARRIES the standing record's other knobs (`parent`, `version`, `inboxOf`).
// A declaration is latest-wins over the whole record, not per-pointer, so re-declaring with only
// the knobs this door knows about would silently RE-ROOT a container an operator had nested — a
// read quietly undoing a write.
//
// What is NOT fixed here, and is ticketed rather than hidden (T164): this writes operator-signed
// law from inside a read. A transiently unbound sibling lens narrows the context union, so the
// next read re-declares, and the read after it declares back — one permanent delta per flap.
async function ensureListingContainer(
  gw: Gateway,
  lens: string,
  program: ProgramName,
  membership: Record<string, unknown>,
  law: { operator: string; seed: string },
): Promise<string> {
  const name = listingContainerName(program);
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const standing = table.containers.get(name);
  if (standing !== undefined && (standing.trust !== "curated" || standing.posture !== "shared")) {
    throw new Error(
      `list ${lens}: "${name}" stands declared ${standing.trust}/${standing.posture}, and the ` +
        `listing reads only through the curated/shared container it declares itself — trust and ` +
        `posture are immutable (§28.4), so this name is taken. Strike that declaration, or leave ` +
        `this lens unlisted.`,
    );
  }
  if (table.detached.has(name)) {
    throw new Error(
      `list ${lens}: the backing container "${name}" is DETACHED — its candidate set is ` +
        `deliberately off the record, and an empty page here would read as "no entities" (H9). ` +
        `Reattach it, or exclude the container if an empty listing is what you mean.`,
    );
  }
  if (standing?.membershipAt !== undefined && standing.membership === undefined) {
    throw new Error(
      `list ${lens}: the backing container "${name}" carries its membership at a published ` +
        `address (${standing.membershipAt}), and this door compares the INLINE Term — it cannot ` +
        `tell whether that address already says what it would declare, so every read would mint ` +
        `one more declaration. Re-declare it inline, or leave this lens unlisted.`,
    );
  }
  if (
    standing?.membership !== undefined &&
    JSON.stringify(standing.membership) === JSON.stringify(membership)
  ) {
    return name;
  }
  await gw.append([
    signClaims(
      containerClaims(
        {
          container: name,
          trust: "curated",
          posture: "shared",
          membership,
          // Latest-wins is per DECLARATION: omitting a knob that stands is deleting it.
          ...(standing?.parent === undefined ? {} : { parent: standing.parent }),
          ...(standing?.version === undefined ? {} : { version: standing.version }),
          ...(standing?.inboxOf === undefined ? {} : { inboxOf: standing.inboxOf }),
        },
        law.operator,
        gw.nextTimestamp(),
      ),
      law.seed,
    ),
  ]);
  return name;
}

// ── The maintained candidate set (cost 1) and the seekable cursor (cost 2) ──────────────────────
//
// The index follows the reactor's ARRIVAL LOG by a swept high-water mark: `log[0, swept)` is folded
// in, and a read folds `log[swept, length)` before answering. That is H8's safe shape — an index of
// work COMPLETED, never of data expected: lose it and the next read rebuilds, which merely costs
// time. It is keyed on the reactor object (a reseat replaces the reactor, orphaning the index) and
// on the membership Term (a lens evolution that narrows the contexts is a fresh index).
//
// A delta advances the index in O(1) only when it cannot REMOVE or REVIVE anything: no container
// law (`isContainerLaw` — the operator's container records and strikes, the two shapes the table
// reads), no pointer at a delta (no strike, no manifest, no supersession), unstruck at the moment
// it is folded (federation may deliver a strike before its target), and unable to feed the mask's
// trust sub-view (`trustFeeder` — under the governed body that is an operator-minted grant). Then it
// is a member exactly when it carries a pointer in a listing context — the membership `select`
// matches it, no mask can drop an unstruck delta, and the closure only ever ADDS negations. Every
// other delta rebuilds the index from the container scope, the one place that owns exclusion,
// closure, and refusal. The operator's own DATA folds like anyone's: on a store the operator writes
// to, "authored by the operator" would collapse every write back to a scan. So under ordinary
// writes a page never scans the ground; a strike or an act of law buys exactly one scan, on the
// next read. Fresh ids are folded as ONE sorted merge per read (O(k log k + N) for k arrivals),
// not a splice per id — a bulk pull would otherwise pay O(k·N) memmoves on the read path.
//
// What "law" means here is enumerated from the code that reads it, not guessed: the container
// table (`computeContainerTable`) reads container-context records and operator strikes; the lens
// contexts are recomputed per read from the live bindings, so a registration reaches the index
// through the membership key, never through this fold; grants reach it through `trustFeeder`.
//
// The index is consulted only while the container's ALGEBRA is plain — nothing excluded that is
// declared and active, no active inbox pool bound to this container. An excluded container's
// members subtract from every scope, and an inbox pool's members compose in from a reactor this
// index does not follow; both are honored by falling back to the scope read, correct and slow.
interface ListingIndex {
  readonly reactor: WeakRef<Reactor>; // weak: a reseat must not keep the old reactor alive
  readonly membership: string; // the Term as JSON, the key that ties the index to one candidate set
  readonly contexts: ReadonlySet<string>;
  swept: number; // arrival-log high-water mark
  readonly entities: string[]; // ascending, distinct
  readonly seen: Set<string>;
  // The mask's ground-dependence (`trustFeeder`); undefined means no delta is plain — always rebuild.
  readonly feedsTrust: ((d: Delta) => boolean) | undefined;
}

const indexes = new WeakMap<Gateway, Map<string, ListingIndex>>();

/** The distinct entities a member set points at in the listing contexts, ascending. */
export function projectListingEntities(
  members: Iterable<Delta>,
  contexts: ReadonlySet<string>,
): string[] {
  const ids = new Set<string>();
  for (const d of members) addPointedEntities(d, contexts, ids);
  return [...ids].sort();
}

function addPointedEntities(d: Delta, contexts: ReadonlySet<string>, into: Set<string>): void {
  for (const p of d.claims.pointers) {
    if (p.target.kind !== "entity") continue;
    const context = p.target.entity.context;
    if (context !== undefined && contexts.has(context)) into.add(p.target.entity.id);
  }
}

// Plain claim: cannot remove or revive a member (see the block comment above). `feedsTrust` is the
// mask's own ground-dependence — see `trustFeeder`.
const isPlainClaim = (gw: Gateway, d: Delta, feedsTrust: (d: Delta) => boolean): boolean =>
  !isContainerLaw(d, gw.operatorAuthor) &&
  d.claims.pointers.every((p) => p.target.kind !== "delta") &&
  gw.reactor.negationsOf(d.id).length === 0 &&
  !feedsTrust(d);

// A TRUST mask decides which negations count by a predicate, and that predicate may read the
// ground (`inView`: "struck by an author the surviving grants name"). Then a delta that is no
// strike and no law can still change membership — by joining the sub-view the predicate reads,
// which lets a dormant strike bind. This bounds that dependence per delta: it answers "could this
// delta join any `inView` sub-view of the mask?" for the shapes a listing membership takes — OUR
// `select` over `input` or over a masked `input`, and inside the mask a trust predicate whose
// `inView` sub-views are themselves a `select` over a per-delta predicate. Anything else — a nested
// reflective predicate, an aliased closure (expanded against the ground), a root variable, a hole,
// an unfamiliar operator — answers `undefined`, and then no delta is plain: every read that finds
// the log moved rebuilds, which is exactly the old cost and never a wrong page. Under the governed
// body's mask the sub-view selects operator-authored grants, so a stranger's claim never feeds it.
export function trustFeeder(membership: unknown): ((d: Delta) => boolean) | undefined {
  const term = parseTerm(membership);
  if (term.kind !== "select" || predUnbounded(term.pred)) return undefined;
  const of = term.of;
  if (of.kind === "input") return () => false;
  if (of.kind !== "mask" || of.of.kind !== "input") return undefined;
  if (of.policy.kind !== "trust") return () => false;
  const feeders: ((d: Delta) => boolean)[] = [];
  return boundTrust(of.policy.pred, feeders) ? (d) => feeders.some((f) => f(d)) : undefined;
}

// Walk a trust predicate: per-delta parts decide nothing about the ground; each `inView` yields a
// feeder; a part that reads the ground any other way is unbounded (false).
function boundTrust(pred: Pred, feeders: ((d: Delta) => boolean)[]): boolean {
  switch (pred.kind) {
    case "and":
    case "or":
      return boundTrust(pred.left, feeders) && boundTrust(pred.right, feeders);
    case "not":
      return boundTrust(pred.pred, feeders);
    case "inView": {
      const feeder = mayJoin(pred.term);
      if (feeder === undefined) return false;
      feeders.push(feeder);
      return true;
    }
    default:
      return !predUnbounded(pred);
  }
}

// Could a delta join `eval(term, ground)`? Bounded for a `select` over a per-delta predicate, over
// `input` or over a masked `input` (a mask only REMOVES, and only a strike removes — which is
// already not plain): then it is exactly the predicate on the delta.
function mayJoin(term: Term): ((d: Delta) => boolean) | undefined {
  if (term.kind !== "select" || predUnbounded(term.pred)) return undefined;
  const of = term.of;
  const overInput =
    of.kind === "input" ||
    (of.kind === "mask" &&
      of.of.kind === "input" &&
      (of.policy.kind !== "trust" || !predUnbounded(of.policy.pred)));
  if (!overInput) return undefined;
  const pred = term.pred;
  return (d) => evalPred(pred, d);
}

// A predicate that reads the ground (reflective, aliased), the ambient root, or a binding cannot
// be decided on the delta alone.
function predUnbounded(pred: Pred): boolean {
  switch (pred.kind) {
    case "and":
    case "or":
      return predUnbounded(pred.left) || predUnbounded(pred.right);
    case "not":
      return predUnbounded(pred.pred);
    case "inView":
      return true;
    case "match":
      return isHole(pred.constant);
    case "hasPointer": {
      const pp = pred.ppred;
      return (
        pp.role?.kind === "aliased" ||
        pp.context?.kind === "aliased" ||
        pp.targetEntity?.kind === "root" ||
        pp.targetEntity?.kind === "hole" ||
        (pp.targetValue?.kind === "vcmp" && isHole(pp.targetValue.value))
      );
    }
    default:
      return false;
  }
}

const isHole = (v: unknown): boolean =>
  typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "hole";

const algebraIsPlain = (table: ContainerTable, container: string): boolean => {
  for (const name of table.excluded) {
    if (table.containers.has(name) && !table.detached.has(name)) return false;
  }
  for (const [name, rec] of table.containers) {
    if (rec.inboxOf === container && !table.detached.has(name)) return false;
  }
  return true;
};

// The first index whose id is > needle (strict) or >= needle (not strict), in an ascending array:
// the cursor seek, and the insertion point. Ids compare by code unit, exactly as `.sort()` orders
// them, so the seek and the order can never disagree.
function seek(sorted: readonly string[], needle: string, strict: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const below = strict ? sorted[mid]! <= needle : sorted[mid]! < needle;
    if (below) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// One linear merge of a sorted batch of NEW ids (disjoint from `sorted`) into `sorted`, in place.
function mergeSorted(sorted: string[], fresh: string[]): void {
  fresh.sort();
  let i = sorted.length - 1;
  let j = fresh.length - 1;
  sorted.length += fresh.length;
  for (let k = sorted.length - 1; j >= 0; k -= 1) {
    if (i >= 0 && sorted[i]! > fresh[j]!) {
      sorted[k] = sorted[i]!;
      i -= 1;
    } else {
      sorted[k] = fresh[j]!;
      j -= 1;
    }
  }
}

// The index for (gateway, container), current to the reactor's log — built, rebuilt, or advanced.
function currentIndex(
  gw: Gateway,
  container: string,
  membership: Record<string, unknown>,
  contexts: ReadonlySet<string>,
): ListingIndex {
  const key = JSON.stringify(membership);
  let perGw = indexes.get(gw);
  if (perGw === undefined) {
    perGw = new Map<string, ListingIndex>();
    indexes.set(gw, perGw);
  }
  const byContainer = perGw;
  const log = gw.reactor.arrivalLog();
  const idx = byContainer.get(container);
  const rebuild = (): ListingIndex => {
    const entities = projectListingEntities(
      gw.containerScope({ containers: [container] }),
      contexts,
    );
    const fresh: ListingIndex = {
      reactor: new WeakRef(gw.reactor),
      membership: key,
      contexts,
      swept: log.length,
      entities,
      seen: new Set(entities),
      feedsTrust: idx?.membership === key ? idx.feedsTrust : trustFeeder(membership),
    };
    byContainer.set(container, fresh);
    return fresh;
  };
  if (idx === undefined || idx.reactor.deref() !== gw.reactor || idx.membership !== key) {
    return rebuild();
  }
  if (idx.feedsTrust === undefined) {
    return idx.swept === log.length ? idx : rebuild();
  }
  const fresh = new Set<string>();
  for (let i = idx.swept; i < log.length; i += 1) {
    if (!isPlainClaim(gw, log[i]!, idx.feedsTrust)) return rebuild();
    addPointedEntities(log[i]!, contexts, fresh);
  }
  const arrivals: string[] = [];
  for (const id of fresh) {
    if (idx.seen.has(id)) continue;
    idx.seen.add(id);
    arrivals.push(id);
  }
  if (arrivals.length > 0) mergeSorted(idx.entities, arrivals);
  idx.swept = log.length;
  return idx;
}

// One page of ENTITY IDS — the candidate set sliced at the cursor, before any resolution. Exported
// as its own seam so the candidate cost can be measured and railed apart from cost 3.
export async function listingPageImpl(
  gw: Gateway,
  name: string,
  opts: ListOptions = {},
): Promise<string[]> {
  const def = gw.def(name); // refuses an unregistered lens in the door's own voice
  const program = programOf(def);
  const limit = opts.limit ?? LISTING_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LISTING_MAX_LIMIT) {
    throw new Error(
      `list ${name}: limit must be an integer between 1 and ${LISTING_MAX_LIMIT} — each listed ` +
        `entity costs a resolution, so the page is bounded; walk the cursor for more`,
    );
  }
  // The refusal names the LENS the caller asked for (H6: a message reporting the program would
  // describe a request the caller never made); the container it could not declare is the body's.
  if (gw.operatorAuthor === undefined || gw.options.seed === undefined) {
    throw new Error(
      `list ${name}: a listing reads through the container that backs its hyperschema ` +
        `("${listingContainerName(program)}"), and an ungoverned store has no operator to ` +
        `declare one — open the gateway with an operator seed`,
    );
  }
  const contexts = listingContexts(gw, program);
  // The mask comes off THIS program's body — one hyperschema per program is enforced upstream, so
  // the lens the caller asked through carries the program's single body and its single posture.
  const membership = listingMembershipJson(contexts, programMaskJson(def.hyperschema.body));
  const container = await ensureListingContainer(gw, name, program, membership, {
    operator: gw.operatorAuthor,
    seed: gw.options.seed,
  });
  const inContexts = new Set(contexts);
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const after = opts.after;
  if (!algebraIsPlain(table, container)) {
    // The scope read owns exclusion and inbox composition; it is O(ground), and correct.
    return projectListingEntities(gw.containerScope({ containers: [container] }), inContexts)
      .filter((id) => after === undefined || id > after)
      .slice(0, limit);
  }
  const idx = currentIndex(gw, container, membership, inContexts);
  // `after` is EXCLUSIVE: the page starts at the first entity strictly greater than it.
  const from = after === undefined ? 0 : seek(idx.entities, after, true);
  return idx.entities.slice(from, from + limit);
}

// The listing itself (the body of `Gateway.list`): one page of entity ids from the maintained
// candidate set, each resolved through the asked lens. Members are deltas; the door serves
// entities. Ordering is ascending entity id — deterministic across stores and pulses, which is
// what makes `after` an honest cursor: the page after `after` is the same page tomorrow unless
// the ground moved, and a moved ground shifts entities, never reorders them.
export async function listImpl(
  gw: Gateway,
  name: string,
  opts: ListOptions = {},
): Promise<ResolvedNode[]> {
  const page = await listingPageImpl(gw, name, opts);
  // `resolvedNode` is synchronous and O(ground), so a page resolved in one run holds the event
  // loop for its whole duration — one authed request stalling every other mount and the tokenless
  // public door. Yield BETWEEN entities: the caller waits exactly as long, and nobody else does.
  const nodes: ResolvedNode[] = [];
  for (const entity of page) {
    if (nodes.length > 0) await yieldToLoop();
    nodes.push(gw.resolvedNode(name, entity));
  }
  return nodes;
}

// A macrotask, not a microtask: `await Promise.resolve()` drains into the same run and yields to
// nothing. `setImmediate` is Node's cheapest real yield; `setTimeout(…, 0)` is the portable
// fallback for a runtime without it.
const yieldToLoop = (): Promise<void> =>
  new Promise<void>((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
