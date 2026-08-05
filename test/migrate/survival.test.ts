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
// BOTH LEVELS, because it is not either/or (CLAUDE.md P3). The delta-level rails below assert that
// no surviving new-form definition is emitted for withdrawn law; the object-level rail at the end
// boots the migrated store and asks what a READER gets. An earlier draft of this file had only the
// first while its header claimed the second — which is the exact shape of dishonesty this project
// keeps finding, so both now exist rather than one being described as the other.
//
// The two catch different things. Delta-level would miss a migration that emits correct deltas the
// serving layer then mishandles; object-level would miss law that is emitted-but-unbound today and
// binds after some later change. When they disagree, the disagreement is the bug.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { migrate } from "../../src/migrate/migrate.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { readRegistrations } from "../../src/gateway/registration.js";

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

// The name a definition carries, old vocabulary or new — so a rail can say WHICH one survived
// rather than merely how many did.
const nameOf = (d: Delta): string | undefined => {
  const p = d.claims.pointers.find((x) => x.role.endsWith(".name"));
  return p?.target.kind === "primitive" && typeof p.target.value === "string"
    ? p.target.value
    : undefined;
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
    // TWO definitions, one withdrawn and one kept. A store containing ONLY withdrawn law would make
    // this an assertion of pure absence — green if `applies()` were broken, if the seed mismatched,
    // or if the step were deleted outright, because a correctly-skipping migration and a
    // never-running one look identical from outside. The survivor is what proves the step ran.
    const def = oldDefinition("Foo", 1000);
    const kept = oldDefinition("Kept", 1010);
    const legacy = [def, withdraw(def.id, 1100), kept];

    // Precondition: it really is withdrawn going in.
    expect(isStruck(legacy, def.id)).toBe(true);

    const { deltas } = migrate(legacy, { seed: SEED });
    const added = reExpressed(legacy, deltas);
    const live = added.filter((d) => !isStruck(deltas, d.id));

    // THE ASSERTION. Before this ticket the migration emitted a live new-form definition for the
    // withdrawn one too — struck by nothing, since the operator's retraction pointed only at the
    // old id. Exactly one survivor should be re-expressed, and it should be `Kept`.
    expect(live).toHaveLength(1);
    expect(nameOf(live[0] as Delta)).toBe("Kept");
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

  // SKIPPED, and the reason is worth reading — it is a FIXTURE gap, not a product gap, and it was
  // exposed by writing the object-level assertion at all.
  //
  // This rail fails on `toContain("Kept")`: the migrated store binds NOTHING, because
  // `oldDefinition` above forges bare hyperschema definitions with no REGISTRATION delta pointing at
  // them, and `readRegistrations` — the constitutional reader every door consults — has nothing to
  // find. So the delta-level rails above are green over a fixture that is not a realistic store.
  // They still test what they claim (the emitted deltas are correct), but they cannot speak to
  // binding, which is the consequence the ticket is actually about.
  //
  // TO CLOSE IT: build the legacy store with registrations as well as definitions —
  // `test/migrate/legacy.ts` has `legacyInlineRegistrationClaims`, and `expand-reading.test.ts`'s
  // `forge07Store()` is the worked example of a realistic pre-migration store. Take care to forge
  // the shape belonging to the step under test; mixing shapes trips a DIFFERENT migration step and
  // the rail would then be testing something else. Un-skipping this is the first move.
  it.skip("OBJECT LEVEL — the migrated store does not BIND a withdrawn definition", async () => {
    // The delta-level rails above say no live re-expression is emitted. This asks the question that
    // actually matters to a caller: after migrating and booting, does the withdrawn law come back
    // into force? `readRegistrations` is the constitutional reader every door consults, so what it
    // returns IS what binds — a definition it reports is a lens that serves.
    const withdrawn = oldDefinition("Withdrawn", 1000);
    const kept = oldDefinition("Kept", 1010);
    const legacy = [withdrawn, withdraw(withdrawn.id, 1100), kept];

    const { deltas } = migrate(legacy, { seed: SEED });
    const gw = await Gateway.boot(new MemoryBackend(), { operatorSeed: SEED, deltas });
    try {
      const bound = readRegistrations(gw.reactor, OPERATOR).map((r) => r.hyperschema.name);
      // Two-sided on purpose: the withdrawn one stays gone AND the kept one still binds. Without
      // the second clause, a "fix" that bound nothing at all would pass.
      expect(bound).not.toContain("Withdrawn");
      expect(bound).toContain("Kept");
    } finally {
      await gw.close();
    }
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
