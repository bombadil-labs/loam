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

import { signClaims } from "@bombadil/rhizomatic";
import { containerClaims, readContainerTable } from "./container.js";
import type { Gateway } from "./gateway.js";
import { groupPrograms } from "./lifecycle.js";
import { programOf, type ProgramName } from "./registration.js";
import type { ResolvedNode } from "../surface/surface.js";

// Each listed entity costs one resolution, so the page size is bounded here — an unbounded
// listing is H8's full-scan cost multiplied by the member count, on one request. MEASURED
// (T110 open item b, 2026-08-11, memory backend): the candidate set is NOT maintained
// incrementally — `watch` re-evaluates the whole Term per pulse (~0.3s at a 2k-delta ground,
// ~2s at 10k), and a cold per-entity resolution is itself O(ground) (~0.12s per entity at 2k,
// ~0.8s at 10k). So a page costs roughly (limit × point-read) + one membership evaluation:
// exactly N point-reads a client would otherwise issue blind, never more — but a page should
// default modest, and holding this door honest past ~10k deltas needs warm materializations
// (the read side's own affordance), not a wider page.
export const LISTING_DEFAULT_LIMIT = 25;
export const LISTING_MAX_LIMIT = 500;

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

// The membership Term: the gather's selection, un-rooted. The per-root gather selects deltas
// pointing at ONE root and buckets them byTargetContext; this selects every delta carrying a
// pointer in one of those buckets, for ANY root — the pre-filtered candidate set. Mask "drop"
// runs over the whole ground, so a struck claim is not a member and an entity whose every
// relevant claim is struck drops out of the listing.
export function listingMembershipJson(contexts: readonly string[]): Record<string, unknown> {
  return {
    op: "select",
    pred: { hasPointer: { context: { inSet: [...contexts].sort() } } },
    in: { op: "mask", policy: "drop", in: "input" },
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
//     and it stays honored downstream.
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
  if (
    standing?.membership !== undefined &&
    JSON.stringify(standing.membership) === JSON.stringify(membership)
  ) {
    return name;
  }
  await gw.append([
    signClaims(
      containerClaims(
        { container: name, trust: "curated", posture: "shared", membership },
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
  const container = await ensureListingContainer(
    gw,
    name,
    program,
    listingMembershipJson(contexts),
    {
      operator: gw.operatorAuthor,
      seed: gw.options.seed,
    },
  );
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
  return page.map((entity) => gw.resolvedNode(name, entity));
}
