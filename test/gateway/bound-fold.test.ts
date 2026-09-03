// T263 — THE BOUND FOLD at the library seam (SPEC §58 position 2; Myk's ruling 2026-09-03: a
// bound connection's law serves only its container). Two inbox pools in ONE container may each
// publish the same lens name, and the fold must answer the contest the same way whoever asks and
// however the pools were attached. The rule is REGISTRATION order: the earlier binding keeps the
// name, the later one is refused with the collision named, and the answer does not change when
// the pools are re-attached in another order — which is what a reboot does.
//
// Why here and not through the doors: consent binds one pool per (user, container), so two pools
// in one container need two connection keys bound at this seam, the way `binding-route.test.ts`
// binds its one. The door-level rails for the same fold are in test/server/derived-standing.test.ts.
//
// REVERT PROBE, measured: drop the candidate sort in `boundBindingsImpl` and BOTH cases go red —
// pool A (attached first) wins the name it registered LAST, and the answer flips on re-attach.
//
// RAILS-RED on origin/main: both cases red, because `boundSurface` does not exist there. That is
// an honest red and a WEAK one — it cannot tell a right ordering from a wrong one; the probe above
// is the measurement that can.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { lensOf } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = GARDENER_SEED;
const OWNER = GARDENER;
const CONN_A = authorForSeed("a1".repeat(32));
const CONN_B = authorForSeed("b2".repeat(32));
const HOME = "home:alice";
const LENS = "home:alice:x";

const ALICES_OWN = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OWNER } },
  in: "input",
};

async function twoPools(): Promise<{ gw: Gateway; a: string; b: string }> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([signClaims(grantClaims(STORE_ENTITY, OWNER, "write", OP, 500), OP_SEED)]);
  await gw.append([
    signClaims(
      containerClaims(
        { container: HOME, trust: "curated", posture: "shared", membership: ALICES_OWN },
        OP,
        600,
      ),
      OP_SEED,
    ),
  ]);
  // A is attached FIRST, B second — the order a Map iterates them.
  const a = (
    await gw.bindConnection({ container: HOME, connectionKey: CONN_A, ownerSeed: OWNER_SEED })
  ).entity!;
  const b = (
    await gw.bindConnection({ container: HOME, connectionKey: CONN_B, ownerSeed: OWNER_SEED })
  ).entity!;
  return { gw, a, b };
}

const pool = (gw: Gateway, inbox: string): Gateway => gw.connectionInboxes.get(inbox)!.gateway!;
const named = (name: string) => ({ ...PLANT_POLICY, name });

describe("§58 — two pools in one container contest a name by REGISTRATION order", () => {
  it("the earlier registrant keeps the name, whichever pool was attached first", async () => {
    const { gw, a, b } = await twoPools();
    // B (attached SECOND) registers the lens FIRST; A registers it later.
    await pool(gw, b).publishRegistration({ ...PLANT, name: LENS }, named(LENS), [FERN]);
    await pool(gw, a).publishRegistration({ ...PLANT, name: LENS }, named(LENS), [FERN]);

    for (const asker of [a, b]) {
      const surface = gw.boundSurface({ container: HOME, inbox: asker });
      const row = surface.registered.find((r) => lensOf(r) === LENS);
      expect(row?.channel, `asked from ${asker === a ? "A" : "B"}`).toBe(b);
      expect(surface.refused.get(LENS)).toMatch(/collides/);
    }
    // Two-sided: the root's own law is untouched, and the root fold never saw either row.
    expect(gw.registered.map(lensOf)).toEqual(["Plant"]);
  });

  it("answers the same after the pools are re-attached in the other order", async () => {
    const { gw, a, b } = await twoPools();
    await pool(gw, b).publishRegistration({ ...PLANT, name: LENS }, named(LENS), [FERN]);
    await pool(gw, a).publishRegistration({ ...PLANT, name: LENS }, named(LENS), [FERN]);
    const before = gw
      .boundSurface({ container: HOME, inbox: a })
      .registered.find((r) => lensOf(r) === LENS)?.channel;
    // Re-attach in the other order: delete both handles and reinsert B, then A.
    const handleA = gw.connectionInboxes.get(a)!;
    const handleB = gw.connectionInboxes.get(b)!;
    gw.connectionInboxes.delete(a);
    gw.connectionInboxes.delete(b);
    gw.connectionInboxes.set(b, handleB);
    gw.connectionInboxes.set(a, handleA);
    const after = gw
      .boundSurface({ container: HOME, inbox: a })
      .registered.find((r) => lensOf(r) === LENS)?.channel;
    expect(before).toBe(b);
    expect(after).toBe(b);
  });
});
