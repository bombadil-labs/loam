import { describe, expect, it, vi } from "vitest";
import type { Delta } from "@bombadil/rhizomatic";

const counter = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@bombadil/rhizomatic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bombadil/rhizomatic")>();
  return {
    ...real,
    verifyDelta: (d: Delta) => {
      counter.calls += 1;
      return real.verifyDelta(d);
    },
  };
});

const { assembleGenesis } = await import("../../src/gateway/genesis.js");
const { Gateway } = await import("../../src/gateway/gateway.js");
const { MemoryBackend } = await import("../../src/store/memory.js");
const { sameVerifiedDelta } = await import("../../src/gateway/erase-law.js");
const { FERN, observed } = await import("../spike/garden.js");

const ME_SEED = "cc".repeat(32);
const ALICE_SEED = "a1".repeat(32);
const N = 120;

async function store(seed: string) {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
    { channelBackend: () => new MemoryBackend() },
  );
}

describe("a no-op sync does not re-verify what the pool holds", () => {
  it("verifies each held delta once, not once per sync", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const planted = Array.from({ length: N }, (_, i) =>
        observed(FERN, "height", i, 1000 + i, ALICE_SEED),
      );
      await alice.append(planted);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      const pool = channel.pool.gateway!;

      const first = await channel.sync();
      expect(first.accepted).toBeGreaterThanOrEqual(N);
      for (const d of planted) expect(pool.reactor.get(d.id)).toBeDefined();

      for (const round of [1, 2, 3]) {
        counter.calls = 0;
        const quiet = await channel.sync();
        expect(quiet.accepted, `round ${round}`).toBe(0);
        expect(counter.calls, `round ${round}`).toBeLessThan(N / 4);
      }

      const gathered = new Set(me.containerScope({ containers: ["friends"] }).map((d) => d.id));
      for (const d of planted) expect(gathered.has(d.id)).toBe(true);
    } finally {
      await alice.close();
      await me.close();
    }
  }, 60_000);

  it("still checks and refuses a re-offer that differs from the held bytes", async () => {
    const me = await store(ME_SEED);
    try {
      const d = observed(FERN, "height", 7, 1000, ALICE_SEED);
      const landed = await me.federate([d]);
      expect(landed.accepted).toBe(1);
      await me.federate([d]);

      const flipped = d.sig!.slice(0, -1) + (d.sig!.endsWith("0") ? "1" : "0");
      const forged = { ...d, sig: flipped };
      counter.calls = 0;
      const report = await me.federate([forged]);
      expect(report.accepted).toBe(0);
      expect(report.rejected).toBe(1);
      expect(counter.calls).toBeGreaterThan(0);
      expect(me.reactor.get(d.id)!.sig).toBe(d.sig);

      const [subject, value] = d.claims.pointers;
      const rewritten = {
        ...d,
        claims: {
          ...d.claims,
          pointers: [subject!, { ...value!, target: { kind: "primitive" as const, value: 8 } }],
        },
      };
      const again = await me.federate([rewritten]);
      expect(again.accepted).toBe(0);
      expect(again.rejected).toBe(1);
    } finally {
      await me.close();
    }
  });

  it("re-verifies an object mutated after it verified", () => {
    const d = observed(FERN, "height", 9, 1000, ALICE_SEED);
    expect(sameVerifiedDelta(d, d)).toBe(true);
    counter.calls = 0;
    expect(sameVerifiedDelta(d, d)).toBe(true);
    expect(counter.calls).toBe(0);
    const sig = d.sig!;
    (d as { sig?: string }).sig = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(sameVerifiedDelta(d, d)).toBe(false);
    expect(counter.calls).toBe(1);

    const e = observed(FERN, "height", 10, 1000, ALICE_SEED);
    expect(sameVerifiedDelta(e, e)).toBe(true);
    const value = e.claims.pointers[1]!;
    (value as { target: unknown }).target = { kind: "primitive", value: 11 };
    expect(sameVerifiedDelta(e, e)).toBe(false);
  });
});
