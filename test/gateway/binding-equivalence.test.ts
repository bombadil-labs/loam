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
import { withStamp } from "../../src/gateway/stamp.js";

const OP_SEED = "cc".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });

async function store(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
  );
}

async function trickyCorpus(gw: Gateway): Promise<void> {
  await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
  await gw.publishRegistration(
    { name: "Two", alg: 1, body: PLANT.body },
    named("Shared"),
    [FERN],
    undefined,
    "hyperschema:Two",
  );
  await gw.publishRegistration(
    PLANT,
    { ...named("Shared"), default: { kind: "all", order: { kind: "byTimestamp", dir: "desc" } } },
    [FERN],
    undefined,
    "hyperschema:One",
  );
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
    signClaims(
      withStamp(gw.stamp(), (t) => makeNegationClaims(gw.operatorAuthor!, t, binding.id)),
      OP_SEED,
    ),
  ]);
}

describe("§47 — the equivalence: the fast path is a cache with a proof", () => {
  it("production's table equals the interpreter's, mode by mode, over the tricky corpus", async () => {
    for (const mode of ["byTimestamp", "byAuthorRank"] as const) {
      const gw = await store();
      try {
        await gw.append([
          signClaims(
            withStamp(gw.stamp(), (t) => bindingPolicyClaims(mode, gw.operatorAuthor!, t)),
            OP_SEED,
          ),
        ]);
        await trickyCorpus(gw);

        const production = new Map(
          readRegistrations(gw.reactor, gw.validityNow(), gw.operatorAuthor).map((r) => [
            lensOf(r) as string,
            r.entity,
          ]),
        );

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

        expect([...production.keys()].sort()).toEqual([...spec.winners.keys()].sort());
        for (const [lens, deltaId] of spec.winners) {
          const winner = candidates.find((c) => c.deltaId === deltaId)!;
          expect(production.get(lens), `winner for "${lens}" under ${mode}`).toBe(winner.entity);
        }
        expect(production.has("Gone")).toBe(false);
      } finally {
        await gw.close();
      }
    }
  });

  it("byAuthorRank, at the spec level: the operator's binding outranks a stranger's for one name", () => {
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
      timestamp: 2000,
      deltaId: "bb",
    };
    const ranked = interpretBindingPolicy([mine, theirs], "byAuthorRank", "op");
    expect(ranked.winners.get("Note")).toBe("aa");
    const unranked = interpretBindingPolicy([mine, theirs], "byAuthorRank");
    expect(unranked.winners.get("Note")).toBe("bb");
  });
});
