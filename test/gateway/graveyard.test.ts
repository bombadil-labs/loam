import { describe, expect, it } from "vitest";
import { erasureSlate } from "../../src/gateway/erase.js";
import { standingErasures, erasureTarget } from "../../src/gateway/erase-law.js";
import { graveyardCompleteness } from "../../src/gateway/slate.js";
import { readFrozenTerm } from "../../src/gateway/slate-law.js";
import { FERN, observed } from "../spike/garden.js";
import { BEFORE_DEADLINE, OP, OP_SEED, bootSlateStore, standSlate } from "./slating.js";

describe("T64 criterion 12 — the graveyard is durable, joinable, and its completeness is arithmetic", () => {
  it("carries every history field, joins its erasures, and computes TRUE from the ground alone", async () => {
    const gw = await bootSlateStore();
    const members = [
      observed(FERN, "height", 30, 1000, OP_SEED),
      observed(FERN, "height", 31, 1001, OP_SEED),
    ];
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([...members, bystander]);
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

    for (const m of members) {
      expect(await gw.backend.holds(m.id)).toBe(false);
      const verdicts = report.members.find((r) => r.member === m.id)!.tiers;
      expect(verdicts.length).toBeGreaterThan(0);
      expect(verdicts.map((v) => v.tier)).toContain("primary");
      expect(verdicts.every((v) => v.holds === false)).toBe(true);
    }
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    const tags = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tags.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);

    const graves = gw.graveyards();
    expect(graves).toHaveLength(1);
    const grave = graves[0]!;
    expect(grave.id).toBe(report.graveyard);
    expect(grave.container).toBe(stood.container);
    expect(grave.record).toBe(stood.record);
    expect(gw.reactor.get(grave.record)).toBeDefined();
    expect(grave.version).toBe(stood.version);
    expect(grave.memberCount).toBe(2);
    expect(grave.opened).toBe(report.window.opened);
    expect(grave.cutAt).toBe(BEFORE_DEADLINE);
    expect([...grave.closes].sort()).toEqual(["cite", "egress"]);
    expect(grave.affected).toEqual([watcher.container]);
    expect(grave.priorErasure).toEqual([]);

    const joined = standingErasures(gw.reactor, gw.validityNow(), OP).filter(
      (t) => erasureSlate(t.claims) === stood.container,
    );
    expect(joined.map((t) => erasureTarget(t.claims)).sort()).toEqual(
      members.map((m) => m.id).sort(),
    );

    const check = graveyardCompleteness(gw.reactor, gw.validityNow(), OP, grave.id);
    expect([...check.members].sort()).toEqual(members.map((m) => m.id).sort());
    expect(check.missing).toEqual([]);
    expect(check.negated).toEqual([]);
    expect(check.holds).toBe(true);

    const frozen = readFrozenTerm(gw.reactor, grave.membershipAt);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) throw new Error(frozen.why);
    expect([...frozen.ids].sort()).toEqual(members.map((m) => m.id).sort());
    await gw.close();
  });

  it("a walk that finds no members is NOT a proof — `holds` is false on an empty set", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    const tags = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tags.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    const nothing = graveyardCompleteness(
      gw.reactor,
      gw.validityNow(),
      OP,
      `${report.graveyard.slice(0, -2)}zz`,
    );
    expect(nothing.members).toEqual([]);
    expect(nothing.holds).toBe(false);
    expect(nothing.readable).toBe(false);
    const real = graveyardCompleteness(gw.reactor, gw.validityNow(), OP, report.graveyard);
    expect(real.holds).toBe(true);
    expect(real.readable).toBe(true);
    expect(real.members).toEqual([member.id]);
    expect(await gw.backend.holds(member.id)).toBe(false);
    await gw.close();
  });
});

describe("T64 criterion 13 — the affected set was frozen PRE-PURGE, provably", () => {
  it("the graveyard's affected set is non-empty while the same intersection now reads EMPTY", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
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

    expect(gw.containerScope({ containers: [watcher.container] })).toEqual([]);
    expect(gw.containers().containers.get(watcher.container)).toBeDefined();
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});
