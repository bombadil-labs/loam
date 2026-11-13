import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  parseTerm,
  signClaims,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { governedGatherBody, grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  LISTING_MAX_LIMIT,
  listingContainerName,
  listingMembershipJson,
} from "../../src/gateway/listing.js";
import {
  containerClaims,
  detachClaims,
  exclusionClaims,
  termClaims,
} from "../../src/gateway/container-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const MALLORY_SEED = "ee".repeat(32);
const MALLORY = authorForSeed(MALLORY_SEED);
const MOSS = "plant:moss";
const OAK = "plant:oak";

async function governedGarden(): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gw.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
  ]);
  gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gw;
}

const entitiesOf = (nodes: readonly { entity: string }[]): string[] => nodes.map((n) => n.entity);

describe("the listing door — object level: what the authed door serves", () => {
  it("lists the distinct entities holding evidence, ascending, sparse views intact", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(FERN, "tag", "shade", 1100, GARDENER_SEED),
      observed(MOSS, "tag", "soft", 1200, GARDENER_SEED),
      observed(OAK, "height", 900, 1300, GARDENER_SEED),
    ]);
    const read = await gw.query(`{ plants { _entity height tag } }`);
    expect(read.errors).toBeUndefined();
    const plants = (read.data as { plants: { _entity: string; height: unknown; tag: unknown }[] })
      .plants;
    expect(plants.map((p) => p._entity)).toEqual([FERN, MOSS, OAK]);
    expect(plants[1]!.height).toBeNull();
    expect(plants[1]!.tag).toEqual(["soft"]);
    await gw.close();
  });

  it("paginates on an exclusive after-cursor over the ascending order", async () => {
    const gw = await governedGarden();
    const names = ["plant:a", "plant:b", "plant:c", "plant:d", "plant:e"];
    await gw.append(names.map((n, i) => observed(n, "height", i, 1000 + i, GARDENER_SEED)));
    const one = await gw.list("Plant", { limit: 2 });
    expect(entitiesOf(one)).toEqual(["plant:a", "plant:b"]);
    const two = await gw.list("Plant", { limit: 2, after: "plant:b" });
    expect(entitiesOf(two)).toEqual(["plant:c", "plant:d"]);
    const three = await gw.list("Plant", { limit: 2, after: "plant:d" });
    expect(entitiesOf(three)).toEqual(["plant:e"]);
    const read = await gw.query(`{ plants(limit: 1, after: "plant:c") { _entity } }`);
    expect((read.data as { plants: { _entity: string }[] }).plants.map((p) => p._entity)).toEqual([
      "plant:d",
    ]);
    await gw.close();
  });

  it("bounds the page: each listed entity costs a resolution", async () => {
    const gw = await governedGarden();
    await expect(gw.list("Plant", { limit: 0 })).rejects.toThrow(/between 1 and/);
    await expect(gw.list("Plant", { limit: LISTING_MAX_LIMIT + 1 })).rejects.toThrow(
      /between 1 and/,
    );
    await expect(gw.list("Plant", { limit: 26 })).rejects.toThrow(/between 1 and 25/);
    await expect(gw.list("Plant", { limit: 25 })).resolves.toEqual([]);
    await gw.close();
  });

  it("defaults to a modest page: exactly 10 entities when none is asked for", async () => {
    const gw = await governedGarden();
    const names = Array.from({ length: 30 }, (_, i) => `plant:p${String(i).padStart(2, "0")}`);
    await gw.append(names.map((n, i) => observed(n, "height", i, 1000 + i, GARDENER_SEED)));
    const page = await gw.list("Plant");
    expect(page).toHaveLength(10);
    expect(entitiesOf(page)).toEqual(names.slice(0, 10));
    await gw.close();
  });

  it("yields the event loop between resolutions — one page cannot stall the process", async () => {
    const gw = await governedGarden();
    const names = Array.from({ length: 8 }, (_, i) => `plant:y${i}`);
    await gw.append(names.map((n, i) => observed(n, "height", i, 1000 + i, GARDENER_SEED)));
    await gw.list("Plant", { limit: 1 });
    const tickDuring = async (limit: number): Promise<boolean> => {
      let ticked = false;
      const timer = setTimeout(() => {
        ticked = true;
      }, 0);
      await gw.list("Plant", { limit });
      clearTimeout(timer);
      return ticked;
    };
    expect(await tickDuring(1)).toBe(false);
    expect(await tickDuring(8)).toBe(true);
    await gw.close();
  });

  it("a lens whose name IS another lens's listing field refuses at build, both orders", async () => {
    const first = await governedGarden();
    expect(() => first.register({ ...PLANT, name: "Plants" }, PLANT_POLICY, [FERN])).toThrowError(
      /collides/,
    );
    await first.close();
    const second = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    second.register({ ...PLANT, name: "Plants" }, PLANT_POLICY, [FERN]);
    expect(() => second.register(PLANT, PLANT_POLICY, [FERN])).toThrowError(/collides/);
    await second.close();
  });

  it("refuses an unregistered lens in the door's own voice", async () => {
    const gw = await governedGarden();
    await expect(gw.list("Nope")).rejects.toThrow(/no registered schema named Nope/);
    await gw.close();
  });

  it("refuses on an ungoverned store: no operator, no container, no silent fallback", async () => {
    const gw = await Gateway.open(new MemoryBackend());
    gw.register(PLANT, PLANT_POLICY, [FERN]);
    await expect(gw.list("Plant")).rejects.toThrow(/ungoverned store has no operator/);
    await gw.close();
  });
});

describe("the listing door — delta level: what the container actually holds", () => {
  it("the first listing declares the backing container, and its members are the evidence", async () => {
    const gw = await governedGarden();
    const evidence = [
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "tag", "soft", 1200, GARDENER_SEED),
    ];
    await gw.append(evidence);
    expect(gw.containers().containers.size).toBe(0);
    await gw.list("Plant");
    const name = listingContainerName("Plant");
    const declared = gw.containers().containers.get(name);
    expect(declared).toBeDefined();
    expect(declared!.trust).toBe("curated");
    expect(declared!.posture).toBe("shared");
    expect(declared!.membership).toEqual(
      listingMembershipJson(["height", "readings", "tag", "watered"], "drop"),
    );
    const members = gw.containerScope({ containers: [name] });
    expect(members.map((d) => d.id).sort()).toEqual(evidence.map((d) => d.id).sort());
    await gw.close();
  });

  it("a claim in a context no lens reads is not a member — bucketed how, not merely at whom", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "aroma", "loamy", 1100, GARDENER_SEED),
    ]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    const members = gw.containerScope({ containers: [listingContainerName("Plant")] });
    expect(members.some((d) => d.claims.timestamp === 1100)).toBe(false);
    await gw.close();
  });

  it("a sibling lens widens the membership: latest-wins refresh, both levels", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "note", "check weekly", 1100, GARDENER_SEED),
    ]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    await gw.list("Sketch");
    const declared = gw.containers().containers.get(listingContainerName("Plant"));
    expect(declared!.membership).toEqual(
      listingMembershipJson(["height", "note", "readings", "tag", "watered"], "drop"),
    );
    expect(entitiesOf(await gw.list("Sketch"))).toEqual([FERN, MOSS]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN, MOSS]);
    await gw.close();
  });

  it("suppression closes at both levels: the struck claim's entity drops, bystanders stay", async () => {
    const gw = await governedGarden();
    const mossTag = observed(MOSS, "tag", "soft", 1200, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), mossTag]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN, MOSS]);
    await gw.append([signClaims(makeNegationClaims(GARDENER, 2000, mossTag.id), GARDENER_SEED)]);
    const members = gw.containerScope({ containers: [listingContainerName("Plant")] });
    expect(members.some((d) => d.id === mossTag.id)).toBe(false);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    await gw.close();
  });

  it("an evolved lens narrows the membership: the superseded binding's contexts do not linger", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "note", "check weekly", 1100, GARDENER_SEED),
    ]);
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    expect(entitiesOf(await gw.list("Sketch"))).toEqual([FERN, MOSS]);
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["watered", pickLatest]]), default: pickLatest },
      [FERN],
    );
    expect(entitiesOf(await gw.list("Sketch"))).toEqual([FERN]);
    const declared = gw.containers().containers.get(listingContainerName("Plant"));
    expect(declared!.membership).toEqual(
      listingMembershipJson(["height", "readings", "tag", "watered"], "drop"),
    );
    await gw.close();
  });

  it("refuses a name squatted by a container with other knobs — never reads through it", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gw.append([
      signClaims(
        containerClaims(
          { container: listingContainerName("Plant"), trust: "curated", posture: "separate" },
          OPERATOR,
          2000,
        ),
        OPERATOR_SEED,
      ),
    ]);
    await expect(gw.list("Plant")).rejects.toThrow(
      /reads only through the curated\/shared container it declares itself/,
    );
    await gw.close();
  });

  it("refuses a DETACHED backing container instead of serving a complete-looking empty page", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    const name = listingContainerName("Plant");
    await gw.append([signClaims(detachClaims(name, undefined, OPERATOR, 3000), OPERATOR_SEED)]);
    await expect(gw.list("Plant")).rejects.toThrow(/DETACHED/);
    await gw.close();
  });

  it("a refresh carries the standing knobs — a read never re-roots a nested container", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gw.list("Plant");
    const name = listingContainerName("Plant");
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OPERATOR), (t) =>
          containerClaims(
            {
              container: "container:garden",
              trust: "curated",
              posture: "shared",
              membership: {
                op: "select",
                pred: { hasPointer: { context: { exact: "nothing" } } },
                in: "input",
              },
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
      signClaims(
        withStamp(gw.stamp(OPERATOR), (t) =>
          containerClaims(
            {
              container: name,
              trust: "curated",
              posture: "shared",
              parent: "container:garden",
              version: "deadbeef",
              membership: gw.containers().containers.get(name)!.membership,
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    await gw.list("Sketch");
    const after = gw.containers().containers.get(name)!;
    expect(after.membership).toEqual(
      listingMembershipJson(["height", "note", "readings", "tag", "watered"], "drop"),
    );
    expect(after.parent).toBe("container:garden");
    expect(after.version).toBe("deadbeef");
    await gw.close();
  });

  it("refuses a backing container whose membership lives at an address, not inline", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const name = listingContainerName("Plant");
    const published = signClaims(
      termClaims(
        listingMembershipJson(["height", "readings", "tag", "watered"], "drop"),
        OPERATOR,
        2000,
      ),
      OPERATOR_SEED,
    );
    await gw.append([published]);
    await gw.append([
      signClaims(
        containerClaims(
          { container: name, trust: "curated", posture: "shared", membershipAt: published.id },
          OPERATOR,
          2100,
        ),
        OPERATOR_SEED,
      ),
    ]);
    await expect(gw.list("Plant")).rejects.toThrow(/membership at a published address/);
    await gw.close();
  });

  it("the container algebra is load-bearing: excluding the container empties the listing", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    const name = listingContainerName("Plant");
    await gw.append([signClaims(exclusionClaims(name, OPERATOR, 3000), OPERATOR_SEED)]);
    expect(await gw.list("Plant")).toEqual([]);
    const read = await gw.query(`{ plants { _entity } }`);
    expect((read.data as { plants: unknown[] }).plants).toEqual([]);
    await gw.close();
  });
});

describe("the listing door — the candidate set reads under the program's own mask", () => {
  const GUARDED: HyperSchema = { name: "Guarded", alg: 1, body: governedGatherBody(OPERATOR) };
  const UNMASKED: HyperSchema = {
    name: "Unmasked",
    alg: 1,
    body: parseTerm({
      op: "group",
      key: "byTargetContext",
      in: { op: "select", pred: { hasPointer: { targetEntity: { var: "root" } } }, in: "input" },
    }),
  };

  async function heckled(hyperschema: HyperSchema): Promise<{ gw: Gateway; struck: string }> {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
    ]);
    gw.register(hyperschema, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const mossTag = observed(MOSS, "tag", "soft", 1200, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), mossTag]);
    await gw.federate([signClaims(makeNegationClaims(MALLORY, 3000, mossTag.id), MALLORY_SEED)]);
    return { gw, struck: mossTag.id };
  }

  it("a stranger's strike cannot delete an entity from a governed listing", async () => {
    const { gw, struck } = await heckled(GUARDED);
    const point = await gw.query(`{ guarded(entity: "${MOSS}") { tag } }`);
    expect((point.data as { guarded: { tag: string[] } }).guarded.tag).toEqual(["soft"]);
    expect(entitiesOf(await gw.list("Guarded"))).toEqual([FERN, MOSS]);
    const name = listingContainerName("Guarded");
    expect(gw.containerScope({ containers: [name] }).some((d) => d.id === struck)).toBe(true);
    const membership = gw.containers().containers.get(name)!.membership as {
      in: { op: string; policy: Record<string, unknown> };
    };
    expect(membership.in.op).toBe("mask");
    expect(membership.in.policy).not.toBe("drop");
    expect(Object.keys(membership.in.policy)).toEqual(["trust"]);
    await gw.close();
  });

  it("a LAWFUL striker still empties it — the mask is honored, not merely bypassed", async () => {
    const { gw } = await heckled(GUARDED);
    const mine = [...gw.reactor.snapshot()].find(
      (d) => d.claims.author === GARDENER && d.claims.timestamp === 1200,
    )!;
    await gw.append([signClaims(makeNegationClaims(GARDENER, 4000, mine.id), GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Guarded"))).toEqual([FERN]);
    await gw.close();
  });

  it("an unmasked body masks nothing in its candidate set either — no invented suppression", async () => {
    const { gw, struck } = await heckled(UNMASKED);
    const name = listingContainerName("Unmasked");
    expect(entitiesOf(await gw.list("Unmasked"))).toEqual([FERN, MOSS]);
    expect(gw.containers().containers.get(name)!.membership).toEqual({
      op: "select",
      pred: { hasPointer: { context: { inSet: ["height", "readings", "tag", "watered"] } } },
      in: "input",
    });
    expect(gw.containerScope({ containers: [name] }).some((d) => d.id === struck)).toBe(true);
    await gw.append([signClaims(makeNegationClaims(GARDENER, 4000, struck), GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Unmasked"))).toEqual([FERN, MOSS]);
    await gw.close();
  });

  it("refuses a body that masks two ways — one listing, one candidate set", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    gw.register(
      {
        name: "TwoMinds",
        alg: 1,
        body: parseTerm({
          op: "group",
          key: "byTargetContext",
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: { op: "mask", policy: "annotate", in: { op: "mask", policy: "drop", in: "input" } },
          },
        }),
      },
      PLANT_POLICY,
      [FERN],
    );
    await expect(gw.list("TwoMinds")).rejects.toThrow(/masks negations 2 different ways/);
    await gw.close();
  });
});

describe("the listing door — the refusal shapes: authed only", () => {
  it("the public surface refuses the field exactly as one that never existed", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gw.declarePublic(["Plant"]);
    const point = await gw.queryPublic(`{ plant(entity: "${FERN}") { height } }`);
    expect((point.data as { plant: { height: number } }).plant.height).toBe(30);
    const listing = await gw.queryPublic(`{ plants { _entity } }`);
    const nonsense = await gw.queryPublic(`{ plantz { _entity } }`);
    expect(listing.data).toBeUndefined();
    expect(listing.errors).toHaveLength(1);
    expect(listing.errors![0]!.replace(`"plants"`, `"plantz"`)).toBe(nonsense.errors![0]);
    await gw.close();
  });
});
