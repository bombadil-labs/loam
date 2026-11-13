import { describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  parseTerm,
  signClaims,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { governedGatherBody, grantClaims } from "../../src/gateway/accounts.js";
import { entityGatherBody } from "../../src/gateway/gather.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  listingContainerName,
  listingPageImpl,
  projectListingEntities,
} from "../../src/gateway/listing.js";
import { containerClaims, exclusionClaims } from "../../src/gateway/container-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";
import { plant } from "../helpers/plant.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const MOSS = "plant:moss";
const OAK = "plant:oak";
const CONTAINER = listingContainerName("Plant");
const CONTEXTS = new Set(["height", "readings", "tag", "watered"]);

async function governedGarden(backend = new MemoryBackend()): Promise<Gateway> {
  const gw = await Gateway.open(backend, { seed: OPERATOR_SEED });
  await gw.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
  ]);
  gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gw;
}

async function coldTwin(gw: Gateway): Promise<Gateway> {
  const copy = new MemoryBackend();
  await plant(copy, await gw.backend.deltasSince(new Set()), gw.operatorAuthor);
  const twin = await Gateway.open(copy, { seed: OPERATOR_SEED });
  twin.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return twin;
}

const page = (gw: Gateway, opts: { limit?: number; after?: string | undefined } = {}) =>
  listingPageImpl(gw, "Plant", { limit: 25, ...opts });
const served = async (gw: Gateway, opts: { limit?: number; after?: string | undefined } = {}) =>
  (await gw.list("Plant", { limit: 25, ...opts })).map((n) => n.entity);
const door = async (gw: Gateway): Promise<string[]> => {
  const read = await gw.query(`{ plants(limit: 25) { _entity } }`);
  expect(read.errors).toBeUndefined();
  return (read.data as { plants: { _entity: string }[] }).plants.map((p) => p._entity);
};
const slow = (gw: Gateway): string[] =>
  projectListingEntities(gw.containerScope({ containers: [CONTAINER] }), CONTEXTS);

async function agreeOn(gw: Gateway, expected: string[]): Promise<void> {
  expect(await page(gw)).toEqual(expected);
  expect(slow(gw)).toEqual(expected);
  expect(await served(gw)).toEqual(expected);
  expect(await door(gw)).toEqual(expected);
  const twin = await coldTwin(gw);
  expect(await page(twin)).toEqual(expected);
  await twin.close();
}

function scans(gw: Gateway): {
  snapshots: () => number;
  scopes: () => number;
  folds: () => number;
  reset: () => void;
} {
  const snap = vi.spyOn(gw.reactor, "snapshot");
  const scope = vi.spyOn(gw, "containerScope");
  const fold = vi.spyOn(gw.reactor, "negationsOf");
  return {
    snapshots: () => snap.mock.calls.length,
    scopes: () => scope.mock.calls.length,
    folds: () => fold.mock.calls.length,
    reset: () => {
      snap.mockClear();
      scope.mockClear();
      fold.mockClear();
    },
  };
}

describe("the maintained candidate set — a warm page does not scan the ground", () => {
  it("a repeat page and a page after a plain append call neither snapshot nor scope", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "tag", "soft", 1100, GARDENER_SEED),
    ]);
    expect(await page(gw)).toEqual([FERN, MOSS]);
    const s = scans(gw);
    expect(await page(gw)).toEqual([FERN, MOSS]);
    expect(s.snapshots()).toBe(0);
    expect(s.scopes()).toBe(0);
    await gw.append([observed(OAK, "height", 900, 1200, GARDENER_SEED)]);
    s.reset();
    expect(await page(gw)).toEqual([FERN, MOSS, OAK]);
    expect(s.snapshots()).toBe(0);
    expect(s.scopes()).toBe(0);
    expect(s.folds()).toBe(1);
    s.reset();
    expect(await page(gw)).toEqual([FERN, MOSS, OAK]);
    expect(s.folds()).toBe(0);
    await agreeOn(gw, [FERN, MOSS, OAK]);
    await gw.close();
  });

  it("a bulk of plain arrivals folds in one read: no scan, and the page equals a cold twin", async () => {
    const gw = await governedGarden();
    const standing = ["plant:b00150", "plant:b00750", "plant:b01350", MOSS];
    await gw.append(standing.map((n, i) => observed(n, "tag", "soft", 1100 + i, GARDENER_SEED)));
    expect(await page(gw)).toEqual(standing);
    const s = scans(gw);
    const bulk = Array.from({ length: 1500 }, (_, i) =>
      observed(`plant:b${String(1500 - i).padStart(5, "0")}`, "height", i, 2000 + i, GARDENER_SEED),
    ).filter(
      (d) =>
        !standing.includes(
          d.claims.pointers[0]!.target.kind === "entity"
            ? d.claims.pointers[0]!.target.entity.id
            : "",
        ),
    );
    await gw.append(bulk);
    s.reset();
    const first = await page(gw, { limit: 25 });
    expect(s.snapshots()).toBe(0);
    expect(s.scopes()).toBe(0);
    expect(s.folds()).toBe(bulk.length);
    const cold = slow(gw);
    expect(cold).toHaveLength(1501);
    expect(await page(gw, { limit: 25, after: "plant:b00140" })).toEqual(cold.slice(140, 165));
    expect(first).toEqual(cold.slice(0, 25));
    expect(await page(gw, { limit: 25, after: cold[750]! })).toEqual(cold.slice(751, 776));
    expect(await page(gw, { limit: 25, after: cold[1490]! })).toEqual(cold.slice(1491));
    await gw.close();
  }, 60_000);

  it("the warm fold keeps the order, takes a whole batch, and admits no unread context", async () => {
    const gw = await governedGarden();
    await gw.append([observed(MOSS, "tag", "soft", 1100, GARDENER_SEED)]);
    expect(await page(gw)).toEqual([MOSS]);
    const s = scans(gw);
    await gw.append([
      observed("plant:aaa", "height", 1, 1200, GARDENER_SEED),
      observed(OAK, "height", 900, 1300, GARDENER_SEED),
      observed("plant:zzz", "note", "unread", 1400, GARDENER_SEED),
    ]);
    s.reset();
    expect(await page(gw)).toEqual(["plant:aaa", MOSS, OAK]);
    expect(s.scopes()).toBe(0);
    expect(await page(gw, { after: "plant:" })).toEqual(["plant:aaa", MOSS, OAK]);
    await agreeOn(gw, ["plant:aaa", MOSS, OAK]);
    await gw.close();
  });

  it("the cursor seeks: every page of a walk equals the slow projection's slice", async () => {
    const gw = await governedGarden();
    const names = Array.from({ length: 40 }, (_, i) => `plant:w${String(i).padStart(2, "0")}`);
    await gw.append(names.map((n, i) => observed(n, "height", i, 1000 + i, GARDENER_SEED)));
    await page(gw);
    const cold = slow(gw);
    const s = scans(gw);
    const walked: string[] = [];
    let after: string | undefined;
    for (;;) {
      const next = await page(gw, { limit: 7, after });
      if (next.length === 0) break;
      const from = after === undefined ? 0 : cold.findIndex((id) => id > after!);
      expect(next).toEqual(cold.slice(from, from + 7));
      walked.push(...next);
      after = next[next.length - 1];
    }
    expect(walked).toEqual(names);
    expect(s.snapshots()).toBe(0);
    expect(s.scopes()).toBe(0);
    expect(await page(gw, { limit: 3, after: names[39]! })).toEqual([]);
    expect(await page(gw, { limit: 3, after: "plant:w05!" })).toEqual(names.slice(6, 9));
    expect(await served(gw, { limit: 3, after: "plant:w05!" })).toEqual(names.slice(6, 9));
    await gw.close();
  });
});

describe("the maintained candidate set — every path that changes membership reaches it", () => {
  it("a strike de-lists at both levels, a bystander stays, and a later append does not revive it", async () => {
    const gw = await governedGarden();
    const mossTag = observed(MOSS, "tag", "soft", 1100, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), mossTag]);
    await agreeOn(gw, [FERN, MOSS]);
    const s = scans(gw);
    await gw.append([signClaims(makeNegationClaims(GARDENER, 2000, mossTag.id), GARDENER_SEED)]);
    expect(gw.containerScope({ containers: [CONTAINER] }).some((d) => d.id === mossTag.id)).toBe(
      false,
    );
    s.reset();
    expect(await page(gw)).toEqual([FERN]);
    expect(s.scopes()).toBe(1);
    await gw.append([observed(OAK, "height", 900, 3000, GARDENER_SEED)]);
    s.reset();
    expect(await page(gw)).toEqual([FERN, OAK]);
    expect(s.scopes()).toBe(0);
    await agreeOn(gw, [FERN, OAK]);
    await gw.close();
  });

  it("striking the strike revives the member — the closure runs forward, both levels", async () => {
    const gw = await governedGarden();
    const mossTag = observed(MOSS, "tag", "soft", 1100, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), mossTag]);
    const strike = signClaims(makeNegationClaims(GARDENER, 2000, mossTag.id), GARDENER_SEED);
    await gw.append([strike]);
    await agreeOn(gw, [FERN]);
    await gw.append([signClaims(makeNegationClaims(GARDENER, 2100, strike.id), GARDENER_SEED)]);
    await agreeOn(gw, [FERN, MOSS]);
    await gw.close();
  });

  it("a strike that arrives BEFORE its target keeps the target off the page", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await agreeOn(gw, [FERN]);
    const mossTag = observed(MOSS, "tag", "soft", 1100, GARDENER_SEED);
    await gw.append([signClaims(makeNegationClaims(GARDENER, 2000, mossTag.id), GARDENER_SEED)]);
    expect(await page(gw)).toEqual([FERN]);
    await gw.append([mossTag]);
    await agreeOn(gw, [FERN]);
    await gw.close();
  });

  it("the operator's own DATA folds as plain; the operator's LAW rebuilds", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await agreeOn(gw, [FERN]);
    const s = scans(gw);
    const opClaim = observed(MOSS, "tag", "op", 1100, OPERATOR_SEED);
    await gw.append([opClaim]);
    s.reset();
    expect(await page(gw)).toEqual([FERN, MOSS]);
    expect(s.scopes()).toBe(0);
    expect(s.snapshots()).toBe(0);
    await agreeOn(gw, [FERN, MOSS]);
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "container:other",
            trust: "curated",
            posture: "shared",
            membership: { op: "select", pred: { hasPointer: { targetEntity: OAK } }, in: "input" },
          },
          OPERATOR,
          1200,
        ),
        OPERATOR_SEED,
      ),
    ]);
    s.reset();
    expect(await page(gw)).toEqual([FERN, MOSS]);
    expect(s.scopes()).toBe(1);
    await gw.append([signClaims(makeNegationClaims(OPERATOR, 1300, opClaim.id), OPERATOR_SEED)]);
    s.reset();
    expect(await page(gw)).toEqual([FERN]);
    expect(s.scopes()).toBe(1);
    await agreeOn(gw, [FERN]);
    await gw.close();
  });

  it("exclusion empties the warm page; re-inclusion restores it; another excluded container subtracts", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "tag", "soft", 1100, GARDENER_SEED),
    ]);
    await agreeOn(gw, [FERN, MOSS]);
    const exclusion = signClaims(exclusionClaims(CONTAINER, OPERATOR, 3000), OPERATOR_SEED);
    await gw.append([exclusion]);
    await agreeOn(gw, []);
    await gw.append([observed("plant:excluded-era", "height", 1, 3050, GARDENER_SEED)]);
    await agreeOn(gw, []);
    await gw.append([signClaims(makeNegationClaims(OPERATOR, 3100, exclusion.id), OPERATOR_SEED)]);
    await agreeOn(gw, ["plant:excluded-era", FERN, MOSS]);
    const s = scans(gw);
    s.reset();
    expect(await page(gw)).toEqual(["plant:excluded-era", FERN, MOSS]);
    expect(s.scopes()).toBe(0);
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "container:mossy",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { hasPointer: { targetEntity: MOSS } },
              in: "input",
            },
          },
          OPERATOR,
          3200,
        ),
        OPERATOR_SEED,
      ),
      signClaims(exclusionClaims("container:mossy", OPERATOR, 3300), OPERATOR_SEED),
    ]);
    await agreeOn(gw, ["plant:excluded-era", FERN]);
    await gw.append([
      observed(OAK, "height", 900, 3400, GARDENER_SEED),
      observed(MOSS, "height", 2, 3500, GARDENER_SEED),
    ]);
    await agreeOn(gw, ["plant:excluded-era", FERN, OAK]);
    await gw.close();
  });

  it("an evolved lens that narrows the contexts narrows the warm page", async () => {
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
    const sketch = (g: Gateway) => listingPageImpl(g, "Sketch", { limit: 25 });
    expect(await sketch(gw)).toEqual([FERN, MOSS]);
    expect(await sketch(gw)).toEqual([FERN, MOSS]);
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["watered", pickLatest]]), default: pickLatest },
      [FERN],
    );
    expect(await sketch(gw)).toEqual([FERN]);
    expect((await gw.list("Sketch")).map((n) => n.entity)).toEqual([FERN]);
    await gw.close();
  });

  it("an erasure reseats the reactor, and the index follows the fresh one", async () => {
    const gw = await governedGarden();
    const mossTag = observed(MOSS, "tag", "soft", 1100, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), mossTag]);
    await agreeOn(gw, [FERN, MOSS]);
    await gw.erase(mossTag.id, { reason: "asked to be forgotten" });
    expect(gw.reactor.get(mossTag.id)).toBeUndefined();
    await agreeOn(gw, [FERN]);
    await gw.append([observed(OAK, "height", 900, 3000, GARDENER_SEED)]);
    await agreeOn(gw, [FERN, OAK]);
    await gw.close();
  });
});

describe("the maintained candidate set — under a trust mask that reads the ground", () => {
  const MALLORY_SEED = "ee".repeat(32);
  const MALLORY = authorForSeed(MALLORY_SEED);
  const GUARDED: HyperSchema = { name: "Guarded", alg: 1, body: governedGatherBody(OPERATOR) };
  const DEPUTIZED: HyperSchema = {
    name: "Deputized",
    alg: 1,
    body: entityGatherBody({
      mask: {
        trust: {
          inView: {
            term: {
              op: "select",
              pred: { hasPointer: { role: { exact: "deputize" } } },
              in: "input",
            },
            field: "author",
            extract: { field: "author" },
          },
        },
      },
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
  const listed = async (gw: Gateway, lens: string): Promise<string[]> =>
    (await gw.list(lens, { limit: 25 })).map((n) => n.entity);
  const ids = (gw: Gateway, lens: string) => listingPageImpl(gw, lens, { limit: 25 });

  it("an unmasked body: nothing suppresses, so nothing feeds — a stranger's claim stays O(1)", async () => {
    const UNMASKED: HyperSchema = {
      name: "Unmasked",
      alg: 1,
      body: parseTerm({
        op: "group",
        key: "byTargetContext",
        in: { op: "select", pred: { hasPointer: { targetEntity: { var: "root" } } }, in: "input" },
      }),
    };
    const { gw } = await heckled(UNMASKED);
    expect(await ids(gw, "Unmasked")).toEqual([FERN, MOSS]);
    const s = scans(gw);
    await gw.federate([observed(OAK, "height", 1, 3100, MALLORY_SEED)]);
    s.reset();
    expect(await ids(gw, "Unmasked")).toEqual([FERN, MOSS, OAK]);
    expect(s.scopes()).toBe(0);
    await gw.close();
  });

  it("the governed body: a stranger's claim stays O(1), and a late grant binds the dormant strike", async () => {
    const { gw } = await heckled(GUARDED);
    expect(await ids(gw, "Guarded")).toEqual([FERN, MOSS]);
    const s = scans(gw);
    await gw.federate([observed(OAK, "height", 1, 3100, MALLORY_SEED)]);
    s.reset();
    expect(await ids(gw, "Guarded")).toEqual([FERN, MOSS, OAK]);
    expect(s.scopes()).toBe(0);
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, MALLORY, "write", OPERATOR, 3200), OPERATOR_SEED),
    ]);
    s.reset();
    expect(await ids(gw, "Guarded")).toEqual([FERN, OAK]);
    expect(s.scopes()).toBe(1);
    expect(await listed(gw, "Guarded")).toEqual([FERN, OAK]);
    await gw.close();
  });

  it("a mask this door cannot bound: every moved read rebuilds, and every page is still right", async () => {
    const ALIASED: HyperSchema = {
      name: "Aliased",
      alg: 1,
      body: entityGatherBody({
        mask: {
          trust: {
            or: [
              {
                inView: {
                  term: {
                    op: "select",
                    pred: {
                      and: [
                        { hasPointer: { role: { exact: "deputize" } } },
                        { hasPointer: { context: { aliased: { name: "deputy" } } } },
                      ],
                    },
                    in: "input",
                  },
                  field: "author",
                  extract: { field: "author" },
                },
              },
              { match: { field: "author", cmp: "eq", const: OPERATOR } },
            ],
          },
        },
      }),
    };
    const { gw } = await heckled(ALIASED);
    expect(await ids(gw, "Aliased")).toEqual([FERN, MOSS]);
    const s = scans(gw);
    expect(await ids(gw, "Aliased")).toEqual([FERN, MOSS]);
    expect(s.scopes()).toBe(0);
    await gw.federate([observed(OAK, "height", 1, 3100, MALLORY_SEED)]);
    s.reset();
    expect(await ids(gw, "Aliased")).toEqual([FERN, MOSS, OAK]);
    expect(s.scopes()).toBe(1);
    expect(await listed(gw, "Aliased")).toEqual([FERN, MOSS, OAK]);
    await gw.close();
  });

  it("a mask fed by strangers: the feeding claim rebuilds and binds the strike; others stay O(1)", async () => {
    const { gw } = await heckled(DEPUTIZED);
    expect(await ids(gw, "Deputized")).toEqual([FERN, MOSS]);
    const s = scans(gw);
    await gw.federate([observed(OAK, "height", 1, 3100, MALLORY_SEED)]);
    s.reset();
    expect(await ids(gw, "Deputized")).toEqual([FERN, MOSS, OAK]);
    expect(s.scopes()).toBe(0);
    await gw.federate([
      signClaims(
        {
          timestamp: 3200,
          validFrom: 3200,
          author: MALLORY,
          pointers: [{ role: "deputize", target: { kind: "entity", entity: { id: "plant:oak" } } }],
        },
        MALLORY_SEED,
      ),
    ]);
    s.reset();
    expect(await ids(gw, "Deputized")).toEqual([FERN, OAK]);
    expect(s.scopes()).toBe(1);
    expect(await listed(gw, "Deputized")).toEqual([FERN, OAK]);
    await gw.close();
  });
});

describe("the maintained candidate set — an inbox pool composes in from another reactor", () => {
  const CONN_SEED = "c3".repeat(32);
  it("a claim written into the inbox lists without ever touching the primary log", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await agreeOn(gw, [FERN]);
    const inbox = await gw.bindConnection({
      container: CONTAINER,
      connectionKey: authorForSeed(CONN_SEED),
      ownerSeed: OPERATOR_SEED,
    });
    await inbox.gateway!.append([observed(MOSS, "tag", "inbox", 1100, CONN_SEED)]);
    expect(slow(gw)).toEqual([FERN, MOSS]);
    expect(await page(gw)).toEqual([FERN, MOSS]);
    expect(await served(gw)).toEqual([FERN, MOSS]);
    expect(await door(gw)).toEqual([FERN, MOSS]);
    await gw.append([observed(OAK, "height", 900, 1200, GARDENER_SEED)]);
    expect(await page(gw)).toEqual([FERN, MOSS, OAK]);
    expect(await served(gw)).toEqual([FERN, MOSS, OAK]);
    await inbox.gateway!.append([observed("plant:pond", "tag", "inbox", 1300, CONN_SEED)]);
    expect(await page(gw)).toEqual([FERN, MOSS, OAK, "plant:pond"]);
    expect(await door(gw)).toEqual([FERN, MOSS, OAK, "plant:pond"]);
    await gw.close();
  });
});
