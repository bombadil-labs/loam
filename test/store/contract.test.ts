// Step 2's contract: persistence is a seam, and every driver is an interchangeable witness to
// it. A backend holds a grow-only set of deltas, deduped by id — append is idempotent,
// deltasSince(known) is the exact complement, and what comes back is byte-for-byte what went
// in, signatures and all. Durable drivers additionally survive close/reopen and let a second
// handle see the union.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import {
  claimsToJson,
  makeDelta,
  makeNegationClaims,
  verifyDelta,
  type Delta,
} from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";

const signed1 = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const signed2 = observed(FERN, "height", 34, 2000, SURVEYOR_SEED);
const unsigned = makeDelta({
  timestamp: 3000,
  author: "did:key:zAnon",
  pointers: [{ role: "note", target: { kind: "primitive", value: "unsigned but true" } }],
});
// The shapes step 3 will persist: a delta-ref (negation), an entity-ref with context, a boolean.
const negation = makeDelta(makeNegationClaims(GARDENER, 3500, signed2.id, "remeasured"));
const mixed = makeDelta({
  timestamp: 4000,
  author: "did:key:zAnon",
  pointers: [
    { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "watered" } } },
    { role: "value", target: { kind: "primitive", value: true } },
  ],
});
const all = [signed1, signed2, unsigned, negation, mixed];

const ids = (deltas: readonly Delta[]) => deltas.map((d) => d.id).sort();

interface Harness {
  readonly name: string;
  open(): StoreBackend;
  // Durable drivers only: a fresh handle over the same underlying storage.
  reopen?(): StoreBackend;
}

const tmp = mkdtempSync(join(tmpdir(), "loam-store-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let dbCount = 0;
function sqliteHarness(): Harness {
  const path = join(tmp, `store-${dbCount++}.sqlite`);
  return {
    name: "sqlite",
    open: () => new SqliteBackend(path),
    reopen: () => new SqliteBackend(path),
  };
}

const harnesses: (() => Harness)[] = [
  () => ({ name: "memory", open: () => new MemoryBackend() }),
  sqliteHarness,
];

for (const makeHarness of harnesses) {
  const sample = makeHarness();
  describe(`StoreBackend contract: ${sample.name}`, () => {
    it("append stores the new, skips the known, and says exactly how many", async () => {
      const h = makeHarness();
      const store = h.open();
      expect(await store.append([signed1, signed2])).toBe(2);
      expect(await store.append([signed1])).toBe(0); // idempotent by id
      expect(await store.append([unsigned, unsigned])).toBe(1); // deduped within one batch too
      await store.close();
    });

    it("deltasSince(∅) is everything; deltasSince(known) is the exact complement", async () => {
      const h = makeHarness();
      const store = h.open();
      await store.append(all);
      expect(ids(await store.deltasSince(new Set()))).toEqual(ids(all));
      const complement = await store.deltasSince(new Set([signed1.id, unsigned.id]));
      expect(ids(complement)).toEqual(ids([signed2, negation, mixed]));
      expect(ids(await store.deltasSince(new Set(ids(all))))).toEqual([]);
      await store.close();
    });

    it("what comes back is what went in — claims, signatures, refs, verification", async () => {
      const h = makeHarness();
      const store = h.open();
      await store.append(all);
      const back = new Map((await store.deltasSince(new Set())).map((d) => [d.id, d]));
      for (const d of all) expect(back.get(d.id)).toEqual(d);
      expect(verifyDelta(back.get(signed1.id)!)).toBe("verified");
      expect(verifyDelta(back.get(unsigned.id)!)).toBe("unsigned");
      await store.close();
    });

    it("every driver returns the canonical form: -0 comes back as 0, id unchanged", async () => {
      const minusZero = makeDelta({
        timestamp: 5000,
        author: "did:key:zAnon",
        pointers: [{ role: "value", target: { kind: "primitive", value: -0 } }],
      });
      const h = makeHarness();
      const store = h.open();
      await store.append([minusZero]);
      const [back] = await store.deltasSince(new Set());
      expect(back!.id).toBe(minusZero.id); // canonical CBOR never saw a -0 to begin with
      const value = back!.claims.pointers[0]!.target;
      expect(value.kind === "primitive" && Object.is(value.value, 0)).toBe(true);
      await store.close();
    });

    it("a forged id is refused as a rejection; nothing is stored", async () => {
      const forged: Delta = { ...signed1, id: `1e20${"00".repeat(32)}` };
      const h = makeHarness();
      const store = h.open();
      await expect(store.append([forged])).rejects.toThrow(/does not match its claims/);
      expect(await store.deltasSince(new Set())).toEqual([]);
      await store.close();
    });

    it("after close, every method rejects", async () => {
      const h = makeHarness();
      const store = h.open();
      await store.append([signed1]);
      await store.close();
      await expect(store.append([signed2])).rejects.toThrow(/closed/);
      await expect(store.deltasSince(new Set())).rejects.toThrow(/closed/);
    });

    if (sample.reopen !== undefined) {
      it("state survives close and reopen", async () => {
        const h = makeHarness();
        const store = h.open();
        await store.append(all);
        await store.close();
        const again = h.reopen!();
        expect(ids(await again.deltasSince(new Set()))).toEqual(ids(all));
        // and the reopened handle still dedups against what the first one wrote
        expect(await again.append([signed1])).toBe(0);
        await again.close();
      });

      it("a tampered row is corruption: reads refuse, they do not launder", async () => {
        const h = makeHarness();
        const store = h.open() as SqliteBackend;
        await store.append([signed1]);
        await store.close();
        // Swap in ANOTHER delta's (well-formed) claims behind the store's back — the row is
        // valid in shape but no longer recomputes to its own id.
        const raw = new Database(store.filePath);
        raw
          .prepare("UPDATE deltas SET claims = ? WHERE id = ?")
          .run(JSON.stringify(claimsToJson(signed2.claims)), signed1.id);
        raw.close();
        const again = h.reopen!();
        await expect(again.deltasSince(new Set())).rejects.toThrow(/corruption/);
        await again.close();
      });

      it("two handles on one store converge to the union", async () => {
        const h = makeHarness();
        const a = h.open();
        const b = h.reopen!();
        await a.append([signed1]);
        await b.append([signed2]);
        expect(ids(await a.deltasSince(new Set()))).toEqual(ids([signed1, signed2]));
        expect(ids(await b.deltasSince(new Set()))).toEqual(ids([signed1, signed2]));
        // appending what the OTHER handle already stored is still a no-op
        expect(await a.append([signed2])).toBe(0);
        await a.close();
        await b.close();
      });
    }
  });
}
