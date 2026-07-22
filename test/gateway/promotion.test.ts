// Promotion — promote-outputs (SPEC §24.3), the first CONTAINER operation of §27: the operator adopts a
// delta a quarantine produced by RE-SPEAKING its content as their own claim into the primary, carrying
// `loam.adoption` provenance back to the pool. The value crosses by re-assertion (authored fresh, not
// federated), so the pool can be dropped wholesale and the adopted value survives in the operator's voice —
// and its origin is kept FOREVER, which is what makes fork/pull-request native. These suites prove: the
// adopted value lands and resolves in the primary under the operator; it survives dropping the pool; the
// provenance trail is readable; and a promotion whose reference would dangle is refused (reference closure).
// The re-assertion INHERITS the source timestamp (§11 rung 2), so promotion is content-addressed: the
// idempotence, erasure-holds, and chain-closure suites below all stand on that one property.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { isAdoption, readAdoptions } from "../../src/gateway/adopt.js";
import { PLANT } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const GUEST_SEED = "9d".repeat(32); // a stranger whose fact runs in the quarantine
const GUEST = authorForSeed(GUEST_SEED);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = { props: new Map<string, Policy>([["message", pick]]), default: pick };

// A foreign fact about FERN's `message`, authored by a STRANGER — the kind of output a quarantined app
// produces: present in the pool, inert (binds nothing, §8), until the operator adopts it.
const foreignFact = (value: string, ts: number) =>
  signClaims(
    {
      timestamp: ts,
      author: GUEST,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "message" } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    GUEST_SEED,
  );

const bootPrimary = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["message"] }],
    }),
  );

const messageOf = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { message } }`);
  return (res.data as { plant?: { message?: unknown } } | undefined)?.plant?.message;
};

describe("§24.3 promote-outputs — adopt a quarantine's output as the operator's own claim", () => {
  it("promotes a stranger's pool fact into the primary, re-signed by the operator, and it resolves there", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("the stranger's app said this", 3000);
    await q.gateway.federate([fact]); // the stranger's output, present in the pool (inert there)
    expect(await messageOf(primary)).toBeNull(); // the primary has NOT seen it — it's sequestered

    const { promoted } = await primary.promote(q.gateway, fact.id, { from: "trial-pool" });

    // The re-signed content now lives in the primary, authored by the OPERATOR (clean — no provenance
    // pollution), and resolves as itself. The provenance rides a SEPARATE adoption record pointing at it.
    const adopted = primary.reactor.get(promoted);
    expect(adopted?.claims.author).toBe(OP);
    expect(isAdoption(adopted!.claims)).toBe(false); // the content delta is clean
    expect(primary.adoptions().some((a) => a.adoptedDelta === promoted)).toBe(true); // the record points at it
    expect(await messageOf(primary)).toBe("the stranger's app said this");
    await q.drop();
    await primary.close();
  });

  it("keeps the provenance trail — where it came from, who made it, who blessed it (§24.3 / §27)", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("provenance survives", 3100);
    await q.gateway.federate([fact]);
    await primary.promote(q.gateway, fact.id, { from: "trial-pool" });

    const trail = primary.adoptions();
    expect(trail).toHaveLength(1);
    expect(trail[0]!.from).toBe("trial-pool");
    expect(trail[0]!.sourceDelta).toBe(fact.id); // WHAT was adopted
    expect(trail[0]!.producedBy).toBe(GUEST); // WHO made the output (the granted author it wrote under)
    expect(trail[0]!.adoptedBy).toBe(OP); // WHO blessed it
    await q.drop();
    await primary.close();
  });

  it("the adopted value SURVIVES dropping the pool — it crossed by re-assertion, not federation", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("this outlives the sandbox", 3200);
    await q.gateway.federate([fact]);
    await primary.promote(q.gateway, fact.id, { from: "trial-pool" });
    await q.drop(); // discard the whole quarantine
    expect(await messageOf(primary)).toBe("this outlives the sandbox"); // still standing, in the operator's voice
    await primary.close();
  });

  it("refuses a promotion whose reference would DANGLE in the primary (reference closure, §27)", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    // A pool delta that cites another delta the primary does not hold — promoting it would dangle.
    const dangling = signClaims(
      {
        timestamp: 3300,
        author: GUEST,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "message" } } },
          {
            role: "cites",
            target: { kind: "delta", deltaRef: { delta: "delta:not-in-the-primary" } },
          },
        ],
      },
      GUEST_SEED,
    );
    await q.gateway.federate([dangling]);
    await expect(primary.promote(q.gateway, dangling.id, { from: "trial-pool" })).rejects.toThrow(
      /dangle/,
    );
    await q.drop();
    await primary.close();
  });

  it("promotes a CHAIN: a citation of an already-adopted pool delta is rewritten to its adopted counterpart", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const factA = foreignFact("the first output", 3400);
    const factB = signClaims(
      {
        timestamp: 3410,
        author: GUEST,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "message" } } },
          {
            role: "value",
            target: { kind: "primitive", value: "the second output, citing the first" },
          },
          { role: "cites", target: { kind: "delta", deltaRef: { delta: factA.id } } },
        ],
      },
      GUEST_SEED,
    );
    await q.gateway.federate([factA, factB]);
    // B before A dangles (A's pool id is unknown here, no adoption bridges it yet)…
    await expect(primary.promote(q.gateway, factB.id)).rejects.toThrow(/dangle/);
    // …but after adopting A, promoting B succeeds and B's citation is REWRITTEN to A's adopted id —
    // the trail is the bridge, and no pool id ever appears in the primary's ground.
    const { promoted: adoptedA } = await primary.promote(q.gateway, factA.id);
    const { promoted: adoptedB } = await primary.promote(q.gateway, factB.id);
    const cites = primary.reactor
      .get(adoptedB)!
      .claims.pointers.find((p) => p.role === "cites")!.target;
    expect(cites.kind === "delta" && cites.deltaRef.delta).toBe(adoptedA);
    await q.drop();
    await primary.close();
  });

  it("is IDEMPOTENT: the re-assertion inherits the source timestamp, so promoting twice converges on one delta and one trail record", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("said once, adopted once", 3500);
    await q.gateway.federate([fact]);
    const first = await primary.promote(q.gateway, fact.id, { from: "trial-pool" });
    const second = await primary.promote(q.gateway, fact.id, { from: "trial-pool" });
    expect(second.promoted).toBe(first.promoted);
    expect(primary.reactor.get(first.promoted)!.claims.timestamp).toBe(3500); // inherited, §11 rung 2
    expect(primary.adoptions().filter((a) => a.sourceDelta === fact.id)).toHaveLength(1);
    await q.drop();
    await primary.close();
  });

  it("an ERASED adoption stays dead: re-promoting the same output mints the same id, and the tombstone refuses it", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("adopted, regretted, erased", 3600);
    await q.gateway.federate([fact]);
    const { promoted } = await primary.promote(q.gateway, fact.id);
    await primary.erase(promoted, { reason: "the operator un-said it" });
    // The pool's source delta survives the fan-out (only the adopted id was erased) — and that is not a
    // door back in: the inherited timestamp makes re-promotion re-mint the SAME id, which the tombstone
    // refuses. Without inheritance a fresh timestamp would mint a fresh id and walk the content past §11.
    await expect(primary.promote(q.gateway, fact.id)).rejects.toThrow(/erased|tombstone/);
    await q.drop();
    await primary.close();
  });
});

describe("§24.3 promote-outputs adopts FACTS, never LAW — operator authorship is force", () => {
  const refusesPromotion = async (pointers: Parameters<typeof signClaims>[0]["pointers"]) => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const lawShaped = signClaims({ timestamp: 3700, author: GUEST, pointers }, GUEST_SEED);
    await q.gateway.federate([lawShaped]);
    await expect(primary.promote(q.gateway, lawShaped.id)).rejects.toThrow(/promotion refused/);
    await q.drop();
    await primary.close();
  };

  it("refuses a grant-shaped output — a blind adoption must not mint a capability", () =>
    refusesPromotion([
      {
        role: "subject",
        target: { kind: "entity", entity: { id: "loam:trust", context: "loam.grants" } },
      },
      { role: "value", target: { kind: "primitive", value: GUEST } },
    ]));

  it("refuses an adoption-shaped output — the provenance trail is not forgeable through its own door", () =>
    refusesPromotion([
      {
        role: "adopts",
        target: { kind: "entity", entity: { id: "loam:adoption", context: "loam.adoption" } },
      },
      { role: "adopted-from", target: { kind: "primitive", value: "a-pool-that-never-was" } },
    ]));

  it("refuses a NEGATION — a retraction is the operator's own §14 act, never an adopted output", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const standing = foreignFact("a fact worth keeping", 3800);
    await q.gateway.federate([standing]);
    const { promoted } = await primary.promote(q.gateway, standing.id);
    const strike = signClaims(
      {
        timestamp: 3810,
        author: GUEST,
        pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: promoted } } }],
      },
      GUEST_SEED,
    );
    await q.gateway.federate([strike]);
    await expect(primary.promote(q.gateway, strike.id)).rejects.toThrow(/promotion refused/);
    await q.drop();
    await primary.close();
  });

  it("readAdoptions without an operator reads EVERY adoption record — an optional filter filters, never empties", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("read by anyone auditing", 3900);
    await q.gateway.federate([fact]);
    await primary.promote(q.gateway, fact.id);
    expect(readAdoptions(primary.reactor)).toHaveLength(1);
    expect(readAdoptions(primary.reactor, GUEST)).toHaveLength(0); // the filter still filters
    await q.drop();
    await primary.close();
  });
});

// A struck adoption record must leave the trail AND let promotion re-establish it (ticket T46). The
// adoption reader ignored `lawfulNegated`, so a withdrawn provenance record kept appearing in
// `adoptions()` (the audit trail lied) and `promoteImpl`'s presence short-circuit rode that stale
// trail — re-promoting a value whose record was struck returned success and landed nothing.
describe("§24.3/§27 — a STRUCK adoption record leaves the trail and lets promotion re-land", () => {
  const recordFor = (gw: Gateway, promoted: string) =>
    [...gw.reactor.snapshot()].find(
      (d) =>
        isAdoption(d.claims) &&
        d.claims.pointers.some(
          (p) =>
            p.role === "adopted" &&
            p.target.kind === "delta" &&
            p.target.deltaRef.delta === promoted,
        ),
    );
  const recordCount = (gw: Gateway) =>
    [...gw.reactor.snapshot()].filter((d) => isAdoption(d.claims)).length;

  it("AUDIT (object): striking an adoption record removes it from adoptions(), while the value lives", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("adopted, then provenance withdrawn", 3700);
    await q.gateway.federate([fact]);
    const { promoted } = await primary.promote(q.gateway, fact.id, { from: "trial-pool" });
    const record = recordFor(primary, promoted)!;
    expect(primary.adoptions().some((a) => a.adoptedDelta === promoted)).toBe(true); // present first

    // The operator withdraws the PROVENANCE record (a plain negation), keeping the value.
    await primary.append([
      signClaims(makeNegationClaims(OP, 9_000_000, record.id, "withdraw provenance"), OP_SEED),
    ]);

    expect(primary.adoptions().some((a) => a.adoptedDelta === promoted)).toBe(false); // gone from trail
    expect(await messageOf(primary)).toBe("adopted, then provenance withdrawn"); // value still stands
    await q.drop();
    await primary.close();
  });

  it("PROMOTE (delta): re-promoting after striking the record LANDS A NEW record, not a silent no-op", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("re-blessed after withdrawal", 3800);
    await q.gateway.federate([fact]);
    const { promoted } = await primary.promote(q.gateway, fact.id, { from: "trial-pool" });
    const record = recordFor(primary, promoted)!;
    await primary.append([
      signClaims(makeNegationClaims(OP, 9_000_000, record.id, "withdraw"), OP_SEED),
    ]);
    const before = recordCount(primary); // 1 — the struck record still sits in the ground

    const re = await primary.promote(q.gateway, fact.id, { from: "trial-pool" });
    // A fresh record must land — before the fix, promote short-circuits on the stale trail and lands
    // nothing while reporting success.
    expect(recordCount(primary)).toBe(before + 1);
    expect(primary.adoptions().some((a) => a.adoptedDelta === re.promoted)).toBe(true); // live in trail
    await q.drop();
    await primary.close();
  });
  it("BRIDGE (regression): a citation still rewrites after the cited value's provenance record is struck", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const factA = foreignFact("cited value, provenance later withdrawn", 3900);
    const factB = signClaims(
      {
        timestamp: 3910,
        author: GUEST,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "message" } } },
          {
            role: "value",
            target: { kind: "primitive", value: "cites A after A's record is struck" },
          },
          { role: "cites", target: { kind: "delta", deltaRef: { delta: factA.id } } },
        ],
      },
      GUEST_SEED,
    );
    await q.gateway.federate([factA, factB]);
    const { promoted: adoptedA } = await primary.promote(q.gateway, factA.id);
    const recordA = recordFor(primary, adoptedA)!;
    // Withdraw A's PROVENANCE record (keeping the value) — the §27 review action T46's audit rail
    // blesses. The reference bridge must NOT be severed: A's counterpart still stands and is citable.
    await primary.append([
      signClaims(makeNegationClaims(OP, 9_000_001, recordA.id, "withdraw A's provenance"), OP_SEED),
    ]);
    // Before the bridge decoupling this threw "would dangle" — the struck record removed the bridge.
    const { promoted: adoptedB } = await primary.promote(q.gateway, factB.id);
    const cited = primary.reactor.get(adoptedB)!.claims.pointers.find((p) => p.role === "cites")!;
    expect(cited.target.kind === "delta" && cited.target.deltaRef.delta).toBe(adoptedA); // rewritten
    await q.drop();
    await primary.close();
  });
});
