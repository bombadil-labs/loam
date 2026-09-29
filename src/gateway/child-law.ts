// Whose law a ground reads (step 6, refactor/audit/step6-pool-keys.md). A child ground governs its
// own law with its own key. It reads host-signed copies only in the law contexts it selects, and the
// host reviews its promotions only where it selects the host as a reviewer. User facts stay the
// host's (`usersGovernor`); peer-local erasure state is read as before until the substrate's erasure
// boundary lands.
//
// No reader treats {host, pool} as one governor. A reader asks for one context. For a single-valued
// law (a trust policy) the child's own declaration comes first, and a selected host declaration
// counts only where the child declares none. For a standing (a grant), either governor's surviving
// grant counts.

export type LawContext = "containers" | "registrations" | "trust" | "grants" | "renderers";

export interface ChildLaw {
  /** The host's governing key. */
  readonly host: string;
  /** The law contexts where this child accepts the host as a trusted author. */
  readonly selects: ReadonlySet<LawContext>;
  /** Whether host review strikes (the host and its surviving grantees) can block a promotion. */
  readonly hostReviews: boolean;
}

// An inbox builds its authority in its own ground on purpose: it selects nothing from the host.
export const inboxLaw = (host: string): ChildLaw => ({
  host,
  selects: new Set(),
  hostReviews: false,
});

// A channel, quarantine or separate pool holds seeded host copies of the container table,
// registrations, trust, grants and renderer twins, and selects the host for all of them.
export const seededLaw = (host: string): ChildLaw => ({
  host,
  selects: new Set<LawContext>(["containers", "registrations", "trust", "grants", "renderers"]),
  hostReviews: true,
});

/** The authors of `context` law in a ground governed by `own`: own key first, then a selected host. */
export function lawAuthors(
  own: string | undefined,
  law: ChildLaw | undefined,
  context: LawContext,
): string[] {
  const out = own === undefined ? [] : [own];
  if (law !== undefined && law.selects.has(context) && law.host !== own) out.push(law.host);
  return out;
}

/** Every key whose acts in this ground are the receiver's own, never a peer's: own and host. */
export function localAuthors(own: string | undefined, law: ChildLaw | undefined): string[] {
  const out = own === undefined ? [] : [own];
  if (law !== undefined && law.host !== own) out.push(law.host);
  return out;
}
