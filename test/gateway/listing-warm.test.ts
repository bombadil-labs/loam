// The listing door's MAINTAINED candidate set (ticket T163), railed at both levels and two-sided:
//
//   FAST = SLOW — every page the maintained index serves is the page a cold read over the same
//   ground serves: the projection of `containerScope` on this gateway, AND a FRESH gateway opened
//   over the same backend (no index at all). The index may only ever be a faster way to the same
//   answer.
//
//   AND THE COST DROPPED — the warm path is proven not to scan: `reactor.snapshot` (the copy every
//   O(ground) walk in this codebase pays) and `containerScope` are spied, and a warm page calls
//   neither; the paths that must rebuild (a strike, an act of law) call `containerScope` exactly
//   once. Deterministic — no clock — so it cannot flake under load; the numbers themselves live in
//   `listing-scale.bench.test.ts` and the ticket's PR.
//
//   EVERY PATH THAT CHANGES MEMBERSHIP REACHES THE INDEX (H8's stale-index trap): a plain append,
//   a strike (H1: the struck member de-lists and a later plain append must not resurrect it), a
//   revived strike, a strike that arrives BEFORE its target, an operator-authored claim, an
//   exclusion and its re-inclusion, an evolved lens that narrows the contexts, an erasure that
//   reseats the reactor. Each is asserted at the delta level (`listingPage`, the id seam) and at
//   the object level (`gw.list` / the GraphQL door), with a live bystander surviving where a
//   member drops.
//
// Deliberately NOT here: cost 3. A cold `resolvedNode` is still O(ground) per listed entity — the
// point door's own cost, out of this door's hands; the bench measures it and the ticket names it.

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
import { containerClaims, exclusionClaims } from "../../src/gateway/container.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";

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

// A fresh gateway over a COPY of the same ground: it holds no index, so its first page is a cold
// read (a copy rather than the shared backend, so closing the twin does not close the store).
async function coldTwin(gw: Gateway): Promise<Gateway> {
  const copy = new MemoryBackend();
  await copy.append(await gw.backend.deltasSince(new Set()));
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

// Assert the fast page, the served page, the door, the slow projection, and a cold twin agree.
async function agreeOn(gw: Gateway, expected: string[]): Promise<void> {
  expect(await page(gw)).toEqual(expected);
  expect(slow(gw)).toEqual(expected);
  expect(await served(gw)).toEqual(expected);
  expect(await door(gw)).toEqual(expected);
  const twin = await coldTwin(gw);
  expect(await page(twin)).toEqual(expected);
  await twin.close();
}

// The two scans a page must not pay: the snapshot copy and the scope read.
function scans(gw: Gateway): { snapshots: () => number; scopes: () => number; reset: () => void } {
  const snap = vi.spyOn(gw.reactor, "snapshot");
  const scope = vi.spyOn(gw, "containerScope");
  return {
    snapshots: () => snap.mock.calls.length,
    scopes: () => scope.mock.calls.length,
    reset: () => {
      snap.mockClear();
      scope.mockClear();
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
    expect(await page(gw)).toEqual([FERN, MOSS]); // the first read builds the index
    const s = scans(gw);
    expect(await page(gw)).toEqual([FERN, MOSS]);
    expect(s.snapshots()).toBe(0);
    expect(s.scopes()).toBe(0);
    // A plain append (a stranger's claim, no strike) reaches the index in O(1): the entity is
    // listed at once, and still nothing scanned.
    await gw.append([observed(OAK, "height", 900, 1200, GARDENER_SEED)]);
    s.reset();
    expect(await page(gw)).toEqual([FERN, MOSS, OAK]);
    expect(s.snapshots()).toBe(0);
    expect(s.scopes()).toBe(0);
    await agreeOn(gw, [FERN, MOSS, OAK]);
    await gw.close();
  });

  it("the warm fold keeps the order, takes a whole batch, and admits no unread context", async () => {
    const gw = await governedGarden();
    await gw.append([observed(MOSS, "tag", "soft", 1100, GARDENER_SEED)]);
    expect(await page(gw)).toEqual([MOSS]);
    const s = scans(gw);
    // Two entities in one batch, one sorting BEFORE everything listed so far, and a claim in a
    // context no lens reads (`note`) for a third entity that must therefore not list.
    await gw.append([
      observed("plant:aaa", "height", 1, 1200, GARDENER_SEED),
      observed(OAK, "height", 900, 1300, GARDENER_SEED),
      observed("plant:zzz", "note", "unread", 1400, GARDENER_SEED),
    ]);
    s.reset();
    expect(await page(gw)).toEqual(["plant:aaa", MOSS, OAK]);
    expect(s.scopes()).toBe(0);
    // A cursor below the first id starts at the first id.
    expect(await page(gw, { after: "plant:" })).toEqual(["plant:aaa", MOSS, OAK]);
    await agreeOn(gw, ["plant:aaa", MOSS, OAK]);
    await gw.close();
  });

  it("the cursor seeks: every page of a walk equals the slow projection's slice", async () => {
    const gw = await governedGarden();
    const names = Array.from({ length: 40 }, (_, i) => `plant:w${String(i).padStart(2, "0")}`);
    await gw.append(names.map((n, i) => observed(n, "height", i, 1000 + i, GARDENER_SEED)));
    await page(gw); // build
    const cold = slow(gw); // the whole set, once, before the spies — the walk must match its slices
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
    // Exclusive cursor, past the end, and between two ids: the same three answers a cold read gives.
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
    // Delta level: the struck claim is out of the scope; the index rebuilt from that scope, once.
    expect(gw.containerScope({ containers: [CONTAINER] }).some((d) => d.id === mossTag.id)).toBe(
      false,
    );
    s.reset();
    expect(await page(gw)).toEqual([FERN]);
    expect(s.scopes()).toBe(1);
    // The failure that matters most: a plain append after the strike takes the O(1) path, and the
    // struck member must NOT come back with it.
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
    // The claim lands already struck: not plain, so it must not be folded in as a member.
    await gw.append([mossTag]);
    await agreeOn(gw, [FERN]);
    await gw.close();
  });

  it("an operator-authored claim is law-shaped to the index: it rebuilds, and lists correctly", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await agreeOn(gw, [FERN]);
    const s = scans(gw);
    await gw.append([observed(MOSS, "tag", "op", 1100, OPERATOR_SEED)]);
    s.reset();
    expect(await page(gw)).toEqual([FERN, MOSS]);
    expect(s.scopes()).toBe(1);
    await agreeOn(gw, [FERN, MOSS]);
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
    // While the exclusion stands, a plain append must not be folded in as if the set were plain.
    await gw.append([observed("plant:excluded-era", "height", 1, 3050, GARDENER_SEED)]);
    await agreeOn(gw, []);
    await gw.append([signClaims(makeNegationClaims(OPERATOR, 3100, exclusion.id), OPERATOR_SEED)]);
    await agreeOn(gw, ["plant:excluded-era", FERN, MOSS]);
    const s = scans(gw);
    s.reset();
    expect(await page(gw)).toEqual(["plant:excluded-era", FERN, MOSS]);
    expect(s.scopes()).toBe(0); // plain again, and warm again
    // A DIFFERENT container, excluded: its members subtract from every scope, this one included.
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
    // And a plain append while that exclusion stands still lists correctly (the slow path): oak
    // lists, and a fresh claim about moss — a member of the excluded container — does not.
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
    expect(await sketch(gw)).toEqual([FERN, MOSS]); // warm
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
    // And the fresh reactor's index keeps following: a plain append after the purge lists.
    await gw.append([observed(OAK, "height", 900, 3000, GARDENER_SEED)]);
    await agreeOn(gw, [FERN, OAK]);
    await gw.close();
  });
});

// A TRUST mask decides who counts as a striker by reading the ground, so a delta that is no strike
// and no law can still change membership: it can make a dormant strike bind. The index must see
// that coming or rebuild — a stranger's claim must never be folded in as if it changed nothing.
describe("the maintained candidate set — under a trust mask that reads the ground", () => {
  const MALLORY_SEED = "ee".repeat(32);
  const MALLORY = authorForSeed(MALLORY_SEED);
  const GUARDED: HyperSchema = { name: "Guarded", alg: 1, body: governedGatherBody(OPERATOR) };
  // Anyone who has ever carried a `deputize` pointer is a trusted striker — deliberately fed by
  // strangers' plain claims, the shape the governed body's operator-minted grants never take.
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
    expect(await ids(gw, "Guarded")).toEqual([FERN, MOSS]); // mallory's strike is inert
    const s = scans(gw);
    // A stranger's plain claim cannot feed the operator-minted grants the mask reads: no rebuild.
    await gw.federate([observed(OAK, "height", 1, 3100, MALLORY_SEED)]);
    s.reset();
    expect(await ids(gw, "Guarded")).toEqual([FERN, MOSS, OAK]);
    expect(s.scopes()).toBe(0);
    // The operator grants mallory standing: the strike that was inert now binds, and moss must
    // leave the page at both levels while fern and oak stay.
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, MALLORY, "write", OPERATOR, 3200), OPERATOR_SEED),
    ]);
    expect(await ids(gw, "Guarded")).toEqual([FERN, OAK]);
    expect(await listed(gw, "Guarded")).toEqual([FERN, OAK]);
    await gw.close();
  });

  it("a mask this door cannot bound: every moved read rebuilds, and every page is still right", async () => {
    // An aliased closure expands against the ground, so no delta is provably plain here — and it
    // sits under an `and` inside the sub-view and an `or` at the trust level, so a walk that lets
    // one bounded side vouch for the pair would wrongly call the whole mask bounded.
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
    expect(s.scopes()).toBe(0); // nothing moved: the index stands
    await gw.federate([observed(OAK, "height", 1, 3100, MALLORY_SEED)]);
    s.reset();
    expect(await ids(gw, "Aliased")).toEqual([FERN, MOSS, OAK]);
    expect(s.scopes()).toBe(1); // moved: rebuilt, not folded
    expect(await listed(gw, "Aliased")).toEqual([FERN, MOSS, OAK]);
    await gw.close();
  });

  it("a mask fed by strangers: the feeding claim rebuilds and binds the strike; others stay O(1)", async () => {
    const { gw } = await heckled(DEPUTIZED);
    expect(await ids(gw, "Deputized")).toEqual([FERN, MOSS]);
    const s = scans(gw);
    // A plain claim that does NOT carry the deputizing role: folded in without a scan.
    await gw.federate([observed(OAK, "height", 1, 3100, MALLORY_SEED)]);
    s.reset();
    expect(await ids(gw, "Deputized")).toEqual([FERN, MOSS, OAK]);
    expect(s.scopes()).toBe(0);
    // Mallory deputizes herself with an ordinary claim — no strike, no law. Her earlier strike now
    // binds: the page must drop moss, at both levels, and the index must have rebuilt to know it.
    await gw.federate([
      signClaims(
        {
          timestamp: 3200,
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

// An inbox pool bound to the listing container composes its members into the scope from a reactor
// the index does not follow (SPEC §39). The door must not fold on the primary log as if that were
// the whole ground: while an active inbox stands it reads the scope, and every level agrees.
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
    // Delta level: the scope holds the inbox claim; the page holds moss; the door serves it.
    expect(slow(gw)).toEqual([FERN, MOSS]);
    expect(await page(gw)).toEqual([FERN, MOSS]);
    expect(await served(gw)).toEqual([FERN, MOSS]);
    expect(await door(gw)).toEqual([FERN, MOSS]);
    // A plain append to the primary while the inbox stands still lists, beside the inbox's member.
    await gw.append([observed(OAK, "height", 900, 1200, GARDENER_SEED)]);
    expect(await page(gw)).toEqual([FERN, MOSS, OAK]);
    expect(await served(gw)).toEqual([FERN, MOSS, OAK]);
    // A SECOND inbox write, with the primary log standing still: nothing on the primary marks the
    // move, so a door reading a maintained index here would serve a stale page. It must not.
    await inbox.gateway!.append([observed("plant:pond", "tag", "inbox", 1300, CONN_SEED)]);
    expect(await page(gw)).toEqual([FERN, MOSS, OAK, "plant:pond"]);
    expect(await door(gw)).toEqual([FERN, MOSS, OAK, "plant:pond"]);
    await gw.close();
  });
});
