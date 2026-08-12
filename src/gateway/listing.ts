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

import { signClaims, termToJson, type Term } from "@bombadil/rhizomatic";
import { containerClaims, readContainerTable } from "./container.js";
import type { Gateway } from "./gateway.js";
import { groupPrograms } from "./lifecycle.js";
import { programOf, type ProgramName } from "./registration.js";
import type { ResolvedNode } from "../surface/surface.js";

// WHAT A PAGE COSTS, and it is NOT "N point-reads and nothing else" — that reading flatters the
// door and is the trap this comment exists to close. Every page pays three separate costs:
//
//   1. one full membership evaluation over the whole ground — the candidate set is NOT maintained
//      incrementally, so `select` re-runs per call;
//   2. the projection of EVERY member delta into entity ids, and a sort of the whole id set,
//      before `after`/`limit` slice it — so walking N entities with `limit: 1` is O(N) pages ×
//      O(N) ids = QUADRATIC in the kind's size, whatever the page size;
//   3. one cold resolution per listed entity, itself O(ground).
//
// MEASURED (memory backend, 2026-08-12), and the numbers are the argument for the cap below:
//
//   ground     membership eval   per entity   list(limit 25)
//   2k deltas            150ms        120ms            3.2s
//   10k deltas           874ms        655ms           17.6s
//
// The first cap was 500. At a 10k-delta ground that is 500 × 655ms ≈ 330 SECONDS on one authed
// request — and `resolvedNode` is synchronous, so all of it was a stalled event loop: every other
// mount and the tokenless public door waited behind one caller's page.
//
// Two fixes, and both are needed. The cap is 25 and the default 10, so the worst page a client
// can ask for costs ~16s at 10k rather than ~330s. And the resolutions YIELD between entities, so
// what remains is the CALLER'S latency rather than the server's — a blocked loop is what turns one
// slow request into a slow server, and that part is now gone at any page size.
//
// Neither makes this door cheap; they make it bounded and interruptible. A large kind wants warm
// materializations (the read side's own affordance) for cost 3 and an incrementally maintained
// candidate set for costs 1 and 2 — H8 on all three, and T163 owns them.
export const LISTING_DEFAULT_LIMIT = 10;
export const LISTING_MAX_LIMIT = 25;

export interface ListOptions {
  /** Page size: 1..LISTING_MAX_LIMIT; defaults to LISTING_DEFAULT_LIMIT. */
  readonly limit?: number;
  /** The cursor: the last `_entity` of the previous page, exclusive. Entities order ascending. */
  readonly after?: string;
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

// The listing itself (the body of `Gateway.list`): ensure the backing container, read its
// members through the container scope (negation-closed, exclusion honored, fail-closed on any
// unresolvable dependency — never a bare Term evaluation), project the DISTINCT ENTITIES the
// members point at (the byTargetContext grouping move, at the set level), and resolve one page
// of them through the asked lens. Members are deltas; the door serves entities.
//
// Ordering is ascending entity id — deterministic across stores and pulses, which is what makes
// `after` an honest cursor: the page after `after` is the same page tomorrow unless the ground
// moved, and a moved ground shifts entities, never reorders them.
export async function listImpl(
  gw: Gateway,
  name: string,
  opts: ListOptions = {},
): Promise<ResolvedNode[]> {
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
  const members = gw.containerScope({ containers: [container] });
  const inContexts = new Set(contexts);
  const ids = new Set<string>();
  for (const d of members) {
    for (const p of d.claims.pointers) {
      if (p.target.kind !== "entity") continue;
      const context = p.target.entity.context;
      if (context !== undefined && inContexts.has(context)) ids.add(p.target.entity.id);
    }
  }
  const after = opts.after;
  const page = [...ids]
    .sort()
    .filter((id) => after === undefined || id > after)
    .slice(0, limit);
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
