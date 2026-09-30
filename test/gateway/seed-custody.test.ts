// A gateway's key lives in its signer and nowhere else (step 6, inventory construction task 2). The
// seed a gateway opens with becomes its signer; the options it keeps carry no seed, so no code that
// holds a gateway, or a pool through one, can read a key. The type rail fails the typecheck if the
// kept options regain a seed.

import { authorForSeed } from "@bombadil/rhizomatic";
import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "5e".repeat(32);

describe("a gateway's seed lives only in its signer", () => {
  it("a booted root and its pool keep no seed, and each still signs as its own key", async () => {
    const host = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: SEED }));
    const pool = (await host.openQuarantine()).gateway;
    for (const gw of [host, pool]) {
      expect("seed" in gw.options).toBe(false);
      expect(JSON.stringify(gw.options)).not.toContain(SEED);
      expect(gw.signer?.author).toBe(gw.operatorAuthor);
    }
    expect(host.operatorAuthor).toBe(authorForSeed(SEED));
    expect(pool.operatorAuthor).not.toBe(host.operatorAuthor); // the pool's own key
    // @ts-expect-error a gateway's kept options carry no seed
    expect(host.options.seed).toBeUndefined();
    await host.close();
  });

  it("a gateway opened with a seed keeps none either", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
    expect("seed" in gw.options).toBe(false);
    expect(gw.operatorAuthor).toBe(authorForSeed(SEED));
    await gw.close();
  });
});
