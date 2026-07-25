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
import { BEFORE_DEADLINE, OP, OP_SEED, bootSlateStore, standSlate, strike } from "./slating.js";

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
    expect(health.forgiven).toEqual({ count: 1, present: 1, ids: [member.id] });
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
    // Two-sided: the bystander was never in any of it.
    expect(receipt.members.map((m) => m.member)).toEqual([member.id]);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});
