// Step 2's contract: persistence is a seam, and every driver is an interchangeable witness to
// it. A backend holds a grow-only set of deltas, deduped by id — append is idempotent,
// deltasSince(known) is the exact complement, and what comes back is byte-for-byte what went
// in, signatures and all. Durable drivers additionally survive close/reopen and let a second
// handle see the union.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeDelta, verifyDelta, type Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";

const signed1 = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const signed2 = observed(FERN, "height", 34, 2000, SURVEYOR_SEED);
const unsigned = makeDelta({
  timestamp: 3000,
  author: "did:key:zAnon",
  pointers: [{ role: "note", target: { kind: "primitive", value: "unsigned but true" } }],
});
const all = [signed1, signed2, unsigned];

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
      expect(ids(complement)).toEqual([signed2.id]);
      expect(ids(await store.deltasSince(new Set(ids(all))))).toEqual([]);
      await store.close();
    });

    it("what comes back is what went in — claims, signatures, verification", async () => {
      const h = makeHarness();
      const store = h.open();
      await store.append(all);
      const back = new Map((await store.deltasSince(new Set())).map((d) => [d.id, d]));
      expect(back.get(signed1.id)).toEqual(signed1);
      expect(back.get(unsigned.id)).toEqual(unsigned);
      expect(verifyDelta(back.get(signed1.id)!)).toBe("verified");
      expect(verifyDelta(back.get(unsigned.id)!)).toBe("unsigned");
      await store.close();
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
