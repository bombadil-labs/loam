import { describe, expect, it } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { erasureSlate } from "../../src/gateway/erase.js";
import { standingErasures, erasureTarget } from "../../src/gateway/erase-law.js";
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

class RefusingBackend implements StoreBackend {
  readonly refuse = new Set<string>();
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

class DurableWallBackend extends MemoryBackend {
  keepOpen = true;
  override async close(): Promise<void> {
    if (!this.keepOpen) await super.close();
  }
}

const tagThrough = async (gw: Gateway): Promise<string[] | null> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  return (res.data as { plant: { tag: string[] | null } }).plant.tag;
};

const heightThrough = async (gw: Gateway): Promise<number | null> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  return (res.data as { plant: { height: number | null } }).plant.height;
};

describe("T64 criterion 9 — the pre-flight is all-or-refuse and leaves the ground byte-identical", () => {
  it("a DANGLING membershipAt refuses before any erasure lands", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress", "cite"] });
    await expect(gw.erase(stood.membershipAt)).rejects.toThrow(/PINNED membership Term/);
    await gw.backend.purge([stood.membershipAt]);
    await gw.reseat();
    const report = gw.slates(BEFORE_DEADLINE)[0]!;
    expect(report.unresolved).toMatch(/resolves to nothing here/);
    expect(report.enforced).toEqual([]);
    expect([...report.closes].sort()).toEqual(["cite", "egress"]);
    expect((await gw.health(BEFORE_DEADLINE)).slates.unresolved).toEqual([stood.container]);
    const before = groundIds(gw);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      /resolves to nothing here/,
    );
    expect(groundIds(gw)).toEqual(before);
    expect(
      standingErasures(gw.reactor, gw.validityNow(), OP).map((t) => erasureTarget(t.claims)),
    ).not.toContain(member.id);
    expect(await gw.backend.holds(member.id)).toBe(true);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await tagThrough(gw)).toEqual(["shade"]);
    await gw.close();
  });

  it("an UNREACHABLE wall in the table refuses before any erasure lands", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress", "cite"] });
    await gw.append([
      declareContainer(
        { container: "container:archive", trust: "curated", posture: "separate" },
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
    expect(await tagThrough(gw)).toEqual(["shade"]);
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
    expect(gw.graveyards()).toEqual([]);
    expect(gw.containers().containers.get(stood.container)).toBeDefined();
    expect(gw.offeredDeltas().map((d) => d.id)).not.toContain(stubborn.id);
    expect(await backend.holds(willing.id)).toBe(false);
    expect(await backend.holds(stubborn.id)).toBe(true);
    expect(await backend.holds(bystander.id)).toBe(true);
    const tagsMid = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tagsMid.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);

    const tombstonesAfterFault = standingErasures(gw.reactor, gw.validityNow(), OP).length;
    backend.refuse.clear();
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(report.members.map((m) => m.member).sort()).toEqual([stubborn.id, willing.id].sort());
    expect(await backend.holds(stubborn.id)).toBe(false);
    const targets = standingErasures(gw.reactor, gw.validityNow(), OP).map((t) =>
      erasureTarget(t.claims),
    );
    expect(targets.filter((t) => t === willing.id)).toHaveLength(1);
    expect(targets.filter((t) => t === stubborn.id)).toHaveLength(1);
    expect(tombstonesAfterFault).toBe(2);
    expect(standingErasures(gw.reactor, gw.validityNow(), OP).length).toBe(tombstonesAfterFault);
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

    gw.cutHold = () => Promise.reject(new Error("power cut"));
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(/power cut/);
    const graveyards = gw.graveyards();
    expect(graveyards).toHaveLength(1);
    expect(gw.containers().containers.get(stood.container)).toBeDefined();

    gw.cutHold = undefined;
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(gw.graveyards()).toHaveLength(1);
    expect(report.graveyard).toBe(graveyards[0]!.id);
    expect(gw.containers().containers.get(stood.container)).toBeUndefined();
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await gw.backend.holds(member.id)).toBe(false);
    expect(await tagThrough(gw)).toEqual(["shade"]);
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
    expect(await heightThrough(gw)).toBeNull();

    const stood = await standSlate(gw, { members: [retraction], closes: ["egress", "cite"] });
    expect(gw.slates(BEFORE_DEADLINE)[0]!.resurfacing).toEqual([claim.id]);

    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(report.resurfacing).toEqual([claim.id]);
    expect(await heightThrough(gw)).toBe(30);
    expect(await gw.backend.holds(retraction.id)).toBe(false);
    expect(await gw.backend.holds(claim.id)).toBe(true);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await tagThrough(gw)).toEqual(["shade"]);
    await gw.close();
  });
});

describe("T64 criterion 19 — a member erased mid-window: the cut COMPLETES, the proof stays decidable", () => {
  it("`prior-erasure` accounts for it, no second erasure, and the arithmetic holds", async () => {
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

    const byHand = await gw.erase(members[1]!.id);
    expect(byHand.erasure).toBeDefined();

    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(report.priorErasure).toEqual([{ member: members[1]!.id, erasure: byHand.erasure }]);
    const forHand = standingErasures(gw.reactor, gw.validityNow(), OP).filter(
      (t) => erasureTarget(t.claims) === members[1]!.id,
    );
    expect(forHand).toHaveLength(1);
    expect(forHand[0]!.id).toBe(byHand.erasure);
    const check = graveyardCompleteness(gw.reactor, gw.validityNow(), OP, report.graveyard);
    expect(check.members).toHaveLength(4);
    expect(check.missing).toEqual([]);
    expect(check.holds).toBe(true);
    const joined = standingErasures(gw.reactor, gw.validityNow(), OP)
      .filter((t) => erasureSlate(t.claims) === stood.container)
      .map((t) => erasureTarget(t.claims))
      .sort();
    expect(joined).toEqual([members[0]!.id, members[2]!.id, members[3]!.id].sort());
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await tagThrough(gw)).toEqual(["shade"]);
    await gw.close();
  });

  it("THE FAIL-CLOSED LEG: a frozen id resolving to nothing with NO erasure refuses the cut", async () => {
    const gw = await bootSlateStore();
    const real = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    const phantom = observed(FERN, "height", 99, 1200, OP_SEED);
    await gw.append([real, bystander]);
    const stood = await standSlate(gw, { members: [real, phantom], closes: ["egress"] });
    const before = groundIds(gw);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      new RegExp(`${phantom.id}[\\s\\S]*NO surviving lawful erasure`),
    );
    expect(groundIds(gw)).toEqual(before);
    expect(await gw.backend.holds(real.id)).toBe(true);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(await tagThrough(gw)).toEqual(["shade"]);
    await gw.close();
  });
});

describe("T64 criterion 20 — a detached wall that demonstrably holds a member is a REFUSAL", () => {
  it("refuses naming the wall and the ids; cutting around it is SIGNED and reads `unproven`", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);

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
            posture: "separate",
            membership: HEIGHTS,
          },
          OP,
          52_000,
        ),
        OP_SEED,
      ),
    ]);
    const shelfBytes = new DurableWallBackend();
    const shelf = await gw.openContainer({ name: "container:shelf", backend: shelfBytes });
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

    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:opaque", trust: "curated", posture: "separate" },
          OP,
          53_000,
        ),
        OP_SEED,
      ),
      signClaims(
        {
          timestamp: 53_001,
          validFrom: 53_001,
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

    const signed = await standSlate(gw, {
      container: "container:slate:signed",
      members: [member],
      closes: ["egress", "cite"],
      acceptsIncomplete: ["container:shelf", "container:opaque"],
      ts: 54_000,
    });
    await gw.append([strike(stood.declaration, 54_500)]);
    const report = await gw.cut(signed.container, { now: BEFORE_DEADLINE });

    const verdicts = report.members[0]!.tiers;
    const shelfVerdict = verdicts.find((v) => v.tier === "container:shelf")!;
    expect(shelfVerdict.holds).not.toBe(false);
    expect(shelfVerdict.holds).toBe("unproven");
    expect(verdicts.find((v) => v.tier === "primary")!.holds).toBe(false);
    expect(report.notReached).toEqual(
      expect.arrayContaining([
        { wall: "container:shelf", acceptsIncomplete: signed.record },
        { wall: "container:opaque", acceptsIncomplete: signed.record },
      ]),
    );
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(receipt.nonClaim.join("\n")).toMatch(/container:shelf/);
    expect(await shelfBytes.holds(member.id)).toBe(true);
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
      posture: "separate",
      admit: () => true,
    });
    expect(pool.gateway!.reactor.get(member.id)).toBeDefined();

    await standSlate(gw, { members: [member], closes: ["cite"] });
    await expect(gw.promote(pool.gateway!, member.id)).rejects.toThrow(/SLATED FOR ERASURE/);
    const ok = await gw.promote(pool.gateway!, bystander.id);
    expect(gw.reactor.get(ok.promoted)).toBeDefined();
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
      posture: "separate",
      admit: () => true,
    });
    const promoted = await gw.promote(pool.gateway!, member.id);
    expect(promoted.promoted).not.toBe(member.id);
    const cite = signClaims(
      {
        timestamp: 1500,
        validFrom: 1500,
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
    const dupes = gw.slates(BEFORE_DEADLINE)[0]!.duplicates;
    expect(dupes.map((d) => d.member)).toContain(member.id);
    expect(dupes.some((d) => d.role === "source-delta")).toBe(true);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).not.toContain(promoted.promoted);

    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    expect(report.members.map((m) => m.member)).toEqual([member.id]);
    expect(await heightThrough(gw)).toBe(30);
    expect(await gw.backend.holds(promoted.promoted)).toBe(true);
    expect(await gw.backend.holds(member.id)).toBe(false);
    expect(report.members[0]!.citations).toContain(cite.id);
    expect(report.duplicates.map((d) => d.member)).toContain(member.id);
    await pool.drop();
    await gw.close();
  });
});
