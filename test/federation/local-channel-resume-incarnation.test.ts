// T288 P5 regressions: a handle retains its exact lifecycle even when currently closed or
// legacy. Every erased/dropped byte belongs to these owned MemoryBackend fixtures.
import { afterEach, describe, expect, it, vi } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { resumeChannelImpl } from "../../src/federation/channel.js";
import { localChannelEvidence } from "../../src/federation/local-channel-events.js";
import { toWire } from "../../src/federation/wire.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "cc".repeat(32);
const FROM = "https://peer.example/default";
const homes: Gateway[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const gw of homes.splice(0)) await gw.close();
});
const fact = (n: number) => observed(FERN, "height", n, 1000 + n, "a1".repeat(32));
const ids = (gw: Gateway) => [...gw.reactor.snapshot()].map((d) => d.id).sort();
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function wire(deltas: readonly Delta[]) {
  return new Response(JSON.stringify({ deltas: deltas.map(toWire) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function events(gw: Gateway, name: string, action: string) {
  return [...gw.reactor.snapshot()].filter(
    (d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.context === "loam.local.channel.event" &&
          p.target.entity.id === `channel:${name}`,
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "action" && p.target.kind === "primitive" && p.target.value === action,
      ),
  );
}
async function home() {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    { channelBackend: () => new MemoryBackend() },
  );
  homes.push(gw);
  return gw;
}

describe("T288 resumed closed incarnation retains its identity", () => {
  it.each(["resumeChannels", "openChannel"] as const)(
    "%s refuses while closed and the same handle syncs after exact close erasure",
    async (path) => {
      const original = await home();
      const ch = await original.openChannel({
        into: "friends",
        prefix: "peer",
        from: FROM,
        source: { pull: () => Promise.resolve([]) },
      });
      const initial = localChannelEvidence(original, ch.name);
      expect(initial.state).toBe("open");
      if (initial.state !== "open") throw new Error("valid opening required");
      const pool = ch.pool.gateway!;
      const purge = pool.backend.purge.bind(pool.backend);
      pool.backend.purge = () => Promise.reject(new Error("fixture failed drop purge"));
      await expect(original.dropChannel(ch.name)).rejects.toThrow();
      pool.backend.purge = purge;
      expect(localChannelEvidence(original, ch.name).state).toBe("closed");
      const close = events(original, ch.name, "close")[0]!;
      expect(close).toBeDefined();
      const rootBackend = new MemoryBackend(),
        poolBackend = new MemoryBackend();
      await rootBackend.append(await original.backend.deltasSince(new Set()));
      await poolBackend.append(await pool.backend.deltasSince(new Set()));
      const restored = await Gateway.open(rootBackend, {
        seed: SEED,
        channelBackend: () => poolBackend,
        ...(path === "resumeChannels" ? { channelToken: () => "token" } : {}),
      });
      homes.push(restored);
      await restored.resumeChannels();
      const offered = fact(1);
      const source = { pull: () => Promise.resolve([offered]) };
      vi.stubGlobal("fetch", () => Promise.resolve(wire([offered])));
      if (path === "openChannel") expect(restored.federationChannels.has(ch.name)).toBe(false);
      const handle =
        path === "resumeChannels"
          ? restored.federationChannels.get(ch.name)!
          : await restored.openChannel({ into: "friends", prefix: "peer", from: FROM, source });
      expect(handle).toBeDefined();
      expect(localChannelEvidence(restored, ch.name).state).toBe("closed");
      const beforeRoot = ids(restored),
        beforePool = ids(handle.pool.gateway!);
      await expect(handle.sync()).rejects.toThrow();
      expect(ids(restored)).toEqual(beforeRoot);
      expect(ids(handle.pool.gateway!)).toEqual(beforePool);
      expect(handle.pool.gateway!.reactor.get(offered.id)).toBeUndefined();
      await restored.erase(close.id);
      const revived = localChannelEvidence(restored, ch.name);
      expect(revived.state).toBe("open");
      if (revived.state === "open") expect(revived.opening).toEqual(initial.opening);
      expect(restored.federationChannels.get(ch.name)).toBe(handle);
      expect((await handle.sync()).accepted).toBe(1);
      const received = localChannelEvidence(restored, ch.name);
      expect(received.state).toBe("open");
      if (received.state === "open")
        expect(received.received.map((d) => d.id)).toEqual([offered.id]);
      expect(handle.pool.gateway!.reactor.get(offered.id)).toBeDefined();
      expect((await handle.sync()).accepted).toBe(0);
      expect(events(restored, ch.name, "received")).toHaveLength(1);
    },
  );
});

const legacyCases = (["fresh", "resumed"] as const).flatMap((handle) =>
  (["declaration", "attachment"] as const).flatMap((replacement) =>
    [false, true].map((failure) => ({ handle, replacement, failure })),
  ),
);
describe("T288 legacy handle exact declaration and attachment", () => {
  it.each(legacyCases)(
    "$handle handle rejects $replacement replacement, failed pull=$failure, without committing",
    async ({ handle: kind, replacement, failure }) => {
      const gw = await home();
      let pull: () => Promise<readonly Delta[]> = () => Promise.resolve([fact(1)]);
      const source = { pull: () => pull() };
      vi.stubGlobal("fetch", async () => wire(await pull()));
      // Empty prefix is deliberately supported legacy history, without forging or deleting events.
      const opts = { into: "friends", prefix: "", from: FROM, source };
      const fresh = await gw.openChannel(opts);
      const handle =
        kind === "fresh" ? fresh : resumeChannelImpl(gw, gw.channelStatus(fresh.name)[0]!, "token");
      expect(localChannelEvidence(gw, fresh.name)).toEqual({ state: "legacy" });
      expect((await handle.sync()).accepted).toBe(1);
      expect(handle.pool.gateway!.reactor.get(fact(1).id)).toBeDefined();
      const originalPool = fresh.pool.gateway!;
      const originalDeclaration = fresh.pool.declarationId!;
      expect(originalDeclaration).toBeDefined();
      const entered = deferred<void>(),
        network = deferred<readonly Delta[]>();
      pull = () => {
        entered.resolve();
        return network.promise;
      };
      let current = fresh;
      if (replacement === "attachment") {
        // This invocation deliberately starts AFTER replacement. A lazy name lookup must not
        // retarget the old resumed handle to the new physical pool before the commit guard runs.
        await gw.dropChannel(fresh.name);
        current = await gw.openChannel(opts);
        expect(current.pool.gateway).not.toBe(originalPool);
        expect(current.pool.declarationId).not.toBe(originalDeclaration);
        expect(localChannelEvidence(gw, fresh.name)).toEqual({ state: "legacy" });
      }
      const pending = handle.sync();
      const outcome = pending.then(
        () => ({ state: "fulfilled" as const }),
        (error: unknown) => ({ state: "rejected" as const, error }),
      );
      await entered.promise;
      if (replacement === "declaration") {
        // The pull entered on the original pool, then a real operator append supersedes its exact
        // declaration while keeping every legacy field and the physical attachment unchanged.
        const declaration = gw.reactor.get(originalDeclaration)!;
        const changed = signClaims({ ...declaration.claims, timestamp: gw.nextTimestamp() }, SEED);
        await gw.append([changed]);
        expect(changed.id).not.toBe(originalDeclaration);
        expect(gw.channelPools.get(fresh.name)!.gateway).toBe(originalPool);
        expect(await gw.backend.holds(changed.id)).toBe(true);
      }
      const beforeRoot = ids(gw),
        beforePool = ids(current.pool.gateway!);
      const status = gw.channelStatus(current.name);
      const offered = fact(2);
      if (failure) network.reject(new Error("fixture old peer failure"));
      else network.resolve([offered]);
      const result = await outcome;
      expect.soft(result.state).toBe("rejected");
      if (result.state === "rejected")
        expect.soft(String(result.error)).toMatch(/stale channel operation/);
      expect.soft(ids(gw)).toEqual(beforeRoot);
      expect.soft(ids(current.pool.gateway!)).toEqual(beforePool);
      expect.soft(gw.channelStatus(current.name)).toEqual(status);
      expect.soft(current.pool.gateway!.reactor.get(offered.id)).toBeUndefined();
      expect.soft(await current.pool.gateway!.backend.holds(offered.id)).toBe(false);
      expect(events(gw, current.name, "received")).toEqual([]);
      // The replacement attachment remains a usable legacy channel; stale refusal is not a
      // blanket ban on receives. Same-declaration mutation intentionally leaves old handles stale.
      if (replacement === "attachment") {
        pull = () => Promise.resolve([fact(3)]);
        expect((await current.sync()).accepted).toBe(1);
        expect(current.pool.gateway!.reactor.get(fact(3).id)).toBeDefined();
      }
    },
  );
});
