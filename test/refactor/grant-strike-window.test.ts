// Write standing reads a negation only inside its own validity window, and a grant only inside its
// own (Myk's ruling, 2026-09-26: an expired negation of a grant revives it). Each case reads on both
// sides of every boundary, at three levels that must agree:
//   - the delta level: the grant and its negation are both held in the store throughout;
//   - the door: an append signed by the writer is admitted or refused (`authorize`, through ingest);
//   - the readers beside the door: `holdsGrant`, `grantsHeldBy`, and the revoke selection
//     `unnegatedOperatorGrantIds` (every unnegated operator grant). The grants here are untimed, so
//     that selection names a grant exactly when the door still honours it. A timed grant is selected
//     outside its window too; `step4-last-readers.test.ts` pins that.
// A bystander writer with an untouched grant writes at every read time.
//
// Named gap: the door is driven through `Gateway.append`, not over HTTP. The HTTP write door calls
// the same ingest, so a served rail would add transport, not a new decision.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims, grantsHeldBy, holdsGrant } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { unnegatedOperatorGrantIds } from "../../src/server/admin-federation.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "6e".repeat(32);
const OP = authorForSeed(OP_SEED);
const BYSTANDER_SEED = "e2".repeat(32);
const BYSTANDER = authorForSeed(BYSTANDER_SEED);

const T0 = 1_000_000; // boot and grants
const T1 = 2_000_000; // the negation's window opens
const T2 = 3_000_000; // the negation's window closes
const T3 = 2_500_000; // a grant's own window closes

afterEach(() => {
  vi.useRealTimers();
});

/** A governed store at T0 with the writer's grant (valid over `window`) and the bystander's. */
async function store(window: { validUntil?: number } = {}): Promise<{ gw: Gateway; grant: Delta }> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  const grant = signClaims(
    { ...grantClaims(STORE_ENTITY, GARDENER, "write", OP, T0), ...window },
    OP_SEED,
  );
  await gw.append([grant]);
  await gw.append([signClaims(grantClaims(STORE_ENTITY, BYSTANDER, "write", OP, T0), OP_SEED)]);
  return { gw, grant };
}

/** The operator's negation of `target`, valid over `window`. */
const strike = (target: string, window: { validFrom: number; validUntil?: number }): Delta =>
  signClaims({ ...makeNegationClaims(OP, T0 + 10, target), ...window }, OP_SEED);

/** Admitted or refused at the door, for an append by `seed` at the current fake time. */
async function doorAdmits(gw: Gateway, seed: string, value: number): Promise<boolean> {
  try {
    await gw.append([observed(FERN, "height", value, Date.now(), seed)]);
    return true;
  } catch (e) {
    expect((e as Error).message).toMatch(/not permitted/);
    return false;
  }
}

/** Every reader's answer at `at`, plus the delta-level facts it rests on. */
async function readAt(gw: Gateway, grant: Delta, held: Delta[], at: number, n: number) {
  vi.setSystemTime(at);
  for (const d of [grant, ...held]) expect(gw.reactor.get(d.id)).toBeDefined(); // held throughout
  const now = gw.validityNow();
  return {
    door: await doorAdmits(gw, GARDENER_SEED, n),
    holds: holdsGrant(gw.reactor, now, STORE_ENTITY, GARDENER, "write", OP),
    held: grantsHeldBy(gw.reactor, now, GARDENER, OP).map((g) => g.id),
    bystander: await doorAdmits(gw, BYSTANDER_SEED, n + 0.5),
    bystanderHolds: holdsGrant(gw.reactor, now, STORE_ENTITY, BYSTANDER, "write", OP),
  };
}

const allowed = (grant: Delta) => ({
  door: true,
  holds: true,
  held: [grant.id],
  bystander: true,
  bystanderHolds: true,
});
const refused = {
  door: false,
  holds: false,
  held: [],
  bystander: true,
  bystanderHolds: true,
};

describe("write standing reads a negation of a grant only inside its window", () => {
  it("a negation over [T1, T2) refuses only inside it: the grant revives at T2", async () => {
    const { gw, grant } = await store();
    const neg = strike(grant.id, { validFrom: T1, validUntil: T2 });
    await gw.append([neg]);
    const panel = () => unnegatedOperatorGrantIds(gw.reactor, gw.validityNow(), OP, GARDENER);

    expect(await readAt(gw, grant, [neg], T1 - 1, 1)).toEqual(allowed(grant));
    expect(panel()).toEqual([grant.id]); // the panel would strike what the door honours
    expect(await readAt(gw, grant, [neg], T1, 2)).toEqual(refused);
    expect(panel()).toEqual([]); // nothing left to strike while the door refuses
    expect(await readAt(gw, grant, [neg], T2 - 1, 3)).toEqual(refused);
    expect(panel()).toEqual([]);
    expect(await readAt(gw, grant, [neg], T2, 4)).toEqual(allowed(grant));
    expect(panel()).toEqual([grant.id]);
    expect(await readAt(gw, grant, [neg], T2 + 1_000, 5)).toEqual(allowed(grant));
    expect(panel()).toEqual([grant.id]);
    await gw.close();
  });

  it("a negation that starts at T1 does not bind before T1, and the panel agrees", async () => {
    const { gw, grant } = await store();
    const neg = strike(grant.id, { validFrom: T1 });
    await gw.append([neg]);
    const panel = () => unnegatedOperatorGrantIds(gw.reactor, gw.validityNow(), OP, GARDENER);

    expect(await readAt(gw, grant, [neg], T1 - 1, 1)).toEqual(allowed(grant));
    expect(panel()).toEqual([grant.id]);
    expect(await readAt(gw, grant, [neg], T1, 2)).toEqual(refused);
    expect(panel()).toEqual([]);
    expect(await readAt(gw, grant, [neg], T2 + 1_000, 3)).toEqual(refused);
    expect(panel()).toEqual([]);
    await gw.close();
  });
});

describe("write standing reads a grant only inside its own window", () => {
  it("a grant valid until T3 admits before T3 and refuses at and after T3", async () => {
    const { gw, grant } = await store({ validUntil: T3 });
    expect(await readAt(gw, grant, [], T3 - 1, 1)).toEqual(allowed(grant));
    expect(await readAt(gw, grant, [], T3, 2)).toEqual(refused);
    expect(await readAt(gw, grant, [], T3 + 1_000, 3)).toEqual(refused);
    await gw.close();
  });
});
