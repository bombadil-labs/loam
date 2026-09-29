// The step 6 host trial (refactor/audit/step6-host-trial.md): a host opened with a peer image
// store admits through the substrate. Each case reads BOTH levels: the image (what the peer
// admitted, and how it arrived) and the gateway (what a reader sees).
//
// Not covered here: erasure, which the image refuses by design in this trial; and the recovery
// barrier's in-batch order, which the image does not keep (a trial finding, not a rail).

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  decodeDurablePeerState,
  signClaims,
  type Delta,
  type DurablePeerState,
  type DurablePeerStore,
} from "@bombadil/rhizomatic";
import { containerClaims } from "../../src/gateway/container.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
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

const boot = (backend: StoreBackend & { peerStore(): DurablePeerStore }): Promise<Gateway> =>
  Gateway.boot(backend, assembleGenesis({ operatorSeed: SEED }), {
    peerStore: backend.peerStore(),
  });

async function image(store: DurablePeerStore): Promise<Uint8Array | undefined> {
  const read = await store.readImage(OP);
  return read.status === "image" ? read.image : undefined;
}

async function stateOf(store: DurablePeerStore): Promise<DurablePeerState> {
  return decodeDurablePeerState((await image(store))!, OP);
}

const sqliteHome = (): string => join(mkdtempSync(join(tmpdir(), "loam-peer-image-")), "s.sqlite");
const fileHash = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("a host opened with a peer image admits through it", () => {
  it("a fresh host's genesis, marker and appends are local arrivals in the image", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const d = note(1);
    await gw.append([d]);
    const state = await stateOf(backend.peerStore());
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
    expect((await stateOf(backend.peerStore())).base.admitted.size).toBe(before.size);
    await again.close();
  });

  it("an atomic append with one refused candidate commits nothing", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const live = note(1);
    await gw.append([live]);
    const before = await image(backend.peerStore());
    const bystander = note(2);
    // The image refuses an erasure in this trial, so the batch it rides in lands nowhere.
    const erasure = signClaims(eraseClaims(live.id, OP, OP, 20_000), SEED);
    await expect(gw.append([bystander, erasure])).rejects.toThrow(/peer image/);
    expect(await image(backend.peerStore())).toEqual(before);
    expect(await backend.holds(bystander.id)).toBe(false);
    expect(gw.reactor.get(bystander.id)).toBeUndefined();
    expect(gw.reactor.get(live.id)).toBeDefined(); // the earlier delta is untouched
    await gw.close();
  });

  it("a federation arrival is unattributed, never a peer id", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const d = note(3);
    const report = await gw.federate([d], { admit: () => true });
    expect(report.accepted).toBe(1);
    const arrival = (await stateOf(backend.peerStore())).base.arrivals.find((a) => a.id === d.id);
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
    const state = await stateOf(backend.peerStore());
    for (const d of [...raw, ...door]) expect(state.base.admitted.has(d.id)).toBe(true);
    await gw.close();
  });
});

describe("the image is the authority over the rows", () => {
  it("a store with rows and no image refuses to open, and its bytes do not change", async () => {
    const path = sqliteHome();
    const plain = new SqliteBackend(path);
    await plain.append([note(1)]); // rows written by a store that never had an image
    await plain.close();
    const hash = fileHash(path);
    await expect(boot(new SqliteBackend(path))).rejects.toThrow(/rows but no peer image/);
    expect(fileHash(path)).toBe(hash);
  });

  it("an admitted row missing from the store fails the open closed", async () => {
    const path = sqliteHome();
    const gw = await boot(new SqliteBackend(path));
    const d = note(1);
    await gw.append([d]);
    await gw.close();
    const db = new Database(path);
    db.prepare("DELETE FROM deltas WHERE id = ?").run(d.id);
    db.close();
    await expect(boot(new SqliteBackend(path))).rejects.toThrow(/no stored row/);
  });

  it("a row the image never admitted is not served", async () => {
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
    await again.close();
  });

  it("another operator key is another peer: its open over these rows is refused", async () => {
    const path = sqliteHome();
    const gw = await boot(new SqliteBackend(path));
    await gw.close();
    // The file holds the first peer's image and rows, and no image for the other key.
    const backend = new SqliteBackend(path);
    await expect(
      Gateway.boot(backend, assembleGenesis({ operatorSeed: OTHER_SEED }), {
        peerStore: backend.peerStore(),
      }),
    ).rejects.toThrow(/rows but no peer image/);
    await backend.close();
  });
});

describe("the adapters' empty-image creation", () => {
  for (const [name, make] of [
    ["memory", () => new MemoryBackend()],
    ["sqlite", () => new SqliteBackend(sqliteHome())],
  ] as const) {
    it(`${name}: two creations race, and exactly one commits`, async () => {
      const store = make().peerStore();
      const bytes = new Uint8Array([1, 2, 3]);
      const results = await Promise.all([
        store.compareAndSet(OP, null, bytes, []),
        store.compareAndSet(OP, null, bytes, []),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["conflict", "durable"]);
    });

    it(`${name}: creation over a store that holds a row refuses and writes nothing`, async () => {
      const backend = make();
      await backend.append([note(1)]);
      const store = backend.peerStore();
      expect(await store.readImage(OP)).toEqual({ status: "rows-without-image" });
      expect((await store.compareAndSet(OP, null, new Uint8Array([9]), [])).status).toBe(
        "conflict",
      );
      expect(await store.readImage(OP)).toEqual({ status: "rows-without-image" });
    });
  }
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
    const before = await image(backend.peerStore());
    const c = await gw.openContainer({ name: "container:trial" });
    const pool = c.gateway!;
    expect(pool.peer).toBeUndefined();
    expect(gw.peer).toBeDefined();
    const d = note(9);
    await pool.federate([d], { admit: () => true });
    expect(pool.reactor.get(d.id)).toBeDefined();
    // the host's image did not see the pool's write
    expect(await image(backend.peerStore())).toEqual(before);
    await gw.close();
  });
});
