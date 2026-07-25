// T64 (SPEC §29.6) — THE GRAVEYARD: the erasure EVENT, durable and joinable, whose completeness is
// ARITHMETIC rather than narrative.
//
// Criteria 12 and 13. The sentence under test:
//
//   > Every member of the frozen `version` has a surviving tombstone, and that tombstone either cites
//   > this slate or is named for that member in the graveyard's `prior-tombstone` list.
//
// It is checkable at any later date FROM DURABLE GROUND ALONE — no observation of the tiers, no memory
// of the cut. That is the difference between a narrative and a proof, and it is why the graveyard cites
// tombstones rather than replacing them: `readTombstones` stays the single per-id law, and "which
// tombstones belong to this graveyard" is a JOIN, so the record is one small delta whether the cut had
// four members or forty thousand.
//
// THE HOLLOW-RAIL QUESTION, asked of this file: a completeness walk that returned NOTHING would satisfy
// "no missing members" vacuously, so every rail here asserts the member COUNT before it asserts the
// verdict, and the criterion-12 rail asserts an EMPTY `prior-tombstone` explicitly so criterion 19's
// exception cannot hide inside the clean case.

import { describe, expect, it } from "vitest";
import { survivingTombstones, tombstoneSlate, tombstoneTarget } from "../../src/gateway/erase.js";
import { graveyardCompleteness, readFrozenTerm } from "../../src/gateway/slate.js";
import { FERN, observed } from "../spike/garden.js";
import { BEFORE_DEADLINE, OP, OP_SEED, bootSlateStore, standSlate } from "./slating.js";

describe("T64 criterion 12 — the graveyard is durable, joinable, and its completeness is arithmetic", () => {
  it("carries every history field, joins its tombstones, and computes TRUE from the ground alone", async () => {
    const gw = await bootSlateStore();
    const members = [
      observed(FERN, "height", 30, 1000, OP_SEED),
      observed(FERN, "height", 31, 1001, OP_SEED),
    ];
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([...members, bystander]);
    // A second container whose scope INTERSECTS the condemned set, so the affected set is real.
    const stood = await standSlate(gw, {
      members,
      closes: ["egress", "cite"],
      reason: "a subject request",
    });
    const watcher = await standSlate(gw, {
      container: "container:tenant-view",
      members,
      closes: [],
      ts: 51_000,
    });

    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });

    // Every member is byte-gone on every tier and every attached pool.
    for (const m of members) {
      expect(await gw.backend.holds(m.id)).toBe(false);
      const verdicts = report.members.find((r) => r.member === m.id)!.tiers;
      expect(verdicts.every((v) => v.holds === false)).toBe(true);
    }
    // TWO-SIDED: the named live bystander survived, at the bytes and through a Schema.
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    const tags = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tags.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);

    // The graveyard RESOLVES, carrying the whole event.
    const graves = gw.graveyards();
    expect(graves).toHaveLength(1);
    const grave = graves[0]!;
    expect(grave.id).toBe(report.graveyard);
    expect(grave.container).toBe(stood.container);
    expect(grave.record).toBe(stood.record); // the request provenance: who asked, when, why, deadline
    expect(gw.reactor.get(grave.record)).toBeDefined();
    expect(grave.version).toBe(stood.version); // the frozen condemned set
    expect(grave.memberCount).toBe(2);
    expect(grave.opened).toBe(report.window.opened);
    expect(grave.cutAt).toBe(BEFORE_DEADLINE);
    expect([...grave.closes].sort()).toEqual(["cite", "egress"]);
    expect(grave.affected).toEqual([watcher.container]);
    // THE CLEAN CASE SAYS SO EXPLICITLY — otherwise criterion 19's exception could hide right here.
    expect(grave.priorTombstone).toEqual([]);

    // Every tombstone carries its `slate` join.
    const joined = survivingTombstones(gw.reactor, OP).filter(
      (t) => tombstoneSlate(t.claims) === stood.container,
    );
    expect(joined.map((t) => tombstoneTarget(t.claims)).sort()).toEqual(
      members.map((m) => m.id).sort(),
    );

    // §29.6's ARITHMETIC, from durable ground alone: no probe, no CutReport.
    const check = graveyardCompleteness(gw.reactor, OP, grave.id);
    expect([...check.members].sort()).toEqual(members.map((m) => m.id).sort()); // a walk returning nothing FAILS here
    expect(check.missing).toEqual([]);
    expect(check.forgiven).toEqual([]);
    expect(check.holds).toBe(true);

    // And it is re-derivable from the STORE rather than from this process: the frozen version's ids
    // come back out of the published Term the graveyard names, which survived the cut.
    const frozen = readFrozenTerm(gw.reactor, grave.membershipAt)!;
    expect([...frozen.ids].sort()).toEqual(members.map((m) => m.id).sort());
    await gw.close();
  });

  it("a walk that finds no members is NOT a proof — `holds` is false on an empty set", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    // Ask about a graveyard nobody wrote: the arithmetic must answer FALSE rather than vacuously TRUE.
    const nothing = graveyardCompleteness(gw.reactor, OP, `${report.graveyard.slice(0, -2)}zz`);
    expect(nothing.members).toEqual([]);
    expect(nothing.holds).toBe(false);
    // And the real one still holds, so the negative rail is not just a broken lookup.
    expect(graveyardCompleteness(gw.reactor, OP, report.graveyard).holds).toBe(true);
    await gw.close();
  });
});

describe("T64 criterion 13 — the affected set was frozen PRE-PURGE, provably", () => {
  it("the graveyard's affected set is non-empty while the same intersection now reads EMPTY", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    // A tenant-facing container whose scope holds the member — declared through the ordinary slate
    // helper (a property container over a frozen id set) with `closes: none`, so it enforces nothing
    // and exists only to be INTERSECTED.
    const watcher = await standSlate(gw, {
      container: "container:tenant-view",
      members: [member],
      closes: [],
      ts: 51_000,
    });
    const stood = await standSlate(gw, {
      container: "container:slate:condemn",
      members: [member],
      closes: ["egress", "cite"],
      ts: 52_000,
    });
    expect(gw.containerScope({ containers: [watcher.container] }).map((d) => d.id)).toEqual([
      member.id,
    ]);

    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const grave = gw.graveyards()[0]!;
    expect(grave.affected).toEqual([watcher.container]);
    expect(report.affected).toEqual([watcher.container]);

    // THE ASSERTION THAT PROVES IT WAS COMPUTED RATHER THAN QUERIED: recomputing the same
    // intersection AFTER the cut reads EMPTY, because the members are gone and every intersection
    // now reads empty. A design that queried this at read time would report nothing forever.
    expect(gw.containerScope({ containers: [watcher.container] })).toEqual([]);
    // Two-sided: the watcher container itself still resolves — the cut narrowed the CONTENT of its
    // scope, and did not remove the tenant's container.
    expect(gw.containers().containers.get(watcher.container)).toBeDefined();
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});
