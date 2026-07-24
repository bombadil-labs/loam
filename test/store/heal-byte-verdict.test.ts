// T70 — heal answers with a BYTE verdict, not a count. `MirrorBackend.heal` sweeps every dead id
// off each tier, but a `purge` that returns a count and does not throw was taken as done. That is
// the §11 conflation T40 caught at the store's front door (the API said forgotten while the bytes
// sat legible): a purge can report success while a freelist page, a `.tmp` straggler, or a WAL image
// still holds the plaintext. `erase` was converted to a `holds`-based verdict; heal was not — the one
// completeness path T67 left reporting COUNTS. These rails drive the two shapes a heal sweep fails in
// and assert heal reports each through `purgeFailures` (the channel cli.ts already surfaces loudly),
// so a boot heal can never call an unfinished erasure clean.
//
// Object level, not count: every assertion turns on `holds(id)` — what the bytes say — and on what
// heal REPORTS, never on `purgedPrimary`/`purgedMirror`, which are evidence of work and not the
// verdict. A count-only rail is exactly what let this survive T67.

import { describe, expect, it } from "vitest";
import type { StoreBackend } from "../../src/store/backend.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const dead = observed(FERN, "height", 30, 1000, GARDENER_SEED);

// A tier that LIES: its `purge` reports it removed the ids, but removes nothing — so the bytes
// remain and `holds` stays true. The shape T40 found: success reported, plaintext retained.
const purgeLies = (inner: StoreBackend): StoreBackend => ({
  append: (d) => inner.append(d),
  deltasSince: (k) => inner.deltasSince(k),
  purge: (ids) => Promise.resolve([...ids].length), // "removed them all" — a lie; nothing is deleted
  holds: (id) => inner.holds(id),
  close: () => inner.close(),
});

// A tier whose `purge` REFUSES (throws) — the read-only mount or the WAL a concurrent reader will
// not release. heal must not abort, and must report the refusal rather than swallow it.
const purgeThrows = (inner: StoreBackend): StoreBackend => ({
  append: (d) => inner.append(d),
  deltasSince: (k) => inner.deltasSince(k),
  purge: () => Promise.reject(new Error("read-only mount: purge refused")),
  holds: (id) => inner.holds(id),
  close: () => inner.close(),
});

describe("T70: heal reports a byte verdict, never trusts a purge's count", () => {
  it("a mirror whose purge LIES (success, bytes remain) is reported — the count is not the verdict", async () => {
    const primaryInner = new MemoryBackend();
    const mirrorInner = new MemoryBackend();
    await primaryInner.append([dead]);
    await mirrorInner.append([dead]);
    const store = new MirrorBackend(primaryInner, purgeLies(mirrorInner));

    const report = await store.heal(new Set([dead.id]));

    // The mirror still holds the byte — the ground truth the count hid.
    expect(await mirrorInner.holds(dead.id)).toBe(true);
    // ...and heal SAYS SO: purgeFailures names the surviving id, though no purge threw.
    expect(report.purgeFailures.length).toBeGreaterThan(0);
    expect(report.purgeFailures.some((m) => m.includes(dead.id))).toBe(true);
  });

  it("a tier whose purge THROWS is reported AND its dead id is verified still held (never swallowed)", async () => {
    const primaryInner = new MemoryBackend();
    const mirrorInner = new MemoryBackend();
    await primaryInner.append([dead]);
    await mirrorInner.append([dead]);
    const store = new MirrorBackend(primaryInner, purgeThrows(mirrorInner));

    const report = await store.heal(new Set([dead.id]));

    // heal did not abort — a refused sweep is best-effort-and-loud, not an outage.
    expect(report.toMirror).toBeGreaterThanOrEqual(0);
    // The refusal reason is carried, and the surviving byte is named: both the throw and the
    // holds-verdict route to purgeFailures, so the operator learns the erasure did not finish.
    expect(report.purgeFailures.some((m) => m.includes("refused"))).toBe(true);
    expect(await mirrorInner.holds(dead.id)).toBe(true);
    expect(report.purgeFailures.some((m) => m.includes(dead.id))).toBe(true);
  });

  it("a HEALTHY sweep that truly removes the bytes reports nothing — the verdict is silent when clean", async () => {
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    await primary.append([dead]);
    await mirror.append([dead]);
    const store = new MirrorBackend(primary, mirror);

    const report = await store.heal(new Set([dead.id]));

    // Both tiers really forgot: holds is false, so the byte verdict adds nothing.
    expect(await primary.holds(dead.id)).toBe(false);
    expect(await mirror.holds(dead.id)).toBe(false);
    expect(report.purgeFailures).toEqual([]);
  });
});
