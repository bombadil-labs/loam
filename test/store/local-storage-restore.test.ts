// T66 on the browser driver (SPEC §15/§25). The squatting shape is the same bug by a different
// route: `append` skips any id whose key already exists, so a healthy copy of a delta the origin set
// aside is dropped on the floor. `restoreQuarantined` replaces the value AT that key with bytes that
// admit — and refuses to touch a key whose current value already admits.
//
// The driver's REACH is what this file pins, because it is narrower than sqlite's and the narrowness
// is easy to assume away: a row is addressed by `loam:<store>:<id>`, so a corrupt row MISFILED under
// some other key is not reachable by id. That is the same limit `holds` already documents; it is
// asserted here rather than assumed, so the boundary is a fact and not a hope.
//
// Two-sided throughout: every case names a live bystander key and proves its value byte-identical
// after the call.

import { describe, expect, it } from "vitest";
import { makeDelta, type Delta } from "@bombadil/rhizomatic";
import { LocalStorageBackend } from "../../src/store/local-storage.js";
import { toWire } from "../../src/federation/wire.js";
import { canonicalDelta } from "../../src/store/canon.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { MemStorage } from "./mem-storage.js";

const good = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const bystander = observed(FERN, "tag", "shade", 1500, GARDENER_SEED);
const key = (id: string) => `loam:garden:${id}`;
const wire = (d: Delta) => JSON.stringify(toWire(canonicalDelta(d)));

// Damage the value at a delta's own key so it no longer verifies: the claims still parse (so the
// row's `negates` stays legible), the signature does not.
function corruptAt(origin: MemStorage, d: Delta): void {
  const row = JSON.parse(origin.getItem(key(d.id))!) as Record<string, unknown>;
  origin.setItem(key(d.id), JSON.stringify({ ...row, sig: "ab".repeat(64) }));
}

describe("T66 (§15): a corrupt localStorage row is replaceable by an admitting delta of that id", () => {
  it("replaces the squatted key's bytes and leaves a live bystander key byte-identical", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([good, bystander]);
    const bystanderBefore = origin.getItem(key(bystander.id));
    corruptAt(origin, good);
    // The premise: the row really is set aside, so the recovery has something to recover.
    await store.deltasSince(new Set());
    expect((await store.quarantine()).map((r) => r.key)).toEqual([key(good.id)]);

    expect(await store.restoreQuarantined([good])).toEqual([good.id]);

    // Delta/bytes: the key now holds the canonical wire row, identical to a fresh append's.
    expect(origin.getItem(key(good.id))).toBe(wire(good));
    // Object/reader: the driver's own read admits it again, and the pen is empty.
    const out = await store.deltasSince(new Set());
    expect(out.map((d) => d.id).sort()).toEqual([good.id, bystander.id].sort());
    expect(await store.quarantine()).toEqual([]);
    // TWO-SIDED: the bystander key never moved.
    expect(origin.getItem(key(bystander.id))).toBe(bystanderBefore);
    await store.close();
  });

  it("an ADMITTED row is never replaced — not even by an unsigned twin of itself", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([good, bystander]);
    const before = origin.getItem(key(good.id));
    const unsigned = makeDelta(good.claims); // admits as "unsigned"; same id, no signature

    expect(await store.restoreQuarantined([unsigned])).toEqual([]);

    expect(origin.getItem(key(good.id))).toBe(before); // the signature survives
    expect(origin.getItem(key(bystander.id))).toBe(wire(bystander));
    await store.close();
  });

  it("a row MISFILED under another key is out of reach — the id addresses one key, and only that one", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([bystander]);
    // `good`'s bytes, corrupted, filed under a DIFFERENT delta id's key. Nothing addresses it by
    // `good.id`, so the restore neither repairs nor damages it — the same reach `holds` and `purge`
    // have. THE RAIL that would close it: a driver-level sweep that reads every owned key's claims
    // and re-files by computed id (unbuilt; it would make relocation laundering possible).
    const alien = key("1e20" + "f0".repeat(32));
    origin.setItem(alien, JSON.stringify({ ...JSON.parse(wire(good)), sig: "ab".repeat(64) }));

    expect(await store.restoreQuarantined([good])).toEqual([]);

    expect(origin.getItem(alien)).not.toBeNull(); // untouched, not silently repaired
    expect(origin.getItem(key(good.id))).toBeNull(); // and nothing was planted at the canonical key
    expect(origin.getItem(key(bystander.id))).toBe(wire(bystander));
    await store.close();
  });
});
