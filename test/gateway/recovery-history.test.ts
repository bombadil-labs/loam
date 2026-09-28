// A recovered user's history, cut per store (refactor/audit/recovery-history.md; ruling 8, M1). The
// records are written by hand here, as `loam user recover` (the barrier PR) will write them. Each case
// asks the delta level (what the store holds, what the door admits) and the object level (what a
// membership naming the user selects), with a bystander.

import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { eraseClaims, refusedIds } from "../../src/gateway/erase.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { historyIds, writtenByUser } from "../../src/gateway/member-of.js";
import { keysEverOf } from "../../src/gateway/principal.js";
import {
  activeIncarnation,
  arrivalIndex,
  cutClaims,
  cutsHere,
  incarnationClaims,
  mintIncarnation,
  outcomeClaims,
  pausedKeys,
} from "../../src/gateway/recovery-cut.js";
import { lineageClaims, recoveryClaims } from "../../src/gateway/user-root.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const [K1_SEED, K2_SEED, B_SEED] = ["b1", "b2", "bb"].map((h) => h.repeat(32)) as [
  string,
  string,
  string,
];
const [K1, K2, B] = [K1_SEED, K2_SEED, B_SEED].map(authorForSeed) as [string, string, string];
const SCOPE = "inbox:ada";
const op = (c: Claims): Delta => signClaims(c, OP_SEED);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

async function store(): Promise<Gateway> {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
  open.push(gw);
  return gw;
}

const paused = (gw: Gateway) => pausedKeys(gw.reactor, OP, refusedIds(gw.reactor, OP));
const incarnationOf = (gw: Gateway): string => {
  const d = activeIncarnation(gw.reactor, OP, refusedIds(gw.reactor, OP))!;
  const p = d.claims.pointers.find((x) => x.role === "incarnation")!.target;
  return p.kind === "primitive" ? String(p.value) : "";
};

// ada (root K1, write by name) and bea (key B). K1 and B each write one value.
async function world(): Promise<{ gw: Gateway; byK1: Delta; byB: Delta }> {
  const gw = await store();
  await gw.append([
    op(userClaims("ada", OP, 10)),
    op(rootClaims("ada", K1, OP, 10)),
    op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 11)),
    op(grantClaims(STORE_ENTITY, B, "write", OP, 12)),
  ]);
  const byK1 = observed(FERN, "height", 1, 20, K1_SEED);
  const byB = observed(FERN, "height", 2, 21, B_SEED);
  await gw.append([byK1, byB]);
  return { gw, byK1, byB };
}

// The recovery K1 → K2 as the barrier lands it on the host: a cut first, then the record, its
// lineage, the new root and K2's binding, then (unless `outcome` is omitted) the outcome.
async function recover(
  gw: Gateway,
  opts: { outcome?: "committed" | "aborted"; land?: boolean; position?: number } = {},
): Promise<{ record: Delta; cut: Delta; binding: Delta }> {
  const record = op(
    recoveryClaims({ name: "ada", attempt: "a", previous: K1, root: K2, retired: [K1] }, OP, 30),
  );
  const cut = op(
    cutClaims(
      {
        store: incarnationOf(gw),
        attempt: "a",
        recovery: record.id,
        key: K1,
        index: opts.position ?? gw.reactor.arrivalLog().length,
      },
      OP,
      29,
    ),
  );
  // A wrong position is refused at the door; planted past it, the readers must still fail closed.
  if (opts.position === undefined) await gw.append([cut]);
  else expect(gw.reactor.ingest(cut).status).toBe("accepted");
  const binding = signClaims(
    {
      timestamp: 32,
      validFrom: 32,
      author: K2,
      pointers: [
        {
          role: "principal",
          target: { kind: "entity", entity: { id: K2, context: "rhizomatic.principal" } },
        },
        { role: "kind", target: { kind: "primitive", value: "binding" } },
        { role: "key", target: { kind: "primitive", value: K1 } },
      ],
    },
    K2_SEED,
  );
  if (opts.land !== false) {
    const commit = [
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ];
    // The door admits the record only behind a live cut, so a planted bad cut's record is planted too.
    if (opts.position === undefined) await gw.append(commit);
    else for (const d of commit) expect(gw.reactor.ingest(d).status).toBe("accepted");
    await gw.append([binding]);
  }
  if (opts.outcome !== undefined)
    await gw.append([op(outcomeClaims(cut.id, opts.outcome, OP, 40))]);
  return { record, cut, binding };
}

const members = (gw: Gateway) => new Set(gw.select(writtenByUser("ada", SCOPE)).map((d) => d.id));
const admits = async (gw: Gateway, d: Delta) => {
  try {
    await gw.append([d]);
    return true;
  } catch {
    return false;
  }
};

describe("H1: history before the cut, nothing after it", () => {
  it("K1's earlier value is a member after recovery; a later, backdated K1 value is not; bea's is not", async () => {
    const { gw, byK1, byB } = await world();
    await recover(gw, { outcome: "committed" });
    const late = observed(FERN, "height", 9, 5, K1_SEED); // backdated
    await gw.federate([late]);
    expect(gw.reactor.get(late.id)).toBeDefined();
    const m = members(gw);
    expect([m.has(byK1.id), m.has(late.id), m.has(byB.id)]).toEqual([true, false, false]);
  });

  it("the append door refuses a retiring record with no cut; planted past it, no history shows", async () => {
    const { gw, byK1 } = await world();
    const record = op(
      recoveryClaims({ name: "ada", attempt: "n", previous: K1, root: K2, retired: [K1] }, OP, 30),
    );
    const commit = [
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ];
    await expect(gw.append(commit)).rejects.toThrow(/holds no live cut for it/);
    expect(gw.reactor.get(record.id)).toBeUndefined();
    for (const d of commit) expect(gw.reactor.ingest(d).status).toBe("accepted");
    expect(members(gw).has(byK1.id)).toBe(false);
  });

  it("the append door refuses a retiring record whose only cut is not at its position", async () => {
    const { gw } = await world();
    const { record } = await recover(gw, { land: false, position: 999 });
    await expect(
      gw.append([
        record,
        op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
        op(rootClaims("ada", K2, OP, 30)),
      ]),
    ).rejects.toThrow(/holds no live cut for it/);
  });

  it("the append door refuses a retiring record whose only cut is aborted", async () => {
    const { gw } = await world();
    const { record, cut } = await recover(gw, { land: false });
    await gw.append([op(outcomeClaims(cut.id, "aborted", OP, 31))]);
    await expect(
      gw.append([
        record,
        op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
        op(rootClaims("ada", K2, OP, 30)),
      ]),
    ).rejects.toThrow(/holds no live cut for it/);
  });
});

describe("H2: a prepared cut pauses the old key", () => {
  it("K1 is refused at append and federate until an outcome; after an abort it writes again", async () => {
    const { gw } = await world();
    const { cut } = await recover(gw, { land: false });
    expect(paused(gw).has(K1)).toBe(true);
    expect(paused(gw).has(B)).toBe(false);
    expect(await admits(gw, observed(FERN, "height", 3, 50, K1_SEED))).toBe(false);
    const federated = observed(FERN, "height", 4, 51, K1_SEED);
    await gw.federate([federated]);
    expect(gw.reactor.get(federated.id)).toBeUndefined();
    expect(await admits(gw, observed(FERN, "height", 5, 52, B_SEED))).toBe(true);
    await gw.append([op(outcomeClaims(cut.id, "aborted", OP, 60))]);
    expect(paused(gw).has(K1)).toBe(false);
    expect(await admits(gw, observed(FERN, "height", 6, 61, K1_SEED))).toBe(true);
  });
});

describe("H7: the new key can withdraw its binding, and restore it", () => {
  it("a K2 strike on the binding removes K1's history; a K2 counter-strike restores it", async () => {
    const { gw, byK1 } = await world();
    const { binding } = await recover(gw, { outcome: "committed" });
    expect(members(gw).has(byK1.id)).toBe(true);
    const strike = signClaims(makeNegationClaims(K2, 70, binding.id), K2_SEED);
    await gw.federate([strike]);
    expect(members(gw).has(byK1.id)).toBe(false);
    expect(keysEverOf(gw.reactor, gw.validityNow(), { root: K2 }, OP).has(K1)).toBe(false);
    await gw.federate([signClaims(makeNegationClaims(K2, 71, strike.id), K2_SEED)]);
    expect(members(gw).has(byK1.id)).toBe(true);
  });
});

describe("store-bound cuts and durable records", () => {
  it("H9: a cut copied into another store counts for nothing there", async () => {
    const { gw } = await world();
    const { cut } = await recover(gw, { land: false });
    const other = await store();
    await other.federate([cut]);
    expect(other.reactor.get(cut.id)).toBeDefined();
    expect(paused(other).has(K1)).toBe(false);
    await other.append([op(eraseClaims(cut.id, OP, OP, 70))]);
    expect(refusedIds(other.reactor, OP).has(cut.id)).toBe(true);
  });

  it("H10/H11: after the committed outcome lands, erasing the record does not re-pause; a strike on the outcome changes nothing; the outcome alone cannot be erased", async () => {
    const { gw } = await world();
    const { record, cut } = await recover(gw, { outcome: "committed" });
    expect(gw.reactor.ingest(op(eraseClaims(record.id, OP, OP, 80))).status).toBe("accepted");
    expect(paused(gw).has(K1)).toBe(false);
    const outcome = [...gw.reactor.arrivalLog()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "cut" && p.target.kind === "primitive" && p.target.value === cut.id,
      ),
    )!;
    await gw.append([op(makeNegationClaims(OP, 81, outcome.id))]);
    expect(paused(gw).has(K1)).toBe(false);
    await expect(gw.append([op(eraseClaims(outcome.id, OP, OP, 82))])).rejects.toThrow(
      /erased together, not one alone/,
    );
  });

  it("H12: contradictory outcomes for one cut fail closed", async () => {
    const { gw, byK1 } = await world();
    const { cut } = await recover(gw, { outcome: "committed" });
    await gw.append([op(outcomeClaims(cut.id, "aborted", OP, 41))]);
    expect(paused(gw).has(K1)).toBe(true);
    expect(members(gw).has(byK1.id)).toBe(false);
  });

  it("H13: a store writes its own marker first; a replayed older marker and cut are inert", async () => {
    const gw = await store();
    const marker = activeIncarnation(gw.reactor, OP, refusedIds(gw.reactor, OP))!;
    expect(arrivalIndex(gw.reactor, marker.id)).toBe(0);
    const old = op(incarnationClaims(mintIncarnation(), OP, 1));
    const oldCut = op(
      cutClaims(
        { store: "some-earlier-incarnation", attempt: "o", recovery: "r", key: K1, index: 99 },
        OP,
        2,
      ),
    );
    await gw.federate([old, oldCut]);
    expect(activeIncarnation(gw.reactor, OP, refusedIds(gw.reactor, OP))!.id).toBe(marker.id);
    expect(paused(gw).has(K1)).toBe(false);
  });

  it("H14: the active marker cannot be erased, and a strike on it changes nothing", async () => {
    const gw = await store();
    const marker = activeIncarnation(gw.reactor, OP, refusedIds(gw.reactor, OP))!;
    await expect(gw.append([op(eraseClaims(marker.id, OP, OP, 5))])).rejects.toThrow(
      /active incarnation marker cannot be erased/,
    );
    await gw.append([op(makeNegationClaims(OP, 6, marker.id))]);
    expect(activeIncarnation(gw.reactor, OP, refusedIds(gw.reactor, OP))!.id).toBe(marker.id);
  });

  it("H15: a prepared cut cannot be erased; its pause holds", async () => {
    const { gw } = await world();
    const { cut } = await recover(gw, { land: false });
    await expect(gw.append([op(eraseClaims(cut.id, OP, OP, 90))])).rejects.toThrow(
      /prepared recovery cut cannot be erased/,
    );
    expect(paused(gw).has(K1)).toBe(true);
  });
});

describe("the cut readers, against erasure, position and a shared root", () => {
  it("S1: an erased cut and outcome stop counting at once, before the purge", async () => {
    const { gw, byK1 } = await world();
    const { cut } = await recover(gw, { outcome: "committed" });
    expect(members(gw).has(byK1.id)).toBe(true);
    const outcome = gw.reactor
      .arrivalLog()
      .find((d) => d.claims.pointers.some((p) => p.role === "outcome"))!;
    await gw.append([op(eraseClaims(cut.id, OP, OP, 90)), op(eraseClaims(outcome.id, OP, OP, 90))]);
    expect(gw.reactor.get(cut.id)).toBeDefined(); // held, waiting for the purge
    expect(cutsHere(gw.reactor, OP, refusedIds(gw.reactor, OP))).toEqual([]);
    expect(members(gw).has(byK1.id)).toBe(false);
  });

  it("S1: an erased prepared cut's pause ends with it once aborted and erased as a pair", async () => {
    const { gw } = await world();
    const { cut } = await recover(gw, { land: false });
    await gw.append([op(outcomeClaims(cut.id, "aborted", OP, 60))]);
    const outcome = gw.reactor.arrivalLog().at(-1)!;
    await gw.append([op(eraseClaims(cut.id, OP, OP, 61)), op(eraseClaims(outcome.id, OP, OP, 61))]);
    expect(paused(gw).has(K1)).toBe(false);
    expect(cutsHere(gw.reactor, OP, refusedIds(gw.reactor, OP))).toEqual([]);
  });

  it("S2: federate does not land one erasure of the pair when the predicate turns the other away", async () => {
    const { gw } = await world();
    const { cut } = await recover(gw, { outcome: "committed" });
    const outcome = gw.reactor
      .arrivalLog()
      .find((d) => d.claims.pointers.some((p) => p.role === "outcome"))!;
    const eCut = op(eraseClaims(cut.id, OP, OP, 90));
    const eOutcome = op(eraseClaims(outcome.id, OP, OP, 90));
    const report = await gw.federate([eCut, eOutcome], { admit: (d) => d.id !== eOutcome.id });
    expect(report.accepted).toBe(0);
    expect(gw.reactor.get(eCut.id)).toBeUndefined();
    expect(refusedIds(gw.reactor, OP).has(cut.id)).toBe(false);
  });

  it("S3: a cut that names a later position than where it arrived gives no history and pauses", async () => {
    const { gw, byK1 } = await world();
    await recover(gw, { outcome: "committed", position: 999 });
    const late = observed(FERN, "height", 9, 5, K1_SEED);
    await gw.federate([late]);
    expect(members(gw).has(late.id)).toBe(false);
    expect(members(gw).has(byK1.id)).toBe(false);
    expect(paused(gw).has(K1)).toBe(true);
  });

  it("S3: a wrong-position cut with a committed outcome cannot be erased as a pair; its pause holds", async () => {
    const { gw } = await world();
    const { cut } = await recover(gw, { outcome: "committed", position: 999 });
    const outcome = gw.reactor
      .arrivalLog()
      .find((d) => d.claims.pointers.some((p) => p.role === "outcome"))!;
    await expect(
      gw.append([op(eraseClaims(cut.id, OP, OP, 90)), op(eraseClaims(outcome.id, OP, OP, 90))]),
    ).rejects.toThrow(/prepared recovery cut cannot be erased/);
    expect(paused(gw).has(K1)).toBe(true);
  });

  it("S3: the append door refuses a cut that names a position other than where it lands", async () => {
    const { gw } = await world();
    const at = gw.reactor.arrivalLog().length;
    const cutAt = (index: number, t: number) =>
      op(
        cutClaims({ store: incarnationOf(gw), attempt: "p", recovery: "r", key: K1, index }, OP, t),
      );
    for (const wrong of [at + 1, at - 1, 999])
      await expect(gw.append([cutAt(wrong, 40 + wrong)])).rejects.toThrow(/position it lands at/);
    const second = observed(FERN, "height", 7, 41, B_SEED);
    await expect(gw.append([second, cutAt(at, 42)])).rejects.toThrow(/position it lands at/);
    await gw.append([second, cutAt(at + 1, 43)]);
    expect(paused(gw).has(K1)).toBe(true);
  });

  it("S3: a negative or earlier position fails the same way", async () => {
    for (const position of [-1, 0]) {
      const { gw, byK1 } = await world();
      await recover(gw, { outcome: "committed", position });
      expect(members(gw).has(byK1.id)).toBe(false);
      expect(paused(gw).has(K1)).toBe(true);
    }
  });

  it("S3: two committed cuts for one recovery and key: the earlier one bounds the history", async () => {
    const { gw, byK1 } = await world();
    const { record } = await recover(gw, { outcome: "committed" });
    const late = observed(FERN, "height", 9, 5, K1_SEED); // backdated, after the first cut
    await gw.federate([late]);
    const again = op(
      cutClaims(
        {
          store: incarnationOf(gw),
          attempt: "b",
          recovery: record.id,
          key: K1,
          index: gw.reactor.arrivalLog().length,
        },
        OP,
        95,
      ),
    );
    await gw.append([again, op(outcomeClaims(again.id, "committed", OP, 96))]);
    const m = members(gw);
    expect([m.has(byK1.id), m.has(late.id)]).toEqual([true, false]);
  });

  it("S4: two users sharing a root do not share one's history", async () => {
    const { gw, byK1 } = await world();
    await gw.append([op(userClaims("bea", OP, 13)), op(rootClaims("bea", K2, OP, 13))]);
    await recover(gw, { outcome: "committed" });
    const now = gw.validityNow();
    expect(historyIds(gw.reactor, now, OP, "ada", refusedIds(gw.reactor, OP))).toContain(byK1.id);
    expect(historyIds(gw.reactor, now, OP, "bea", refusedIds(gw.reactor, OP))).not.toContain(
      byK1.id,
    );
  });
});
