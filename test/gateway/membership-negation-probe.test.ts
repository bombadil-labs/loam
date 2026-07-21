// PROBE (2026-07-21) — does a membership-scoped seeding edge carry the NEGATION CLOSURE?
//
// rhizomatic flagged (issue #27) that `negated(d, D)` ranges over the OPERAND SET (SPEC-2 §4.3), so
// a filter that keeps a claim but drops its negation lets the claim come back UN-SUPPRESSED in the
// filtered set — pinned substrate-side as the `select-then-mask-scopes-to-operand` vector. That was
// raised about a future property→wall migration, but Loam already ships a filter of exactly this
// shape: `QuarantineOptions.membership` (T15, #132) seeds a pool through a Term.
//
// §24.8's law is handled — TOMBSTONES pass the seeding edge unconditionally, so erasure reaches
// through. Ordinary negations get no such treatment. This asks whether that is a real hole.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = {
  props: new Map<string, Policy>([["height", pick]]),
  default: pick,
};

const boot = async (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height"] }],
    }),
  );

// RESULT: THE HOLE IS REAL. Run 2026-07-21 — the claim crosses, the negation does not, and the
// claim reads as LIVE in the pool though it is retracted in the primary. A retraction does not
// survive a membership-scoped seeding edge.
//
// SKIPPED, not deleted, and skipped rather than left failing so the suite still tells the truth
// about what is green. **Ticket T38 fixes it, and un-skipping this is its first step** — the rail
// already exists, it just does not pass yet. Do not "fix" this file; fix the seeding edge.
describe.skip("PROBE: membership scoping and the negation closure (FAILS — see T38)", () => {
  it("a membership Term that keeps a claim but drops its negation un-suppresses the claim", async () => {
    const gw = await boot();

    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);

    // Retract it the ordinary way: a negation delta pointing at the claim, in the operator's voice.
    const negation = signClaims(
      {
        timestamp: 1100,
        author: authorForSeed(OP_SEED),
        pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: claim.id } } }],
      },
      OP_SEED,
    );
    await gw.append([negation]);

    // In the PRIMARY the claim is retracted — this is the baseline the pool should inherit.
    const primaryNegated = gw.reactor.negationsOf(claim.id).length > 0;
    expect(primaryNegated).toBe(true);

    // A membership Term selecting ONLY height-context claims. The negation delta points at a
    // DELTA, not at a context, so it is NOT a member — the exact shape rhizomatic warned about.
    const HEIGHTS = {
      op: "select",
      pred: { hasPointer: { context: { exact: "height" } } },
      in: "input",
    };
    const members = gw.select(HEIGHTS).map((d) => d.id);
    expect(members).toContain(claim.id);
    expect(members).not.toContain(negation.id); // the negation is left behind

    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    const holds = (id: string): boolean =>
      [...pool.gateway.reactor.snapshot()].some((d) => d.id === id);

    // What crossed?
    const claimInPool = holds(claim.id);
    const negationInPool = holds(negation.id);
    const suppressedInPool = pool.gateway.reactor.negationsOf(claim.id).length > 0;

    // eslint-disable-next-line no-console
    console.log(
      `PROBE — claim in pool: ${claimInPool}, negation in pool: ${negationInPool}, ` +
        `still suppressed in pool: ${suppressedInPool}`,
    );

    // THE ASSERTION THAT MATTERS: a claim retracted in the primary must not read as live in a
    // pool seeded from it. If this fails, the seeding edge needs the negation closure.
    expect(claimInPool && !suppressedInPool).toBe(false);

    await pool.drop();
    await gw.close();
  });
});
