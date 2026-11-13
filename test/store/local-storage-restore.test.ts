import { describe, expect, it } from "vitest";
import { makeDelta, type Delta } from "@bombadil/rhizomatic";
import { LocalStorageBackend } from "../../src/store/local-storage.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { toWire } from "../../src/federation/wire.js";
import { canonicalDelta } from "../../src/store/canon.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { MemStorage } from "./mem-storage.js";

const good = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const bystander = observed(FERN, "tag", "shade", 1500, GARDENER_SEED);
const key = (id: string) => `loam:garden:${id}`;
const wire = (d: Delta) => JSON.stringify(toWire(canonicalDelta(d)));

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
    await store.deltasSince(new Set());
    expect((await store.quarantine()).map((r) => r.key)).toEqual([key(good.id)]);

    expect(await store.restoreQuarantined([good])).toEqual([good.id]);

    expect(origin.getItem(key(good.id))).toBe(wire(good));
    const out = await store.deltasSince(new Set());
    expect(out.map((d) => d.id).sort()).toEqual([good.id, bystander.id].sort());
    expect(await store.quarantine()).toEqual([]);
    expect(origin.getItem(key(bystander.id))).toBe(bystanderBefore);
    await store.close();
  });

  it("an UNPARSEABLE value is a squatter too — the check asks ADMITS, not merely PARSES", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([good, bystander]);
    const bystanderBefore = origin.getItem(key(bystander.id));
    origin.setItem(key(good.id), "{not json at all");
    await store.deltasSince(new Set());
    expect((await store.quarantine())[0]?.reason).toBe("unparseable");

    expect(await store.restoreQuarantined([good])).toEqual([good.id]);

    expect(origin.getItem(key(good.id))).toBe(wire(good));
    expect(origin.getItem(key(bystander.id))).toBe(bystanderBefore);
    await store.close();
  });

  it("heal over a localStorage PRIMARY restores through the `prefix + id` pen key", async () => {
    const origin = new MemStorage();
    const primary = new LocalStorageBackend("garden", origin);
    const vault = new MemoryBackend();
    await primary.append([good, bystander]);
    await vault.append([good, bystander]);
    corruptAt(origin, good);

    origin.setItem("loam:garden:ui:pins", '["a"]');

    const store = new MirrorBackend(primary, vault);
    await store.heal();

    expect(store.lastRestore).toEqual({ restored: [good.id], stranded: [], replantWithheld: [] });
    expect(origin.getItem("loam:garden:ui:pins")).toBe('["a"]');
    expect(origin.getItem(key(good.id))).toBe(wire(good));
    expect(origin.getItem(key(bystander.id))).toBe(wire(bystander));
    await store.close();
  });

  it("an ADMITTED row is never replaced — not even by an unsigned twin of itself", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([good, bystander]);
    const before = origin.getItem(key(good.id));
    const unsigned = makeDelta(good.claims);

    expect(await store.restoreQuarantined([unsigned])).toEqual([]);

    expect(origin.getItem(key(good.id))).toBe(before);
    expect(origin.getItem(key(bystander.id))).toBe(wire(bystander));
    await store.close();
  });

  it("a row MISFILED under another key is out of reach — the id addresses one key, and only that one", async () => {
    const origin = new MemStorage();
    const store = new LocalStorageBackend("garden", origin);
    await store.append([bystander]);
    const alien = key("1e20" + "f0".repeat(32));
    origin.setItem(alien, JSON.stringify({ ...JSON.parse(wire(good)), sig: "ab".repeat(64) }));

    expect(await store.restoreQuarantined([good])).toEqual([]);

    expect(origin.getItem(alien)).not.toBeNull();
    expect(origin.getItem(key(good.id))).toBeNull();
    expect(origin.getItem(key(bystander.id))).toBe(wire(bystander));
    await store.close();
  });
});
