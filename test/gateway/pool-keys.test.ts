// Criterion 17: a new pool is its own peer under its own key K_p. The host records K_p before the
// pool uses it. An older pool (bytes, no key record) is refused (ruling 10). A host erasure binds in
// the pool only as an order that names the pool as its receiver (SPEC-6 §3).

import { describe, expect, it } from "vitest";
import { authorForSeed, OrdinaryJournalPeer, signClaims, type Delta } from "@bombadil/rhizomatic";
import { containerClaims } from "../../src/gateway/container-law.js";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import {
  memoryPoolKeys,
  recordedPoolKey,
  type PoolKeySource,
} from "../../src/gateway/pool-keys.js";
import { CTX_INCARNATION } from "../../src/gateway/recovery-cut.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "5a".repeat(32);
const OP = authorForSeed(SEED);
const OTHER_SEED = "6b".repeat(32);

const note = (n: number, seed = SEED): Delta =>
  signClaims(
    {
      timestamp: 10_000 + n,
      validFrom: 10_000 + n,
      author: authorForSeed(seed),
      pointers: [
        {
          role: "note",
          target: { kind: "entity", entity: { id: "pool:subject", context: "note" } },
        },
        { role: "n", target: { kind: "primitive", value: n } },
      ],
    },
    seed,
  );

const OTHER_PEER = authorForSeed(OTHER_SEED);

describe("criterion 17: a fresh pool starts under its own key", () => {
  const hostWith = (backend: MemoryBackend, keys: PoolKeySource): Promise<Gateway> =>
    Gateway.boot(backend, assembleGenesis({ operatorSeed: SEED }), {
      peerStore: backend.journalStore(),
      poolKeys: keys,
    });
  const declare = (gw: Gateway, name: string) =>
    gw.append([
      signClaims(
        containerClaims({ container: name, trust: "untrusted", posture: "separate" }, OP, 12_000),
        SEED,
      ),
    ]);

  it("mints K_p, the host records it first, and the pool's own law is K_p's", async () => {
    const gw = await hostWith(new MemoryBackend(), memoryPoolKeys());
    await declare(gw, "container:k17");
    const poolStore = new MemoryBackend();
    const c = await gw.openContainer({ name: "container:k17", backend: poolStore });
    const pool = c.gateway!;
    const kp = pool.operatorAuthor!;
    expect(kp).not.toBe(OP);
    expect(recordedPoolKey(gw.reactor, OP, "container:k17")).toBe(kp); // the host's record
    expect(pool.peer?.journal.peerId).toBe(kp); // its own journal peer
    // its first incarnation marker is signed by K_p
    const markers = [...pool.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_INCARNATION,
      ),
    );
    expect(markers.map((d) => d.claims.author)).toEqual([kp]);
    // it admits a write into its own journal
    const d = note(9);
    await pool.federate([d], { admit: () => true });
    const opened = await OrdinaryJournalPeer.open(poolStore.journalStore(), kp);
    expect(opened.status === "open" && opened.peer.snapshot().base.admitted.has(d.id)).toBe(true);
    await gw.close();
  });

  it("a pool the host recorded under a key it cannot load is refused, never reopened as the host", async () => {
    const hostStore = new MemoryBackend();
    const poolStore = new MemoryBackend();
    const gw = await hostWith(hostStore, memoryPoolKeys());
    await declare(gw, "container:k17b");
    await gw.openContainer({ name: "container:k17b", backend: poolStore });
    const other = await hostWith(hostStore, memoryPoolKeys()); // a key source that lost the key
    await expect(
      other.openContainer({ name: "container:k17b", backend: poolStore }),
    ).rejects.toThrow(/its key is not here/);
    await gw.close();
  });

  it("a recorded pool opened by a host that brought no key source is refused, never reopened as the host", async () => {
    const hostStore = new MemoryBackend();
    const poolStore = new MemoryBackend();
    const gw = await hostWith(hostStore, memoryPoolKeys());
    await declare(gw, "container:k17e");
    await gw.openContainer({ name: "container:k17e", backend: poolStore });
    // An embedder's open with no key source: it gets a fresh one, which lacks the recorded key.
    const bare = await Gateway.open(hostStore, { seed: SEED });
    await expect(
      bare.openContainer({ name: "container:k17e", backend: poolStore }),
    ).rejects.toThrow(/its key is not here/);
    await gw.close();
  });

  it("a host opened directly still gives a named pool its own key, and refuses an older pool", async () => {
    const hostStore = new MemoryBackend();
    const gw = await Gateway.open(hostStore, { seed: SEED }); // no boot, no key source passed
    await declare(gw, "container:k17f");
    const c = await gw.openContainer({ name: "container:k17f", backend: new MemoryBackend() });
    const kp = c.gateway!.operatorAuthor!;
    expect(kp).not.toBe(OP);
    expect(c.gateway!.peer?.journal.peerId).toBe(kp);
    expect(recordedPoolKey(gw.reactor, OP, "container:k17f")).toBe(kp);
    await declare(gw, "container:k17g");
    const older = new MemoryBackend();
    await older.append([note(30)]);
    await expect(gw.openContainer({ name: "container:k17g", backend: older })).rejects.toThrow(
      /earlier Loam/,
    );
    await gw.close();
  });

  it("an anonymous quarantine pool starts under its own key, on its own journal", async () => {
    const gw = await hostWith(new MemoryBackend(), memoryPoolKeys());
    const q = await gw.openQuarantine();
    const pool = q.gateway;
    expect(pool.operatorAuthor).not.toBe(OP);
    expect(pool.peer?.journal.peerId).toBe(pool.operatorAuthor);
    await gw.close();
  });

  it("a pool opened after a host erasure receives it as an order naming the pool, and refuses the target", async () => {
    const gw = await hostWith(new MemoryBackend(), memoryPoolKeys());
    const target = note(40);
    const bystander = note(41);
    await gw.append([target]);
    await gw.erase(target.id);
    const pool = (await gw.openQuarantine()).gateway;
    const orders = [...pool.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some((p) => p.role === "erases"),
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]!.claims.pointers.find((p) => p.role === "receiver")?.target).toEqual({
      kind: "primitive",
      value: pool.operatorAuthor,
    });
    // object level: the erased delta cannot come back into the pool; a bystander can
    expect((await pool.federate([target], { admit: () => true })).accepted).toBe(0);
    expect((await pool.federate([bystander], { admit: () => true })).accepted).toBe(1);
    await gw.close();
  });

  it("a nested pool opened after a root erasure receives it from its own opener, and refuses the target", async () => {
    const gw = await hostWith(new MemoryBackend(), memoryPoolKeys());
    const target = note(42);
    const p = (await gw.openQuarantine()).gateway;
    await gw.append([target]);
    await p.federate([target], { admit: () => true });
    await gw.erase(target.id); // fans out to p as an order naming p
    expect(p.reactor.get(target.id)).toBeUndefined();
    const q = (await p.openQuarantine()).gateway;
    const orders = [...q.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some((x) => x.role === "erases"),
    );
    expect(orders.map((d) => d.claims.author)).toEqual([p.operatorAuthor]);
    expect(orders[0]!.claims.pointers.find((x) => x.role === "receiver")?.target).toEqual({
      kind: "primitive",
      value: q.operatorAuthor,
    });
    expect((await q.federate([target], { admit: () => true })).accepted).toBe(0);
    expect((await q.federate([note(43)], { admit: () => true })).accepted).toBe(1); // bystander
    await gw.close();
  });

  it("an older pool (bytes, no key record) is refused, and its bytes do not change", async () => {
    const gw = await hostWith(new MemoryBackend(), memoryPoolKeys());
    await declare(gw, "container:k17c");
    const poolStore = new MemoryBackend();
    await poolStore.append([note(8)]);
    await expect(gw.openContainer({ name: "container:k17c", backend: poolStore })).rejects.toThrow(
      /earlier Loam/,
    );
    expect(recordedPoolKey(gw.reactor, OP, "container:k17c")).toBeUndefined();
    expect([...(await poolStore.ids())]).toEqual([note(8).id]);
    expect(await poolStore.journalPeers()).toEqual([]);
    await gw.close();
  });

  it("a host erasure reaches a K_p pool only as an order naming that pool (SPEC-6 §3)", async () => {
    const gw = await hostWith(new MemoryBackend(), memoryPoolKeys());
    await declare(gw, "container:k17d");
    const c = await gw.openContainer({ name: "container:k17d", backend: new MemoryBackend() });
    const pool = c.gateway!;
    const kp = pool.operatorAuthor!;
    const target = note(20);
    const bystander = note(21);
    await gw.append([target, bystander]);
    await pool.federate([target, bystander], { admit: () => true });
    // a host order with no receiver, or naming another peer, is testimony in the pool
    const bare = signClaims(eraseClaims(target.id, OP, OP, 40_000), SEED);
    const elsewhere = signClaims(
      eraseClaims(target.id, OP, OP, 40_001, undefined, undefined, OTHER_PEER),
      SEED,
    );
    await expect(pool.append([bare])).rejects.toThrow(/operator's alone/);
    await expect(pool.append([elsewhere])).rejects.toThrow(/operator's alone/);
    expect(pool.reactor.get(target.id)).toBeDefined();
    // the host's erase fans out an order it signs for this pool, naming K_p
    await gw.erase(target.id);
    const orders = [...pool.reactor.snapshot()].filter(
      (d) => d.claims.pointers.some((p) => p.role === "erases") && d.claims.author === OP,
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]!.claims.pointers.find((p) => p.role === "receiver")?.target).toEqual({
      kind: "primitive",
      value: kp,
    });
    expect(pool.reactor.get(target.id)).toBeUndefined();
    expect(pool.reactor.get(bystander.id)).toBeDefined(); // two-sided
    await gw.close();
  });
});
