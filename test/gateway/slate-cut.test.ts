// T64 (SPEC §29.5) — THE CUT: pre-flight ALL-OR-REFUSE, per-member work with a fault report, the
// graveyard before the strike, and the two states that would otherwise jam a slate forever.
//
// Criteria 9, 10, 11, 14, 19, 20, 21. Atomicity is claimed only where it is real: erasure is not
// transactional across tiers, so the pre-flight is all-or-nothing and the per-member sweep is
// per-member. Every refusal rail compares the ground DELTA-FOR-DELTA across the refusal — a pre-flight
// that "refused" after minting one tombstone would pass a weaker assertion.
//
// TWO-SIDEDNESS, which matters more here than anywhere else in T64: a rail that only proves the target
// is gone cannot see OVER-PURGING, and over-purging is the failure with no way back. So every cut rail
// names a live bystander and asserts it survived, at the bytes and through a Schema.

import { describe, expect, it } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { containerClaims } from "../../src/gateway/container.js";
import { survivingTombstones, tombstoneSlate, tombstoneTarget } from "../../src/gateway/erase.js";
import { graveyardCompleteness } from "../../src/gateway/slate.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import {
  BEFORE_DEADLINE,
  OP,
  OP_SEED,
  bootSlateStore,
  declareContainer,
  groundIds,
  standSlate,
  strike,
} from "./slating.js";

/** A store whose `purge` REFUSES for a named set of ids — one tier that will not let go. */
class RefusingBackend implements StoreBackend {
  readonly refuse = new Set<string>();
  /** Survives close(), so a detached wall's bytes stay readable to the rail that must prove they are. */
  keepOpen = false;
  constructor(private readonly inner: MemoryBackend = new MemoryBackend()) {}
  append(deltas: Iterable<Delta>): Promise<number> {
    return this.inner.append(deltas);
  }
  deltasSince(known: ReadonlySet<string>): Promise<Delta[]> {
    return this.inner.deltasSince(known);
  }
  async purge(ids: readonly string[]): Promise<number> {
    const blocked = ids.filter((id) => this.refuse.has(id));
    if (blocked.length > 0) {
      throw new Error(`this tier refuses to purge ${blocked.join(", ")}`);
    }
    return this.inner.purge(ids);
  }
  holds(id: string): Promise<boolean> {
    return this.inner.holds(id);
  }
  async heldAmong(ids: readonly string[]): Promise<Set<string>> {
    const held = new Set<string>();
    for (const id of ids) if (await this.inner.holds(id)) held.add(id);
    return held;
  }
  async close(): Promise<void> {
    if (!this.keepOpen) await this.inner.close();
  }
}

const heightThrough = async (gw: Gateway): Promise<number | null> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  return (res.data as { plant: { height: number | null } }).plant.height;
};

describe("T64 criterion 9 — the pre-flight is all-or-refuse and leaves the ground byte-identical", () => {
  it("a DANGLING membershipAt refuses before any tombstone lands", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress", "cite"] });
    // The published Term is erased out from under the declaration, so the container resolves and its
    // membership address does not. If we cannot read WHICH IDS ARE CONDEMNED we cannot cut (H9).
    await gw.erase(stood.membershipAt);
    const before = groundIds(gw);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      /resolves to nothing here/,
    );
    expect(groundIds(gw)).toEqual(before);
    expect(survivingTombstones(gw.reactor, OP).map((t) => tombstoneTarget(t.claims))).not.toContain(
      member.id,
    );
    // Two-sided: both the member and the bystander still hold their bytes.
    expect(await gw.backend.holds(member.id)).toBe(true);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });

  it("an UNREACHABLE wall in the table refuses before any tombstone lands", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress", "cite"] });
    // A declared wall neither attached nor covered by a detach record: its store may hold this byte
    // outside the sweep, so §27.7's guard refuses the cut exactly as it refuses an ordinary erase.
    await gw.append([
      declareContainer(
        { container: "container:archive", trust: "curated", posture: "wall" },
        55_000,
      ),
    ]);
    const before = groundIds(gw);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      /neither attached nor covered/,
    );
    expect(groundIds(gw)).toEqual(before);
    expect(await gw.backend.holds(member.id)).toBe(true);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    // And the slate STANDS: its doors are still closed, so the refusal is not a quiet reopening.
    expect(gw.offeredDeltas().map((d) => d.id)).not.toContain(member.id);
    expect(gw.slates(BEFORE_DEADLINE)).toHaveLength(1);
    await gw.close();
  });
});

describe("T64 criterion 10 — per-member, faults collected, the slate STANDS, then resumes", () => {
  it("one refusing tier: throws naming the member, no graveyard, then a clean re-run", async () => {
    const backend = new RefusingBackend();
    const gw = await bootSlateStore(backend);
    const stubborn = observed(FERN, "height", 30, 1000, OP_SEED);
    const willing = observed(FERN, "height", 34, 1050, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([stubborn, willing, bystander]);
    const stood = await standSlate(gw, {
      members: [stubborn, willing],
      closes: ["egress", "cite"],
    });
    backend.refuse.add(stubborn.id);

    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      new RegExp(stubborn.id),
    );
    // NO graveyard, the declaration still resolves, the closed doors are still closed — a partially
    // cut slate is still slated, still reviewable, and RESUMABLE.
    expect(gw.graveyards()).toEqual([]);
    expect(gw.containers().containers.get(stood.container)).toBeDefined();
    expect(gw.offeredDeltas().map((d) => d.id)).not.toContain(stubborn.id);
    // The member the tier DID release is gone; the stubborn one is still held.
    expect(await backend.holds(willing.id)).toBe(false);
    expect(await backend.holds(stubborn.id)).toBe(true);
    // Two-sided: the bystander is untouched by the failed cut, at the bytes and through a Schema.
    expect(await backend.holds(bystander.id)).toBe(true);
    const tagsMid = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tagsMid.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);

    const tombstonesAfterFault = survivingTombstones(gw.reactor, OP).length;
    backend.refuse.clear();
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(report.members.map((m) => m.member).sort()).toEqual([stubborn.id, willing.id].sort());
    expect(await backend.holds(stubborn.id)).toBe(false);
    // EXACTLY ONE TOMBSTONE PER MEMBER — the re-run mints no second one (§11's anchor).
    const targets = survivingTombstones(gw.reactor, OP).map((t) => tombstoneTarget(t.claims));
    expect(targets.filter((t) => t === willing.id)).toHaveLength(1);
    expect(targets.filter((t) => t === stubborn.id)).toHaveLength(1);
    // The failed attempt had ALREADY landed the stubborn member's tombstone — `eraseImpl` grounds it
    // before the purge on purpose — so the re-run mints not one new tombstone anywhere.
    expect(tombstonesAfterFault).toBe(2);
    expect(survivingTombstones(gw.reactor, OP).length).toBe(tombstonesAfterFault);
    expect(await backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 criterion 11 — order and crash semantics: graveyard BEFORE strike, exactly one", () => {
  it("interrupting between the two and re-running yields one graveyard and a struck declaration", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress", "cite"] });

    // The injected hold: interrupt EXACTLY between the graveyard's landing and the strike. Order is
    // load-bearing — strike first and a crash loses the record, because the struck declaration no
    // longer resolves the set the graveyard has to name.
    gw.cutHold = () => Promise.reject(new Error("power cut"));
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(/power cut/);
    const graveyards = gw.graveyards();
    expect(graveyards).toHaveLength(1);
    // The graveyard is in the ground WHILE the declaration still resolves — the crash window, observed.
    expect(gw.containers().containers.get(stood.container)).toBeDefined();

    gw.cutHold = undefined;
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    // The re-run finds nothing outstanding and simply strikes: exactly ONE graveyard, and the same one.
    expect(gw.graveyards()).toHaveLength(1);
    expect(report.graveyard).toBe(graveyards[0]!.id);
    expect(gw.containers().containers.get(stood.container)).toBeUndefined();
    // Two-sided: the bystander survived both attempts.
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await gw.backend.holds(member.id)).toBe(false);
    await gw.close();
  });
});

describe("T64 criterion 14 — resurrection is visible at review and REAL at the cut", () => {
  it("a slated NEGATION reports its target as resurfacing, and the target goes live after the cut", async () => {
    const gw = await bootSlateStore();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const retraction = strike(claim.id, 2000);
    await gw.append([retraction]);
    expect(await heightThrough(gw)).toBeNull(); // struck at the source

    const stood = await standSlate(gw, { members: [retraction], closes: ["egress", "cite"] });
    // AT REVIEW TIME — the genuine new value of the two-phase shape: the operator sees which claims
    // will come back to life BEFORE the cut, which no single-act erasure could ever show them.
    expect(gw.slates(BEFORE_DEADLINE)[0]!.resurfacing).toEqual([claim.id]);

    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(report.resurfacing).toEqual([claim.id]);
    // OBJECT LEVEL, at the door: the target resolves LIVE again.
    expect(await heightThrough(gw)).toBe(30);
    expect(await gw.backend.holds(retraction.id)).toBe(false);
    // Two-sided: the revived target's own bytes were never touched, and neither was the bystander's.
    expect(await gw.backend.holds(claim.id)).toBe(true);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 criterion 19 — a member erased mid-window: the cut COMPLETES, the proof stays decidable", () => {
  it("`prior-tombstone` accounts for it, no second tombstone, and the arithmetic holds", async () => {
    const gw = await bootSlateStore();
    const members = [
      observed(FERN, "height", 30, 1000, OP_SEED),
      observed(FERN, "height", 31, 1001, OP_SEED),
      observed(FERN, "height", 32, 1002, OP_SEED),
      observed(FERN, "height", 33, 1003, OP_SEED),
    ];
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([...members, bystander]);
    const stood = await standSlate(gw, { members, closes: ["egress"] });

    // The mundane move the exception exists for: the operator erases one member BY HAND mid-window.
    const byHand = await gw.erase(members[1]!.id);
    expect(byHand.tombstone).toBeDefined();

    // It must NOT throw. Refusing without an exception would only DETECT a jam nothing can repair —
    // nothing can un-erase, so the slate would stand with `read` closing forever.
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(report.priorTombstone).toEqual([
      { member: members[1]!.id, tombstone: byHand.tombstone },
    ]);
    // Exactly ONE tombstone for that member, and it is the PRE-CUT one.
    const forHand = survivingTombstones(gw.reactor, OP).filter(
      (t) => tombstoneTarget(t.claims) === members[1]!.id,
    );
    expect(forHand).toHaveLength(1);
    expect(forHand[0]!.id).toBe(byHand.tombstone);
    // §29.6's arithmetic computes TRUE from DURABLE GROUND ALONE — no probe, no CutReport.
    const check = graveyardCompleteness(gw.reactor, OP, report.graveyard);
    expect(check.members).toHaveLength(4);
    expect(check.missing).toEqual([]);
    expect(check.holds).toBe(true);
    // The other three carry the `slate` join; the hand-erased one cannot (content addressing forbids
    // adding a pointer to an existing delta — H4), which is exactly why the exception is ENUMERATED.
    const joined = survivingTombstones(gw.reactor, OP)
      .filter((t) => tombstoneSlate(t.claims) === stood.container)
      .map((t) => tombstoneTarget(t.claims))
      .sort();
    expect(joined).toEqual([members[0]!.id, members[2]!.id, members[3]!.id].sort());
    // Two-sided: the bystander survived a four-member cut.
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });

  it("THE FAIL-CLOSED LEG: a frozen id resolving to nothing with NO tombstone refuses the cut", async () => {
    const gw = await bootSlateStore();
    const real = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    const phantom = observed(FERN, "height", 99, 1200, OP_SEED); // NEVER appended
    await gw.append([real, bystander]);
    // The frozen set names an id this ground does not hold and never tombstoned. Both sides of the
    // door's agreement check evaluate it away identically, so the slate stands lawfully — and the cut
    // must then refuse rather than stand over an unreported gap. It should be unreachable today,
    // which is exactly why it is written down.
    const stood = await standSlate(gw, { members: [real, phantom], closes: ["egress"] });
    const before = groundIds(gw);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      new RegExp(`${phantom.id}[\\s\\S]*NO surviving lawful tombstone`),
    );
    expect(groundIds(gw)).toEqual(before);
    // Two-sided: nothing was erased on the way to the refusal.
    expect(await gw.backend.holds(real.id)).toBe(true);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 criterion 20 — a detached wall that demonstrably holds a member is a REFUSAL", () => {
  it("refuses naming the wall and the ids; cutting around it is SIGNED and reads `unproven`", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);

    // A NAMED wall whose at-rest membership Term admits the member, seeded and then DETACHED — the
    // exact state `eraseImpl`'s documented remedy produces, which converts a FAULT into a footnote.
    const HEIGHTS = {
      op: "select",
      pred: { hasPointer: { context: { exact: "height" } } },
      in: "input",
    };
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "container:shelf",
            trust: "curated",
            posture: "wall",
            membership: HEIGHTS,
          },
          OP,
          52_000,
        ),
        OP_SEED,
      ),
    ]);
    const shelfBytes = new RefusingBackend();
    shelfBytes.keepOpen = true; // a durable store: detach() must not make its bytes unreadable
    const shelf = await gw.openContainer({ name: "container:shelf", backend: shelfBytes });
    // ASSERTED BY READING THE WALL'S OWN STORE, never by trusting the seed.
    expect(shelf.gateway!.reactor.get(member.id)).toBeDefined();
    expect(await shelfBytes.holds(member.id)).toBe(true);
    await shelf.detach("parked for the audit");
    expect(gw.containers().detached.has("container:shelf")).toBe(true);

    const stood = await standSlate(gw, { members: [member], closes: ["egress", "cite"] });
    const before = groundIds(gw);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      new RegExp(`kept wall "container:shelf" was seeded to admit[\\s\\S]*${member.id}`),
    );
    expect(groundIds(gw)).toEqual(before);
    expect(await gw.backend.holds(member.id)).toBe(true);

    // A kept wall with NO at-rest membership Term refuses too: an uncomputable intersection cannot be
    // excluded, and H9's direction is to fail closed rather than to assume empty.
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:opaque", trust: "curated", posture: "wall" },
          OP,
          53_000,
        ),
        OP_SEED,
      ),
      signClaims(
        {
          timestamp: 53_001,
          author: OP,
          pointers: [
            {
              role: "container",
              target: {
                kind: "entity",
                entity: { id: "container:opaque", context: "loam.container.detached" },
              },
            },
          ],
        },
        OP_SEED,
      ),
    ]);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      /declares no at-rest membership Term/,
    );

    // WITH `accepts-incomplete` naming both walls, the cut completes and every artifact tells the
    // truth. The operator can always cut; the operator cannot cut SILENTLY over a wall that may hold
    // members — the difference between an incomplete erasure and a false claim of a complete one is a
    // signature, and now it is one.
    const signed = await standSlate(gw, {
      container: "container:slate:signed",
      members: [member],
      closes: ["egress", "cite"],
      acceptsIncomplete: ["container:shelf", "container:opaque"],
      ts: 54_000,
    });
    await gw.append([strike(stood.declaration, 54_500)]); // one slate at a time over this member
    const report = await gw.cut(signed.container, { now: BEFORE_DEADLINE });

    const verdicts = report.members[0]!.tiers;
    const shelfVerdict = verdicts.find((v) => v.tier === "container:shelf")!;
    // ASSERTED AS AN INEQUALITY AGAINST `false`, because collapsing the tri-state is the actual bug:
    // a report of work NOT DONE must never read as a report of work completed.
    expect(shelfVerdict.holds).not.toBe(false);
    expect(shelfVerdict.holds).toBe("unproven");
    expect(verdicts.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(report.notReached).toEqual(
      expect.arrayContaining([
        { wall: "container:shelf", acceptsIncomplete: signed.record },
        { wall: "container:opaque", acceptsIncomplete: signed.record },
      ]),
    );
    // The receipt's NON-CLAIM section names it.
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(receipt.nonClaim.join("\n")).toMatch(/container:shelf/);
    // AND THE MEMBER'S BYTES ARE STILL READABLE IN THE WALL'S STORE — so the rail proves the report is
    // honest about a copy that really is still there, rather than honest about nothing.
    expect(await shelfBytes.holds(member.id)).toBe(true);
    // Two-sided: the bystander survived, at the bytes and through a Schema.
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    const tags = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tags.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    shelfBytes.keepOpen = false;
    await shelfBytes.close();
    await gw.close();
  });
});

describe("T64 criterion 21 — content re-spoken under another id: the window closes, the past does not", () => {
  const bootWithGardener = (): Promise<Gateway> =>
    Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
        grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OP, 2)],
      }),
    );

  it("`promote` of a member is REFUSED — the predicate reads a PRIMITIVE source-delta", async () => {
    const gw = await bootWithGardener();
    const member = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, GARDENER_SEED);
    await gw.append([member, bystander]);
    const pool = await gw.openContainer({
      trust: "untrusted",
      posture: "wall",
      admit: () => true,
    });
    expect(pool.gateway!.reactor.get(member.id)).toBeDefined();

    await standSlate(gw, { members: [member], closes: ["cite"] });
    // `promoteImpl` re-signs the source's pointers under the operator, so without this leg the ground
    // would gain a fresh OPERATOR-AUTHORED copy of the condemned content, under a new id, outside the
    // frozen version, on the operator's own say-so, while the slate stood. The cut would never touch
    // it and no door would ever close on it.
    await expect(gw.promote(pool.gateway!, member.id)).rejects.toThrow(/SLATED FOR ERASURE/);
    // Two-sided: promoting the BYSTANDER out of the same pool still works while the slate stands.
    const ok = await gw.promote(pool.gateway!, bystander.id);
    expect(gw.reactor.get(ok.promoted)).toBeDefined();
    // THE ENCODING, asserted explicitly so the enumerated-role list cannot be narrowed by accident:
    // the adoption record's link back to what it copied is a PRIMITIVE string, not a delta-ref.
    const record = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.role === "source-delta"),
    )!;
    const link = record.claims.pointers.find((p) => p.role === "source-delta")!;
    expect(link.target.kind).toBe("primitive");
    expect((link.target as { value: string }).value).toBe(bystander.id);
    await pool.drop();
    await gw.close();
  });

  it("a promotion made BEFORE the slate is NOT reached, and the review says so", async () => {
    const gw = await bootWithGardener();
    const member = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    await gw.append([member]);
    const pool = await gw.openContainer({
      trust: "untrusted",
      posture: "wall",
      admit: () => true,
    });
    // The copy is made BEFORE identification: erasure is by ID, and a content-addressed store cannot
    // chase content. §11 has never promised to.
    const promoted = await gw.promote(pool.gateway!, member.id);
    expect(promoted.promoted).not.toBe(member.id);
    // A surviving citation of the member, so the CutReport's manifest is genuinely non-empty.
    const cite = signClaims(
      {
        timestamp: 1500,
        author: OP,
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: member.id } } },
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      OP_SEED,
    );
    await gw.append([cite]);

    const stood = await standSlate(gw, { members: [member], closes: ["egress", "cite"] });
    // AT REVIEW TIME the operator SEES it — an honest partial that finds LINKS, never content, and
    // that is the one moment a review could surface it at all.
    const dupes = gw.slates(BEFORE_DEADLINE)[0]!.duplicates;
    expect(dupes.map((d) => d.member)).toContain(member.id);
    expect(dupes.some((d) => d.role === "source-delta")).toBe(true);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).not.toContain(promoted.promoted);

    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    // The promoted copy is absent from the frozen version and STILL RESOLVES LIVE through a Schema.
    expect(report.members.map((m) => m.member)).toEqual([member.id]);
    expect(await heightThrough(gw)).toBe(30);
    expect(await gw.backend.holds(promoted.promoted)).toBe(true);
    expect(await gw.backend.holds(member.id)).toBe(false);
    // The CutReport carries §11's citations manifest per member — the holes the cut left, enumerated.
    expect(report.members[0]!.citations).toContain(cite.id);
    expect(report.duplicates.map((d) => d.member)).toContain(member.id);
    await pool.drop();
    await gw.close();
  });
});
