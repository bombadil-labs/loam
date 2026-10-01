import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
      p.reader.reseat = async () => {
        throw new Error("temporary store read failure");
      };
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
});
