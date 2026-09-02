// LEEWAY — what a container may do, and what it allows beneath it (SPEC §58, position 4).
//
// A leeway is four switches, an envelope, and delegation terms. Every switch starts off: the
// private journal is the default, and nothing here can widen what a person did not turn on.
//
// THE ONE RULE, and it is the whole of this file: a child's leeway — its switches, its envelope,
// and its own `delegate` — must fit inside its parent's DELEGATION TERMS. The parent's own
// switches never enter the comparison. A sealed room may therefore hold an open annex: a
// container with `receive` off and `delegate: { receive: on }` follows nothing into its own room
// and may still declare a child that follows a store into its.
//
// `delegate: "off"` is not "no terms" — it means the subtree is a pure NAMESPACE. Nothing may be
// configured below and nothing may be bound below, because every child inherits this container's
// leeway exactly. So a child leeway under `off` is refused even when it asks for nothing new;
// there is no such thing as a child leeway there to compare.
//
// `"same"` in a terms' `delegate` means: helpers may delegate further under these very terms, all
// the way down, without anyone writing the recursion out. It resolves to the terms that carry it,
// which is what keeps the comparison finite — see `fitsWithin`.
//
// The envelope names how much compute may run behind glass. It is ordered, not boolean, and the
// terms carry a CEILING rather than a permission. The three names bind to §23's bills where a
// renderer is actually run; this file only orders them, because ordering is all the rule needs.

/** How much compute an agent here may spend running things behind glass. */
export type EnvelopeSize = "small" | "medium" | "large";

const ENVELOPE_RANK: Readonly<Record<EnvelopeSize, number>> = { small: 1, medium: 2, large: 3 };

/** The three switches that are plain permissions. The envelope is a ceiling and is compared apart. */
const SWITCHES = ["receive", "offer", "publish"] as const;
type Switch = (typeof SWITCHES)[number];

interface Allowances {
  readonly receive: boolean;
  readonly offer: boolean;
  readonly publish: boolean;
  readonly envelope: EnvelopeSize;
}

/** What may exist below a container. `"same"` carries these terms down unchanged. */
export interface Terms extends Allowances {
  readonly delegate: "off" | "same" | Terms;
}

/** A container's own leeway. Its `delegate` says what may exist below it. */
export interface Leeway extends Allowances {
  readonly delegate: "off" | Terms;
}

/** Why a child was refused. Absent means it fits. */
export interface LeewayRefusal {
  readonly why: string;
}

/**
 * Does `child` fit inside what `parent` delegates?
 *
 * Takes the parent's LEEWAY rather than its terms on purpose: ignoring `parent.receive` and
 * reading only `parent.delegate` is this function's own doing, so a rail can catch it if that ever
 * stops being true.
 */
export function leewayFits(child: Leeway, parent: Leeway): LeewayRefusal | undefined {
  if (parent.delegate === "off") {
    return {
      why:
        "this container delegates nothing, so its subtree is a pure namespace: every child " +
        "inherits its leeway exactly and none may declare one of its own. Turn Delegate on and " +
        "set the terms a child may differ within.",
    };
  }
  return fitsWithin(child, parent.delegate);
}

/**
 * The comparison, shared by a container's own leeway and by every nested terms below it.
 *
 * TERMINATION. Each step consumes one written level of one side. A child `delegate` that is a
 * terms OBJECT walks the child's own finite structure; a child `delegate` of `"same"` holds the
 * child still and walks the ALLOWED chain instead, stopping at that chain's `"same"` (admit) or
 * `"off"` (refuse). `"same"` never expands on either side, so the depth is bounded by
 * max(depth(child's written terms), depth(allowed's written terms)).
 */
function fitsWithin(
  child: Allowances & { readonly delegate: "off" | "same" | Terms },
  allowed: Terms,
): LeewayRefusal | undefined {
  for (const name of SWITCHES) {
    if (child[name] && !allowed[name]) {
      return { why: refusedSwitch(name) };
    }
  }
  if (ENVELOPE_RANK[child.envelope] > ENVELOPE_RANK[allowed.envelope]) {
    return {
      why:
        `the envelope "${child.envelope}" is above the ceiling "${allowed.envelope}" these terms ` +
        `set. Choose ${allowed.envelope} or smaller, or raise the ceiling where the terms are written.`,
    };
  }

  const wanted = child.delegate;
  if (wanted === "off") return undefined; // delegating nothing always fits

  const permitted = allowed.delegate;
  if (permitted === "off") {
    return {
      why:
        "these terms delegate nothing further, so a child here may not set terms of its own. " +
        "Everything below it inherits its leeway exactly.",
    };
  }

  // `"same"` on the allowed side means "under these very terms", so the terms in hand ARE the
  // ceiling for the next level down. This is the clause that keeps the comparison finite.
  const ceiling: Terms = permitted === "same" ? allowed : permitted;

  // `"same"` on the CHILD side asserts these allowances at EVERY depth below, so they must fit
  // EVERY ceiling the parent wrote — not merely the next one. Walk the allowed side down until it
  // reaches its own fixpoint (`"same"`: every deeper ceiling is the one already fitted, so admit)
  // or ends (`"off"`, refused above, because a pure namespace is exactly what `"same"` asks to
  // configure). Stopping one level early lets a child escape a chain that narrows deeper down,
  // which made the shorthand WIDER than writing the same recursion out.
  if (wanted === "same") {
    return permitted === "same" ? undefined : fitsWithin(child, ceiling);
  }

  return fitsWithin(wanted, ceiling);
}

function refusedSwitch(name: Switch): string {
  const act = {
    receive: "follow other stores",
    offer: "be followed by other stores",
    publish: "publish to the internet",
  }[name];
  return (
    `these terms do not allow a child to ${act}, so "${name}" may not be turned on below here. ` +
    `Turn ${name} on in the delegation terms first, where the person who set them can read what ` +
    `it gives away.`
  );
}
