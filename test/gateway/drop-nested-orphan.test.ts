// T162 — drop() on an intermediate container reaches every pool nested beneath it, at the bytes.
// Containers nest (a pool may open a pool), and the discard fan-out must follow the same runtime
// tree the §24.5 envelope report walks: a nested pool's store that drop() cannot see is bytes at
// rest that no sweep visits and no report mentions — outside §11's reach, with the tree's own
// cleanup call as the leak (the T72 hazard, one level down).
//
// Every rail here is TWO-SIDED: the condemned store is proven empty at the bytes AND a named live
// bystander — a sibling container, and the primary itself — is proven to keep its bytes and still
// answer a read. A rail that only proves removal cannot see over-purging.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { StoreBackend } from "../../src/store/backend.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5d".repeat(32);
const NESTED_MARKER = "NESTED-POOL-CANARY-a41c88";
const SIBLING_MARKER = "SIBLING-BYSTANDER-CANARY-b52d99";
const PRIMARY_MARKER = "PRIMARY-BYSTANDER-CANARY-c63eaa";

const tmp = mkdtempSync(join(tmpdir(), "loam-drop-nested-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

describe("T162: drop() on an intermediate container discards the whole subtree, at the bytes", () => {
  it("a nested pool's durable store is EMPTY after the intermediate's drop — and the sibling and primary keep theirs", async () => {
    const gw = await boot();
    const primaryNote = observed(FERN, "note", PRIMARY_MARKER, 1000, OP_SEED);
    const siblingNote = observed(FERN, "note", SIBLING_MARKER, 1001, OP_SEED);
    await gw.append([primaryNote, siblingNote]);

    const siblingPath = join(tmp, "sibling.db");
    const sibling = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new SqliteBackend(siblingPath),
    });

    const mid = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new MemoryBackend(),
    });
    const nestedPath = join(tmp, "nested.db");
    const nested = await mid.gateway!.openQuarantine({ backend: new SqliteBackend(nestedPath) });
    // The secret lives ONLY in the nested pool's own store — nothing above ever held it.
    const secret = observed(FERN, "note", NESTED_MARKER, 1002, OP_SEED);
    await nested.gateway.append([secret]);
    expect(await nested.gateway.backend.holds(secret.id)).toBe(true);

    await mid.drop();

    // The condemned side, verified where it lives: a FRESH handle on the nested path holds
    // nothing — not the secret, not the seeded copies (wholesale) — and no plaintext remains.
    const reopened = new SqliteBackend(nestedPath);
    expect(await reopened.holds(secret.id)).toBe(false);
    expect(await reopened.deltasSince(new Set())).toEqual([]);
    await reopened.close();
    expect(readFileSync(nestedPath).includes(Buffer.from(NESTED_MARKER))).toBe(false);

    // The bystanders, BOTH levels: the sibling container still holds its bytes and a reader
    // through it still resolves the claim; the primary's own ground is untouched.
    expect(await sibling.gateway!.backend.holds(siblingNote.id)).toBe(true);
    expect(sibling.members().some((d) => d.id === siblingNote.id)).toBe(true);
    expect(await gw.backend.holds(primaryNote.id)).toBe(true);
    expect(gw.reactor.has(primaryNote.id)).toBe(true);

    await sibling.detach();
    // Detached, the sibling's file keeps its plaintext — drop() reached exactly its own subtree.
    expect(readFileSync(siblingPath).includes(Buffer.from(SIBLING_MARKER))).toBe(true);
    await gw.close();
  });

  it("the discard is TRANSITIVE — a grandchild pool two levels beneath the drop is emptied too", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, 2000, OP_SEED)]);
    const mid = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new MemoryBackend(),
    });
    const child = await mid.gateway!.openQuarantine({ backend: new MemoryBackend() });
    const grandPath = join(tmp, "grandchild.db");
    const grand = await child.gateway.openQuarantine({ backend: new SqliteBackend(grandPath) });
    const secret = observed(FERN, "note", NESTED_MARKER, 2001, OP_SEED);
    await grand.gateway.append([secret]);

    await mid.drop();

    const reopened = new SqliteBackend(grandPath);
    expect(await reopened.holds(secret.id)).toBe(false);
    expect(await reopened.deltasSince(new Set())).toEqual([]);
    await reopened.close();
    expect(readFileSync(grandPath).includes(Buffer.from(NESTED_MARKER))).toBe(false);
    await gw.close();
  });

  it("a nested store that cannot prove discard refuses the WHOLE drop, naming the nested pool, and the tree stays attached", async () => {
    const gw = await boot();
    const note = observed(FERN, "note", SIBLING_MARKER, 3000, OP_SEED);
    await gw.append([note]);
    const mid = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new MemoryBackend(),
    });
    const secret = observed(FERN, "note", NESTED_MARKER, 3001, OP_SEED);
    const inner = new MemoryBackend();
    // Purges everything EXCEPT the secret: the count looks honest, one byte remains (T40/T70).
    const keepOne: StoreBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: async (ids) => inner.purge([...ids].filter((id) => id !== secret.id)),
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
    };
    const nested = await mid.gateway!.openQuarantine({ backend: keepOne });
    await nested.gateway.append([secret]);

    await expect(mid.drop()).rejects.toThrow(/drop refused:.*nested pool/s);

    // Fail-safe, at every level: nothing left the erasure fan-out's reach.
    expect(gw.quarantinePools.has(mid.gateway!)).toBe(true);
    expect(mid.gateway!.quarantinePools.has(nested.gateway)).toBe(true);
    expect(await inner.holds(secret.id)).toBe(true); // the retained byte is still where §11 can see it
    expect(await gw.backend.holds(note.id)).toBe(true); // and the primary bystander kept its own
    await gw.close();
  });
});
