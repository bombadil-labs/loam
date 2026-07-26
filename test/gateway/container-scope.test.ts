// T32 — the scope-merge operation (criteria 7, 13, 18, 19). A read scope is
// union(active containers) MINUS excluded, on the 0.6.0 set algebra. Four promises, both levels:
// the union side is pinned (active = surviving declaration + no detach cover; a child never rides
// its parent); nested difference composes; exclusion may narrow what a scope sees but never
// revive what was struck (H1, through the shared assertPreservesSuppression rail); and an
// unresolvable dependency — a dangling membershipAt, an unreachable wall — REFUSES the read
// loudly rather than resolving as if the container were empty (the H9 shape on the read side).

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import {
  containerClaims,
  detachClaims,
  exclusionClaims,
  termClaims,
} from "../../src/gateway/container.js";
import { assertClosureDoesNotLeak, assertPreservesSuppression, retraction } from "./narrowing.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "2f".repeat(32);
const OP = authorForSeed(OP_SEED);

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const OPERATOR_CLAIMS = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OP } },
  in: "input",
};
const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};
const MESSAGES = {
  op: "select",
  pred: { hasPointer: { context: { exact: "message" } } },
  in: "input",
};

const declare = (spec: Parameters<typeof containerClaims>[0], ts: number) =>
  signClaims(containerClaims(spec, OP, ts), OP_SEED);

describe("T32 criterion 18 — the union side of the formula is pinned", () => {
  it("two active containers union; a detach cover silences; a child never rides its parent", async () => {
    const gw = await boot();
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    const m = observed(FERN, "message", "hello", 1100, OP_SEED);
    await gw.append([h, m]);
    await gw.append([
      declare(
        { container: "container:a", trust: "curated", posture: "shared", membership: HEIGHTS },
        10_000,
      ),
      declare(
        { container: "container:b", trust: "curated", posture: "shared", membership: MESSAGES },
        10_001,
      ),
      declare(
        {
          container: "container:child",
          trust: "curated",
          posture: "shared",
          membership: MESSAGES,
          parent: "container:a",
        },
        10_002,
      ),
    ]);

    // Union of the two NAMED actives.
    const union = gw
      .containerScope({ containers: ["container:a", "container:b"] })
      .map((d) => d.id);
    expect(union).toContain(h.id);
    expect(union).toContain(m.id);

    // A child's members do not ride its parent's activation: scoping A alone yields heights only,
    // although container:child (a MESSAGES scope) hangs beneath it.
    const aOnly = gw.containerScope({ containers: ["container:a"] }).map((d) => d.id);
    expect(aOnly).toContain(h.id);
    expect(aOnly).not.toContain(m.id);

    // A detach cover contributes NOTHING, even with no exclusion anywhere: active means a
    // surviving declaration AND no surviving detach record.
    await gw.append([signClaims(detachClaims("container:b", "set aside", OP, 10_100), OP_SEED)]);
    const covered = gw
      .containerScope({ containers: ["container:a", "container:b"] })
      .map((d) => d.id);
    expect(covered).toContain(h.id);
    expect(covered).not.toContain(m.id);
    await gw.close();
  });
});

describe("T32 criterion 7 — nested exclusion composes on the set algebra", () => {
  it("difference-against-difference resolves the correct member set, exclusions and all", async () => {
    const gw = await boot();
    const opHeight = observed(FERN, "height", 30, 1000, OP_SEED);
    const opMessage = observed(FERN, "message", "mine", 1100, OP_SEED);
    await gw.append([opHeight, opMessage]);
    // The pre-0.6.0-impossible shape: the operator's claims MINUS (the operator's claims MINUS
    // the heights) — exactly the operator's heights, said the long way round.
    const nested = {
      op: "difference",
      of: OPERATOR_CLAIMS,
      without: { op: "difference", of: OPERATOR_CLAIMS, without: HEIGHTS },
    };
    await gw.append([
      declare(
        {
          container: "container:nested",
          trust: "curated",
          posture: "shared",
          membership: nested,
        },
        11_000,
      ),
      declare(
        {
          container: "container:msgs",
          trust: "curated",
          posture: "shared",
          membership: MESSAGES,
        },
        11_001,
      ),
    ]);
    const both = gw
      .containerScope({ containers: ["container:nested", "container:msgs"] })
      .map((d) => d.id);
    expect(both).toContain(opHeight.id);
    expect(both).toContain(opMessage.id);

    // Exclude the relative one: the nested difference still resolves; only the excluded members left.
    await gw.append([signClaims(exclusionClaims("container:nested", OP, 11_100), OP_SEED)]);
    const excluded = gw
      .containerScope({ containers: ["container:nested", "container:msgs"] })
      .map((d) => d.id);
    expect(excluded).not.toContain(opHeight.id);
    expect(excluded).toContain(opMessage.id);
    await gw.close();
  });
});

describe("T32 criterion 13 — exclusion never revives a strike (H1, fourth site)", () => {
  it("a retracted claim whose negation lives in an EXCLUDED container stays retracted", async () => {
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    const strike = retraction(target.id, OP, OP_SEED, 1200);
    await gw.append([strike]);
    // The active container admits the target; the EXCLUDED container's membership holds the
    // strike (the operator's non-height claims). Subtracting it drops the strike from the operand
    // set — and `negated(d, D)` ranges over the operand set, so without the forward closure the
    // target would read LIVE: a well-formed wrong view, the exact shape this repo paid for three
    // times before it was named.
    await gw.append([
      declare(
        { container: "container:live", trust: "curated", posture: "shared", membership: HEIGHTS },
        12_000,
      ),
      declare(
        {
          container: "container:struck",
          trust: "curated",
          posture: "shared",
          membership: { op: "difference", of: OPERATOR_CLAIMS, without: HEIGHTS },
        },
        12_001,
      ),
    ]);
    await gw.append([signClaims(exclusionClaims("container:struck", OP, 12_100), OP_SEED)]);

    const scoped = gw.containerScope({ containers: ["container:live", "container:struck"] });
    // Object level, through the shared H1 rail: land the scoped read in a fresh store and ask
    // what a READER resolves — never merely which ids crossed.
    const dest = await Gateway.open(new MemoryBackend(), {});
    await dest.federate(scoped, { admit: () => true });
    assertPreservesSuppression({
      what: "container-scoped read (exclusion subtracting a negation)",
      source: gw,
      destination: dest,
      struckClaim: target.id,
    });
    // And the TOP level — a Schema-resolved View, not the negation index (the P3 doctrine: the
    // middle is not the top). A lens over the destination must not serve the struck value.
    dest.register(PLANT, PLANT_POLICY, [FERN], undefined, [...PLANT_WRITABLE]);
    const view = await dest.query(`{ Plant(entity: "${FERN}") { height } }`);
    expect((view.data?.Plant as { height?: unknown } | undefined)?.height ?? null).not.toBe(30);
    await dest.close();
    await gw.close();
  });

  it("the closure runs forward only: a strike never drags its excluded target in", async () => {
    const gw = await boot();
    const height = observed(FERN, "height", 30, 1000, OP_SEED);
    const message = observed(FERN, "message", "never in scope", 1100, OP_SEED);
    await gw.append([height, message]);
    const messageStrike = retraction(message.id, OP, OP_SEED, 1300);
    await gw.append([messageStrike]);
    await gw.append([
      declare(
        {
          container: "container:only-heights",
          trust: "curated",
          posture: "shared",
          membership: HEIGHTS,
        },
        13_000,
      ),
    ]);
    const scoped = gw.containerScope({ containers: ["container:only-heights"] });
    const dest = await Gateway.open(new MemoryBackend(), {});
    await dest.federate(scoped, { admit: () => true });
    assertClosureDoesNotLeak({
      what: "container-scoped read",
      destination: dest,
      excludedTarget: message.id,
      itsRetraction: messageStrike.id,
    });
    await dest.close();
    await gw.close();
  });
});

describe("T32 — the wall side of the union (P5 fold: the positive leg, and the cross-ground strike)", () => {
  it("an attached wall contributes its members to the scoped read", async () => {
    // The refusal leg alone (criterion 19) could be satisfied by an implementation that refuses
    // EVERY wall — this is the leg that makes the attached-wall branch load-bearing.
    const gw = await boot();
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    const m = observed(FERN, "message", "hello", 1100, OP_SEED);
    await gw.append([h, m]);
    await gw.append([
      declare(
        { container: "container:aw", trust: "untrusted", posture: "separate", membership: HEIGHTS },
        30_000,
      ),
      declare(
        { container: "container:pp", trust: "curated", posture: "shared", membership: MESSAGES },
        30_001,
      ),
    ]);
    const wall = await gw.openContainer({ name: "container:aw", backend: new MemoryBackend() });
    const wallOnly = gw.containerScope({ containers: ["container:aw"] }).map((d) => d.id);
    expect(wallOnly).toContain(h.id);
    const both = gw
      .containerScope({ containers: ["container:aw", "container:pp"] })
      .map((d) => d.id);
    expect(both).toContain(h.id);
    expect(both).toContain(m.id);
    await wall.drop();
    await gw.close();
  });

  it("a member shared by a wall and a property container still carries the primary's strike", async () => {
    // The suppression lens's confirmed resurrection: the wall's snapshot was seeded BEFORE the
    // strike landed (no reseed), so only the PRIMARY ground holds the negation — and a
    // first-wins ground assignment would close the shared member over the wall alone, handing
    // the reader the claim live. The closure must run over EVERY ground that admitted it. The
    // wall's name sorts FIRST on purpose: that is exactly the order that picked the wrong home.
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    await gw.append([
      declare(
        {
          container: "container:aa-wall",
          trust: "untrusted",
          posture: "separate",
          membership: HEIGHTS,
        },
        31_000,
      ),
      declare(
        {
          container: "container:zz-prop",
          trust: "curated",
          posture: "shared",
          membership: HEIGHTS,
        },
        31_001,
      ),
    ]);
    const wall = await gw.openContainer({
      name: "container:aa-wall",
      backend: new MemoryBackend(),
    });
    expect(wall.gateway!.reactor.get(target.id)).toBeDefined(); // seeded pre-strike
    await gw.append([retraction(target.id, OP, OP_SEED, 31_100)]); // no reseed — the pool never sees it

    const scoped = gw.containerScope({ containers: ["container:aa-wall", "container:zz-prop"] });
    const dest = await Gateway.open(new MemoryBackend(), {});
    await dest.federate(scoped, { admit: () => true });
    assertPreservesSuppression({
      what: "container-scoped read (wall and property sharing a member across grounds)",
      source: gw,
      destination: dest,
      struckClaim: target.id,
    });
    await dest.close();
    await wall.drop();
    await gw.close();
  });

  it("members() on a property container is a reading, not a raw dset (H1)", async () => {
    // One name, one closure contract: a struck member crosses WITH its strike on both postures.
    const gw = await boot();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    const strike = retraction(target.id, OP, OP_SEED, 32_000);
    await gw.append([strike]);
    await gw.append([
      declare(
        {
          container: "container:reading",
          trust: "curated",
          posture: "shared",
          membership: HEIGHTS,
        },
        32_100,
      ),
    ]);
    const c = await gw.openContainer({ name: "container:reading" });
    const ids = c.members().map((d) => d.id);
    expect(ids).toContain(target.id);
    expect(ids).toContain(strike.id); // the closure rode along — no consumer inherits a live ghost
    await gw.close();
  });
});

describe("T32 criterion 19 — an unresolvable dependency refuses, never shrinks", () => {
  it("a membershipAt address that resolves to nothing refuses the read, naming the address", async () => {
    const gw = await boot();
    const dangling = "a".repeat(44); // shaped like an address, resolving to nothing
    await gw.append([
      declare(
        {
          container: "container:remote",
          trust: "curated",
          posture: "shared",
          membershipAt: dangling,
        },
        14_000,
      ),
    ]);
    expect(() => gw.containerScope({ containers: ["container:remote"] })).toThrow(
      new RegExp(dangling),
    );
    await gw.close();
  });

  it("a membershipAt that RESOLVES scopes exactly like an inline Term", async () => {
    // The positive leg, so the refusal above cannot be satisfied by rejecting every membershipAt.
    const gw = await boot();
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([h]);
    const published = signClaims(termClaims(HEIGHTS, OP, 14_100), OP_SEED);
    await gw.append([published]);
    await gw.append([
      declare(
        {
          container: "container:by-address",
          trust: "curated",
          posture: "shared",
          membershipAt: published.id,
        },
        14_200,
      ),
    ]);
    expect(gw.containerScope({ containers: ["container:by-address"] }).map((d) => d.id)).toContain(
      h.id,
    );
    await gw.close();
  });

  it("a scope including an unreachable WALL refuses naming the container", async () => {
    const gw = await boot();
    // Declared, never attached this session, not detach-covered: the read must refuse — an
    // empty-set fallback would be partial data with no error, indistinguishable from a
    // legitimately empty container.
    await gw.append([
      declare({ container: "container:away", trust: "curated", posture: "separate" }, 15_000),
    ]);
    expect(() => gw.containerScope({ containers: ["container:away"] })).toThrow(/container:away/);
    await gw.close();
  });
});
