// T288: the newly authored declaration's exact ID must cross asynchronous attachment.
// A latest-row scan can accidentally attribute a fresh local opening to a concurrent declaration.
import { describe, expect, it } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { localChannelEvidence } from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "cc".repeat(32);
function declarations(gw: Gateway, name: string): Delta[] {
  return [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.context === "loam.container" &&
        p.target.entity.id === name,
    ),
  );
}
function opens(gw: Gateway, name: string): Delta[] {
  return [...gw.reactor.snapshot()].filter(
    (d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.context === "loam.local.channel.event" &&
          p.target.entity.id === `channel:${name}`,
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "action" && p.target.kind === "primitive" && p.target.value === "open",
      ),
  );
}
function declarationRef(event: Delta): string | undefined {
  const p = event.claims.pointers.find((p) => p.role === "pool-declaration");
  return p?.target.kind === "delta" ? p.target.deltaRef.delta : undefined;
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class DelayedSeedBackend extends MemoryBackend {
  readonly entered = signal();
  readonly release = signal();
  private first = true;
  override async append(batch: Iterable<Delta>): Promise<number> {
    const deltas = [...batch];
    if (this.first && deltas.length > 0) {
      this.first = false;
      this.entered.resolve();
      await this.release.promise;
    }
    return super.append(deltas);
  }
}

describe("T288 exact freshly authored declaration across async pool attachment", () => {
  it("normal attachment records the exact declaration already authored before its seed append", async () => {
    const delayed = new DelayedSeedBackend();
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: SEED, registrations: [] }),
      { channelBackend: () => delayed },
    );
    const pending = gw.openChannel({
      into: "friends",
      prefix: "peer",
      source: { pull: () => Promise.resolve([]) },
    });
    try {
      await delayed.entered.promise;
      const authored = declarations(gw, "channel:friends:peer");
      expect(authored).toHaveLength(1);
      expect(await gw.backend.holds(authored[0]!.id)).toBe(true);
      expect(opens(gw, "channel:friends:peer")).toEqual([]);
      delayed.release.resolve();
      const channel = await pending;
      const evidence = localChannelEvidence(gw, channel.name);
      expect(evidence.state).toBe("open");
      if (evidence.state === "open") expect(evidence.opening.poolDeclaration).toBe(authored[0]!.id);
      expect(opens(gw, channel.name).map(declarationRef)).toEqual([authored[0]!.id]);
    } finally {
      delayed.release.resolve();
      await pending.catch(() => undefined);
      await gw.close();
    }
  });

  it("a same-name declaration arriving while the real seed append waits cannot replace the authored ID", async () => {
    const delayed = new DelayedSeedBackend();
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: SEED, registrations: [] }),
      { channelBackend: () => delayed },
    );
    const name = "channel:friends:peer";
    // Observe either allowed partial outcome without turning rejection into an unhandled promise.
    const pending = gw
      .openChannel({
        into: "friends",
        prefix: "peer",
        source: { pull: () => Promise.resolve([]) },
      })
      .then(
        () => "returned" as const,
        () => "rejected" as const,
      );
    try {
      await delayed.entered.promise;
      const authored = declarations(gw, name);
      expect(authored).toHaveLength(1);
      const original = authored[0]!;
      expect(await gw.backend.holds(original.id)).toBe(true);
      expect(opens(gw, name)).toEqual([]);
      // The race is an ordinary operator append on this same gateway while channel creation
      // awaits a real backend. No raw reactor writes, event writer mocks or clock sleeps.
      const replacement = signClaims({ ...original.claims, timestamp: gw.nextTimestamp() }, SEED);
      expect(replacement.id).not.toBe(original.id);
      await gw.append([replacement]);
      expect(await gw.backend.holds(replacement.id)).toBe(true);
      expect(declarations(gw, name)).toHaveLength(2);
      delayed.release.resolve();
      await pending;
      const issued = opens(gw, name);
      expect(issued.map(declarationRef)).not.toContain(replacement.id);
      for (const event of issued) expect(declarationRef(event)).toBe(original.id);
      // No stronger rollback promise: a rejected open or a retained partial legacy attachment
      // is allowed. Superseded exact D1 evidence must not claim to be a current protected open.
      expect(localChannelEvidence(gw, name).state).not.toBe("open");
      expect(await gw.backend.holds(original.id)).toBe(true);
      expect(await gw.backend.holds(replacement.id)).toBe(true);
    } finally {
      delayed.release.resolve();
      await pending;
      await gw.close();
    }
  });
});
