// T64 (SPEC §29.7) — THE RECEIPT: what is needed NOW is every FIELD; what is deferred is the signed
// document. If the cut's report is complete, the receipt is a formatter. If it is not, no later work
// can reconstruct it — the DATA can never be reconstructed later, the DOCUMENT can wait.
//
// Criteria 16, 22, 23. The governing distinction, and the one this file exists to enforce:
//
//   - A HISTORY field is a fact about what HAPPENED. The CutReport is a good source for it forever.
//   - A PER-TIER BYTE VERDICT is an OBSERVATION OF THE TIERS at a moment, and may NEVER be read from a
//     CutReport later. A formatter that reprinted last month's snapshot as today's receipt would be
//     the whole dry-run mistake this design rejects, wearing a letterhead.
//
// So criterion 22's rail is not a code inspection: it resurfaces a byte after the cut and requires the
// re-derived verdict to FLIP while the CutReport's copy does not. Only the DISAGREEMENT proves the
// re-issue probed rather than formatted — a re-issue that read the CutReport would pass the second
// assertion and fail the first.

import { describe, expect, it } from "vitest";
import { MemoryBackend } from "../../src/store/memory.js";
import { RECEIPT_FIELDS, graveyardCompleteness } from "../../src/gateway/slate.js";
import { FERN, observed } from "../spike/garden.js";
import {
  BEFORE_DEADLINE,
  OP,
  OP_SEED,
  bootSlateStore,
  declareContainer,
  standSlate,
  strike,
} from "./slating.js";

/** The §29.7 receipt's field list, enumerated HERE so the rail and the source must agree. */
const HISTORY = [
  "window",
  "version",
  "memberCount",
  "requestedBy",
  "requestedByForm",
  "requestedAt",
  "deadline",
  "closes",
  "tombstone",
  "spokenBy",
  "priorTombstone",
  "citations",
  "duplicates",
  "affected",
  "resurfacing",
  "graveyard",
  "notReached",
] as const;
const OBSERVATION = ["tiers", "presentAgain", "forgiven"] as const;

describe("T64 criterion 16 — the CutReport carries every receipt HISTORY field", () => {
  it("the partition is asserted, and every byte verdict is on the OBSERVATION side", () => {
    // The source's own table must be exactly this partition — a field that drifted to the wrong side
    // would green-light exactly the formatter criterion 22 forbids.
    const declared = new Map(RECEIPT_FIELDS.map((f) => [f.field, f.side]));
    expect([...declared.keys()].sort()).toEqual([...HISTORY, ...OBSERVATION].sort());
    for (const field of HISTORY) expect(declared.get(field)).toBe("history");
    for (const field of OBSERVATION) expect(declared.get(field)).toBe("observation");
    // EVERY per-tier byte verdict is an observation. `tiers` is the only field carrying one, and it is
    // named on the observation side; nothing on the history side may be a byte verdict.
    expect(declared.get("tiers")).toBe("observation");
    expect((HISTORY as readonly string[]).includes("tiers")).toBe(false);
  });

  it("the partition is DECIDABLE from a real report, not a literal against itself", async () => {
    // The assertion above compares two lists in this file, which cannot see a field the SOURCE
    // classifies wrongly or forgets. This one reads a real CutReport and a real Receipt and requires
    // every field carrying a per-tier byte verdict to be on the observation side — and every key of
    // either object to be classified at all, so a NEW field cannot arrive unpartitioned.
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    const side = new Map(RECEIPT_FIELDS.map((f) => [f.field, f.side]));

    // Anything shaped like a per-tier verdict must be classified OBSERVATION, found by shape.
    const verdictBearing = (row: Record<string, unknown>): string[] =>
      Object.entries(row)
        .filter(
          ([, v]) =>
            Array.isArray(v) &&
            v.length > 0 &&
            typeof v[0] === "object" &&
            v[0] !== null &&
            "tier" in (v[0] as object) &&
            "holds" in (v[0] as object),
        )
        .map(([k]) => k);
    const found = [
      ...verdictBearing(report.members[0] as unknown as Record<string, unknown>),
      ...verdictBearing(receipt.members[0] as unknown as Record<string, unknown>),
    ];
    expect(found.length).toBeGreaterThan(0); // a rail that found none would prove nothing
    for (const field of found) expect(side.get(field)).toBe("observation");

    // And the report NAMES its own observation side, so a formatter reads it rather than guessing.
    expect([...report.observationOnly].sort()).toEqual(
      RECEIPT_FIELDS.filter((f) => f.side === "observation")
        .map((f) => f.field)
        .sort(),
    );
    await gw.close();
  });

  it("every HISTORY field is present in the CutReport or derivable from DURABLE GROUND", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const other = observed(FERN, "height", 31, 1001, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, other, bystander]);
    // A watcher container so `affected` is non-empty; the member `other` is erased by hand mid-window
    // so `priorTombstone` is non-empty; a retraction among the members so `resurfacing` is non-empty.
    const target = observed(FERN, "tag", "moss", 1200, OP_SEED);
    await gw.append([target]);
    const retraction = strike(target.id, 1300);
    await gw.append([retraction]);
    await standSlate(gw, {
      container: "container:tenant-view",
      members: [member],
      closes: [],
      ts: 51_000,
    });
    const stood = await standSlate(gw, {
      container: "container:slate:full",
      members: [member, other, retraction],
      closes: ["egress", "cite"],
      reason: "a subject request",
      requestedBy: "subject:42",
      requestedByForm: "sealed",
      ts: 52_000,
    });
    const byHand = await gw.erase(other.id);

    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });

    // Present in the CutReport, and NON-VACUOUS: no history field requires information that existed
    // only during the cut.
    expect(report.window).toEqual({ opened: report.requestedAt, cutAt: BEFORE_DEADLINE });
    expect(report.version).toBe(stood.version);
    expect(report.memberCount).toBe(3);
    expect(report.requestedBy).toBe("subject:42");
    expect(report.requestedByForm).toBe("sealed");
    expect(report.deadline).toBeGreaterThan(report.requestedAt);
    expect([...report.closes].sort()).toEqual(["cite", "egress"]);
    expect(report.graveyard).toBe(gw.graveyards()[0]!.id);
    expect(report.priorTombstone).toEqual([{ member: other.id, tombstone: byHand.tombstone }]);
    expect(report.resurfacing).toEqual([target.id]);
    expect(report.affected).toEqual(["container:tenant-view"]);
    expect(report.notReached).toEqual([]);
    for (const m of report.members) {
      expect(m.tombstone).toBeTruthy();
      expect(m.spokenBy).toBe(OP);
      expect(Array.isArray(m.citations)).toBe(true);
    }
    expect(report.observationOnly).toEqual([...OBSERVATION]);

    // DERIVABLE FROM DURABLE GROUND, with the CutReport thrown away: a re-derived receipt reaches the
    // same history from the graveyard + the tombstones + the frozen version alone.
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(receipt.version).toBe(report.version);
    expect(receipt.memberCount).toBe(report.memberCount);
    expect(receipt.window).toEqual(report.window);
    expect([...receipt.closes].sort()).toEqual([...report.closes].sort());
    expect(receipt.requestedBy).toBe(report.requestedBy);
    expect(receipt.requestedByForm).toBe(report.requestedByForm);
    expect(receipt.priorTombstone).toEqual(report.priorTombstone);
    expect(receipt.completeness.holds).toBe(true);
    expect(receipt.nonClaim.length).toBeGreaterThan(0);
    // Two-sided: the bystander and the revived target survived a three-member cut.
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await gw.backend.holds(target.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 — the RE-ISSUE path must confess what the CUT was allowed to refuse", () => {
  it("a wall that is neither attached nor covered reads `unproven`, and the non-claim names it", async () => {
    // `cutImpl` refuses on `walls.faults`; a RE-ISSUE cannot refuse, so it must confess. The two sets
    // are DISJOINT — `kept` is detach-covered, `faults` is neither attached nor covered — so a reader
    // consulting only `kept` makes a faulted tier appear NOWHERE, which reads as "not a tier" rather
    // than `unproven`. That is H9 in the artifact whose whole purpose is not overclaiming.
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    // Clean first: no wall, so nothing is unproven and nothing is disclaimed.
    const clean = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(clean.members[0]!.tiers.every((v) => v.holds === false)).toBe(true);
    expect(clean.nonClaim.join("\n")).not.toMatch(/COULD NOT BE REACHED/);

    // Then a declared wall appears in the table and is never attached — the post-restart state.
    await gw.append([
      declareContainer({ container: "container:cold", trust: "curated", posture: "wall" }, 60_000),
    ]);
    const reissued = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    const cold = reissued.members[0]!.tiers.find((v) => v.tier === "container:cold")!;
    expect(cold).toBeDefined();
    expect(cold.holds).not.toBe(false); // the inequality is the assertion — never collapse the tri-state
    expect(cold.holds).toBe("unproven");
    expect(reissued.nonClaim.join("\n")).toMatch(
      /"container:cold"[\s\S]*COULD NOT BE REACHED|COULD NOT BE REACHED[\s\S]*container:cold/,
    );
    // Two-sided: the primary's verdict is still a real `false`, so the confession did not smear
    // uncertainty over a tier that WAS examined.
    expect(reissued.members[0]!.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });

  it("an UNREADABLE frozen set is not a clean one — the arithmetic fails closed", async () => {
    // `members.length > 0` used to stand inside `holds`, which is the H7 shape wearing a guard clause:
    // lose the membership Term and the walk finds no ids, so "every member is accounted for" would be
    // vacuously true over a set the store can no longer read. Deleting that clause left the whole suite
    // green, so the verdict is now its own field.
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(graveyardCompleteness(gw.reactor, OP, report.graveyard).readable).toBe(true);

    // The Term row is LOST at the store — the only route left, since `eraseImpl` refuses to erase a
    // standing slate's pinned Term and the cut refuses it as a member. A restore gone wrong, a §25
    // quarantined row: the states this check exists to be honest about.
    await gw.backend.purge([stood.membershipAt]);
    await gw.reseat();

    const check = graveyardCompleteness(gw.reactor, OP, report.graveyard);
    expect(check.readable).toBe(false);
    expect(check.unreadable).toMatch(/resolves to nothing here/);
    expect(check.holds).toBe(false);
    expect(check.cutCompleted).toBe(false);
    expect(check.members).toEqual([]);
    // And the store's forgiveness instrument says the same rather than "nothing forgiven".
    const health = await gw.health(BEFORE_DEADLINE);
    expect(health.forgiven.unreadable).toEqual([report.graveyard]);
    expect(health.forgiven.count).toBe(0);
    await gw.close();
  });
});

describe("T64 criterion 22 — the receipt's byte verdicts are RE-PROBED, never reprinted", () => {
  it("a resurfaced byte FLIPS the re-derived verdict while the CutReport's copy does not move", async () => {
    const backend = new MemoryBackend();
    const gw = await bootSlateStore(backend);
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });

    const stored = report.members[0]!.tiers.find((v) => v.tier === "primary")!;
    expect(stored.holds).toBe(false);
    const clean = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(clean.members[0]!.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);

    // THE RESTORED-BACKUP SHAPE: the bytes come back on one tier, underneath the reactor, exactly as a
    // restore would put them there. The tombstone still stands, so nothing about the PROMISE changed —
    // only the world did.
    await backend.append([member]);
    expect(await backend.holds(member.id)).toBe(true);

    const reissued = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    // The re-derived verdict FLIPS...
    expect(reissued.members[0]!.tiers.find((v) => v.tier === "primary")!.holds).toBe(true);
    // ...while the CutReport's stored copy does NOT. Only the disagreement proves the re-issue probed
    // rather than formatted: a re-issue that read the CutReport would pass the second assertion and
    // fail the first.
    expect(report.members[0]!.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(stored.holds).toBe(false);
    // The store's own instrument agrees with the receipt, not with the CutReport.
    const health = await gw.health(BEFORE_DEADLINE);
    expect(health.status).toBe("settling");
    expect(health.erasure.outstanding).toEqual([member.id]);
    // Two-sided: the bystander is not swept up by the resurfacing report either way.
    expect(reissued.members.map((m) => m.member)).toEqual([member.id]);
    expect(await backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 criterion 23 — forgiveness, re-federated: the store can still see the id came back", () => {
  it("reports FORGIVEN with its strike id AND present again, and health().forgiven counts it", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const tombstone = report.members[0]!.tombstone;

    const forgiveness = strike(tombstone, 80_000);
    await gw.append([forgiveness]);
    // `federateImpl` now ADMITS the id, because it is no longer dead — that is lawful, and it is
    // exactly what makes the third fact necessary.
    const fed = await gw.federate([member], { admit: () => true });
    expect(fed.accepted).toBe(1);

    // OBJECT LEVEL: the id resolves LIVE through a Schema again.
    const res = await gw.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((res.data as { plant: { height: number } }).plant.height).toBe(30);

    const health = await gw.health(BEFORE_DEADLINE);
    // THE HOLE, STATED: striking the tombstone removed the id from `readTombstones`, so it left
    // `health().erasure.promised` ENTIRELY and the byte debt reads clean. Nothing in §11's instrument
    // can see a forgiven-and-returned id.
    expect(health.erasure.promised).toBe(0);
    expect(health.erasure.outstanding).toEqual([]);
    // AND THE SECTION THAT CLOSES IT — sourced from the graveyard's frozen `version` rather than from
    // `readTombstones`, which is the only durable list of ids the store ever promised to forget.
    expect(health.forgiven).toEqual({
      count: 1,
      present: 1,
      ids: [member.id],
      unreadable: [],
    });
    // Lawful, not debt: `status` is unmoved by a forgiveness, exactly as it is by a lapsed slate.
    expect(health.status).toBe("ok");

    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    const row = receipt.members[0]!;
    // "Forgiven at <strike id>, and present again as of <issue time>" is the sentence. A receipt that
    // said only FORGIVEN would be technically true and communicate the opposite of what happened,
    // because the reader wants to know whether the data is THERE.
    expect(row.forgiven).toBe(forgiveness.id);
    expect(row.tombstone).toBeUndefined();
    expect(row.presentAgain).toBe(true);
    expect(row.tiers.find((v) => v.tier === "primary")!.holds).toBe(true);
    // The graveyard's arithmetic reports the forgiveness rather than reading as an incomplete cut:
    // it records an event that HAPPENED, and forgiveness is a later event.
    const check = graveyardCompleteness(gw.reactor, OP, report.graveyard);
    expect(check.forgiven).toEqual([{ member: member.id, strike: forgiveness.id }]);
    expect(check.missing).toEqual([]);
    // THE TWO VERDICTS COME APART HERE, and that is the point: §29.6's sentence read literally is now
    // FALSE (no surviving tombstone covers this member), while the CUT still completed and nothing is
    // unexplained. One boolean holding both would make the first lawful forgiveness indistinguishable
    // from an abandoned cut — the same collapse this file refuses for a byte verdict, one layer up.
    expect(check.holds).toBe(false);
    expect(check.cutCompleted).toBe(true);
    expect(check.readable).toBe(true);
    // Two-sided: the bystander was never in any of it.
    expect(receipt.members.map((m) => m.member)).toEqual([member.id]);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});
