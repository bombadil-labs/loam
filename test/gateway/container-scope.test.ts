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
} from "../../src/gateway/container-law.js";
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

    const union = gw
      .containerScope({ containers: ["container:a", "container:b"] })
      .map((d) => d.id);
    expect(union).toContain(h.id);
    expect(union).toContain(m.id);

    const aOnly = gw.containerScope({ containers: ["container:a"] }).map((d) => d.id);
    expect(aOnly).toContain(h.id);
    expect(aOnly).not.toContain(m.id);

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
    const dest = await Gateway.open(new MemoryBackend(), {});
    await dest.federate(scoped, { admit: () => true });
    assertPreservesSuppression({
      what: "container-scoped read (exclusion subtracting a negation)",
      source: gw,
      destination: dest,
      struckClaim: target.id,
    });
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
    expect(wall.gateway!.reactor.get(target.id)).toBeDefined();
    await gw.append([retraction(target.id, OP, OP_SEED, 31_100)]);

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
    expect(ids).toContain(strike.id);
    await gw.close();
  });
});

describe("T32 criterion 19 — an unresolvable dependency refuses, never shrinks", () => {
  it("a membershipAt address that resolves to nothing refuses the read, naming the address", async () => {
    const gw = await boot();
    const dangling = "a".repeat(44);
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
    await gw.append([
      declare({ container: "container:away", trust: "curated", posture: "separate" }, 15_000),
    ]);
    expect(() => gw.containerScope({ containers: ["container:away"] })).toThrow(/container:away/);
    await gw.close();
  });
});
