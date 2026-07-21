// §20 migration must not resurrect the withdrawn (ticket T41).
//
// Audit 3 probed this: every step's `additions()` loop gates on author + signature + shape, and
// never asks whether the delta it is about to re-sign still SURVIVES. It re-expresses into a new
// content address and supersedes the OLD id — but the operator's own retraction also points at the
// old id, and NOTHING points at the re-expression. So a definition the operator deliberately
// withdrew comes back live, in the operator's voice, wearing a new id.
//
// The concrete cost is a §17 410 door becoming a 200 — and if the lens was ever `declarePublic`'d,
// the withdrawn reading is then served ANONYMOUSLY.
//
// HONEST SCOPE OF THESE RAILS, because an earlier draft of this comment overstated them: they
// assert DELTA SHAPES — that no surviving new-form definition is emitted for withdrawn law — not
// the door behavior that failure ultimately causes. That is a weaker assertion than "boot the
// migrated store and watch the 410 stay a 410", and it is weaker in the exact direction this
// project keeps getting burned by. It is what is written because the migration steps are unit-level
// and a full boot-and-serve rail belongs beside the §17 door tests; the gap is named here rather
// than papered over. **If you extend this file, the behavioral rail is the one worth adding.**

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { migrate } from "../../src/migrate/migrate.js";

const SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(SEED);

// A pre-0.3 hyperschema definition: the shape the `hyperschema-roles` step migrates.
const oldDefinition = (name: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      author: OPERATOR,
      pointers: [
        {
          role: "rhizomatic.schema.name",
          target: { kind: "primitive", value: name },
        },
        {
          role: "rhizomatic.schema.body",
          target: {
            kind: "primitive",
            value: JSON.stringify({ op: "mask", policy: "drop", in: "input" }),
          },
        },
      ],
    },
    SEED,
  );

// The operator withdrawing it — an ordinary §14 retraction in their own voice.
const withdraw = (targetId: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      author: OPERATOR,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    SEED,
  );

// Everything the migration ADDED that speaks the new vocabulary — i.e. what it re-expressed.
const reExpressed = (before: readonly Delta[], after: readonly Delta[]): Delta[] => {
  const had = new Set(before.map((d) => d.id));
  return after.filter(
    (d) =>
      !had.has(d.id) && d.claims.pointers.some((p) => p.role.startsWith("rhizomatic.hyperschema.")),
  );
};

// Is `id` struck by a surviving negation in this set? (Transitive: a struck strike revives.)
const isStruck = (deltas: readonly Delta[], id: string): boolean => {
  const strikes = deltas.filter((d) =>
    d.claims.pointers.some(
      (p) => p.role === "negates" && p.target.kind === "delta" && p.target.deltaRef.delta === id,
    ),
  );
  return strikes.some((s) => !isStruck(deltas, s.id));
};

describe("§20 — a migration does not resurrect withdrawn law", () => {
  it("a WITHDRAWN definition is not re-expressed", () => {
    const def = oldDefinition("Foo", 1000);
    const legacy = [def, withdraw(def.id, 1100)];

    // Precondition: it really is withdrawn going in.
    expect(isStruck(legacy, def.id)).toBe(true);

    const { deltas } = migrate(legacy, { seed: SEED });

    // THE ASSERTION. Before this ticket the migration emitted a live new-form definition here,
    // struck by nothing — the operator's retraction still pointed only at the old id.
    const added = reExpressed(legacy, deltas);
    const live = added.filter((d) => !isStruck(deltas, d.id));
    expect(live).toHaveLength(0);
  });

  it("a SURVIVING definition is still migrated — the fix must not stop the migration working", () => {
    const def = oldDefinition("Foo", 1000);
    const legacy = [def];

    const { deltas } = migrate(legacy, { seed: SEED });

    const added = reExpressed(legacy, deltas);
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((d) => !isStruck(deltas, d.id)).length).toBeGreaterThan(0);
    // ...and the old form is superseded, as it always was.
    expect(isStruck(deltas, def.id)).toBe(true);
  });

  it("the check is TRANSITIVE — a withdrawal that was itself withdrawn leaves the definition live", () => {
    const def = oldDefinition("Foo", 1000);
    const strike = withdraw(def.id, 1100);
    const counter = withdraw(strike.id, 1200); // negating the negation revives the definition
    const legacy = [def, strike, counter];

    // Precondition: the definition is LIVE again in the input.
    expect(isStruck(legacy, def.id)).toBe(false);

    const { deltas } = migrate(legacy, { seed: SEED });

    // So it must be carried forward. A one-link check would wrongly skip it — the same class of
    // bug, mirrored: refusing to migrate something that was never actually withdrawn.
    const added = reExpressed(legacy, deltas);
    expect(added.filter((d) => !isStruck(deltas, d.id)).length).toBeGreaterThan(0);
  });

  it("a withdrawal by SOMEONE ELSE does not stop the migration — only the operator's strikes bind", () => {
    const strangerSeed = "a1".repeat(32);
    const def = oldDefinition("Foo", 1000);
    const foreign = signClaims(
      {
        timestamp: 1100,
        author: authorForSeed(strangerSeed),
        pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: def.id } } }],
      },
      strangerSeed,
    );

    const { deltas } = migrate([def, foreign], { seed: SEED });

    // Inert-by-default (§8/§12): a federated stranger cannot retire the operator's law, and so
    // cannot suppress its migration either. Skipping here would let any peer quietly delete an
    // operator's lens by shipping a negation before an upgrade.
    const added = reExpressed([def, foreign], deltas);
    expect(added.filter((d) => !isStruck(deltas, d.id)).length).toBeGreaterThan(0);
  });
});
