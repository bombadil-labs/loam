// THE GATHER — the hyperschema body an ordinary entity wants, as a named constructor instead of a
// five-level Term literal every author re-types. The program is short and always the same: SELECT
// every delta pointing at the root, MASK the survivors under a negation posture, and GROUP them by
// the pointer context each one named — which is what turns a bucket into a field. Written out, that
// is `{ op: "group", key: "byTargetContext", in: { op: "select", pred: { hasPointer: {
// targetEntity: { var: "root" } } }, in: { op: "mask", policy: "drop", in: "input" } } }`, and it
// appears verbatim across the tree in schema files, fixtures, docs, and generators.
//
// TWO DIALECTS, because the duplication lives in both. `*Json` is the at-rest form a `.json`
// hyperschema file or a wire registration carries, and it is the PRIMITIVE here; the Term form is
// `parseTerm` of exactly that, so the pair can never come to describe different programs. What is
// NOT here: a context-narrowed gather (three sites, and it is a `select` wrapped around this one
// rather than a distinct idiom) and a bare group-over-mask (two sites in one file). A constructor
// nobody reaches for is one more name to keep true.

import { parseTerm, type Term } from "@bombadil/rhizomatic";

/**
 * The negation posture a gather reads under, in the JSON dialect `parseTerm` eats: `"drop"` (a
 * struck delta is simply gone), `"annotate"` (visible-but-flagged, so a reader can show the
 * retraction), or a `{ trust: <pred> }` policy naming whose strikes bind at all — which is how a
 * governed store keeps a federated stranger from retracting its data.
 *
 * Left as JSON rather than the substrate's parsed `MaskPolicy`, because every caller writes JSON —
 * and the one caller that COMPUTES its policy (`governedGatherBody`, accounts.ts) computes a
 * predicate as JSON too.
 */
export type GatherMask = "drop" | "annotate" | { readonly trust: unknown };

export interface GatherSpec {
  /**
   * Defaults to `"drop"` — every negation present binds, which is the honest posture for an
   * ungoverned read and the one all but a handful of call sites in the tree ask for.
   */
  readonly mask?: GatherMask;
}

/** The plain-entity gather, in the at-rest JSON dialect. */
export function entityGatherJson(spec: GatherSpec = {}): Record<string, unknown> {
  return {
    op: "group",
    key: "byTargetContext",
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" } } },
      in: { op: "mask", policy: spec.mask ?? "drop", in: "input" },
    },
  };
}

/** The plain-entity gather, parsed — a hyperschema `body`. */
export function entityGatherBody(spec: GatherSpec = {}): Term {
  return parseTerm(entityGatherJson(spec));
}

export interface ExpandedGatherSpec extends GatherSpec {
  /**
   * The pointer role whose targets become children. Matched EXACTly: every expand in the tree names
   * one role, and a prefix- or pattern-matched fan-out is rare enough to write its own literal
   * rather than widen this to a `StrMatch` nobody would pass.
   */
  readonly role: string;
  /** The child's hyperschema — the gather program resolving each child, by living name. */
  readonly schema: string;
  /** The Schema the child resolves THROUGH. Omitted, the child has no reading of its own. */
  readonly reading?: string;
}

/** A gather that expands one role into its children's own views — the edge-field shape, as JSON. */
export function expandedGatherJson(spec: ExpandedGatherSpec): Record<string, unknown> {
  return {
    op: "expand",
    role: { exact: spec.role },
    schema: spec.schema,
    ...(spec.reading === undefined ? {} : { reading: spec.reading }),
    in: entityGatherJson(spec),
  };
}

/** A gather that expands one role into its children's own views — parsed. */
export function expandedGatherBody(spec: ExpandedGatherSpec): Term {
  return parseTerm(expandedGatherJson(spec));
}
