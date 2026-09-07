// T285: a physical retention probe that needs no Gateway and carries no erasure authority.
//
// RAILS-RED on origin/main, this file copied in: the suite does not LOAD there. It imports
// src/gateway/custody.js, which this slice adds, so vitest reports one failed suite and no cases.
//
// REVERT PROBES, each guard deleted in turn on this tree (6 cases):
//   batch answers outside the request are counted as held     → 1 red
//   a failed batch probe falls back to the narrower tier       → 2 red
//   a failed probe throws instead of reporting unasked         → 2 red
//   the batch probe is never used                              → 3 red
//   the empty-request guard is removed                         → 1 red
//   the holds fallback records nothing                         → 2 red
//
// WHAT THIS RAIL DOES NOT ASSERT: the fold of held and unasked back into erasureStandings. That
// fold is driven by test/gateway/store-health.test.ts and the erase rails; deleting the held
// re-note reddens seven of their cases, deleting the unasked re-note reddens two.
// The RetentionProbe type narrows what a caller may CALL, not what the object CAN do: the object
// handed in by erase.ts is the full backend. Do not read the type as a security boundary.
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
      holds: vi.fn(() => Promise.reject(new Error("fallback forbidden"))),
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
