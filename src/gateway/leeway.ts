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

// ── Reading a leeway off a container declaration (SPEC §58, position 4: "A leeway is a declaration
// on the container, so changing it later ... is a delta the next request obeys").

/**
 * What a container has when it declares no leeway, and what it falls back to when the leeway it
 * declares does not parse. Every switch off — the private journal.
 *
 * BOTH ROADS LEAD HERE ON PURPOSE. An absent leeway and a broken one must read the same, and they
 * must read as the tightest thing expressible: a defect that widened what a person turned on would
 * be a report of permission nobody granted (H9).
 */
export const SEALED_LEEWAY: Leeway = {
  receive: false,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
};

/** How deep a written terms chain may nest before the declaration is a defect rather than a stack. */
const MAX_TERMS_DEPTH = 32;

const ENVELOPE_NAMES: ReadonlySet<string> = new Set<EnvelopeSize>(["small", "medium", "large"]);
const LEEWAY_KEYS: ReadonlySet<string> = new Set([...SWITCHES, "envelope", "delegate"]);

/**
 * Read a declared leeway from the JSON a container declaration carries.
 *
 * Answers with a DEFECT SENTENCE rather than throwing, and never with a partial value: a leeway
 * that does not parse is not binding, and its container reads as `SEALED_LEEWAY`.
 *
 * UNKNOWN KEYS ARE REFUSED rather than ignored. A misspelled switch that silently reads `false` is
 * the same bug in a quieter coat, and refusing lands on the closed side either way — including the
 * day a sixth control is added and an older reader meets it.
 */
export function parseLeeway(raw: string): { leeway: Leeway } | { defect: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { defect: "the declared leeway is not parseable JSON" };
  }
  // THE BYTES MUST SAY WHAT THEY MEAN. `JSON.parse` resolves a duplicate key to the LAST one, so
  // `{"publish":false,"publish":true}` reads as bytes that plainly say false and a value that is
  // true — law whose stored form misreports itself. Requiring the canonical form refuses that, and
  // with it every other spelling of one value: whitespace, key order, a second copy of a switch.
  if (raw !== canonicalLeewayJson(parsed)) {
    return {
      defect:
        "the declared leeway is not in canonical form — a leeway is stored with its keys sorted " +
        "and no duplicates, so the bytes at rest say exactly one thing",
    };
  }
  const allowances = readAllowances(parsed);
  if (typeof allowances === "string") return { defect: allowances };
  const delegate = (parsed as Record<string, unknown>).delegate;
  if (delegate === "off") return { leeway: { ...allowances, delegate: "off" } };
  if (delegate === "same") {
    return {
      defect:
        '"same" means "under these very terms", so it belongs inside delegation terms and never ' +
        "on a container's own leeway, where there are no enclosing terms for it to repeat",
    };
  }
  const terms = readTerms(delegate, 1);
  return typeof terms === "string"
    ? { defect: terms }
    : { leeway: { ...allowances, delegate: terms } };
}

/**
 * The four fields a leeway and a terms share. Rejects an unknown key rather than dropping it, so a
 * typo cannot pass as a switch left off.
 */
function readAllowances(value: unknown): Allowances | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "a leeway is an object carrying three switches, an envelope and delegation terms";
  }
  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!LEEWAY_KEYS.has(key)) return `the declared leeway carries an unknown key "${key}"`;
  }
  for (const name of SWITCHES) {
    if (typeof o[name] !== "boolean") {
      return `the leeway switch "${name}" is a boolean, and every declaration carries all three`;
    }
  }
  const envelope = o.envelope;
  if (typeof envelope !== "string" || !ENVELOPE_NAMES.has(envelope)) {
    return 'the leeway envelope is "small", "medium" or "large"';
  }
  return {
    receive: o.receive as boolean,
    offer: o.offer as boolean,
    publish: o.publish as boolean,
    envelope: envelope as EnvelopeSize,
  };
}

/**
 * One level of delegation terms. Unlike a container's own leeway, a terms may carry `"same"` —
 * there ARE enclosing terms here for it to repeat.
 */
function readTerms(value: unknown, depth: number): Terms | string {
  if (depth > MAX_TERMS_DEPTH) {
    return `the declared leeway nests deeper than ${MAX_TERMS_DEPTH} levels of terms`;
  }
  const allowances = readAllowances(value);
  if (typeof allowances === "string") return allowances;
  const delegate = (value as Record<string, unknown>).delegate;
  if (delegate === "off" || delegate === "same") return { ...allowances, delegate };
  const inner = readTerms(delegate, depth + 1);
  return typeof inner === "string" ? inner : { ...allowances, delegate: inner };
}

/**
 * Is this the leeway a container has when it declares none? Used where a re-declaration carries
 * knobs forward: an absent leeway and a sealed one resolve identically, so the sealed case need
 * not be written down, and not writing it keeps the delta's bytes as they were.
 */
export function isSealed(leeway: Leeway): boolean {
  return (
    !leeway.receive &&
    !leeway.offer &&
    !leeway.publish &&
    leeway.envelope === "small" &&
    leeway.delegate === "off"
  );
}

/**
 * The one spelling a leeway is stored in: keys sorted, no whitespace, nothing repeated. Law is
 * read from bytes by strangers, so the bytes may have exactly one meaning.
 */
export function canonicalLeewayJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o).sort()) out[key] = sortKeys(o[key]);
  return out;
}
