// A recovered user's history, cut per store (refactor/audit/recovery-history.md; ruling 8, M1). The
// records are written by hand here, as `loam user recover` (the barrier PR) will write them. Each case
// asks the delta level (what the store holds, what the door admits) and the object level (what a
// membership naming the user selects), with a bystander.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { eraseClaims, refusedIds } from "../../src/gateway/erase-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { historyIds, writtenByUser } from "../../src/gateway/member-of.js";
import { keysEverOf } from "../../src/gateway/principal.js";
import {
  activeIncarnation,
  arrivalIndex,
  cutClaims,
  cutsHere,
  historyBefore,
  incarnationClaims,
  manifestClaims,
  mintIncarnation,
  outcomeClaims,
  pausedKeys,
} from "../../src/gateway/recovery-cut.js";
import {
  lineageClaims,
  recoveryClaims,
  userGroundOf,
  userRootAt,
} from "../../src/gateway/user-root.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
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
  opts: { outcome?: "committed" | "aborted"; land?: boolean } = {},
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
      },
      OP,
      29,
    ),
  );
  await gw.append([cut]);
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
    // The manifest in its own append, then the record's: one append is one transfer.
    await gw.append([op(manifestClaims(record.id, [cut.id], OP, 30))]);
    await gw.append([
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ]);
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
    await expect(gw.append(commit)).rejects.toThrow(/no cut manifest for it is held/);
    expect(gw.reactor.get(record.id)).toBeUndefined();
    for (const d of commit) expect(gw.reactor.ingest(d).status).toBe("accepted");
    expect(members(gw).has(byK1.id)).toBe(false);
  });

  it("the append door refuses a retiring record whose only cut is aborted", async () => {
    const { gw } = await world();
    const { record, cut } = await recover(gw, { land: false });
    await gw.append([op(outcomeClaims(cut.id, "aborted", OP, 31))]);
    await gw.append([op(manifestClaims(record.id, [cut.id], OP, 30))]);
    await expect(
      gw.append([
        record,
        op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
        op(rootClaims("ada", K2, OP, 30)),
      ]),
    ).rejects.toThrow(/holds no live cut for it/);
  });
});

describe("the barrier holds at both doors", () => {
  it("federation drops a retiring record with no manifest, and the root does not move", async () => {
    const { gw } = await world();
    const root = () =>
      userRootAt(gw.reactor, gw.validityNow(), OP, "ada", userGroundOf(gw.reactor).erased());
    expect(root()).toBe(K1);
    const record = op(
      recoveryClaims({ name: "ada", attempt: "f", previous: K1, root: K2, retired: [K1] }, OP, 30),
    );
    const lineage = op(
      lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30),
    );
    // A bare operator root claim moves a root at either door; the record is what retires K1.
    await gw.federate([record, lineage], { admit: () => true });
    // delta level: the record did not land; object level: the served root is still K1
    expect(gw.reactor.get(record.id)).toBeUndefined();
    expect(root()).toBe(K1);
  });

  it("an earlier, narrower manifest does not block a later, complete one", async () => {
    const { gw } = await world();
    const { record, cut } = await recover(gw, { land: false });
    // A manifest naming no cut is lawful to hold, and covers nothing.
    await gw.append([op(manifestClaims(record.id, [], OP, 29))]);
    await gw.append([op(manifestClaims(record.id, [cut.id], OP, 30))]);
    await gw.append([
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ]);
    expect(gw.reactor.get(record.id)).toBeDefined();
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
    const outcome = [...gw.reactor.arrivalLog()].find(
      (d) =>
        d.claims.pointers.some((p) => p.role === "outcome") &&
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
      cutClaims({ store: "some-earlier-incarnation", attempt: "o", recovery: "r", key: K1 }, OP, 2),
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

describe("the cut readers, against erasure, restart and a shared root", () => {
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

  it("S3: a purge of an earlier delta and a restart leave the cut committed and the history whole", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-recovery-restart-"));
    const boot = () =>
      Gateway.boot(
        new SqliteBackend(join(dir, "store.sqlite")),
        assembleGenesis({ operatorSeed: OP_SEED }),
      );
    const gw = await boot();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 10)),
      op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 11)),
      op(grantClaims(STORE_ENTITY, B, "write", OP, 12)),
    ]);
    const byB = observed(FERN, "height", 2, 19, B_SEED); // arrives first, then is purged
    const byK1 = observed(FERN, "height", 1, 20, K1_SEED);
    await gw.append([byB]);
    await gw.append([byK1]);
    await recover(gw, { outcome: "committed" });
    await gw.erase(byB.id);
    await gw.close();
    const again = await boot();
    try {
      expect(again.reactor.get(byB.id)).toBeUndefined();
      expect(
        cutsHere(again.reactor, OP, refusedIds(again.reactor, OP)).map((c) => c.state),
      ).toEqual(["committed"]);
      expect(paused(again).has(K1)).toBe(false);
      expect(members(again).has(byK1.id)).toBe(true);
    } finally {
      await again.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("S5: a cut after a federated record: the door refuses it; planted, it commits nothing", async () => {
    const { gw, byK1 } = await world();
    const record = op(
      recoveryClaims({ name: "ada", attempt: "f", previous: K1, root: K2, retired: [K1] }, OP, 30),
    );
    const landed = [
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ];
    await gw.federate(landed);
    expect(gw.reactor.get(record.id)).toBeUndefined(); // federation runs the barrier too
    for (const d of landed) gw.reactor.ingest(d); // planted past both doors
    expect(gw.reactor.get(record.id)).toBeDefined();
    const late = observed(FERN, "height", 9, 5, K1_SEED); // after the record, backdated
    await gw.federate([late]);
    expect(gw.reactor.get(late.id)).toBeDefined();
    const cut = op(
      cutClaims({ store: incarnationOf(gw), attempt: "f", recovery: record.id, key: K1 }, OP, 40),
    );
    await expect(gw.append([cut])).rejects.toThrow(/must arrive before its record/);
    expect(gw.reactor.ingest(cut).status).toBe("accepted"); // planted past the door
    await gw.append([op(outcomeClaims(cut.id, "committed", OP, 41))]);
    await gw.federate([
      signClaims(
        {
          timestamp: 42,
          validFrom: 42,
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
      ),
    ]);
    expect(cutsHere(gw.reactor, OP, refusedIds(gw.reactor, OP)).map((c) => c.state)).toEqual([
      "prepared",
    ]);
    const m = members(gw);
    expect([m.has(late.id), m.has(byK1.id)]).toEqual([false, false]);
  });

  it("S5: federate drops a cut that names this store; a cut for another store is kept, inert", async () => {
    const { gw } = await world();
    const mine = op(
      cutClaims({ store: incarnationOf(gw), attempt: "g", recovery: "r", key: K1 }, OP, 40),
    );
    const theirs = op(
      cutClaims({ store: "elsewhere", attempt: "g", recovery: "r", key: K1 }, OP, 40),
    );
    await gw.federate([mine, theirs]);
    expect(
      [gw.reactor.get(mine.id), gw.reactor.get(theirs.id)].map((d) => d !== undefined),
    ).toEqual([false, true]);
    expect(paused(gw).has(K1)).toBe(false);
  });

  it("a stale pool user ground cannot make a post-recovery write historical", async () => {
    const host = await store();
    const staleHost = await store();
    const pool = await store();
    pool.readUsersFrom(staleHost);
    const record = op(
      recoveryClaims(
        { name: "ada", attempt: "stale", previous: K1, root: K2, retired: [K1] },
        OP,
        30,
      ),
    );
    await host.federate([
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ]);
    const late = observed(FERN, "height", 997, 5, K1_SEED);
    await pool.federate([late]);
    const cut = op(
      cutClaims(
        { store: incarnationOf(pool), attempt: "stale", recovery: record.id, key: K1 },
        OP,
        31,
      ),
    );
    await pool.append([cut]); // stale host view does not see R
    pool.readUsersFrom(host); // host now shows R
    expect(cutsHere(pool.reactor, OP, refusedIds(pool.reactor, OP)).map((c) => c.state)).toEqual([
      "prepared",
    ]);
    expect(
      historyBefore(pool.reactor, OP, record.id, K1, refusedIds(pool.reactor, OP)),
    ).not.toContain(late.id);
    // A committed outcome for the late cut changes nothing: no manifest ahead of R names it.
    await pool.append([op(outcomeClaims(cut.id, "committed", OP, 32))]);
    expect(cutsHere(pool.reactor, OP, refusedIds(pool.reactor, OP)).map((c) => c.state)).toEqual([
      "prepared",
    ]);
  });

  it("a federated manifest and record, before the pool cut they name, qualify nothing", async () => {
    const host = await store();
    const pool = await store();
    pool.readUsersFrom(host);
    const record = op(
      recoveryClaims(
        { name: "ada", attempt: "pre", previous: K1, root: K2, retired: [K1] },
        OP,
        30,
      ),
    );
    const cut = op(
      cutClaims(
        { store: incarnationOf(pool), attempt: "pre", recovery: record.id, key: K1 },
        OP,
        31,
      ),
    );
    const manifest = op(manifestClaims(record.id, [cut.id], OP, 30)); // names a cut not yet written
    const rest = [
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ];
    await host.federate([manifest, ...rest]);
    expect(host.reactor.get(manifest.id)).toBeUndefined(); // the federate door drops a manifest
    expect(host.reactor.get(record.id)).toBeUndefined(); // and a record with no barrier
    for (const d of rest) host.reactor.ingest(d); // planted past both doors
    expect(host.reactor.get(record.id)).toBeDefined();
    const late = observed(FERN, "height", 996, 5, K1_SEED);
    await pool.federate([late]);
    expect(pool.reactor.ingest(cut).status).toBe("accepted"); // the pool door refuses it: planted
    expect(cutsHere(pool.reactor, OP, refusedIds(pool.reactor, OP)).map((c) => c.state)).toEqual([
      "prepared",
    ]);
    expect(
      historyBefore(pool.reactor, OP, record.id, K1, refusedIds(pool.reactor, OP)),
    ).not.toContain(late.id);
  });

  it("a manifest that arrives after its record qualifies nothing", async () => {
    const host = await store();
    const pool = await store();
    pool.readUsersFrom(host);
    const record = op(
      recoveryClaims(
        { name: "ada", attempt: "after", previous: K1, root: K2, retired: [K1] },
        OP,
        30,
      ),
    );
    await host.federate([
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ]);
    const late = observed(FERN, "height", 995, 5, K1_SEED);
    await pool.federate([late]);
    const cut = op(
      cutClaims(
        { store: incarnationOf(pool), attempt: "after", recovery: record.id, key: K1 },
        OP,
        31,
      ),
    );
    expect(pool.reactor.ingest(cut).status).toBe("accepted");
    // As a writer that never saw R would land it: after R, in the host's durable order.
    expect(host.reactor.ingest(op(manifestClaims(record.id, [cut.id], OP, 32))).status).toBe(
      "accepted",
    );
    expect(cutsHere(pool.reactor, OP, refusedIds(pool.reactor, OP)).map((c) => c.state)).toEqual([
      "prepared",
    ]);
    expect(
      historyBefore(pool.reactor, OP, record.id, K1, refusedIds(pool.reactor, OP)),
    ).not.toContain(late.id);
  });

  it("the append door refuses a manifest naming a cut no store holds, and one beside its record", async () => {
    const { gw } = await world();
    const { record, cut } = await recover(gw, { land: false });
    const future = op(
      cutClaims(
        { store: incarnationOf(gw), attempt: "later", recovery: record.id, key: K1 },
        OP,
        50,
      ),
    );
    const commit = (m: Delta) => [
      m,
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ];
    // A manifest may not name a cut that is not held yet: it would bind a later arrival.
    const early = op(manifestClaims(record.id, [cut.id, future.id], OP, 30));
    await expect(gw.append([early])).rejects.toThrow(/neither held nor in its append/);
    expect(gw.reactor.get(early.id)).toBeUndefined();
    // One append's arrivals are simultaneous, so a manifest beside its record does not count.
    await expect(
      gw.append(commit(op(manifestClaims(record.id, [cut.id], OP, 30)))),
    ).rejects.toThrow(/separate appends, the manifest first/);
    expect(gw.reactor.get(record.id)).toBeUndefined();
  });

  it("a manifest cannot be erased while a cut it names stands here", async () => {
    const { gw } = await world();
    await recover(gw, { outcome: "committed" });
    const manifest = gw.reactor
      .arrivalLog()
      .find(
        (d) =>
          d.claims.pointers.some((p) => p.role === "recovery" && p.target.kind === "primitive") &&
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.context === "loam.cutmanifest",
          ),
      )!;
    await expect(gw.append([op(eraseClaims(manifest.id, OP, OP, 90))])).rejects.toThrow(
      /cut manifest is kept while a cut it names stands here/,
    );
    expect(paused(gw).has(K1)).toBe(false);
  });

  it("S3: a held aborted cut resubmitted with the record does not cover it", async () => {
    const { gw } = await world();
    const { record, cut } = await recover(gw, { land: false });
    await gw.append([op(outcomeClaims(cut.id, "aborted", OP, 31))]);
    await gw.append([cut, op(manifestClaims(record.id, [cut.id], OP, 30))]);
    await expect(
      gw.append([
        record,
        op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
        op(rootClaims("ada", K2, OP, 30)),
      ]),
    ).rejects.toThrow(/holds no live cut for it/);
  });

  it("S3: two committed cuts for one recovery and key: the earlier one bounds the history", async () => {
    const { gw, byK1 } = await world();
    const record = op(
      recoveryClaims({ name: "ada", attempt: "a", previous: K1, root: K2, retired: [K1] }, OP, 30),
    );
    const cutFor = (attempt: string, t: number) =>
      op(cutClaims({ store: incarnationOf(gw), attempt, recovery: record.id, key: K1 }, OP, t));
    const cutA = cutFor("a", 28);
    await gw.append([cutA]);
    const between = observed(FERN, "height", 9, 5, K1_SEED); // the pause would refuse it: planted
    expect(gw.reactor.ingest(between).status).toBe("accepted");
    const cutB = cutFor("b", 29);
    await gw.append([cutB]);
    await gw.append([op(manifestClaims(record.id, [cutA.id, cutB.id], OP, 30))]);
    await gw.append([
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ]);
    await gw.federate([
      signClaims(
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
      ),
    ]);
    const m = members(gw);
    expect([m.has(byK1.id), m.has(between.id)]).toEqual([true, false]);
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
