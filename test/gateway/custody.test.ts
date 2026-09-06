import { describe, expect, it, vi } from "vitest";
import { probePhysicalRetention } from "../../src/gateway/custody.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

describe("physical custody without administrative authority", () => {
  it("reports actual retained bytes without requiring a gateway or tombstone receipt", async () => {
    const backend = new MemoryBackend();
    const fact = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    await backend.append([fact]);
    const append = vi.spyOn(backend, "append"),
      purge = vi.spyOn(backend, "purge"),
      close = vi.spyOn(backend, "close");
    expect(await probePhysicalRetention(backend, [fact.id, "absent"])).toEqual({
      held: new Set([fact.id]),
      unasked: new Set(),
    });
    expect(await probePhysicalRetention(backend, ["absent"])).toEqual({
      held: new Set(),
      unasked: new Set(),
    });
    expect(append).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(await backend.deltasSince(new Set())).toEqual([fact]);
  });
  it("prefers one batch probe and preserves its receiver", async () => {
    const target = {
      retained: new Set(["a"]),
      holds: vi.fn((_id: string) => Promise.reject(new Error("fallback forbidden"))),
      heldAmong: vi.fn(function (this: { retained: Set<string> }, ids: Iterable<string>) {
        return Promise.resolve(new Set([...ids].filter((id) => this.retained.has(id))));
      }),
    };
    expect(await probePhysicalRetention(target, ["a", "b"])).toEqual({
      held: new Set(["a"]),
      unasked: new Set(),
    });
    expect(target.heldAmong).toHaveBeenCalledTimes(1);
    expect(target.holds).not.toHaveBeenCalled();
  });
  it("does not probe an empty request", async () => {
    const target = {
      holds: vi.fn(() => Promise.reject(new Error("unexpected"))),
      heldAmong: vi.fn(() => Promise.reject(new Error("unexpected"))),
    };
    expect(await probePhysicalRetention(target, [])).toEqual({
      held: new Set(),
      unasked: new Set(),
    });
    expect(target.holds).not.toHaveBeenCalled();
    expect(target.heldAmong).not.toHaveBeenCalled();
  });
  it("preserves held evidence when a later fallback probe fails and marks the batch unproven", async () => {
    const target = {
      retained: "a",
      holds(id: string) {
        return id === "b"
          ? Promise.reject(new Error("unavailable"))
          : Promise.resolve(id === this.retained);
      },
    };
    expect(await probePhysicalRetention(target, ["a", "b", "c"])).toEqual({
      held: new Set(["a"]),
      unasked: new Set(["a", "b", "c"]),
    });
  });
  it("marks batch failures unproven without falling back to a possibly narrower tier", async () => {
    const target = {
      holds: vi.fn(() => Promise.resolve(false)),
      heldAmong: vi.fn(() => Promise.reject(new Error("unavailable"))),
    };
    expect(await probePhysicalRetention(target, ["a", "b"])).toEqual({
      held: new Set(),
      unasked: new Set(["a", "b"]),
    });
    expect(target.holds).not.toHaveBeenCalled();
  });
  it("cannot introduce unrelated ids returned by an overreporting backend", async () => {
    const target = {
      holds: () => Promise.resolve(false),
      heldAmong: () => Promise.resolve(new Set(["a", "bystander"])),
    };
    expect(await probePhysicalRetention(target, ["a", "b"])).toEqual({
      held: new Set(["a"]),
      unasked: new Set(),
    });
  });
});
