// The ordinary journal store seam (rhizomatic 0.11.0-next.6), per driver. These rails drive the
// substrate's OrdinaryJournalPeer directly over each adapter: no gateway is involved, so what they
// prove is the storage contract itself. The erasure rail checks the BYTES of the sqlite file and
// its -wal sidecar, because a row-only absence proof is not a proof (the frames and checkpoints
// hold payloads too).

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  OrdinaryJournalPeer,
  signClaims,
  type Delta,
  type DurableOrdinaryJournalStore,
} from "@bombadil/rhizomatic";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";

const SEED = "5a".repeat(32);
const OP = authorForSeed(SEED);
const note = (n: number, value: unknown = n): Delta =>
  signClaims(
    {
      timestamp: 10_000 + n,
      validFrom: 10_000 + n,
      author: OP,
      pointers: [{ role: "v", target: { kind: "primitive", value: value as number } }],
    },
    SEED,
  );
const sqlitePath = (): string => join(mkdtempSync(join(tmpdir(), "loam-journal-")), "s.sqlite");

async function opened(store: DurableOrdinaryJournalStore): Promise<OrdinaryJournalPeer> {
  const r = await OrdinaryJournalPeer.open(store, OP);
  if (r.status !== "open") throw new Error(`open: ${r.status}`);
  return r.peer;
}

const admit = (peer: OrdinaryJournalPeer, offered: readonly Delta[]) =>
  peer.admit({
    offered,
    origin: { kind: "local" },
    arrivedAt: 50_000,
    policyState: {},
    guards: [],
    isErasureCandidate: () => false,
    mode: "atomic",
    capacity: Number.MAX_SAFE_INTEGER,
  });

const drivers = [
  ["memory", () => new MemoryBackend()],
  ["sqlite", () => new SqliteBackend(sqlitePath())],
  ["mirror", () => new MirrorBackend(new MemoryBackend(), new MemoryBackend())],
] as const;

describe("the journal store seam, per driver", () => {
  for (const [name, make] of drivers) {
    it(`${name}: two creations race, and exactly one commits`, async () => {
      const store = make().journalStore();
      const results = await Promise.all([
        store.compareAndAppend(OP, null, "", null, []),
        store.compareAndAppend(OP, null, "", null, []),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["conflict", "durable"]);
      expect(await store.readJournal(OP)).toEqual({ status: "journal", head: "", frames: [] });
    });

    it(`${name}: a store that already holds rows has no journal, and none is created over it`, async () => {
      const backend = make();
      await backend.append([note(1)]);
      const store = backend.journalStore();
      expect(await store.readJournal(OP)).toEqual({ status: "rows-without-journal" });
      expect((await store.compareAndAppend(OP, null, "", null, [])).status).toBe("conflict");
      expect((await OrdinaryJournalPeer.open(store, OP)).status).toBe("rows-without-journal");
    });

    it(`${name}: an append against a stale head is a conflict and writes nothing`, async () => {
      const store = make().journalStore();
      await store.compareAndAppend(OP, null, "", null, []);
      const write = await store.compareAndAppend(OP, "not-the-head", "x", new Uint8Array([1]), [
        note(2),
      ]);
      expect(write.status).toBe("conflict");
      expect(await store.readAdmittedRows(OP, [note(2).id])).toEqual([]);
    });

    it(`${name}: admitted rows survive a reopen, and a settle refutes while bytes remain`, async () => {
      const backend = make();
      const store = backend.journalStore();
      const peer = await opened(store);
      const d = note(3);
      expect((await admit(peer, [d])).status).toBe("committed");
      const again = await opened(store); // a reopen replays the frames and checks the rows
      expect(again.availableDeltas().has(d.id)).toBe(true);
      const head = again.currentHead();
      expect(
        await store.compareAndSettlePurge!(OP, head, "x", new Uint8Array([7]), d.id, 1),
      ).toEqual({ status: "absence-refuted", targetId: d.id });
      expect(await store.readHead(OP)).toEqual({ status: "head", head }); // unchanged
    });
  }
});

describe("erasure through the journal, proven at the bytes", () => {
  it("sqlite: after order, rebase and purge, the plaintext is gone from the file and its -wal", async () => {
    const path = sqlitePath();
    const backend = new SqliteBackend(path);
    const store = backend.journalStore();
    const peer = await opened(store);
    const secret = "CONDEMNED-SECRET-MARKER";
    const target = note(4, secret);
    const bystander = note(5, "BYSTANDER-KEPT-MARKER");
    await admit(peer, [target, bystander]);
    const order = signClaims(eraseClaims(target.id, OP, OP, 60_000), SEED);
    const erased = await peer.admitErasures({
      orders: [{ delta: order, targetId: target.id, surfaceHoldsBytes: true }],
      origin: { kind: "local" },
      arrivedAt: 60_000,
      policyState: {},
      guards: [],
      mode: "atomic",
      targetBudget: Number.MAX_SAFE_INTEGER,
      advanceRefusalCap: 0,
      authorize: () => true,
    });
    expect(erased.status).toBe("committed");
    const owed = peer.snapshot().obligations.find((o) => o.targetId === target.id)!;
    // before any rebase the settle is refused: the admitting frame still holds the payload
    await backend.purge([target.id]);
    expect((await peer.reportPurge(target.id, owed.generation, { status: "removed" })).status).toBe(
      "absence-refuted",
    );
    const reopened = await opened(store); // a refuted settle asks for a reopen
    expect((await reopened.rebase()).status).toBe("durable");
    expect(
      (await reopened.reportPurge(target.id, owed.generation, { status: "removed" })).status,
    ).toBe("committed");
    await backend.close();
    const bytes = (f: string): Buffer => (existsSync(f) ? readFileSync(f) : Buffer.alloc(0));
    const file = Buffer.concat([bytes(path), bytes(`${path}-wal`)]);
    expect(file.includes(Buffer.from(secret))).toBe(false);
    expect(file.includes(Buffer.from("BYSTANDER-KEPT-MARKER"))).toBe(true); // two-sided
  });

  it("mirror: a settle refutes absence while the shadow tier holds a copy", async () => {
    const shadow = new MemoryBackend();
    const backend = new MirrorBackend(new MemoryBackend(), shadow);
    const store = backend.journalStore();
    await store.compareAndAppend(OP, null, "", null, []);
    const d = note(6);
    await shadow.append([d]);
    expect(await store.compareAndSettlePurge!(OP, "", "x", new Uint8Array([7]), d.id, 1)).toEqual({
      status: "absence-refuted",
      targetId: d.id,
    });
  });
});

describe("settle paths after an interrupted checkpoint, and against a stale head", () => {
  it("sqlite: a WAL debt a busy checkpoint left behind clears on a later, uncontended settle", async () => {
    const path = sqlitePath();
    const first = new SqliteBackend(path);
    await first.journalStore().compareAndAppend(OP, null, "", null, []);
    await first.close();
    // What a rebase leaves when its checkpoint meets a reader: the marker, still standing.
    const db = new Database(path);
    db.prepare("INSERT INTO meta (key, value) VALUES ('rebase-wal-outstanding', ?)").run(OP);
    db.close();
    const store = new SqliteBackend(path).journalStore();
    const absent = note(9).id;
    expect(await store.compareAndSettlePurge!(OP, "", "x", new Uint8Array([7]), absent, 1)).toEqual(
      {
        status: "durable",
      },
    );
    expect(await store.readHead(OP)).toEqual({ status: "head", head: "x" });
  });

  it("mirror: a stale head is a conflict even while the shadow tier holds the target", async () => {
    const shadow = new MemoryBackend();
    const store = new MirrorBackend(new MemoryBackend(), shadow).journalStore();
    await store.compareAndAppend(OP, null, "", null, []);
    const d = note(10);
    await shadow.append([d]);
    const frame = new Uint8Array([7]);
    expect(await store.compareAndSettlePurge!(OP, "stale", "x", frame, d.id, 1)).toEqual({
      status: "conflict",
    });
    expect(await store.compareAndAppendErasure!(OP, "stale", "x", frame, [], [d.id])).toEqual({
      status: "conflict",
    });
    expect(await store.readHead(OP)).toEqual({ status: "head", head: "" });
  });
});

describe("a mirror head that moves while the shadow tier is asked", () => {
  for (const method of ["settle", "erasure"] as const) {
    it(`mirror ${method}: a head moved during the shadow read is a conflict, not a refutation`, async () => {
      let release!: () => void;
      const paused = new Promise<void>((r) => (release = r));
      let asked!: () => void;
      const reading = new Promise<void>((r) => (asked = r));
      class SlowShadow extends MemoryBackend {
        override async holds(id: string): Promise<boolean> {
          asked();
          await paused;
          return super.holds(id);
        }
      }
      const shadow = new SlowShadow();
      const primary = new MemoryBackend();
      const store = new MirrorBackend(primary, shadow).journalStore();
      await store.compareAndAppend(OP, null, "", null, []);
      const d = note(11);
      await shadow.append([d]);
      const frame = new Uint8Array([7]);
      const result =
        method === "settle"
          ? store.compareAndSettlePurge!(OP, "", "x", frame, d.id, 1)
          : store.compareAndAppendErasure!(OP, "", "x", frame, [], [d.id]);
      await reading;
      // Another writer moves the head through the primary while the shadow read is pending.
      await primary.journalStore().compareAndAppend(OP, "", "moved", new Uint8Array([1]), []);
      release();
      expect(await result).toEqual({ status: "conflict" });
    });
  }
});

describe("a damaged admitted row degrades the open (§25)", () => {
  it("sqlite: a deleted admitted row is reported unavailable, and the rest is served", async () => {
    const path = sqlitePath();
    const store = new SqliteBackend(path).journalStore();
    const peer = await opened(store);
    const gone = note(7);
    const kept = note(8);
    await admit(peer, [gone, kept]);
    const db = new Database(path);
    db.prepare("DELETE FROM deltas WHERE id = ?").run(gone.id);
    db.close();
    const store2 = new SqliteBackend(path).journalStore();
    await expect(OrdinaryJournalPeer.open(store2, OP)).rejects.toThrow(/admitted row mismatch/); // strict
    const degraded = await OrdinaryJournalPeer.open(store2, OP, { allowDegraded: true });
    expect(degraded.status).toBe("degraded");
    if (degraded.status !== "degraded") return;
    expect(degraded.unavailable.map((u) => u.id)).toEqual([gone.id]);
    expect(degraded.peer.availableDeltas().has(kept.id)).toBe(true);
    expect(degraded.peer.availableDeltas().has(gone.id)).toBe(false);
  });
});
