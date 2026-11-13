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

const HISTORY = [
  "window",
  "version",
  "memberCount",
  "requestedBy",
  "requestedByForm",
  "requestedAt",
  "deadline",
  "closes",
  "erasure",
  "spokenBy",
  "priorErasure",
  "citations",
  "duplicates",
  "affected",
  "resurfacing",
  "graveyard",
  "notReached",
] as const;
const OBSERVATION = ["tiers", "presentAgain", "negated"] as const;

describe("T64 criterion 16 — the CutReport carries every receipt HISTORY field", () => {
  it("the partition is asserted, and every byte verdict is on the OBSERVATION side", () => {
    const declared = new Map(RECEIPT_FIELDS.map((f) => [f.field, f.side]));
    expect([...declared.keys()].sort()).toEqual([...HISTORY, ...OBSERVATION].sort());
    for (const field of HISTORY) expect(declared.get(field)).toBe("history");
    for (const field of OBSERVATION) expect(declared.get(field)).toBe("observation");
    expect(declared.get("tiers")).toBe("observation");
    expect((HISTORY as readonly string[]).includes("tiers")).toBe(false);
  });

  it("the partition is DECIDABLE from a real report, not a literal against itself", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    const side = new Map(RECEIPT_FIELDS.map((f) => [f.field, f.side]));

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
    expect(found.length).toBeGreaterThan(0);
    for (const field of found) expect(side.get(field)).toBe("observation");

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

    expect(report.window).toEqual({ opened: report.requestedAt, cutAt: BEFORE_DEADLINE });
    expect(report.version).toBe(stood.version);
    expect(report.memberCount).toBe(3);
    expect(report.requestedBy).toBe("subject:42");
    expect(report.requestedByForm).toBe("sealed");
    expect(report.deadline).toBeGreaterThan(report.requestedAt);
    expect([...report.closes].sort()).toEqual(["cite", "egress"]);
    expect(report.graveyard).toBe(gw.graveyards()[0]!.id);
    expect(report.priorErasure).toEqual([{ member: other.id, erasure: byHand.erasure }]);
    expect(report.resurfacing).toEqual([target.id]);
    expect(report.affected).toEqual(["container:tenant-view"]);
    expect(report.notReached).toEqual([]);
    for (const m of report.members) {
      expect(m.erasure).toBeTruthy();
      expect(m.spokenBy).toBe(OP);
      expect(Array.isArray(m.citations)).toBe(true);
    }
    expect(report.observationOnly).toEqual([...OBSERVATION]);

    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(receipt.version).toBe(report.version);
    expect(receipt.memberCount).toBe(report.memberCount);
    expect(receipt.window).toEqual(report.window);
    expect([...receipt.closes].sort()).toEqual([...report.closes].sort());
    expect(receipt.requestedBy).toBe(report.requestedBy);
    expect(receipt.requestedByForm).toBe(report.requestedByForm);
    expect(receipt.priorErasure).toEqual(report.priorErasure);
    expect(receipt.completeness.holds).toBe(true);
    expect(receipt.nonClaim.length).toBeGreaterThan(0);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await gw.backend.holds(target.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 — the CLOSURE SET the receipt reports is the one that was in force", () => {
  it("a ONE-closure cut records that closure, and a `none` cut records none", async () => {
    const gw = await bootSlateStore();
    const one = observed(FERN, "height", 30, 1000, OP_SEED);
    const zero = observed(FERN, "height", 31, 1001, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([one, zero, bystander]);

    const single = await standSlate(gw, {
      container: "container:slate:one",
      members: [one],
      closes: ["egress"],
      ts: 50_000,
    });
    const singleCut = await gw.cut(single.container, { now: BEFORE_DEADLINE });
    expect(singleCut.closes).toEqual(["egress"]);
    expect(gw.graveyards().find((g) => g.id === singleCut.graveyard)!.closes).toEqual(["egress"]);
    const singleReceipt = await gw.receipt(singleCut.graveyard, { now: BEFORE_DEADLINE });
    expect(singleReceipt.closes).toEqual(["egress"]);

    const none = await standSlate(gw, {
      container: "container:slate:none",
      members: [zero],
      closes: [],
      ts: 60_000,
    });
    const noneCut = await gw.cut(none.container, { now: BEFORE_DEADLINE });
    expect(noneCut.closes).toEqual([]);
    expect(gw.graveyards().find((g) => g.id === noneCut.graveyard)!.closes).toEqual([]);
    const noneReceipt = await gw.receipt(noneCut.graveyard, { now: BEFORE_DEADLINE });
    expect(noneReceipt.closes).toEqual([]);
    expect(
      gw.reactor
        .get(noneCut.graveyard)!
        .claims.pointers.filter((x) => x.role === "closes")
        .map((x) => (x.target as { value: string }).value),
    ).toEqual(["none"]);

    expect(await gw.backend.holds(bystander.id)).toBe(true);
    const tags = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tags.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    await gw.close();
  });
});

describe("T64 — the RE-ISSUE path must confess what the CUT was allowed to refuse", () => {
  it("a wall that is neither attached nor covered reads `unproven`, and the non-claim names it", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const clean = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(clean.members[0]!.tiers.every((v) => v.holds === false)).toBe(true);
    expect(clean.nonClaim.join("\n")).not.toMatch(/COULD NOT BE REACHED/);

    await gw.append([
      declareContainer(
        { container: "container:cold", trust: "curated", posture: "separate" },
        60_000,
      ),
    ]);
    const reissued = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    const cold = reissued.members[0]!.tiers.find((v) => v.tier === "container:cold")!;
    expect(cold).toBeDefined();
    expect(cold.holds).not.toBe(false);
    expect(cold.holds).toBe("unproven");
    expect(reissued.nonClaim.join("\n")).toMatch(
      /"container:cold"[\s\S]*COULD NOT BE REACHED|COULD NOT BE REACHED[\s\S]*container:cold/,
    );
    expect(reissued.members[0]!.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });

  it("an UNREADABLE frozen set is not a clean one — the arithmetic fails closed", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(graveyardCompleteness(gw.reactor, gw.validityNow(), OP, report.graveyard).readable).toBe(
      true,
    );

    await gw.backend.purge([stood.membershipAt]);
    await gw.reseat();

    const check = graveyardCompleteness(gw.reactor, gw.validityNow(), OP, report.graveyard);
    expect(check.readable).toBe(false);
    expect(check.unreadable).toMatch(/resolves to nothing here/);
    expect(check.holds).toBe(false);
    expect(check.cutCompleted).toBe(false);
    expect(check.members).toEqual([]);
    const health = await gw.health(BEFORE_DEADLINE);
    expect(health.negated.unreadable).toEqual([report.graveyard]);
    expect(health.negated.count).toBe(0);
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

    await backend.append([member]);
    expect(await backend.holds(member.id)).toBe(true);

    const reissued = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    expect(reissued.members[0]!.tiers.find((v) => v.tier === "primary")!.holds).toBe(true);
    expect(report.members[0]!.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(stored.holds).toBe(false);
    const health = await gw.health(BEFORE_DEADLINE);
    expect(health.status).toBe("settling");
    expect(health.erasure.outstanding).toEqual([member.id]);
    expect(reissued.members.map((m) => m.member)).toEqual([member.id]);
    expect(await backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});

describe("an erasure negated after a cut: the id stays refused", () => {
  it("reports the negation with its negation id, refuses the re-sent id, and health().negated counts it", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const erasure = report.members[0]!.erasure;

    const negation = strike(erasure, 80_000);
    await gw.append([negation]);
    const fed = await gw.federate([member], { admit: () => true });
    expect(fed.accepted).toBe(0);

    const res = await gw.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((res.data as { plant: { height: number | null; tag: string[] } }).plant).toEqual({
      height: null,
      tag: ["shade"],
    });

    const health = await gw.health(BEFORE_DEADLINE);
    expect(health.erasure.promised).toBe(0);
    expect(health.erasure.outstanding).toEqual([]);
    expect(health.negated).toEqual({
      count: 1,
      present: 0,
      ids: [member.id],
      unreadable: [],
    });
    expect(health.status).toBe("ok");

    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    const row = receipt.members[0]!;
    expect(row.negated).toBe(negation.id);
    expect(row.erasure).toBeUndefined();
    expect(row.presentAgain).toBe(false);
    expect(row.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);
    const check = graveyardCompleteness(gw.reactor, gw.validityNow(), OP, report.graveyard);
    expect(check.negated).toEqual([{ member: member.id, negation: negation.id }]);
    expect(check.missing).toEqual([]);
    expect(check.holds).toBe(false);
    expect(check.cutCompleted).toBe(true);
    expect(check.readable).toBe(true);
    expect(receipt.members.map((m) => m.member)).toEqual([member.id]);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    await gw.close();
  });
});
