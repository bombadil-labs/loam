// T263 — THE BOUND FOLD at the library seam (SPEC §58 position 2; Myk's ruling 2026-09-03: a
// bound connection's law serves only its container). Two inbox pools in ONE container may each
// publish the same lens name, and the fold must answer the contest the same way whoever asks,
// however the pools were attached, and however often the holder republishes. The rule is WHO
// STAKED THE NAME FIRST: the earlier surviving claim keeps it, the rival is refused with the
// collision named, a reboot that re-attaches in another order answers the same, and the holder's
// own evolutions never move its claim.
//
// Why here and not through the doors: consent binds one pool per (user, container), so two pools
// in one container need two connection keys bound at this seam, the way `binding-route.test.ts`
// binds its one. The door-level rails for the same fold are in test/server/derived-standing.test.ts.
//
// THE CONFOUND THIS FILE REMOVES: the earlier registrant must NOT also be the lexically-earlier
// pool name, or a comparator that sorted by name alone would pass. So the pool that registers
// first is chosen at runtime to be the one with the lexically LATER inbox name.
//
// The sort settles the contest; it does not settle DEPENDENCY order, and the last case is why. A
// first claim never moves — but a dependency's first claim can be STRUCK, which moves its claim
// later than a dependent's, and (in derived-standing) a lens can be evolved to expand into one
// staked after it. The fold trials in rounds to a fixpoint for both.
//
// REVERT PROBES, MEASURED on these 5 cases: drop the candidate sort → 1 red, 4 green (attach order
// happens to agree with the right answer for one of the two orderings, so exactly one of the
// attach-order and re-attach cases sees it); key the sort on `boundAt` (the latest binding)
// instead of the first → 2 red, 3 green (the holder's own republish loses the name, and the
// re-attach case's evolution moves the holder's latest binding too; the rival's republish never
// wins it, under either key); trial in ONE pass instead of to a fixpoint → 1 red, 4 green (the
// struck-dependency case, and the evolved-dependent case in derived-standing).
//
// RAILS-RED on origin/main: every case red, because `boundSurface` does not exist there. An
// honest red and a WEAK one; the probes above are the measurement.

import { describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { lensOf, readRegistrationVersions } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = GARDENER_SEED;
const OWNER = GARDENER;
const HOME = "home:alice";
const LENS = "home:alice:x";

const ALICES_OWN = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OWNER } },
  in: "input",
};

/** Two pools in one container. `first` registers first and has the lexically LATER inbox name. */
async function twoPools(): Promise<{ gw: Gateway; first: string; second: string }> {
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
  const one = (
    await gw.bindConnection({
      container: HOME,
      connectionKey: authorForSeed("a1".repeat(32)),
      ownerSeed: OWNER_SEED,
    })
  ).entity!;
  const two = (
    await gw.bindConnection({
      container: HOME,
      connectionKey: authorForSeed("b2".repeat(32)),
      ownerSeed: OWNER_SEED,
    })
  ).entity!;
  const [early, late] = [one, two].sort();
  return { gw, first: late!, second: early! };
}

const pool = (gw: Gateway, inbox: string): Gateway => gw.connectionInboxes.get(inbox)!.gateway!;
const publish = (gw: Gateway, inbox: string, prop = "height"): Promise<unknown> =>
  pool(gw, inbox).publishRegistration(
    { ...PLANT, name: LENS },
    { ...PLANT_POLICY, name: LENS, props: new Map([[prop, PLANT_POLICY.default]]) },
    [FERN],
  );
const winner = (gw: Gateway, asker: string): string | undefined =>
  gw.boundSurface({ container: HOME, inbox: asker }).registered.find((r) => lensOf(r) === LENS)
    ?.channel;

describe("§58 — two pools in one container contest a name by who staked it first", () => {
  it("the first registrant keeps the name, whichever pool was attached or sorts first", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    for (const asker of [first, second]) {
      expect(winner(gw, asker), `asked from ${asker}`).toBe(first);
      expect(gw.boundSurface({ container: HOME, inbox: asker }).refused.get(LENS)).toMatch(
        /collides/,
      );
    }
    // Two-sided: the root's own law is untouched, and the root fold never saw either row.
    expect(gw.registered.map(lensOf)).toEqual(["Plant"]);
  });

  it("answers the same after the pools are re-attached in the other order", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    expect(winner(gw, first)).toBe(first);
    // Re-attach in the other order, then EVOLVE the winner so the fold's key moves and the next
    // ask refolds from the Map as it now stands — an unchanged key would answer from the cache
    // and prove nothing. (An evolution moves the latest binding, never the first claim.)
    const handles = new Map(gw.connectionInboxes);
    gw.connectionInboxes.clear();
    for (const name of [...handles.keys()].reverse())
      gw.connectionInboxes.set(name, handles.get(name)!);
    await publish(gw, first, "watered");
    expect(winner(gw, first)).toBe(first);
    expect(winner(gw, second)).toBe(first);
  });

  it("the holder keeps the name through an identical republish and through an evolution", async () => {
    // Keyed on the LATEST binding, a holder lost its name the moment it republished — its claim
    // moved later than the rival's — and nothing it did could win it back.
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    await publish(gw, first); // identical
    expect(winner(gw, first)).toBe(first);
    await publish(gw, first, "watered"); // an evolution
    expect(winner(gw, first)).toBe(first);
    expect(gw.boundSurface({ container: HOME, inbox: second }).refused.get(LENS)).toMatch(
      /collides/,
    );
  });

  it("a dependency whose FIRST binding is struck still sorts where its dependent needs it", async () => {
    // `firstBoundAt` is the first SURVIVING claim. Strike a dependency's earliest binding out of
    // band (an operator-signed negation in the pool — the road the fold's header says it fences)
    // and its first claim moves later than its dependent's. Rounds bind the dependent anyway.
    const { gw, first } = await twoPools();
    const p = pool(gw, first);
    const A = "home:alice:a";
    const B = "home:alice:b";
    const expandsIntoA = {
      ...PLANT,
      name: B,
      body: parseTerm({
        op: "expand",
        role: { exact: "grows" },
        schema: A,
        reading: A,
        in: {
          op: "group",
          key: "byTargetContext",
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: { op: "mask", policy: "drop", in: "input" },
          },
        },
      }),
    };
    await p.publishRegistration({ ...PLANT, name: A }, { ...PLANT_POLICY, name: A }, [FERN]);
    await p.publishRegistration(expandsIntoA, { ...PLANT_POLICY, name: B }, [FERN]);
    await p.publishRegistration(
      { ...PLANT, name: A },
      { ...PLANT_POLICY, name: A, props: new Map([["watered", PLANT_POLICY.default]]) },
      [FERN],
    ); // evolve A: a later binding
    const firstA = readRegistrationVersions(p.reactor, p.operatorAuthor)
      .filter((v) => v.lensName === A)
      .sort((x, y) => x.timestamp - y.timestamp)[0]!;
    await p.append([
      signClaims(
        {
          timestamp: p.nextTimestamp(),
          author: OP,
          pointers: [
            { role: "negates", target: { kind: "delta", deltaRef: { delta: firstA.deltaId } } },
          ],
        },
        OP_SEED,
      ),
    ]);
    const surface = gw.boundSurface({ container: HOME, inbox: first });
    expect(surface.registered.map(lensOf)).toEqual(expect.arrayContaining([A, B]));
    expect(surface.refused.has(B)).toBe(false);
  });

  it("the rival does not take the name by republishing", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    await publish(gw, second, "watered");
    await publish(gw, second);
    expect(winner(gw, second)).toBe(first);
  });
});
