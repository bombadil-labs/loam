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
//
// Coverage seams named deliberately (each half is railed, the composition is trivial): heal's PREFER
// -the-batch-probe logic is bound with a hand-rolled double, and `ArchiveBackend.heldAmong`'s reach
// is bound against a real on-disk archive — but no single test mounts a real ArchiveBackend inside a
// MirrorBackend and heals it on the boot path. And `heldAmong` does not propagate through a nested
// `Mirror(Mirror(_, archive), _)`, so that non-standard topology would revive per-id `holds` on the
// archive (pre-existing; T70 did not introduce it). Both are coverage gaps, not hollow rails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { StoreBackend } from "../../src/store/backend.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const dead = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const other = observed(FERN, "height", 34, 2000, GARDENER_SEED);

const tmp = mkdtempSync(join(tmpdir(), "loam-heal-verdict-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

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

// The verdict's fast path: on the archive, per-id `holds` is a full sweep on absence, so heal asks a
// single-pass `heldAmong` instead (avoiding the O(dead × files) boot cliff). These rail the primitive
// at the DRIVER level — against a real on-disk straggler, not a combinator-level simulated lie — and
// prove heal actually prefers it and honours its refusal.
describe("T70: ArchiveBackend.heldAmong — one pass over the bytes, holds's reach", () => {
  it("finds a canonical byte AND a misfiled straggler; an absent id is not reported held", async () => {
    const root = join(tmp, "archive-heldamong");
    const archive = new ArchiveBackend(root);
    await archive.append([dead]); // canonical <fan>/<dead.id>.json
    // A crash-left straggler for `other`, MISFILED into a foreign fan — the bytes §11 must still see
    // (a plain file any backup sweeps up), and the reach `deltasSince` skips by design.
    const alienFan = join(root, "zz");
    mkdirSync(alienFan, { recursive: true });
    writeFileSync(join(alienFan, `${other.id}.json.99999.tmp`), "{}");

    const held = await archive.heldAmong([dead.id, other.id, "de".repeat(32)]);
    expect(held.has(dead.id)).toBe(true); // canonical
    expect(held.has(other.id)).toBe(true); // misfiled straggler
    expect(held.size).toBe(2); // the absent id is not held
    expect(await archive.heldAmong([])).toEqual(new Set()); // asks nothing, walks nothing
    await archive.close();
  });
});

describe("T70: heal prefers the batch probe and honours its refusal", () => {
  const probeDouble = (
    heldAmong: () => Promise<Set<string>>,
    holdsCalled: { value: boolean },
  ): StoreBackend => {
    const inner = new MemoryBackend();
    return {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: (batch) => inner.purge(batch),
      holds: (id) => {
        holdsCalled.value = true; // heal must NOT fall back here when heldAmong exists
        return inner.holds(id);
      },
      heldAmong,
      close: () => inner.close(),
    };
  };

  it("uses heldAmong, not per-id holds, on a tier that offers it", async () => {
    const holdsCalled = { value: false };
    const mirror = probeDouble(() => Promise.resolve(new Set([dead.id])), holdsCalled);
    const store = new MirrorBackend(new MemoryBackend(), mirror);

    const report = await store.heal(new Set([dead.id]));

    expect(report.purgeFailures.some((m) => m.includes(dead.id))).toBe(true); // survivor from the batch
    expect(holdsCalled.value).toBe(false); // per-id holds never consulted on that tier
    await store.close();
  });

  it("a batch probe that REJECTS marks the whole set unproven, never clean (H9)", async () => {
    const holdsCalled = { value: false };
    const mirror = probeDouble(
      () => Promise.reject(new Error("archive fan unreadable")),
      holdsCalled,
    );
    const store = new MirrorBackend(new MemoryBackend(), mirror);

    const report = await store.heal(new Set([dead.id]));

    expect(report.purgeFailures.some((m) => m.includes(dead.id) && m.includes("unreadable"))).toBe(
      true,
    );
    await store.close();
  });
});
