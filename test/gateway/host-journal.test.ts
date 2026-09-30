// A host is one substrate peer: it opens from its ordinary journal and admits through it. Each
// case reads BOTH levels: the journal (what the peer admitted, and how it arrived) and the
// gateway (what a reader sees). Pools stay off the journal until they take their own key.

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  OrdinaryJournalPeer,
  signClaims,
  type Delta,
  type DurableOrdinaryJournalStore,
  type DurablePeerState,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import type { StoreBackend } from "../../src/store/backend.js";

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
          target: { kind: "entity", entity: { id: "trial:subject", context: "note" } },
        },
        { role: "n", target: { kind: "primitive", value: n } },
      ],
    },
    seed,
  );

const boot = (
  backend: StoreBackend & { journalStore(): DurableOrdinaryJournalStore },
): Promise<Gateway> =>
  Gateway.boot(backend, assembleGenesis({ operatorSeed: SEED }), {
    peerStore: backend.journalStore(),
  });

// The journal's head, and its frame count: together they change on every commit.
async function image(store: DurableOrdinaryJournalStore): Promise<string | undefined> {
  const read = await store.readJournal(OP);
  return read.status === "journal" ? `${read.head}/${read.frames.length}` : undefined;
}

async function stateOf(store: DurableOrdinaryJournalStore): Promise<DurablePeerState> {
  const opened = await OrdinaryJournalPeer.open(store, OP);
  if (opened.status !== "open") throw new Error(opened.status);
  return opened.peer.snapshot();
}

const sqliteHome = (): string => join(mkdtempSync(join(tmpdir(), "loam-peer-image-")), "s.sqlite");
const fileHash = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("a host opened with a peer journal admits through it", () => {
  it("a fresh host's genesis, marker and appends are local arrivals in the journal", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const d = note(1);
    await gw.append([d]);
    const state = await stateOf(backend.journalStore());
    // delta level: the image admitted it, as a local arrival, and it is the store's row
    expect(state.base.admitted.has(d.id)).toBe(true);
    expect(state.base.arrivals.find((a) => a.id === d.id)?.sender).toBe("local");
    expect(await backend.holds(d.id)).toBe(true);
    // every row the store holds is one the image admitted
    expect([...(await backend.ids())].every((id) => state.base.admitted.has(id))).toBe(true);
    // object level: the gateway serves it
    expect(gw.reactor.get(d.id)).toBeDefined();
    await gw.close();
  });

  it("a reopen reads the image: the same set, with no second marker", async () => {
    const path = sqliteHome();
    const first = await boot(new SqliteBackend(path));
    await first.append([note(1), note(2)]);
    const before = new Set([...first.reactor.snapshot()].map((d) => d.id));
    await first.close();
    const backend = new SqliteBackend(path);
    const again = await boot(backend);
    const after = new Set([...again.reactor.snapshot()].map((d) => d.id));
    expect(after).toEqual(before);
    expect((await stateOf(backend.journalStore())).base.admitted.size).toBe(before.size);
    await again.close();
  });

  it("a local append that mixes an erasure with other deltas is one atomic transfer", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const live = note(1);
    await gw.append([live]);
    const bystander = note(2);
    const erasure = signClaims(eraseClaims(live.id, OP, OP, 20_000), SEED);
    await gw.append([bystander, erasure]);
    const state = await stateOf(backend.journalStore());
    // one transfer: the order and the ordinary delta share one transfer ordinal
    const arrivals = state.base.arrivals.filter(
      (a) => a.id === erasure.id || a.id === bystander.id,
    );
    expect(arrivals).toHaveLength(2);
    expect(new Set(arrivals.map((a) => a.transfer)).size).toBe(1);
    expect(state.base.refusedIds.has(live.id)).toBe(true);
    expect(gw.reactor.get(bystander.id)).toBeDefined();
    await gw.close();
  });

  it("erase through the journal: the target is refused, and a bystander stays", async () => {
    const path = sqliteHome();
    const backend = new SqliteBackend(path);
    const gw = await boot(backend);
    const target = note(1);
    const bystander = note(2);
    await gw.append([target]);
    await gw.append([bystander]);
    await gw.erase(target.id).catch(() => undefined); // the report may be "not complete"
    // delta level: the journal refuses the target
    const state = await stateOf(backend.journalStore());
    expect(state.base.refusedIds.has(target.id)).toBe(true);
    expect(state.base.admitted.has(target.id)).toBe(false);
    expect(await backend.holds(target.id)).toBe(false);
    // The bytes themselves are checked in the plaintext rail below.
    await gw.close();
    // object level, after a reopen: the target never returns; the bystander is served
    const again = await boot(new SqliteBackend(path));
    expect(again.reactor.get(target.id)).toBeUndefined();
    expect(again.reactor.get(bystander.id)).toBeDefined();
    await expect(again.append([target])).rejects.toThrow(/erased/);
    await again.close();
  });

  for (const door of ["append", "federate"] as const) {
    it(`an operator order admitted at the ${door} door pays its purge; a bystander stays`, async () => {
      const backend = new SqliteBackend(sqliteHome());
      const gw = await boot(backend);
      const target = note(3);
      const bystander = note(4);
      await gw.append([target, bystander]);
      const order = signClaims(eraseClaims(target.id, OP, OP, 70_000), SEED);
      if (door === "append") await gw.append([order]);
      else await gw.federate([order], { admit: () => true });
      // bytes: the target is gone, the bystander is held
      expect(await backend.holds(target.id)).toBe(false);
      expect(await backend.holds(bystander.id)).toBe(true);
      // journal: the order is admitted, the target refused, and nothing is owed
      const state = await stateOf(backend.journalStore());
      expect(state.base.admitted.has(order.id)).toBe(true);
      expect(state.base.refusedIds.has(target.id)).toBe(true);
      expect(state.obligations.filter((o) => o.status !== "removed")).toEqual([]);
      await gw.close();
    });
  }

  it("erase through the journal: the plaintext leaves every byte of the file, then settles", async () => {
    const path = sqliteHome();
    const backend = new SqliteBackend(path);
    const gw = await boot(backend);
    const secret = "CONDEMNED-SECRET-MARKER";
    const kept = "BYSTANDER-KEPT-MARKER";
    const target = signClaims(
      {
        timestamp: 30_000,
        validFrom: 30_000,
        author: OP,
        pointers: [{ role: "v", target: { kind: "primitive", value: secret } }],
      },
      SEED,
    );
    const bystander = signClaims(
      {
        timestamp: 30_001,
        validFrom: 30_001,
        author: OP,
        pointers: [{ role: "v", target: { kind: "primitive", value: kept } }],
      },
      SEED,
    );
    await gw.append([target]);
    await gw.append([bystander]);
    await gw.erase(target.id);
    const state = await stateOf(backend.journalStore());
    await gw.close();
    const bytes = (f: string): Buffer => (existsSync(f) ? readFileSync(f) : Buffer.alloc(0));
    const file = Buffer.concat([bytes(path), bytes(`${path}-wal`)]);
    // the bytes: the target's plaintext is nowhere in the file or its sidecar; the bystander's is
    expect(file.includes(Buffer.from(secret))).toBe(false);
    expect(file.includes(Buffer.from(kept))).toBe(true);
    // and only then does the obligation read removed
    expect(state.obligations.filter((o) => o.targetId === target.id).map((o) => o.status)).toEqual([
      "removed",
    ]);
    const again = await boot(new SqliteBackend(path));
    expect(again.reactor.get(bystander.id)).toBeDefined();
    expect(again.reactor.get(target.id)).toBeUndefined();
    await again.close();
  });

  it("after a rebase, later appends continue the chain, and the journal reopens (memory)", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const target = note(1);
    await gw.append([target]);
    await gw.erase(target.id);
    const later = note(2);
    await gw.append([later]);
    const state = await stateOf(backend.journalStore()); // reopens from the checkpoint and frames
    expect(state.base.admitted.has(later.id)).toBe(true);
    expect(state.base.refusedIds.has(target.id)).toBe(true);
    await gw.close();
  });

  it("a federation arrival is unattributed, never a peer id", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const d = note(3);
    const report = await gw.federate([d], { admit: () => true });
    expect(report.accepted).toBe(1);
    const arrival = (await stateOf(backend.journalStore())).base.arrivals.find(
      (a) => a.id === d.id,
    );
    expect(arrival?.sender).toBe("unattributed");
    expect(gw.reactor.get(d.id)).toBeDefined();
    await gw.close();
  });

  it("the door and the write-through share one commit queue: neither loses a write", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    // A delta that enters the reactor directly goes out through the write-through; the others go
    // through the door. Both commit to one image, so both must be admitted.
    const raw = [4, 5, 6].map((n) => note(n));
    const door = [7, 8, 9].map((n) => note(n));
    const appends = door.map((d) => gw.append([d]));
    for (const d of raw) gw.reactor.ingest(d);
    await Promise.all(appends);
    await gw.flush();
    const state = await stateOf(backend.journalStore());
    for (const d of [...raw, ...door]) expect(state.base.admitted.has(d.id)).toBe(true);
    await gw.close();
  });
});

describe("the journal is the authority over the rows", () => {
  it("a store with rows and no journal refuses to open, and its bytes do not change", async () => {
    const path = sqliteHome();
    const plain = new SqliteBackend(path);
    await plain.append([note(1)]); // rows written by a store that never had an image
    await plain.close();
    const hash = fileHash(path);
    const refused = new SqliteBackend(path);
    await expect(boot(refused)).rejects.toThrow(/rows but no peer journal/);
    await refused.close();
    expect(fileHash(path)).toBe(hash);
  });

  it("a seeded open is a host's: rows with no journal are refused; a fresh store starts one", async () => {
    const path = sqliteHome();
    const plain = new SqliteBackend(path);
    await plain.append([note(1)]);
    await plain.close();
    const hash = fileHash(path);
    const refused = new SqliteBackend(path);
    await expect(Gateway.open(refused, { seed: SEED })).rejects.toThrow(/rows but no peer journal/);
    await refused.close();
    expect(fileHash(path)).toBe(hash);
    const fresh = new MemoryBackend();
    const gw = await Gateway.open(fresh, { seed: SEED });
    expect(await fresh.journalPeers()).toEqual([OP]);
    await gw.append([note(2)]);
    expect((await stateOf(fresh.journalStore())).base.admitted.has(note(2).id)).toBe(true);
    await gw.close();
  });

  it("an admitted row missing from the store degrades the open: not served, writes live (§25)", async () => {
    const path = sqliteHome();
    const gw = await boot(new SqliteBackend(path));
    const d = note(1);
    const bystander = note(2);
    await gw.append([d]);
    await gw.append([bystander]);
    await gw.close();
    const db = new Database(path);
    db.prepare("DELETE FROM deltas WHERE id = ?").run(d.id);
    db.close();
    const again = await boot(new SqliteBackend(path));
    expect(again.reactor.get(d.id)).toBeUndefined(); // nothing reconstructed from the journal
    expect(again.reactor.get(bystander.id)).toBeDefined();
    const late = note(3);
    await again.append([late]); // admission stays live
    expect(again.reactor.get(late.id)).toBeDefined();
    await again.close();
  });

  it("an admitted row whose signature changed in the file is set aside, never served", async () => {
    const path = sqliteHome();
    const gw = await boot(new SqliteBackend(path));
    const d = note(1);
    await gw.append([d]);
    await gw.close();
    const db = new Database(path);
    db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run(note(2).sig, d.id);
    db.close();
    const backend = new SqliteBackend(path);
    const again = await boot(backend);
    expect(again.reactor.get(d.id)).toBeUndefined();
    expect((await backend.quarantine()).map((r) => r.key)).toEqual([d.id]); // reported (§25)
    await again.close();
  });

  it("a row the journal never admitted is not served", async () => {
    const path = sqliteHome();
    const gw = await boot(new SqliteBackend(path));
    const kept = note(1);
    await gw.append([kept]);
    await gw.close();
    const stray = note(2);
    await new SqliteBackend(path).append([stray]); // a raw row, around the door
    const again = await boot(new SqliteBackend(path));
    expect(again.reactor.get(stray.id)).toBeUndefined();
    expect(again.reactor.get(kept.id)).toBeDefined();
    expect(again.rowsOutsideJournal).toBe(1); // held, not served, and counted for the report
    await again.close();
  });

  it("a journaled store opens only through its journal, with or without a seed", async () => {
    const path = sqliteHome();
    const gw = await boot(new SqliteBackend(path));
    const d = note(1);
    await gw.append([d]);
    await gw.close();
    const stray = note(2);
    await new SqliteBackend(path).append([stray]); // a raw row the journal never admitted
    const again = await Gateway.open(new SqliteBackend(path), { seed: SEED });
    expect(again.peer).toBeDefined();
    expect(again.reactor.get(d.id)).toBeDefined();
    expect(again.reactor.get(stray.id)).toBeUndefined();
    await again.close();
    // No seed: the store's only journal names the peer, and the stray row stays unserved.
    const seedless = await Gateway.open(new SqliteBackend(path));
    expect(seedless.peer).toBeDefined();
    expect(seedless.reactor.get(stray.id)).toBeUndefined();
    await seedless.close();
  });

  it("another operator key is another peer: its open over these rows is refused", async () => {
    const path = sqliteHome();
    const gw = await boot(new SqliteBackend(path));
    await gw.close();
    // The file holds the first peer's image and rows, and no image for the other key.
    const backend = new SqliteBackend(path);
    await expect(
      Gateway.boot(backend, assembleGenesis({ operatorSeed: OTHER_SEED }), {
        peerStore: backend.journalStore(),
      }),
    ).rejects.toThrow(/belongs to .*names no journal here/);
    await backend.close();
  });
});

describe("pools stay on today's path", () => {
  it("a pool of an image host has no peer, and its writes touch no image", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:trial", trust: "untrusted", posture: "separate" },
          OP,
          12_000,
        ),
        SEED,
      ),
    ]);
    const before = await image(backend.journalStore());
    const c = await gw.openContainer({ name: "container:trial" });
    const pool = c.gateway!;
    expect(pool.peer).toBeUndefined();
    expect(gw.peer).toBeDefined();
    const d = note(9);
    await pool.federate([d], { admit: () => true });
    expect(pool.reactor.get(d.id)).toBeDefined();
    // the host's image did not see the pool's write
    expect(await image(backend.journalStore())).toEqual(before);
    await gw.close();
  });
});

describe("two writers on one journal: catch up, re-check, retry", () => {
  const WRITER_SEED = "7c".repeat(32);
  const WRITER = authorForSeed(WRITER_SEED);
  const grant = grantClaims(STORE_ENTITY, WRITER, "write", OP, 9_000);
  const bootWith = (backend: SqliteBackend): Promise<Gateway> =>
    Gateway.boot(backend, assembleGenesis({ operatorSeed: SEED, grants: [grant] }), {
      peerStore: backend.journalStore(),
    });

  it("a stale writer catches up and commits; both writes are in the journal", async () => {
    const path = sqliteHome();
    const a = await bootWith(new SqliteBackend(path));
    const bBackend = new SqliteBackend(path);
    const b = await bootWith(bBackend);
    const d1 = note(1);
    await a.append([d1]);
    const d2 = note(2);
    await b.append([d2]); // b's head is stale: it reopens, takes in d1, and retries
    const state = await stateOf(bBackend.journalStore());
    expect(state.base.admitted.has(d1.id) && state.base.admitted.has(d2.id)).toBe(true);
    expect(b.reactor.get(d1.id)).toBeDefined(); // b now serves what a wrote
    await a.close();
    await b.close();
  });

  it("the retry re-runs Loam's checks: a write the other writer made unlawful is refused", async () => {
    const path = sqliteHome();
    const a = await bootWith(new SqliteBackend(path));
    const bBackend = new SqliteBackend(path);
    const b = await bootWith(bBackend);
    const granted = [...a.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === WRITER),
    )!;
    // a revokes the writer's grant; b has not seen it
    await a.append([signClaims(makeNegationClaims(OP, 20_000, granted.id), SEED)]);
    const late = note(3, WRITER_SEED);
    await expect(b.append([late])).rejects.toThrow(/not permitted/);
    const state = await stateOf(bBackend.journalStore());
    expect(state.base.admitted.has(late.id)).toBe(false);
    expect(b.reactor.get(late.id)).toBeUndefined();
    await a.close();
    await b.close();
  });

  it("under persistent contention the append fails as retryable, and writes nothing", async () => {
    const backend = new MemoryBackend();
    const real = backend.journalStore();
    let contended = false;
    // Every commit after the boot finds the head moved by "another writer".
    const store: DurableOrdinaryJournalStore = {
      ...real,
      compareAndAppend: (...args) =>
        contended ? Promise.resolve({ status: "conflict" }) : real.compareAndAppend(...args),
    };
    const gw = await Gateway.boot(backend, assembleGenesis({ operatorSeed: SEED }), {
      peerStore: store,
    });
    contended = true;
    const d = note(4);
    await expect(gw.append([d])).rejects.toThrow(/Nothing was admitted or refused; try again/);
    expect(await backend.holds(d.id)).toBe(false);
    expect(gw.reactor.get(d.id)).toBeUndefined();
    await gw.close();
  });
});
