// T216 — the erasure receipt must enumerate dangling citations over EVERY tier the byte verdict
// walks, not the primary alone. Before this ticket both dangling-citation enumerations (the erase
// receipt's manifest in erase.ts and the slate receipt's citations in slate.ts) walked
// `gw.reactor.snapshot()` — the primary tier only — while the byte verdict (`tierVerdicts`) walked
// the primary PLUS every attached quarantine pool. So the receipt proved absence multi-tier and
// enumerated danglers single-tier: a surviving pool-resident delta pointing at the hole was invisible.
//
// T207 makes that state structural. A federated arrival lands a receiver-signed attestation in the
// channel's pool, and its `arrived` delta-refs name each accepted delta. Erase a delta that also
// arrived through a channel: the pool copy purges (the byte verdict reads clean), but the stamp
// survives — receiver-authored, its own id — and its pointer now dangles at the hole. The primary-only
// enumeration omitted it while a gather still served a signed delta pointing at the purged id.
//
// THE SHAPE IS FROZEN (T64): `citations` stays a bare `string[]` (slate-cut asserts it CONTAINS a bare
// id, slate-receipt asserts it is an array). Tier attribution rides an ADDITIVE `citationTiers` field
// beside it, never a replacement shape. These rails assert at BOTH levels: the flat id list (delta) and
// the per-tier attribution (the report a reader consults), and each is TWO-SIDED — the hole's citation
// is named AND a live bystander that does not dangle is not.

import { describe, expect, it } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { arrivalClaims } from "../../src/federation/channel.js";
import { FERN, observed } from "../spike/garden.js";
import {
  BEFORE_DEADLINE,
  OP,
  OP_SEED,
  bootSlateStore,
  declareContainer,
  standSlate,
} from "./slating.js";

// A T207 arrival attestation, receiver-signed, naming one accepted delta by a delta-ref. This is the
// exact stamp shape `channel.ts` writes into a channel's pool on every sync that accepts deltas — the
// structural pool-resident citation this ticket exists to enumerate.
const arrivalStamp = (targetId: string, ts: number): Delta =>
  signClaims(
    arrivalClaims({ channel: "peer-echo", from: "peer://echo", arrived: [targetId] }, OP, ts),
    OP_SEED,
  );

const holdsInReactor = (gw: { reactor: { snapshot(): Iterable<Delta> } }, id: string): boolean =>
  [...gw.reactor.snapshot()].some((d) => d.id === id);

describe("T216 (a) — a POOL-resident citation is enumerated and named to its pool", () => {
  it("an erase whose target is cited only by a pool stamp lists it under the pool tier", async () => {
    const gw = await bootSlateStore();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([target, bystander]);

    // The pool seeds from the primary, so it holds the target and the bystander byte-for-byte.
    const pool = await gw.openQuarantine({ backend: new MemoryBackend() });
    expect(await pool.gateway.backend.holds(target.id)).toBe(true);

    // The stamp lives ONLY in the pool — nothing in the primary points at the target. Reverting the
    // enumeration to the primary alone therefore cannot find it, which is what makes this rail bite.
    const stamp = arrivalStamp(target.id, 2000);
    await pool.gateway.append([stamp]);
    expect(holdsInReactor(pool.gateway, stamp.id)).toBe(true);

    const done = await gw.erase(target.id);

    // Delta level: the flat id list now spans the pool, so the stamp is in it.
    expect(done.citations).toContain(stamp.id);
    // Report level: the additive attribution names the pool the citation lives on.
    const poolTier = done.citationTiers.find((t) => t.tier === "pool:1");
    expect(poolTier).toBeDefined();
    expect(poolTier!.citations).toContain(stamp.id);
    // The primary tier is still named (empty here) so the tier set can be compared against the verdict.
    expect(done.citationTiers.some((t) => t.tier === "primary")).toBe(true);

    // Two-sided: the byte is gone on the pool, the stamp survives there, and the live bystander is
    // NOT enumerated as a dangler — an over-listing enumeration would name it too.
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
    // A primary-resident delta pointing at the target — the danger the manifest has always enumerated.
    const cite = arrivalStamp(target.id, 2000);
    await gw.append([cite]);

    const done = await gw.erase(target.id);

    expect(done.citations).toContain(cite.id);
    const primaryTier = done.citationTiers.find((t) => t.tier === "primary");
    expect(primaryTier).toBeDefined();
    expect(primaryTier!.citations).toContain(cite.id);
    // No pool attached, so the tier set is the primary alone — the widening did not invent a tier.
    expect(done.citationTiers.map((t) => t.tier)).toEqual(["primary"]);

    // Two-sided: the citing delta survives (it is a dangler, not the target), the bystander is not
    // named, and the target's own tombstone is excluded from the manifest by identity.
    expect(holdsInReactor(gw, cite.id)).toBe(true);
    expect(done.citations).not.toContain(bystander.id);
    expect(done.citations).not.toContain(done.tombstone);

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
    // A pool-resident stamp citing the member — survives the cut, dangles at the hole.
    const stamp = arrivalStamp(member.id, 2000);
    await pool.gateway.append([stamp]);

    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });

    // The CutReport's per-member erase receipt carries the additive attribution too, naming the pool.
    const cutMember = report.members.find((m) => m.member === member.id)!;
    expect(cutMember.citationTiers.some((t) => t.tier === "pool:1")).toBe(true);
    expect(cutMember.citationTiers.find((t) => t.tier === "pool:1")!.citations).toContain(stamp.id);

    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    const row = receipt.members.find((m) => m.member === member.id)!;

    // The byte verdict walked primary + pool and read clean on both.
    expect(row.tiers.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(row.tiers.find((v) => v.tier === "pool:1")!.holds).toBe(false);

    // The enumeration names the SAME tier set the verdict does (this scenario declares no wall, so the
    // verdict tiers are exactly the reachable tiers the citations walk).
    expect([...row.citationTiers].map((t) => t.tier).sort()).toEqual(
      [...row.tiers].map((v) => v.tier).sort(),
    );
    // Delta level: the flat list spans the pool, so the surviving stamp is in it.
    expect(row.citations).toContain(stamp.id);
    // Report level: the stamp is attributed to the POOL, not smeared onto the primary.
    expect(row.citationTiers.find((t) => t.tier === "pool:1")!.citations).toContain(stamp.id);
    expect(row.citationTiers.find((t) => t.tier === "primary")!.citations).not.toContain(stamp.id);

    // Two-sided: the bystander survived both tiers and is enumerated on neither.
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await pool.gateway.backend.holds(bystander.id)).toBe(true);
    expect(row.citations).not.toContain(bystander.id);
    expect(row.citationTiers.every((t) => !t.citations.includes(bystander.id))).toBe(true);

    await pool.drop();
    await gw.close();
  });

  it("a WALL is named by the byte verdict but never by the citation enumeration", async () => {
    // The tier sets are NOT identical in general: the byte verdict names every WALL it could not reach
    // as `unproven`, and a wall cannot be walked for citations, so `tiers` is a strict superset of
    // `citationTiers` BY TIER NAME whenever a wall stands. This pins that relation, so the honest gap is
    // a rail and not just a comment — a manifest that claimed a wall clean, or listed it as walked,
    // would be the H7 shape one level up.
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });

    // A declared SEPARATE container, never attached — the post-restart wall the re-issue must confess
    // but cannot reach. Declared AFTER the cut, so the cut ran clean and only the re-issue sees it.
    await gw.append([
      declareContainer(
        { container: "container:cold", trust: "curated", posture: "separate" },
        60_000,
      ),
    ]);
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    const row = receipt.members.find((m) => m.member === member.id)!;

    // The byte verdict names the wall — `unproven`, because nobody could look (H9, never `false`).
    const wall = row.tiers.find((v) => v.tier === "container:cold");
    expect(wall).toBeDefined();
    expect(wall!.holds).toBe("unproven");
    // The citation enumeration covers only WALKABLE tiers, so it does NOT name the wall.
    expect(row.citationTiers.some((t) => t.tier === "container:cold")).toBe(false);
    // Two-sided on the tier set: the walkable primary is in BOTH — the wall did not smear the
    // reachable side, and the manifest is a strict SUBSET of the verdict's tiers, never disjoint.
    expect(row.tiers.some((v) => v.tier === "primary")).toBe(true);
    expect(row.citationTiers.some((t) => t.tier === "primary")).toBe(true);
    const verdictTiers = new Set(row.tiers.map((v) => v.tier));
    expect(row.citationTiers.every((t) => verdictTiers.has(t.tier))).toBe(true);
    expect(row.citationTiers.length).toBeLessThan(row.tiers.length);

    await gw.close();
  });
});
