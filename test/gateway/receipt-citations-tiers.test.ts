import { describe, expect, it } from "vitest";
import type { Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { arrivalClaims } from "../../src/federation/channel.js";
import { FERN, observed } from "../spike/garden.js";
import {
  BEFORE_DEADLINE,
  OP_SEED,
  bootSlateStore,
  declareContainer,
  standSlate,
} from "./slating.js";

const arrivalStamp = (receiver: Gateway, targetId: string, ts: number): Delta =>
  receiver.signer!.sign(
    arrivalClaims(
      { channel: "peer-echo", from: "peer://echo", arrived: [targetId] },
      receiver.operatorAuthor!,
      ts,
    ),
  );

const holdsInReactor = (gw: { reactor: { snapshot(): Iterable<Delta> } }, id: string): boolean =>
  [...gw.reactor.snapshot()].some((d) => d.id === id);

describe("T216 (a) — a POOL-resident citation is enumerated and named to its pool", () => {
  it("an erase whose target is cited only by a pool stamp lists it under the pool tier", async () => {
    const gw = await bootSlateStore();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([target, bystander]);

    const pool = await gw.openQuarantine({ backend: new MemoryBackend() });
    expect(await pool.gateway.backend.holds(target.id)).toBe(true);

    const stamp = arrivalStamp(pool.gateway, target.id, 2000);
    await pool.gateway.append([stamp]);
    expect(holdsInReactor(pool.gateway, stamp.id)).toBe(true);

    const done = await gw.erase(target.id);

    expect(done.citations).toContain(stamp.id);
    const poolTier = done.citationTiers.find((t) => t.tier === "pool:1");
    expect(poolTier).toBeDefined();
    expect(poolTier!.citations).toContain(stamp.id);
    expect(done.citationTiers.some((t) => t.tier === "primary")).toBe(true);

    expect(await pool.gateway.backend.holds(target.id)).toBe(false);
    expect(holdsInReactor(pool.gateway, stamp.id)).toBe(true);
    expect(await pool.gateway.backend.holds(bystander.id)).toBe(true);
    expect(done.citations).not.toContain(bystander.id);
    expect(done.citationTiers.every((t) => !t.citations.includes(bystander.id))).toBe(true);

    await pool.drop();
    await gw.close();
  });
});

describe("T216 (b) — a PRIMARY-resident citation still enumerates (no regression)", () => {
  it("an erase whose target is cited in the primary lists it under the primary tier", async () => {
    const gw = await bootSlateStore();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([target, bystander]);
    const cite = arrivalStamp(gw, target.id, 2000);
    await gw.append([cite]);

    const done = await gw.erase(target.id);

    expect(done.citations).toContain(cite.id);
    const primaryTier = done.citationTiers.find((t) => t.tier === "primary");
    expect(primaryTier).toBeDefined();
    expect(primaryTier!.citations).toContain(cite.id);
    expect(done.citationTiers.map((t) => t.tier)).toEqual(["primary"]);

    expect(holdsInReactor(gw, cite.id)).toBe(true);
    expect(done.citations).not.toContain(bystander.id);
    expect(done.citations).not.toContain(done.erasure);

    await gw.close();
  });
});

describe("T216 (c) — the slate receipt's citations name the same tier set as the byte verdict", () => {
  it("re-issue enumerates the pool stamp and the tier sets agree, with correct attribution", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);

    const pool = await gw.openQuarantine({ backend: new MemoryBackend() });
    expect(await pool.gateway.backend.holds(member.id)).toBe(true);
    const stamp = arrivalStamp(pool.gateway, member.id, 2000);
    await pool.gateway.append([stamp]);

    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });

    const cutMember = report.members.find((m) => m.member === member.id)!;
    expect(cutMember.citationTiers.some((t) => t.tier === "pool:1")).toBe(true);
    expect(cutMember.citationTiers.find((t) => t.tier === "pool:1")!.citations).toContain(stamp.id);

    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    const row = receipt.members.find((m) => m.member === member.id)!;

    expect(row.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(row.tiers.find((v) => v.tier === "pool:1")!.holds).toBe(false);

    expect([...row.citationTiers].map((t) => t.tier).sort()).toEqual(
      [...row.tiers].map((v) => v.tier).sort(),
    );
    expect(row.citations).toContain(stamp.id);
    expect(row.citationTiers.find((t) => t.tier === "pool:1")!.citations).toContain(stamp.id);
    expect(row.citationTiers.find((t) => t.tier === "primary")!.citations).not.toContain(stamp.id);

    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await pool.gateway.backend.holds(bystander.id)).toBe(true);
    expect(row.citations).not.toContain(bystander.id);
    expect(row.citationTiers.every((t) => !t.citations.includes(bystander.id))).toBe(true);

    await pool.drop();
    await gw.close();
  });

  it("a WALL is named by the byte verdict but never by the citation enumeration", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });

    await gw.append([
      declareContainer(
        { container: "container:cold", trust: "curated", posture: "separate" },
        60_000,
      ),
    ]);
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    const row = receipt.members.find((m) => m.member === member.id)!;

    const wall = row.tiers.find((v) => v.tier === "container:cold");
    expect(wall).toBeDefined();
    expect(wall!.holds).toBe("unproven");
    expect(row.citationTiers.some((t) => t.tier === "container:cold")).toBe(false);
    expect(row.tiers.some((v) => v.tier === "primary")).toBe(true);
    expect(row.citationTiers.some((t) => t.tier === "primary")).toBe(true);
    const verdictTiers = new Set(row.tiers.map((v) => v.tier));
    expect(row.citationTiers.every((t) => verdictTiers.has(t.tier))).toBe(true);
    expect(row.citationTiers.length).toBeLessThan(row.tiers.length);

    await gw.close();
  });

  it("a pool AND a wall together: the enumeration spans the pool but still omits the wall", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);

    const pool = await gw.openQuarantine({ backend: new MemoryBackend() });
    const stamp = arrivalStamp(pool.gateway, member.id, 2000);
    await pool.gateway.append([stamp]);

    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });

    await gw.append([
      declareContainer(
        { container: "container:cold", trust: "curated", posture: "separate" },
        60_000,
      ),
    ]);
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    const row = receipt.members.find((m) => m.member === member.id)!;

    expect(row.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(row.tiers.find((v) => v.tier === "pool:1")!.holds).toBe(false);
    expect(row.tiers.find((v) => v.tier === "container:cold")!.holds).toBe("unproven");

    expect([...row.citationTiers].map((t) => t.tier).sort()).toEqual(["pool:1", "primary"]);
    expect(row.citationTiers.some((t) => t.tier === "container:cold")).toBe(false);

    expect(row.citations).toContain(stamp.id);
    expect(row.citationTiers.find((t) => t.tier === "pool:1")!.citations).toContain(stamp.id);

    const verdictTiers = new Set(row.tiers.map((v) => v.tier));
    expect(row.citationTiers.every((t) => verdictTiers.has(t.tier))).toBe(true);
    expect(row.citationTiers.length).toBe(2);
    expect(row.tiers.length).toBe(3);

    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await pool.gateway.backend.holds(bystander.id)).toBe(true);
    expect(row.citations).not.toContain(bystander.id);
    expect(row.citationTiers.every((t) => !t.citations.includes(bystander.id))).toBe(true);

    await pool.drop();
    await gw.close();
  });
});
