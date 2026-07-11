// Step 2's contract: persistence is a seam, and every driver is an interchangeable witness to
// it. A backend holds a grow-only set of deltas, deduped by id — append is idempotent,
// deltasSince(known) is the exact complement, and what comes back is byte-for-byte what went
// in, signatures and all. Durable drivers additionally survive close/reopen and let a second
// handle see the union.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { ArchiveBackend } from "../../src/store/archive.js";
import { LocalStorageBackend } from "../../src/store/local-storage.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { MemStorage } from "./mem-storage.js";
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
  // Durable drivers only: reach BEHIND the seam and damage a stored row, so the contract can
  // assert that reads refuse corruption rather than laundering it. Each driver knows its own
  // storage; the contract only knows the promise.
  corruptSig?(id: string): void;
  corruptClaims?(id: string, claims: unknown): void;
}

const tmp = mkdtempSync(join(tmpdir(), "loam-store-"));
// maxRetries rides out a Windows EBUSY if the OS hasn't released a just-closed sqlite handle.
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

let dbCount = 0;
function sqliteHarness(): Harness {
  const path = join(tmp, `store-${dbCount++}.sqlite`);
  const raw = (sql: string, ...params: unknown[]) => {
    const db = new Database(path);
    db.prepare(sql).run(...params);
    db.close();
  };
  return {
    name: "sqlite",
    open: () => new SqliteBackend(path),
    reopen: () => new SqliteBackend(path),
    // a well-shaped signature that verifies nothing / another delta's well-formed claims
    corruptSig: (id) => raw("UPDATE deltas SET sig = ? WHERE id = ?", "ab".repeat(64), id),
    corruptClaims: (id, claims) =>
      raw("UPDATE deltas SET claims = ? WHERE id = ?", JSON.stringify(claims), id),
  };
}

let dirCount = 0;
function archiveHarness(): Harness {
  const root = join(tmp, `archive-${dirCount++}`);
  const fileFor = (id: string) => join(root, id.slice(0, 2), `${id}.json`);
  const rewrite = (id: string, patch: (row: { claims: unknown; sig?: string }) => void) => {
    const row = JSON.parse(readFileSync(fileFor(id), "utf8")) as { claims: unknown; sig?: string };
    patch(row);
    writeFileSync(fileFor(id), JSON.stringify(row));
  };
  return {
    name: "archive",
    open: () => new ArchiveBackend(root),
    reopen: () => new ArchiveBackend(root),
    corruptSig: (id) => rewrite(id, (row) => (row.sig = "ab".repeat(64))),
    corruptClaims: (id, claims) => rewrite(id, (row) => (row.claims = claims)),
  };
}

// The combinator faces the same contract as the drivers it composes: once over ephemeral
// sides, once over durable sides (where reads answer from the primary — so corrupting the
// primary must refuse through the mirror too).
function mirrorMemoryHarness(): Harness {
  return {
    name: "mirror(memory, memory)",
    open: () => new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
  };
}

function mirrorDurableHarness(): Harness {
  const sqlite = sqliteHarness();
  const archive = archiveHarness();
  const open = () => new MirrorBackend(sqlite.open(), archive.open());
  return {
    name: "mirror(sqlite, archive)",
    open,
    reopen: () => new MirrorBackend(sqlite.reopen!(), archive.reopen!()),
    corruptSig: sqlite.corruptSig!.bind(sqlite),
    corruptClaims: sqlite.corruptClaims!.bind(sqlite),
  };
}

// The browser driver: durable exactly as far as its Storage is. The shim IS the origin — a
// reopen is a second handle on the same storage, and corruption is an edited row, exactly as a
// devtools edit would be.
function localStorageHarness(): Harness {
  const origin = new MemStorage();
  const keyFor = (id: string) => `loam:contract:${id}`;
  const rewrite = (id: string, patch: (row: { claims: unknown; sig?: string }) => void) => {
    const row = JSON.parse(origin.getItem(keyFor(id))!) as {
      id: string;
      claims: unknown;
      sig?: string;
    };
    patch(row);
    origin.setItem(keyFor(id), JSON.stringify(row));
  };
  return {
    name: "localStorage",
    open: () => new LocalStorageBackend("contract", origin),
    reopen: () => new LocalStorageBackend("contract", origin),
    corruptSig: (id) => rewrite(id, (row) => (row.sig = "ab".repeat(64))),
    corruptClaims: (id, claims) => rewrite(id, (row) => (row.claims = claims)),
  };
}

const harnesses: (() => Harness)[] = [
  () => ({ name: "memory", open: () => new MemoryBackend() }),
  sqliteHarness,
  archiveHarness,
  mirrorMemoryHarness,
  mirrorDurableHarness,
  localStorageHarness,
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

    it("a forgery wearing a KNOWN id is still a forgery: refused, not silently skipped", async () => {
      const h = makeHarness();
      const store = h.open();
      await store.append([signed1]);
      const wolf: Delta = { id: signed1.id, claims: signed2.claims }; // familiar face, wrong soul
      await expect(store.append([wolf])).rejects.toThrow(/does not match its claims/);
      // and within one batch, riding behind its own honest original:
      await expect(
        store.append([signed2, { id: signed2.id, claims: signed1.claims }]),
      ).rejects.toThrow(/does not match its claims/);
      await store.close();
    });

    it("one refused delta refuses its whole batch, atomically, on every driver", async () => {
      const h = makeHarness();
      const store = h.open();
      const forged: Delta = { ...signed2, id: `1e20${"00".repeat(32)}` };
      await expect(store.append([signed1, forged])).rejects.toThrow(/does not match its claims/);
      expect(await store.deltasSince(new Set())).toEqual([]); // signed1 did not slip in first
      await store.close();
    });

    it("a lone surrogate is refused: its bytes and its identity disagree", async () => {
      const torn = makeDelta({
        timestamp: 6000,
        author: "did:key:zAnon",
        pointers: [{ role: "value", target: { kind: "primitive", value: "\ud800" } }],
      });
      const h = makeHarness();
      const store = h.open();
      await expect(store.append([torn])).rejects.toThrow(/lone surrogate/);
      expect(await store.deltasSince(new Set())).toEqual([]);
      await store.close();
    });

    it("purge removes exactly the named ids and says how many; unknown ids are no-ops", async () => {
      const h = makeHarness();
      const store = h.open();
      await store.append(all);
      expect(await store.purge([signed1.id, unsigned.id, "1e20" + "77".repeat(32)])).toBe(2);
      expect(ids(await store.deltasSince(new Set()))).toEqual(ids([signed2, negation, mixed]));
      expect(await store.purge([signed1.id])).toBe(0); // already gone — idempotent
      await store.close();
    });

    it("purge is mechanical, not law: the purged delta may be appended again", async () => {
      // Refusal-of-return is the GATEWAY's job (tombstones at admission); a backend keeps
      // "a set of deltas" and no memory of grudges.
      const h = makeHarness();
      const store = h.open();
      await store.append([signed1]);
      await store.purge([signed1.id]);
      expect(await store.append([signed1])).toBe(1); // stored anew, counted anew
      expect(ids(await store.deltasSince(new Set()))).toEqual(ids([signed1]));
      await store.close();
    });

    it("after close, every method rejects", async () => {
      const h = makeHarness();
      const store = h.open();
      await store.append([signed1]);
      await store.close();
      await expect(store.append([signed2])).rejects.toThrow(/closed/);
      await expect(store.deltasSince(new Set())).rejects.toThrow(/closed/);
      await expect(store.purge([signed1.id])).rejects.toThrow(/closed/);
    });

    if (sample.reopen !== undefined) {
      it("a purge is durable: the forgotten stay forgotten across reopen", async () => {
        const h = makeHarness();
        const store = h.open();
        await store.append(all);
        await store.purge([signed1.id]);
        await store.close();
        const again = h.reopen!();
        expect(ids(await again.deltasSince(new Set()))).toEqual(
          ids([signed2, unsigned, negation, mixed]),
        );
        await again.close();
      });

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

      if (sample.corruptSig !== undefined) {
        it("a tampered signature is corruption too: reads refuse it", async () => {
          const h = makeHarness();
          const store = h.open();
          await store.append([signed1]);
          await store.close();
          h.corruptSig!(signed1.id); // a well-shaped signature that verifies nothing
          const again = h.reopen!();
          await expect(again.deltasSince(new Set())).rejects.toThrow(/does not verify/);
          await again.close();
        });

        it("a tampered row is corruption: reads refuse, they do not launder", async () => {
          const h = makeHarness();
          const store = h.open();
          await store.append([signed1]);
          await store.close();
          // Swap in ANOTHER delta's (well-formed) claims behind the store's back — the row is
          // valid in shape but no longer recomputes to its own id.
          h.corruptClaims!(signed1.id, claimsToJson(signed2.claims));
          const again = h.reopen!();
          await expect(again.deltasSince(new Set())).rejects.toThrow(/corruption/);
          await again.close();
        });
      }

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
