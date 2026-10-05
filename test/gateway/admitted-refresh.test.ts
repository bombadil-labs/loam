import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { watchEntityImpl } from "../../src/gateway/reads.js";
import { Channel, streamAfter } from "../../src/gateway/channel.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const SEED = "6f".repeat(32);
const QUERY = `{ plant(entity: "${FERN}") { height } }`;
const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

async function pair() {
  const dir = mkdtempSync(join(tmpdir(), "loam-admitted-refresh-"));
  const file = join(dir, "store.sqlite");
  const writer = await Gateway.boot(
    new SqliteBackend(file),
    assembleGenesis({
      operatorSeed: SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  const bystander = observed(FERN, "height", 12, 1000, SEED);
  const target = observed(FERN, "height", 87, 1001, SEED);
  await writer.append([bystander, target]);
  const reader = await Gateway.open(new SqliteBackend(file), { seed: SEED });
  return {
    writer,
    reader,
    target,
    bystander,
    async close() {
      await reader.close();
      await writer.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const height = async (gw: Gateway) =>
  ((await gw.query(QUERY)).data?.plant as { height: number } | undefined)?.height;

describe("refresh reconciles the admitted set", () => {
  it("removes an externally erased row, clears cached views, and closes old streams", async () => {
    const p = await pair();
    try {
      expect(await height(p.reader)).toBe(87);
      const stream = p.reader.watch(HEIGHTS);
      expect(JSON.stringify((await stream.next()).value)).toContain(p.target.id);
      const count = p.reader.reactor.size;
      await p.writer.erase(p.target.id, { reason: "refresh must forget" });
      // A tombstone replaces its target. A size-only freshness check cannot see this change.
      expect(p.writer.reactor.size).toBe(count);
      await p.reader.refresh();
      expect(p.reader.reactor.size).toBe(count);
      expect(p.reader.reactor.get(p.target.id)).toBeUndefined();
      expect(p.reader.reactor.get(p.bystander.id)).toBeDefined();
      expect(await stream.next()).toMatchObject({ done: true });
      expect(p.reader.channels.has(stream)).toBe(false);
      expect(await height(p.reader)).toBe(12);
    } finally {
      await p.close();
    }
  });

  it("refolds persisted registrations when erasure replaces a binding at equal cardinality", async () => {
    const p = await pair();
    try {
      const binding = [...p.writer.reactor.snapshot()].find((d) =>
        d.claims.pointers.some(
          (pointer) =>
            pointer.target.kind === "entity" &&
            pointer.target.entity.context === "loam.registration",
        ),
      );
      expect(binding).toBeDefined();
      expect(p.reader.surface()?.registered).toHaveLength(1);
      const count = p.reader.reactor.size;
      await p.writer.erase(binding!.id, { reason: "retire the binding" });
      expect(p.writer.reactor.size).toBe(count);
      await p.reader.refresh();
      expect(p.reader.reactor.get(binding!.id)).toBeUndefined();
      expect(p.reader.reactor.get(p.bystander.id)).toBeDefined();
      expect(p.reader.surface()?.registered ?? []).toHaveLength(0);
    } finally {
      await p.close();
    }
  });

  it("forgets a row removed while reseat awaits subscription teardown", async () => {
    const p = await pair();
    try {
      const stream = p.reader.watch(HEIGHTS);
      await stream.next();
      const leave = stream.return.bind(stream);
      stream.return = async () => {
        await p.writer.erase(p.target.id, { reason: "remove during teardown" });
        return leave(undefined);
      };
      await p.reader.reseat();
      expect(p.reader.reactor.get(p.target.id)).toBeUndefined();
      expect(p.reader.reactor.get(p.bystander.id)).toBeDefined();
      expect(await height(p.reader)).toBe(12);
      expect(await stream.next()).toMatchObject({ done: true });
    } finally {
      await p.close();
    }
  });

  it("retries a failed reconciliation even when reopening already advanced the journal handle", async () => {
    const p = await pair();
    try {
      await p.writer.erase(p.target.id, { reason: "retry a failed refresh" });
      const reseat = p.reader.reseat.bind(p.reader);
      p.reader.reseat = () => Promise.reject(new Error("temporary store read failure"));
      await expect(p.reader.refresh()).rejects.toThrow("temporary store read failure");
      expect(p.reader.peer!.journal.currentHead()).toBe(p.writer.peer!.journal.currentHead());
      p.reader.reseat = reseat;
      await p.reader.refresh();
      expect(p.reader.reactor.get(p.target.id)).toBeUndefined();
      expect(p.reader.reactor.get(p.bystander.id)).toBeDefined();
      expect(await height(p.reader)).toBe(12);
    } finally {
      await p.close();
    }
  });

  it("keeps a write-through emission committed after conflict reconciliation replaces the reactor", async () => {
    const p = await pair();
    try {
      await p.writer.erase(p.target.id, { reason: "move the head before write-through" });
      const emitted = observed(FERN, "height", 31, 1002, SEED);
      expect(p.reader.reactor.ingest(emitted).status).toBe("accepted");
      await p.reader.flush();
      expect(p.reader.reactor.get(p.target.id)).toBeUndefined();
      expect(p.reader.reactor.get(p.bystander.id)).toBeDefined();
      expect(p.reader.reactor.get(emitted.id)).toBeDefined();
      expect(await height(p.reader)).toBe(31);
      expect(await height(p.writer)).toBe(31);
    } finally {
      await p.close();
    }
  });
  it("a throwing dependent notification must retry its unfinished fanout", async () => {
    const p = await pair();
    try {
      const d = observed(FERN, "height", 44, 1002, SEED);
      await p.writer.append([d]);
      let fail = true,
        callbacks = 0;
      p.reader.watchUsers(() => {
        if (fail) throw new Error("temporary observer fault");
      });
      p.reader.watchUsers(() => {
        callbacks++;
      });
      await expect(p.reader.refresh()).rejects.toThrow("temporary observer fault");
      expect(p.reader.reactor.get(d.id)).toBeDefined();
      expect(p.reader.needsJournalRefresh).toBe(true);
      fail = false;
      await p.reader.refresh();
      expect(callbacks).toBe(1);
    } finally {
      await p.close();
    }
  });
  it("retries refolding when the last ingested row survives a failed refold", async () => {
    const p = await pair();
    try {
      const binding = [...p.writer.reactor.snapshot()].find((d) =>
        d.claims.pointers.some(
          (q) => q.target.kind === "entity" && q.target.entity.context === "loam.registration",
        ),
      )!;
      expect(p.reader.surface()?.registered).toHaveLength(1);
      const strike = signClaims(
        makeNegationClaims(p.writer.operatorAuthor!, Date.now(), binding.id),
        SEED,
      );
      await p.writer.append([strike]);
      const replay = p.reader.replayRegistrations.bind(p.reader);
      p.reader.replayRegistrations = () => {
        throw new Error("temporary refold fault");
      };
      await expect(p.reader.refresh()).rejects.toThrow("temporary refold fault");
      expect(p.reader.reactor.get(strike.id)).toBeDefined();
      expect(p.reader.needsJournalRefresh).toBe(true);
      p.reader.replayRegistrations = replay;
      await p.reader.refresh();
      expect(p.reader.surface()?.registered ?? []).toHaveLength(0);
    } finally {
      await p.close();
    }
  });
  it("a failed direct reseat retries rather than skipping the adopted journal head", async () => {
    const p = await pair();
    try {
      await p.writer.erase(p.target.id, { reason: "direct reseat failure" });
      const store = p.reader.peer!.store;
      const original = store.readJournal.bind(store);
      let reads = 0;
      store.readJournal = async (id) => {
        if (++reads === 2) throw new Error("temporary journal failure");
        return original(id);
      };
      await expect(p.reader.reseat()).rejects.toThrow("temporary journal failure");
      expect(p.reader.peer!.journal.currentHead()).toBe(p.writer.peer!.journal.currentHead());
      expect(p.reader.reactor.get(p.target.id)).toBeDefined();
      store.readJournal = original;
      await p.reader.refresh();
      expect(p.reader.reactor.get(p.target.id)).toBeUndefined();
      expect(p.reader.reactor.get(p.bystander.id)).toBeDefined();
      expect(await height(p.reader)).toBe(12);
    } finally {
      await p.close();
    }
  });
  it("new native watch created by a woken reader does not retain removed bytes", async () => {
    const p = await pair();
    try {
      const old = p.reader.watch(HEIGHTS);
      await old.next();
      let resumed: ReturnType<Gateway["watch"]> | undefined;
      const wake = old.next().then((r) => {
        if (r.done) resumed = p.reader.watch(HEIGHTS);
      });
      await p.writer.erase(p.target.id, { reason: "remove then reconnect" });
      await p.reader.refresh();
      await wake;
      expect(p.reader.reactor.get(p.target.id)).toBeUndefined();
      expect(p.reader.reactor.get(p.bystander.id)).toBeDefined();
      expect(await height(p.reader)).toBe(12);
      const frame = await resumed!.next();
      expect(JSON.stringify(frame)).not.toContain(p.target.id);
    } finally {
      await p.close();
    }
  });
});

describe("streams opened during reactor replacement", () => {
  it("defers materialized streams until the new ground is ready", async () => {
    const p = await pair();
    try {
      const old = p.reader.watch(HEIGHTS);
      await old.next();
      let resumed: ReturnType<typeof watchEntityImpl> | undefined;
      const wake = old.next().then((result) => {
        if (result.done) resumed = watchEntityImpl(p.reader, "Plant", FERN);
      });
      await p.writer.erase(p.target.id, { reason: "reconnect materialized stream" });
      await p.reader.refresh();
      await wake;
      const frame = await resumed!.next();
      expect(frame.done).toBe(false);
      expect(frame.value).toMatchObject({ view: { height: 12 } });
      expect(p.reader.reactor.get(p.target.id)).toBeUndefined();
      expect(p.reader.reactor.get(p.bystander.id)).toBeDefined();
      await resumed!.return();
    } finally {
      await p.close();
    }
  });

  it("leaving a deferred stream wakes pending reads without opening it", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened = 0;
    const stream = streamAfter(ready, () => {
      opened += 1;
      return new Channel<string>();
    });
    const pending = stream.next();
    await stream.return();
    expect(await pending).toMatchObject({ done: true });
    release();
    expect(await stream.next()).toMatchObject({ done: true });
    expect(opened).toBe(0);
  });
});
