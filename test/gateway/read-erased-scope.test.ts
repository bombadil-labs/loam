// The serving reads outside the store's own gathers never show an erased delta either: the
// user and role records behind login and admin checks, a bound connection's scope when only a pool
// holds the erasure, and the entity listing. Each case keeps the erased bytes held, and names a
// bystander that must still show. A last case pins that a duplicate erasure ends no stream.

import { describe, expect, it } from "vitest";
import { authorForSeed, Reactor, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { listingPageImpl } from "../../src/gateway/listing.js";
import { boundGroundFor } from "../../src/gateway/reads.js";
import { roleClaims, rolesOf, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "9c".repeat(32);
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

/** A store with one shared container `home:ada`, and `n` bound connection pools inside it. */
async function homeWithPools(n: number): Promise<{
  gw: Gateway;
  pools: { gw: Gateway; binding: { container: string; inbox: string } }[];
}> {
  const gw = await boot();
  await gw.append([signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 500), OP_SEED)]);
  await gw.append([
    signClaims(
      containerClaims(
        {
          container: "home:ada",
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { match: { field: "author", cmp: "eq", const: GARDENER } },
            in: "input",
          },
        },
        OP,
        600,
      ),
      OP_SEED,
    ),
  ]);
  const pools = [];
  for (let i = 0; i < n; i++) {
    const inbox = (
      await gw.bindConnection({
        container: "home:ada",
        connectionKey: authorForSeed(
          String(i + 1)
            .padStart(2, "d")
            .repeat(32),
        ),
        ownerSeed: GARDENER_SEED,
      })
    ).entity!;
    pools.push({
      gw: gw.connectionInboxes.get(inbox)!.gateway!,
      binding: { container: "home:ada", inbox },
    });
  }
  return { gw, pools };
}

describe("serving reads outside the gathers never show an erased delta", () => {
  it("an erased role record stops counting at once; the bystander role still counts", () => {
    const reactor = new Reactor();
    const user = signClaims(userClaims("ada", OP, 1), OP_SEED);
    const operatorRole = signClaims(roleClaims("ada", "operator", OP, 2), OP_SEED);
    const viewerRole = signClaims(roleClaims("ada", "actor", OP, 3), OP_SEED);
    for (const d of [user, operatorRole, viewerRole]) reactor.ingest(d);
    expect(rolesOf(reactor, OP, Date.now(), "ada")).toEqual(new Set(["operator", "actor"])); // control

    reactor.ingest(signClaims(eraseClaims(operatorRole.id, OP, OP, 4), OP_SEED));
    expect(reactor.get(operatorRole.id)).toBeDefined(); // bytes still held
    expect(rolesOf(reactor, OP, Date.now(), "ada")).toEqual(new Set(["actor"]));
  });

  it("a bound connection's scope drops a claim that only its pool has erased", async () => {
    const gw = await boot();
    await gw.append([signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 500), OP_SEED)]);
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: GARDENER } },
              in: "input",
            },
          },
          OP,
          600,
        ),
        OP_SEED,
      ),
    ]);
    const inbox = (
      await gw.bindConnection({
        container: "home:ada",
        connectionKey: authorForSeed("d1".repeat(32)),
        ownerSeed: GARDENER_SEED,
      })
    ).entity!;
    const pool = gw.connectionInboxes.get(inbox)!.gateway!;
    const claim = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, GARDENER_SEED);
    await pool.append([claim, bystander]);
    const binding = { container: "home:ada", inbox };
    const before = boundGroundFor(gw, binding, Date.now());
    expect(before.has(claim.id)).toBe(true); // control

    await pool.append([signClaims(eraseClaims(claim.id, GARDENER, OP, 2000), OP_SEED)]);
    expect(pool.reactor.get(claim.id)).toBeDefined(); // still held in the pool
    expect(gw.reactor.get(claim.id)).toBeUndefined(); // the parent never saw either
    const after = boundGroundFor(gw, binding, Date.now());
    expect(after.has(claim.id)).toBe(false);
    expect(after.has(bystander.id)).toBe(true);
    await gw.close();
  });

  it("a bound scope drops a claim only a pool holds when the PARENT erased it", async () => {
    const { gw, pools } = await homeWithPools(1);
    const pool = pools[0]!;
    const claim = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, GARDENER_SEED);
    await pool.gw.append([claim, bystander]);
    await gw.append([signClaims(eraseClaims(claim.id, GARDENER, OP, 2000), OP_SEED)]);
    expect(gw.reactor.get(claim.id)).toBeUndefined(); // the parent never held the claim
    expect(pool.gw.reactor.get(claim.id)).toBeDefined(); // the pool still does

    const ground = boundGroundFor(gw, pool.binding, Date.now());
    expect(ground.has(claim.id)).toBe(false);
    expect(ground.has(bystander.id)).toBe(true);

    // The bound listing enumerates the same composed scope.
    const ROSE = "plant:rose";
    const rose = observed(ROSE, "height", 12, 1200, GARDENER_SEED);
    await pool.gw.append([rose]);
    await gw.append([signClaims(eraseClaims(rose.id, GARDENER, OP, 2100), OP_SEED)]);
    const page = await listingPageImpl(gw, "Plant", {}, pool.binding);
    expect(page).not.toContain(ROSE);
    expect(page).toContain(FERN);
    await gw.close();
  });

  it("a pool's erasure naming the wrong author does not hide a sibling pool's claim (a control: passes on the base; fails without the author check)", async () => {
    const { gw, pools } = await homeWithPools(2);
    const claim = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    // Lawful at the first pool's door, because the target is absent there.
    await pools[0]!.gw.append([signClaims(eraseClaims(claim.id, OP, OP, 2000), OP_SEED)]);
    await pools[1]!.gw.append([claim]);
    expect(boundGroundFor(gw, pools[1]!.binding, Date.now()).has(claim.id)).toBe(true);
    await gw.close();
  });

  it("the listing omits an entity whose only claim is erased, and lists the bystander", async () => {
    const gw = await boot();
    const ROSE = "plant:rose";
    const roseClaim = observed(ROSE, "height", 12, 1000, OP_SEED);
    const fernClaim = observed(FERN, "height", 30, 1100, OP_SEED);
    await gw.append([roseClaim, fernClaim]);
    const listed = async () => (await gw.list("Plant")).map((n) => n.entity);
    expect(await listed()).toEqual(expect.arrayContaining([ROSE, FERN])); // control

    await gw.append([signClaims(eraseClaims(roseClaim.id, OP, OP, 2000), OP_SEED)]);
    expect(gw.reactor.get(roseClaim.id)).toBeDefined();
    const after = await listed();
    expect(after).not.toContain(ROSE);
    expect(after).toContain(FERN);
    await gw.close();
  });

  it("a duplicate erasure ends no stream (a control: passes on the base; fails if duplicates trigger)", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const other = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, other]);
    const erasure = signClaims(eraseClaims(claim.id, OP, OP, 2000), OP_SEED);
    await gw.append([erasure]);

    const stream = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
    await stream.next();
    await gw.federate([erasure]); // a repeated pull of the same erasure
    await gw.append([erasure]);
    await gw.query(`mutation { plant(entity: "${FERN}", tag: "sun") { tag } }`);
    const next = await stream.next();
    expect(next.done).toBe(false); // still live: it received the mutation
    await stream.return(undefined);
    await gw.close();
  });
});
