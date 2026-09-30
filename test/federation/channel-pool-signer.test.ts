// A channel's records are signed by the ground they land in (step 5 PR 3j-2): the pool's own law
// (its arrival stamps) by the pool's governing key, the host's law (the pool's declaration) by the
// host's. The pool's key comes from the host's pool key source, fixed here so the test can name it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { gatewayOf } from "../helpers/pool-gateway.js";

const SEED = "cc".repeat(32);
const POOL_SEED = "7e".repeat(32);
const homes: Gateway[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const gw of homes.splice(0)) await gw.close();
});
const inContext = (d: Delta, context: string) =>
  d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.context === context);

describe("channel records are signed by their own ground", () => {
  it("arrival stamps in the pool by the pool's key; the pool's declaration on the host by the host's", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: SEED, registrations: [] }),
      {
        channelBackend: () => new MemoryBackend(),
        poolKeys: { load: () => POOL_SEED, create: () => POOL_SEED },
      },
    );
    homes.push(gw);
    const fact = observed(FERN, "height", 1, 1001, "a1".repeat(32));
    const ch = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      source: { pull: () => Promise.resolve([fact]) },
    });
    await ch.sync();
    const pool = gatewayOf(ch.pool);
    expect(pool.signer!.author).toBe(authorForSeed(POOL_SEED));
    expect(pool.reactor.get(fact.id)).toBeDefined();
    const stamps = pool.reactor
      .arrivalLog()
      .filter((d) => d.claims.pointers.some((p) => p.role === "arrived"));
    expect(stamps.length).toBeGreaterThan(0);
    expect(new Set(stamps.map((d) => d.claims.author))).toEqual(
      new Set([authorForSeed(POOL_SEED)]),
    );
    const declaration = gw.reactor
      .arrivalLog()
      .find(
        (d) =>
          d.claims.pointers.some((p) => p.role === "inboxOf") && inContext(d, "loam.container"),
      )!;
    expect(declaration.claims.author).toBe(authorForSeed(SEED));
  });
});
