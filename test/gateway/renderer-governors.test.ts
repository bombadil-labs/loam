import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, Reactor, signClaims } from "@bombadil/rhizomatic";
import type { LensName } from "../../src/gateway/registration.js";
import { readRenderers, rendererBindingClaims } from "../../src/gateway/renderers.js";

const POOL_SEED = "5c".repeat(32);
const HOST_SEED = "6d".repeat(32);
const POOL = authorForSeed(POOL_SEED);
const HOST = authorForSeed(HOST_SEED);
const binding = (route: string, seed: string, t: number) =>
  signClaims(
    rendererBindingClaims(
      { route, schemaName: "Plant" as LensName, consumes: [], bundle: "export default () => 1" },
      undefined,
      authorForSeed(seed),
      t,
    ),
    seed,
  );
const strike = (target: string, seed: string, t: number) =>
  signClaims(makeNegationClaims(authorForSeed(seed), t, target), seed);
const routes = (r: Reactor) =>
  readRenderers(r, 10_000, [POOL, HOST])
    .map((b) => b.route)
    .sort();

describe("renderer strikes under several governors", () => {
  it("a host strike leaves the pool's own binding; the pool's strike retires the host's copy", () => {
    const r = new Reactor();
    const own = binding("own", POOL_SEED, 100);
    const seeded = binding("seeded", HOST_SEED, 101);
    r.ingest(own);
    r.ingest(seeded);
    expect(routes(r)).toEqual(["own", "seeded"]);
    r.ingest(strike(own.id, HOST_SEED, 200));
    expect(routes(r)).toEqual(["own", "seeded"]);
    r.ingest(strike(seeded.id, POOL_SEED, 201));
    expect(routes(r)).toEqual(["own"]);
  });
});
