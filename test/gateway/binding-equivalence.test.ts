// §47 criterion 1 — THE EQUIVALENCE. Production's registration reader and the pure interpreter
// must produce the identical binding table, over a corpus with a contested name, a superseded
// binding, and a struck one.
//
// WHAT THIS FILE PROVES, precisely — production CALLS the interpreter for the contest step, so a
// bug in the interpreter's contest branch moves both sides in lockstep and this rail cannot see it
// (H10). What it genuinely pins is the EXTRACTION half: production's independent ground-order
// version collapse must agree with the interpreter's per-(entity, lens) collapse, or a name drops
// from one side and the key-set equality fails. The CONTEST semantics are pinned by hand-written
// literals in the sibling rails (binding-contested-name, binding-conflicts-refuses, and the
// interpreter tests below) — trust those, not this file, to catch an interpreter edit.
//
// Also carries the interpreter-level rails for §47 criterion 5 (byAuthorRank): in a governed store
// every SERVED binding is operator-authored — foreign law is inert — so the author-rank distinction
// only reaches a door once channel-pool bindings aggregate into the surface. The interpreter is the
// spec either way, and it is pinned here so the door-level rail has settled semantics to land on.

import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims, type Schema } from "@bombadil/rhizomatic";
import {
  bindingPolicyClaims,
  interpretBindingPolicy,
  type BindingCandidate,
} from "../../src/gateway/binding-policy.js";
import { lensOf, readRegistrations } from "../../src/gateway/registration.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const OP_SEED = "cc".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });

async function store(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
  );
}

/** The corpus the criterion demands: a contested name (two entities, one lens), a superseded
 * binding (a republish at one entity), and a struck one (a negated binding). */
async function trickyCorpus(gw: Gateway): Promise<void> {
  // Two entities contest the lens "Shared".
  await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
  await gw.publishRegistration(
    { name: "Two", alg: 1, body: PLANT.body },
    named("Shared"),
    [FERN],
    undefined,
    "hyperschema:Two",
  );
  // A superseded binding: republish entity One (evolution, never a contest).
  await gw.publishRegistration(
    PLANT,
    { ...named("Shared"), default: { kind: "all", order: { kind: "byTimestamp", dir: "desc" } } },
    [FERN],
    undefined,
    "hyperschema:One",
  );
  // A struck one: an unrelated lens, registered then negated.
  await gw.publishRegistration(
    { name: "Gone", alg: 1, body: PLANT.body },
    named("Gone"),
    [FERN],
    undefined,
    "hyperschema:Gone",
  );
  const binding = [...gw.reactor.snapshot()].find(
    (d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.id === "registration:hyperschema:Gone",
      ) && gw.reactor.negationsOf(d.id).length === 0,
  )!;
  await gw.append([
    signClaims(makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), binding.id), OP_SEED),
  ]);
}

describe("§47 — the equivalence: the fast path is a cache with a proof", () => {
  it("production's table equals the interpreter's, mode by mode, over the tricky corpus", async () => {
    for (const mode of ["byTimestamp", "byAuthorRank"] as const) {
      const gw = await store();
      try {
        await gw.append([
          signClaims(bindingPolicyClaims(mode, gw.operatorAuthor!, gw.nextTimestamp()), OP_SEED),
        ]);
        await trickyCorpus(gw);

        // PRODUCTION: what the optimized reader serves, as lens -> entity.
        const production = new Map(
          readRegistrations(gw.reactor, gw.operatorAuthor).map((r) => [
            lensOf(r) as string,
            r.entity,
          ]),
        );

        // THE SPEC: the interpreter over the raw binding deltas, reduced the same way.
        const candidates: BindingCandidate[] = [];
        for (const d of gw.reactor.snapshot()) {
          const reg = d.claims.pointers.find(
            (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
          );
          const living = d.claims.pointers.find((p) => p.role === "schema");
          const hyper = d.claims.pointers.find((p) => p.role === "hyperschema");
          if (reg?.target.kind !== "entity" || living?.target.kind !== "entity") continue;
          if (hyper?.target.kind !== "entity") continue;
          if (gw.reactor.negationsOf(d.id).length > 0) continue;
          candidates.push({
            lens: living.target.entity.id.replace(/^schema:/, ""),
            entity: hyper.target.entity.id,
            author: d.claims.author,
            timestamp: d.claims.timestamp,
            deltaId: d.id,
          });
        }
        const spec = interpretBindingPolicy(candidates, mode, gw.operatorAuthor);

        // Same names served (Shared and Gone's absence included), and per name, the same entity.
        expect([...production.keys()].sort()).toEqual([...spec.winners.keys()].sort());
        for (const [lens, deltaId] of spec.winners) {
          const winner = candidates.find((c) => c.deltaId === deltaId)!;
          expect(production.get(lens), `winner for "${lens}" under ${mode}`).toBe(winner.entity);
        }
        expect(production.has("Gone")).toBe(false); // the struck binding stayed struck
      } finally {
        await gw.close();
      }
    }
  });

  it("byAuthorRank, at the spec level: the operator's binding outranks a stranger's for one name", () => {
    // §47 criterion 5's semantics, pinned where they are testable today. In a governed store a
    // stranger's binding never reaches the served set (foreign law is inert), so the DOOR-level
    // rail lands with container aggregation; the interpreter must already answer correctly.
    const mine: BindingCandidate = {
      lens: "Note",
      entity: "hyperschema:Mine",
      author: "op",
      timestamp: 1000,
      deltaId: "aa",
    };
    const theirs: BindingCandidate = {
      lens: "Note",
      entity: "hyperschema:Theirs",
      author: "peer",
      timestamp: 2000, // LATER — rank must beat recency, or the mode is byTimestamp in a hat
      deltaId: "bb",
    };
    const ranked = interpretBindingPolicy([mine, theirs], "byAuthorRank", "op");
    expect(ranked.winners.get("Note")).toBe("aa");
    // Two-sided: without an operator to rank by, recency decides — the mode degrades to
    // byTimestamp rather than to an arbitrary pick.
    const unranked = interpretBindingPolicy([mine, theirs], "byAuthorRank");
    expect(unranked.winners.get("Note")).toBe("bb");
  });
});
