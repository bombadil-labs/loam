// Step 9's contract: federation. Two instances meet and merge — union, order-blind, conflict-
// free — over the authed HTTP surface. The load-bearing distinction: a peer's deltas ingest by
// VERIFICATION, not by local capability grants (capabilities gate the mutation surface;
// federation is union at the substrate, and trust is a read-time lens). A published lens
// restricts what a store offers; a forgery is refused at the boundary.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeDelta, parseTerm, signClaims, type Delta } from "@bombadil/rhizomatic";

// Each test boots multiple real servers; a generous hang-guard keeps machine load from blowing
// the default per-test timeout.
vi.setConfig({ testTimeout: 15000 });
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { pullFrom } from "../../src/federation/pull.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_A = "0a".repeat(32);
const OP_B = "0b".repeat(32);
const OPERATOR_A = authorForSeed(OP_A);

const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) await h.close();
  for (const g of gateways.splice(0)) await g.close().catch(() => {});
});

// An instance: a governed gateway (garden tenant, gardener may write) fronted by an HTTP server
// with a federation token, and an optional published lens.
async function instance(
  operatorSeed: string,
  opts: { lens?: ReturnType<typeof parseTerm> } = {},
): Promise<{ gateway: Gateway; url: string; token: string }> {
  const operator = authorForSeed(operatorSeed);
  const gateway = await Gateway.open(new MemoryBackend(), {
    seed: operatorSeed,
    ...(opts.lens === undefined ? {} : { offeredLens: opts.lens }),
  });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", operator, 2), operatorSeed),
  ]);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  const token = `tok-${operatorSeed.slice(0, 4)}`;
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { [token]: { operator: true } },
    port: 0,
  });
  gateways.push(gateway);
  handles.push(handle);
  return { gateway, url: `${handle.url}/default`, token };
}

const height = (g: Gateway) =>
  g
    .query(`{ plant(entity: "${FERN}") { height } }`)
    .then((r) => (r.data as { plant: { height: number | null } }).plant.height);

describe("federation: two instances meet and merge", () => {
  it("a delta on A resolves on B after B pulls", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    // the gardener writes on A (both instances granted her write, so her delta is at home on both)
    await a.gateway.append([observed(FERN, "height", 42, 1000, GARDENER_SEED)]);
    expect(await height(b.gateway)).toBeNull(); // B has not heard yet

    const report = await pullFrom(b.gateway, a.url, a.token);
    expect(report.accepted).toBeGreaterThan(0);
    expect(await height(b.gateway)).toBe(42); // B resolves A's delta
  });

  it("union holds both ways: each keeps the other's writes, no conflict", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    await a.gateway.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await b.gateway.append([observed(FERN, "tag", "shade", 1500, GARDENER_SEED)]);

    await pullFrom(a.gateway, b.url, b.token);
    await pullFrom(b.gateway, a.url, a.token);

    // both now resolve both facts; the views converge
    for (const g of [a.gateway, b.gateway]) {
      const view = await g.query(`{ plant(entity: "${FERN}") { height tag _hex } }`);
      const plant = (view.data as { plant: { height: number; tag: string[]; _hex: string } }).plant;
      expect(plant.height).toBe(30);
      expect(plant.tag).toEqual(["shade"]);
    }
    const ha = (
      (await a.gateway.query(`{ plant(entity: "${FERN}") { _hex } }`)).data as {
        plant: { _hex: string };
      }
    ).plant._hex;
    const hb = (
      (await b.gateway.query(`{ plant(entity: "${FERN}") { _hex } }`)).data as {
        plant: { _hex: string };
      }
    ).plant._hex;
    expect(ha).toBe(hb); // convergence: same deltas → same snapshot
  });

  it("a re-pull is idempotent: nothing new accepted the second time", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    await a.gateway.append([observed(FERN, "height", 42, 1000, GARDENER_SEED)]);
    const first = await pullFrom(b.gateway, a.url, a.token);
    const second = await pullFrom(b.gateway, a.url, a.token);
    expect(first.accepted).toBeGreaterThan(0);
    expect(second.accepted).toBe(0); // union: the same deltas do not re-accept
  });

  it("a published lens restricts what crosses", async () => {
    // A offers only height claims — its tags stay home
    const heightsOnly = parseTerm({
      op: "select",
      pred: { hasPointer: { context: { exact: "height" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    });
    const a = await instance(OP_A, { lens: heightsOnly });
    const b = await instance(OP_B);
    await a.gateway.append([
      observed(FERN, "height", 42, 1000, GARDENER_SEED),
      observed(FERN, "tag", "secret", 1100, GARDENER_SEED),
    ]);
    await pullFrom(b.gateway, a.url, a.token);
    const view = await b.gateway.query(`{ plant(entity: "${FERN}") { height tag } }`);
    const plant = (view.data as { plant: { height: number; tag: string[] | null } }).plant;
    expect(plant.height).toBe(42); // the height crossed
    expect(plant.tag ?? []).toEqual([]); // the tag did not
  });

  it("a forged id is refused at federate; honest deltas around it still land", async () => {
    const b = await instance(OP_B);
    const honest = observed(FERN, "height", 42, 1000, GARDENER_SEED);
    const forged: Delta = { ...honest, id: `1e20${"00".repeat(32)}` };
    const report = await b.gateway.federate([forged, honest]);
    expect(report.rejected).toBe(1); // the forgery
    expect(report.accepted).toBeGreaterThan(0); // the honest delta
    expect(await height(b.gateway)).toBe(42);
  });

  it("an unsigned delta is refused at federate — a peer cannot inject anonymous authorship", async () => {
    const b = await instance(OP_B);
    // a delta whose id recomputes correctly but carries no signature
    const unsigned = makeDelta({
      timestamp: 1000,
      author: "did:key:zNobody",
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "height" } } },
        { role: "value", target: { kind: "primitive", value: 99 } },
      ],
    });
    const report = await b.gateway.federate([unsigned]);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
  });

  it("foreign law is inert: a peer's self-signed grant binds nothing on the victim", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    // Mallory (an author with no standing on B) signs a grant making HERSELF admin of B's STORE
    const MALLORY_SEED = "ee".repeat(32);
    const MALLORY = authorForSeed(MALLORY_SEED);
    const hostileGrant = signClaims(
      grantClaims(STORE_ENTITY, MALLORY, "admin", MALLORY, 5),
      MALLORY_SEED,
    );
    // it verifies, so federate ADMITS it (union is union) — but it must not GOVERN
    const report = await b.gateway.federate([hostileGrant]);
    expect(report.accepted).toBe(1); // the delta crossed (it is signed and well-formed)

    // yet Mallory still cannot write on B: her grant roots in nobody B's operator blessed
    const denied = await b.gateway.query(
      `mutation { plant(entity: "${FERN}", height: 66) { height } }`,
      undefined,
      { actor: MALLORY_SEED },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    void a;
  });

  it("the interim negation boundary: an admit predicate keeps a hostile strike out at the pull", async () => {
    // Under open writes a federated negation would mask honest data at read time (the
    // heckler's veto — principled fix awaits reflective predicates, rhizomatic#2). The interim
    // boundary is the pull's admit predicate: refuse foreign negations from unknown authors.
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    const honest = observed(FERN, "height", 42, 1000, GARDENER_SEED);
    await a.gateway.append([honest]);
    // Mallory's strike against the honest delta somehow reaches A's store (A is ungoverned
    // toward federation: union is union)
    const MALLORY_SEED = "ee".repeat(32);
    const strike = signClaims(
      {
        timestamp: 2000,
        author: authorForSeed(MALLORY_SEED),
        pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: honest.id } } }],
      },
      MALLORY_SEED,
    );
    await a.gateway.federate([strike]);

    // B pulls WITH a trust boundary: only authors B knows may carry negations across
    const known = new Set([authorForSeed(OP_A), GARDENER]);
    await pullFrom(b.gateway, a.url, a.token, {
      admit: (d) =>
        !d.claims.pointers.some((p) => p.target.kind === "delta" && p.role === "negates") ||
        known.has(d.claims.author),
    });
    expect(await height(b.gateway)).toBe(42); // the strike stayed on the far shore
  });

  it("a peer's schema definition merges as data but never reshapes the local surface", async () => {
    // B's operator publishes its own law: Plant, defined and registered through the store
    const OP_B_LOCAL = "0c".repeat(32);
    const backend = new MemoryBackend();
    const b = await Gateway.open(backend, { seed: OP_B_LOCAL });
    await b.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
    ]);
    await b.query(`mutation { plant(entity: "${FERN}", height: 42) { height } }`); // operator writes
    gateways.push(b);

    // Mallory federates a self-authored definition + registration for an "Intruder" schema,
    // AND a newer definition at B's own schema entity — all verified, all admitted (union).
    const MALLORY_SEED = "ee".repeat(32);
    const MALLORY = authorForSeed(MALLORY_SEED);
    const { publishHyperSchemaClaims } = await import("@bombadil/rhizomatic");
    const { registrationDeltaClaims } = await import("../../src/gateway/registration.js");
    const byRole = parseTerm({ op: "group", key: "byRole", in: "input" });
    // §21: a registration is now three deltas (living Schema, snapshot, binding). Mallory federates
    // all of them; every one crosses (union is union) and every one is inert (foreign law binds nothing).
    const intruderReg = registrationDeltaClaims(
      "hyperschema:Intruder",
      "Intruder",
      PLANT_POLICY,
      [FERN],
      MALLORY,
      () => 51,
    );
    const report = await b.federate([
      signClaims(
        publishHyperSchemaClaims(
          { name: "Intruder", alg: 1, body: byRole },
          "hyperschema:Intruder",
          MALLORY,
          50,
        ),
        MALLORY_SEED,
      ),
      signClaims(intruderReg.living, MALLORY_SEED),
      signClaims(intruderReg.snapshot, MALLORY_SEED),
      signClaims(intruderReg.binding, MALLORY_SEED),
      signClaims(
        publishHyperSchemaClaims(
          { name: "Plant", alg: 1, body: byRole },
          "schema:Plant",
          MALLORY,
          9e12,
        ),
        MALLORY_SEED,
      ),
    ]);
    expect(report.accepted).toBe(5); // union is union: 2 hyperschemas + 3 registration deltas cross

    // …but the surface a reopened store GENERATES is the operator's alone
    const reopened = await Gateway.open(backend, { seed: OP_B_LOCAL });
    gateways.push(reopened);
    const plant = await reopened.query(`{ plant(entity: "${FERN}") { height _hex } }`);
    expect(plant.errors).toBeUndefined();
    // 42 gathers only under the operator's byTargetContext body — Mallory's byRole would lose it
    expect((plant.data as { plant: { height: number } }).plant.height).toBe(42);
    const intruder = await reopened.query(`{ intruder(entity: "${FERN}") { _hex } }`);
    expect(intruder.errors?.join(" ")).toMatch(/Cannot query|intruder/);
  });

  it("the wire path refuses a tampered offer, and /federate demands an operator token", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    await a.gateway.append([observed(FERN, "height", 42, 1000, GARDENER_SEED)]);

    // a NON-operator token cannot pull the raw substrate
    const scoped = await serve({
      mounts: { default: a.gateway },
      tokens: { "reader-tok": { actor: GARDENER_SEED } },
      port: 0,
    });
    handles.push(scoped);
    const forbidden = await fetch(`${scoped.url}/default/federate`, {
      headers: { authorization: "Bearer reader-tok" },
    });
    expect(forbidden.status).toBe(403);

    // a tampered offer over the real wire is dropped by fromWire (id recompute), not merged
    const tampered = await pullFrom(b.gateway, a.url, a.token, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              deltas: [
                {
                  id: `1e20${"11".repeat(32)}`,
                  claims: { timestamp: 1, author: "x", pointers: [] },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    });
    expect(tampered.accepted).toBe(0);
    void OPERATOR_A;
  });
});
