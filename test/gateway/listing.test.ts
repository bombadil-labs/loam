// The listing door (ticket T110), railed at BOTH levels (the P3 rule):
//
//   OBJECT — what the door serves: `plants(limit, after)` on the AUTHED GraphQL surface names
//   the distinct entities holding Plant evidence, resolved through the lens, sparse views and
//   all; the public/read surface refuses the field exactly as it refuses one that never existed.
//
//   DELTA — what the container actually holds: the first listing declares a lawful shared
//   container backing the hyperschema (`container:hyperschema:Plant`), its membership Term is
//   the gather's selection un-rooted, its member set is exactly the evidence deltas, and the
//   container ALGEBRA is load-bearing — excluding the container empties the listing, which a
//   bespoke scan could never honor.
//
// Deliberate gaps, named: `select` applies no dead-set filter, so a condemned-but-not-yet-purged
// delta still lists until its purge lands — T90 owns aligning the point-read doors, and the rail
// that closes it belongs there. Claims in contexts no registered lens reads as a prop are not
// members (evidence-level membership is "bucketed how", and the buckets are the props); a
// dynamic-only entity is invisible to the listing by design.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  LISTING_MAX_LIMIT,
  listingContainerName,
  listingMembershipJson,
} from "../../src/gateway/listing.js";
import { exclusionClaims } from "../../src/gateway/container.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
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
      observed(MOSS, "tag", "soft", 1200, GARDENER_SEED), // no height: resolves sparse
      observed(OAK, "height", 900, 1300, GARDENER_SEED),
    ]);
    const read = await gw.query(`{ plants { _entity height tag } }`);
    expect(read.errors).toBeUndefined();
    const plants = (read.data as { plants: { _entity: string; height: unknown; tag: unknown }[] })
      .plants;
    // Ascending by entity id, and NOT bounded by the registered roots: moss and oak are no
    // gateway root, and the listing still finds them — enumeration reads the container, not
    // the root list.
    expect(plants.map((p) => p._entity)).toEqual([FERN, MOSS, OAK]);
    // The §14 edge rides along: evidence-level membership, per-lens resolution — moss holds
    // Plant evidence yet resolves with no height. Absence stays absence.
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
    // Through the door, the same page: the args ride the field.
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
    await gw.close();
  });

  it("refuses an unregistered lens in the door's own voice", async () => {
    const gw = await governedGarden();
    await expect(gw.list("Nope")).rejects.toThrow(/no registered schema named Nope/);
    await gw.close();
  });

  it("refuses on an ungoverned store: no operator, no container, no silent fallback", async () => {
    const gw = await Gateway.open(new MemoryBackend()); // no seed
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
    expect(gw.containers().containers.size).toBe(0); // nothing declared before the first list
    await gw.list("Plant");
    const name = listingContainerName("Plant");
    const declared = gw.containers().containers.get(name);
    expect(declared).toBeDefined();
    expect(declared!.trust).toBe("curated");
    expect(declared!.posture).toBe("shared");
    // The membership Term is the gather's selection un-rooted: the lens's prop contexts, sorted.
    expect(declared!.membership).toEqual(
      listingMembershipJson(["height", "readings", "tag", "watered"]),
    );
    // And the container HOLDS exactly the evidence, as deltas.
    const members = gw.containerScope({ containers: [name] });
    expect(members.map((d) => d.id).sort()).toEqual(evidence.map((d) => d.id).sort());
    await gw.close();
  });

  it("a claim in a context no lens reads is not a member — bucketed how, not merely at whom", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "aroma", "loamy", 1100, GARDENER_SEED), // no lens reads "aroma" as a prop
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
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]); // "note" is nobody's prop yet
    // A sibling lens over the SAME hyperschema (§21.7) reads "note" as a prop.
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    // Delta level: the container's membership re-declares with the widened context union...
    await gw.list("Sketch");
    const declared = gw.containers().containers.get(listingContainerName("Plant"));
    expect(declared!.membership).toEqual(
      listingMembershipJson(["height", "note", "readings", "tag", "watered"]),
    );
    // ...and object level: the ONE maintained candidate set now feeds EVERY lens over the
    // hyperschema — moss lists through Sketch and through Plant alike.
    expect(entitiesOf(await gw.list("Sketch"))).toEqual([FERN, MOSS]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN, MOSS]);
    await gw.close();
  });

  it("suppression closes at both levels: the struck claim's entity drops, bystanders stay", async () => {
    const gw = await governedGarden();
    const mossTag = observed(MOSS, "tag", "soft", 1200, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), mossTag]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN, MOSS]);
    // The author retracts their own claim — an ordinary negation delta.
    await gw.append([signClaims(makeNegationClaims(GARDENER, 2000, mossTag.id), GARDENER_SEED)]);
    // Delta level: the struck claim is no longer a member (mask "drop" runs over the ground).
    const members = gw.containerScope({ containers: [listingContainerName("Plant")] });
    expect(members.some((d) => d.id === mossTag.id)).toBe(false);
    // Object level: the door no longer names moss; the live bystander survives (two-sided).
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    await gw.close();
  });

  it("the container algebra is load-bearing: excluding the container empties the listing", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    const name = listingContainerName("Plant");
    await gw.append([signClaims(exclusionClaims(name, OPERATOR, 3000), OPERATOR_SEED)]);
    // A listing that bypassed the container scope would still serve fern here. It must not:
    // the enumeration IS a container read, so the operator's exclusion governs it.
    expect(await gw.list("Plant")).toEqual([]);
    const read = await gw.query(`{ plants { _entity } }`);
    expect((read.data as { plants: unknown[] }).plants).toEqual([]);
    await gw.close();
  });
});

describe("the listing door — the refusal shapes: authed only", () => {
  it("the public surface refuses the field exactly as one that never existed", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gw.declarePublic(["Plant"]);
    // The public read surface serves the singular field...
    const point = await gw.queryPublic(`{ plant(entity: "${FERN}") { height } }`);
    expect((point.data as { plant: { height: number } }).plant.height).toBe(30);
    // ...and the listing field is a validation impossibility on it, byte-for-byte the refusal
    // a never-registered field gets (modulo the name asked for): no oracle distinguishes "this
    // exists behind a token" from "this does not exist".
    const listing = await gw.queryPublic(`{ plants { _entity } }`);
    const nonsense = await gw.queryPublic(`{ plantz { _entity } }`);
    expect(listing.data).toBeUndefined();
    expect(listing.errors).toHaveLength(1);
    expect(listing.errors![0]!.replace(`"plants"`, `"plantz"`)).toBe(nonsense.errors![0]);
    await gw.close();
  });
});
