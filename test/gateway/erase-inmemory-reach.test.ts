// §11 reach into the structures a LIVE READER holds (ticket T45). Erasure purges every tier and
// re-seats the gateway on the post-purge ground — but a subscription is a third place bytes live:
// the Channel between the store and a reader, and the closure that keeps evaluating for it. Two
// leaks, both proven RED against the pre-T45 code:
//
//   1. A membership `watch` channel was never registered in `gw.channels`, so neither `reseat()`
//      nor `close()` could reach it. A reader parked ACROSS the cut was handed the erased delta —
//      full content and signature, from a live Loam API — and then froze forever on the replaced
//      reactor: no further frame, no `done`, no way to notice.
//   2. `Channel.close()` left its undrained value in the queue, and `next()` reads the queue
//      BEFORE the closed flag — so a slow reader drained a pre-cut patch (a resolved view, erased
//      field value and all) after the purge had completed.
//
// ASSERTED AT BOTH LEVELS. Delta/structure: the channel is REGISTERED while open and GONE from
// `gw.channels` after the cut (torn down, not merely inert — a channel left in the set is a leak
// even when its closure is dead), and a left Channel serves nothing it was holding. Object/reader:
// what the two live doors actually hand a reader across the cut — the membership frame and the
// subscription payload — carries neither the erased id nor its plaintext, and the streams END
// rather than freeze. The at-rest verdict rides along so "in-memory only" means something: the
// bytes really are gone from the backend, and gone from the reader's channel too.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT, because the coverage does not exist and an
// honest-looking test would be worse than none:
//
//   - The ESM cache (`esm.ts`). Erasing a §22 resolver or §23 renderer delta does not evict its
//     loaded module. Loam cannot fix that by clearing its own Map: the source rides a `data:` URL
//     into Node's ESM registry, which retains it for the process lifetime with no eviction API, so
//     an eviction here would claim a completeness it cannot deliver (§11's own rule: a tier that
//     cannot be asked answers HELD). The boundary is stated where it bites, in `esm.ts`'s header.
//   - A `ModuleVersion` a caller holds in its own variable (`container-identity.ts`). The gateway
//     caches no `freeze()` result — nothing in `src/` retains one — so the retention is entirely
//     caller-side and there is no gateway-held structure a rail here could reach. Stated in
//     `container-identity.ts` beside the interface that hands the deltas out.

import { describe, expect, it, vi } from "vitest";
import { authorForSeed, type Delta } from "@bombadil/rhizomatic";
import { Channel } from "../../src/gateway/channel.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden, governedBootstrap } from "./fixtures.js";

// A generous hang-guard for genuine breakage; every passing path here resolves in microseconds.
vi.setConfig({ testTimeout: 15000 });

const KEEPER_SEED = "c3".repeat(32);
const FORGOTTEN = "a-reader-must-not-outlive-the-cut";

// Every tag-bearing delta, UNION the operator's own. The erased delta is a member of the left side
// and the TOMBSTONE joins the right, so landing the removal-order moves this membership — which is
// what wakes a parked reader mid-cut. A tag-only Term would leave the pulse unfired and the leak
// unobserved (the freeze would still show, the erased frame would not).
const WATCHED = {
  op: "union",
  left: { op: "select", pred: { hasPointer: { context: { exact: "tag" } } }, in: "input" },
  right: {
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: authorForSeed(KEEPER_SEED) } },
    in: "input",
  },
};

const SUBSCRIPTION = `subscription {
  plant(entity: "${FERN}") { _hex tag }
}`;

async function keeperStore(): Promise<{ gw: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gw = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gw.append(governedBootstrap(KEEPER_SEED)); // the keeper is the operator, so the keeper erases
  await gw.append(garden);
  gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return { gw, backend };
}

// A read that must not park. A torn-down stream answers `done` in a microtask; a FROZEN one answers
// never, and this turns that into a named failure instead of a suite timeout.
async function promptly<T>(p: Promise<T>): Promise<T | "still parked"> {
  return Promise.race([
    p,
    new Promise<"still parked">((resolve) => {
      setTimeout(() => resolve("still parked"), 1000).unref?.();
    }),
  ]);
}

const idsOf = (frame: unknown): string[] => ((frame ?? []) as Delta[]).map((d) => d.id);

describe("§11 — a live membership watch does not outlive the cut", () => {
  it("a reader parked across the cut is handed no erased bytes, and the stream ends", async () => {
    const { gw, backend } = await keeperStore();
    const secret = observed(FERN, "tag", FORGOTTEN, 3000, GARDENER_SEED);
    await gw.append([secret]);

    const stream = gw.watch(WATCHED);
    const first = await stream.next();
    expect(idsOf(first.value)).toContain(secret.id); // pre-cut, and lawfully so
    // Registered where teardown can reach it — the whole of bug 1. Asserted while the stream is
    // OPEN, because "empty after the cut" is also what a never-registered channel looks like.
    expect(gw.channels.size).toBe(1);

    const parked = stream.next(); // park ACROSS the cut: the erase is what wakes this read
    await gw.erase(secret.id, { reason: "a watcher is a tier too" });

    const woken = await promptly(parked);
    expect(woken).not.toBe("still parked");
    const served = woken === "still parked" ? undefined : woken.value;
    expect(idsOf(served)).not.toContain(secret.id);
    expect(JSON.stringify(served ?? [])).not.toContain(FORGOTTEN);

    // Ended, not frozen on the replaced reactor — the reader learns to resubscribe.
    const after = await promptly(stream.next());
    expect(after).not.toBe("still parked");
    expect(after === "still parked" ? undefined : after.done).toBe(true);
    // Torn down, not merely inert: nothing dead is left in the set.
    expect(gw.channels.size).toBe(0);

    // Object level, after the cut: the same door, freshly asked, and the bytes at rest.
    const reopened = gw.watch(WATCHED);
    const fresh = await reopened.next();
    expect(idsOf(fresh.value)).not.toContain(secret.id);
    expect(JSON.stringify(fresh.value ?? [])).not.toContain(FORGOTTEN);
    await reopened.return?.(undefined);
    expect(JSON.stringify(await backend.deltasSince(new Set()))).not.toContain(FORGOTTEN);
    await gw.close();
  });
});

describe("§11 — an undrained frame does not survive the cut", () => {
  it("a slow subscriber drains no pre-cut view once the erase has closed its stream", async () => {
    const { gw, backend } = await keeperStore();
    const events = await gw.subscribe(SUBSCRIPTION);
    await events.next(); // the initial snapshot, drained; the queue is empty behind it

    const secret = observed(FERN, "tag", FORGOTTEN, 3000, GARDENER_SEED);
    await gw.append([secret]); // a patch carrying the erased-to-be value, pushed and NOT drained
    await gw.erase(secret.id, { reason: "an undrained patch is a tier too" });

    const after = await promptly(events.next());
    expect(after).not.toBe("still parked");
    const payload: unknown = after === "still parked" ? undefined : after.value;
    expect(JSON.stringify(payload ?? {})).not.toContain(FORGOTTEN);
    expect(after === "still parked" ? undefined : after.done).toBe(true);

    // Object level: a subscription opened after the cut sees the post-purge view, and the bytes
    // are gone at rest — the leak was the reader's channel, and it is closed.
    const reopened = await gw.subscribe(SUBSCRIPTION);
    const snapshot = await reopened.next();
    expect(JSON.stringify(snapshot.value ?? {})).not.toContain(FORGOTTEN);
    await reopened.return?.(undefined);
    expect(JSON.stringify(await backend.deltasSince(new Set()))).not.toContain(FORGOTTEN);
    await gw.close();
  });

  it("a channel that has been left forgets what it was holding", async () => {
    const ch = new Channel<string>();
    ch.push(FORGOTTEN);
    await ch.return();
    const after = await ch.next();
    expect(after.done).toBe(true);
    expect(JSON.stringify(after)).not.toContain(FORGOTTEN);
  });
});
