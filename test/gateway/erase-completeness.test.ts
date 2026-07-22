// §24.8/§11 — the erasure verdict is decided by BYTE-PRESENCE, and the replica fan-out is held to
// the SAME rule as the primary (ticket T62). `eraseImpl` refuses to report completion while the
// content is still at rest; `eraseReplicaImpl` discarded its purge count and checked only that the
// tombstone landed — so a pool that held the byte and removed nothing yielded a top-level erase
// reporting success for content still at rest inside the operator's own walls, the exact §24.8
// evasion channel. Both paths now assert the id is absent from the backend's own listing after the
// sweep, which is correct for a pool that never held it (absent → complete) and fails loudly for a
// read-only mount (present → incomplete).

import { describe, expect, it } from "vitest";
import { authorForSeed, type Delta, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = { props: new Map<string, Policy>([["message", pick]]), default: pick };

const bootPrimary = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["message"] }],
    }),
  );

// A pool backend that silently REFUSES to purge — the read-only-mount / stale-index shape. It keeps
// the row and returns 0, exactly the ambiguous count the byte-presence rule exists to see through.
class RetainingBackend extends MemoryBackend {
  retain = false;
  override async purge(ids: Iterable<string>): Promise<number> {
    if (this.retain) return 0; // the bytes stay; the count lies by omission
    return super.purge(ids);
  }
}

const heldAtRest = async (backend: MemoryBackend, id: string): Promise<boolean> =>
  (await backend.deltasSince(new Set())).some((d) => d.id === id);

describe("§24.8/§11 — erasure completeness is byte-presence, in the pool too", () => {
  it("REFUSE: a pool that holds the byte and removes nothing makes the top-level erase refuse", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "forget-me", 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new RetainingBackend();
    const q = await primary.openQuarantine({ backend: poolBackend });
    poolBackend.retain = true; // the pool's disk goes read-only after seeding

    // The pool holds the byte and will not remove it — §11 has NOT reached through the glass, so the
    // operator must be told, not handed a false completion.
    await expect(primary.erase(secret.id, { reason: "the subject asked" })).rejects.toThrow();
    // Delta/store level: the retention was REAL — the byte is still in the pool backend.
    expect(await heldAtRest(poolBackend, secret.id)).toBe(true);
    await q.drop();
    await primary.close();
  });

  it("COMPLETE: a pool that never held the id does not make erase refuse", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "forget-me-too", 2000, OP_SEED);
    await primary.append([secret]);
    // A pool that admits nothing never seeds the byte, so its purge legitimately removes nothing
    // (count 0), and byte-presence must read that as complete — not a false failure.
    const poolBackend = new RetainingBackend();
    poolBackend.retain = true; // even refusing to purge, an absent id is absent
    const q = await primary.openQuarantine({ backend: poolBackend, admit: () => false });
    expect(await heldAtRest(poolBackend, secret.id)).toBe(false); // never held it

    await expect(primary.erase(secret.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: secret.id,
    });
    await q.drop();
    await primary.close();
  });
});
