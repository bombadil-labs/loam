// A program's mask. A leaf: the listing door and the erase door both read it, and neither imports
// the other for it.

import { termToJson, type Term } from "@bombadil/rhizomatic";

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
