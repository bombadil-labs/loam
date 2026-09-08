// Operator cleanup removes only the exact attached pool after a proved local opening erasure.
// Cleanup records retire declarations; they never establish receive evidence.
import { afterEach, expect, it } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import {
  localChannelEvidence,
  parseLocalEvent,
} from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const seed = "cc".repeat(32);
const homes: Gateway[] = [];
afterEach(async () => {
  for (const gw of homes.splice(0)) await gw.close();
});
const ref = (d: Delta, role: string) => d.claims.pointers.find((p) => p.role === role)?.target;
const events = (gw: Gateway, action: string) =>
  [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.role === "action" && p.target.kind === "primitive" && p.target.value === action,
    ),
  );
async function home() {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
    { channelBackend: () => new MemoryBackend() },
  );
  homes.push(gw);
  return gw;
}
const opts = (prefix = "peer") => ({
  into: "friends",
  prefix,
  from: "https://peer.example",
  source: { pull: async () => [] as Delta[] },
});
async function fixture(receive = false) {
  const gw = await home();
  const source = observed(FERN, "height", 100, 1000, "aa".repeat(32));
  const ch = await gw.openChannel({ ...opts(), source: { pull: async () => [source] } });
  if (receive) await ch.sync();
  const evidence = localChannelEvidence(gw, ch.name);
  if (evidence.state !== "open") throw new Error(evidence.state);
  return { gw, ch, opening: evidence.opening, source };
}
async function restore(gw: Gateway) {
  const root = new MemoryBackend();
  await root.append(await gw.backend.deltasSince(new Set()));
  const pools = new Map<string, MemoryBackend>();
  for (const [name, pool] of gw.channelPools) {
    const backend = new MemoryBackend();
    await backend.append(await pool.gateway!.backend.deltasSince(new Set()));
    pools.set(name, backend);
  }
  const copy = await Gateway.boot(
    root,
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
    { channelBackend: (name) => pools.get(name) ?? new MemoryBackend() },
  );
  homes.push(copy);
  return copy;
}

it.each([false, true])(
  "cleans an erased current opening, received=%s, preserves bystanders and permits fresh receive",
  async (receive) => {
    const { gw, ch, opening, source } = await fixture(receive);
    const sibling = await gw.openChannel(opts("sibling"));
    const siblingBytes = await sibling.pool.gateway!.backend.deltasSince(new Set());
    const root = observed(FERN, "height", 9, 100, seed);
    await gw.append([root]);
    const erased = await gw.erase(opening.id);
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    await expect(ch.sync()).rejects.toThrow();
    const backend = ch.pool.gateway!.backend;
    const purge = backend.purge.bind(backend);
    backend.purge = async (ids) => {
      const cleanup = events(gw, "cleanup");
      expect(cleanup).toHaveLength(1);
      expect(await gw.backend.holds(cleanup[0]!.id)).toBe(true);
      expect(cleanup[0]!.claims.pointers).toEqual([
        {
          role: "event",
          target: {
            kind: "entity",
            entity: { id: `channel:${ch.name}`, context: "loam.local.channel.event" },
          },
        },
        { role: "version", target: { kind: "primitive", value: 1 } },
        { role: "action", target: { kind: "primitive", value: "cleanup" } },
        {
          role: "pool-declaration",
          target: { kind: "delta", deltaRef: { delta: opening.poolDeclaration } },
        },
        { role: "reason", target: { kind: "primitive", value: "erased-opening" } },
        { role: "erasure", target: { kind: "delta", deltaRef: { delta: erased.tombstone } } },
      ]);
      return purge(ids);
    };
    await gw.dropChannel(ch.name);
    expect(await backend.deltasSince(new Set())).toEqual([]);
    expect(await gw.backend.holds(root.id)).toBe(true);
    expect(await sibling.pool.gateway!.backend.deltasSince(new Set())).toEqual(siblingBytes);
    expect(gw.channelPools.has(ch.name)).toBe(false);
    expect(gw.channelStatus(ch.name)).toEqual([]);
    const cleanup = events(gw, "cleanup")[0]!;
    expect(parseLocalEvent(cleanup, gw.operatorAuthor)?.action).toBe("cleanup");
    await expect(gw.append([cleanup])).rejects.toThrow();
    expect((await gw.federate([cleanup], { admit: () => true })).accepted).toBe(0);
    const malformed = signClaims(
      {
        ...cleanup.claims,
        pointers: [...cleanup.claims.pointers, cleanup.claims.pointers.at(-1)!],
      },
      seed,
    );
    expect(parseLocalEvent(malformed, gw.operatorAuthor)).toBeUndefined();
    const fresh = await gw.openChannel({ ...opts(), source: { pull: async () => [source] } });
    await fresh.sync();
    const now = localChannelEvidence(gw, fresh.name);
    expect(now.state).toBe("open");
    if (now.state !== "open") throw new Error(now.state);
    expect(now.opening.id).not.toBe(opening.id);
    expect(now.received.map((d) => d.id)).toEqual([source.id]);
  },
);

it("cleans historical erased opening references without granting their receipts to a fresh incarnation", async () => {
  const { gw, ch, opening } = await fixture(true);
  await gw.dropChannel(ch.name);
  const current = await gw.openChannel(opts());
  await gw.erase(opening.id);
  expect(localChannelEvidence(gw, current.name).state).toBe("unavailable");
  await gw.dropChannel(current.name);
  const fresh = await gw.openChannel(opts());
  expect(localChannelEvidence(gw, fresh.name)).toMatchObject({ state: "open", received: [] });
});

it("a failed cleanup append prevents purge, while a failed purge can retry after trusted restart without another record", async () => {
  const { gw, ch, opening } = await fixture(true);
  await gw.erase(opening.id);
  const append = gw.backend.append.bind(gw.backend);
  let failAppend = true;
  gw.backend.append = async (deltas) => {
    const batch = [...deltas];
    if (
      failAppend &&
      batch.some((d) => parseLocalEvent(d, gw.operatorAuthor)?.action === "cleanup")
    )
      throw new Error("cleanup persist fault");
    return append(batch);
  };
  const backend = ch.pool.gateway!.backend;
  let purges = 0;
  backend.purge = async () => {
    purges++;
    throw new Error("pool purge fault");
  };
  await expect(gw.dropChannel(ch.name)).rejects.toThrow("cleanup persist fault");
  expect(purges).toBe(0);
  expect(events(gw, "cleanup")).toHaveLength(0);
  failAppend = false;
  await expect(gw.dropChannel(ch.name)).rejects.toThrow("pool purge fault");
  expect(purges).toBe(1);
  expect(events(gw, "cleanup")).toHaveLength(1);
  expect(gw.channelPools.get(ch.name)).toBe(ch.pool);
  await expect(ch.sync()).rejects.toThrow();
  const copy = await restore(gw);
  await copy.dropChannel(ch.name);
  expect(events(copy, "cleanup").map((d) => d.id)).toEqual(events(gw, "cleanup").map((d) => d.id));
  expect(copy.channelStatus(ch.name)).toEqual([]);
});

it.each(["unmarked hole", "wrong cached pool", "changed declaration", "malformed event"])(
  "refuses cleanup for %s",
  async (defect) => {
    const { gw, ch, opening } = await fixture(true);
    if (defect === "unmarked hole") {
      await gw.backend.purge([opening.id]);
      await gw.reseat();
    } else await gw.erase(opening.id);
    if (defect === "wrong cached pool") {
      const other = await gw.openChannel(opts("sibling"));
      gw.federationChannels.set(ch.name, { ...ch, pool: other.pool });
    }
    if (defect === "changed declaration") {
      const old = gw.reactor.get(opening.poolDeclaration)!;
      await gw.append([signClaims({ ...old.claims, timestamp: gw.nextTimestamp() }, seed)]);
    }
    if (defect === "malformed event") {
      const old = events(gw, "received")[0]!;
      const bad = signClaims(
        {
          ...old.claims,
          timestamp: gw.nextTimestamp(),
          pointers: [
            ...old.claims.pointers,
            { role: "extra", target: { kind: "primitive", value: true } },
          ],
        },
        seed,
      );
      await gw.backend.append([bad]);
      gw.reactor.ingest(bad);
    }
    const bytes = await ch.pool.gateway!.backend.deltasSince(new Set());
    await expect(gw.dropChannel(ch.name)).rejects.toThrow();
    expect(await ch.pool.gateway!.backend.deltasSince(new Set())).toEqual(bytes);
    expect(events(gw, "cleanup")).toHaveLength(0);
  },
);

it("rechecks attachment after persisting cleanup and does not purge a replacement", async () => {
  const { gw, ch, opening } = await fixture();
  const other = await gw.openChannel(opts("sibling"));
  await gw.erase(opening.id);
  const append = gw.backend.append.bind(gw.backend);
  gw.backend.append = async (deltas) => {
    const batch = [...deltas];
    const n = await append(batch);
    if (batch.some((d) => parseLocalEvent(d, gw.operatorAuthor)?.action === "cleanup"))
      gw.channelPools.set(ch.name, other.pool);
    return n;
  };
  const bytes = await ch.pool.gateway!.backend.deltasSince(new Set());
  await expect(gw.dropChannel(ch.name)).rejects.toThrow();
  expect(await ch.pool.gateway!.backend.deltasSince(new Set())).toEqual(bytes);
  expect(events(gw, "cleanup")).toHaveLength(1);
  expect(ref(events(gw, "cleanup")[0]!, "opening")).toBeUndefined();
});
