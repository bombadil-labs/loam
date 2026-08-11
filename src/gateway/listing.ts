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
// (and therefore re-declares nothing).
export function listingContexts(gw: Gateway, program: string): string[] {
  const contexts = new Set<string>();
  for (const r of gw.registered) {
    if (r.hyperschema.name !== program) continue;
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
// edit. Same-membership is a no-op: reads stay reads. Trust/posture are curated/shared and
// immutable; a hand-declared stranger at this name with other knobs refuses at the door, loudly.
async function ensureListingContainer(
  gw: Gateway,
  program: string,
  membership: Record<string, unknown>,
): Promise<string> {
  const name = listingContainerName(program);
  const standing = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(name);
  if (
    standing?.membership !== undefined &&
    JSON.stringify(standing.membership) === JSON.stringify(membership)
  ) {
    return name;
  }
  if (gw.operatorAuthor === undefined || gw.options.seed === undefined) {
    throw new Error(
      `list ${program}: a listing reads through the container that backs its hyperschema, and an ` +
        `ungoverned store has no operator to declare one — open the gateway with an operator seed`,
    );
  }
  await gw.append([
    signClaims(
      containerClaims(
        { container: name, trust: "curated", posture: "shared", membership },
        gw.operatorAuthor,
        gw.nextTimestamp(),
      ),
      gw.options.seed,
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
  const program = def.hyperschema.name;
  const limit = opts.limit ?? LISTING_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LISTING_MAX_LIMIT) {
    throw new Error(
      `list ${name}: limit must be an integer between 1 and ${LISTING_MAX_LIMIT} — each listed ` +
        `entity costs a resolution, so the page is bounded; walk the cursor for more`,
    );
  }
  const contexts = listingContexts(gw, program);
  const container = await ensureListingContainer(gw, program, listingMembershipJson(contexts));
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
