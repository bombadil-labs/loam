// The erase completeness guard reads a SEPARATE declaration's negation at the present read time.
// This file checks that a present read loses no case. A separate declaration whose negation has
// not begun, or has expired, is live, so the live container table names the container and the
// guard fires through the live path. Inside the negation's window, a later shared declaration
// keeps the entity alive and the guard fires through the struck-lineage path.
//
// Each case asserts both levels: the report (`faultEntities`, and which path named the entity by
// the posture the table resolves) and the door (`erase` refuses before any work, and the target
// stays held). Each case also carries a bystander: a shared container that never had its own
// store, which must never be named.
//
// The negation-window cases are CONTROLS: they pass on the code that reads the negation at the
// present time, and they pin that reading. The expiry cases are GATES: an expiry is not a forget,
// so a separate declaration whose own validity has ended keeps naming its store until a detach
// record covers it. Negating every declaration (the explicit forget) still clears the guard.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import {
  containerClaims,
  detachClaims,
  unreachableStoreReport,
} from "../../src/gateway/container.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "6d".repeat(32);
const OP = authorForSeed(OP_SEED);
const T1 = 3_000_000; // the negation begins
const T2 = 3_010_000; // the negation ends
const WALL = "container:wall";
const BYSTANDER = "container:bystander";

afterEach(() => {
  vi.useRealTimers();
});

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

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

const declare = (
  container: string,
  posture: "separate" | "shared",
  ts: number,
  validUntil?: number,
) =>
  signClaims(
    {
      ...containerClaims(
        posture === "separate"
          ? { container, trust: "curated", posture }
          : { container, trust: "curated", posture, membership: HEIGHTS },
        OP,
        ts,
      ),
      ...(validUntil === undefined ? {} : { validUntil }),
    },
    OP_SEED,
  );

const strike = (id: string, ts: number, window: { validFrom: number; validUntil?: number }) =>
  signClaims({ ...makeNegationClaims(OP, ts, id), ...window }, OP_SEED);

// What the guard says now, and which path named the wall: "live" when the table resolves the wall
// as separate, "lineage" when it resolves shared and only the struck declaration names a store.
// "ended" when the table no longer names the wall at all.
function guard(gw: Gateway): { faults: string[]; path?: "live" | "lineage" | "ended" } {
  const faults = unreachableStoreReport(gw).faultEntities;
  const posture = gw.containers().containers.get(WALL)?.posture;
  if (!faults.includes(WALL)) return { faults };
  return {
    faults,
    path: posture === undefined ? "ended" : posture === "separate" ? "live" : "lineage",
  };
}

async function expectEraseRefused(gw: Gateway, id: string): Promise<void> {
  await expect(gw.erase(id)).rejects.toThrow(/refused before any work began[\s\S]*container:wall/);
  expect(gw.reactor.get(id)).toBeDefined();
}

describe("the store guard's present-time read of a separate declaration's negation", () => {
  it("negated over [T1, T2): the lineage path inside the window, the live path after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T1 - 100);
    const gw = await boot();
    const fact = observed(FERN, "height", 30, T1 - 200, OP_SEED);
    const separate = declare(WALL, "separate", T1 - 90);
    await gw.append([
      fact,
      separate,
      declare(BYSTANDER, "shared", T1 - 85),
      strike(separate.id, T1 - 80, { validFrom: T1, validUntil: T2 }),
    ]);

    vi.setSystemTime(T1 - 1); // before the window: the separate declaration is live
    expect(guard(gw)).toEqual({ faults: [WALL], path: "live" });

    // Inside the window the name does not stand, so the door admits a shared declaration of it.
    vi.setSystemTime(T1 + 10);
    expect(gw.containers().containers.has(WALL)).toBe(false);
    await gw.append([declare(WALL, "shared", T1 + 10)]);
    expect(gw.containers().containers.get(WALL)?.posture).toBe("shared");
    expect(guard(gw)).toEqual({ faults: [WALL], path: "lineage" });
    await expectEraseRefused(gw, fact.id);

    vi.setSystemTime(T2); // the negation has expired: the earliest declaration is separate again
    expect(gw.containers().containers.get(WALL)?.posture).toBe("separate");
    expect(guard(gw)).toEqual({ faults: [WALL], path: "live" });
    await expectEraseRefused(gw, fact.id);

    vi.setSystemTime(T2 + 5_000);
    expect(guard(gw)).toEqual({ faults: [WALL], path: "live" });
    await gw.close();
  });

  it("a negation that starts in the future: the live path before it starts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T1 - 100);
    const gw = await boot();
    const fact = observed(FERN, "height", 31, T1 - 200, OP_SEED);
    const separate = declare(WALL, "separate", T1 - 90);
    await gw.append([
      fact,
      separate,
      declare(BYSTANDER, "shared", T1 - 85),
      strike(separate.id, T1 - 80, { validFrom: T1 }),
    ]);

    vi.setSystemTime(T1 - 1);
    expect(gw.containers().containers.get(WALL)?.posture).toBe("separate");
    expect(guard(gw)).toEqual({ faults: [WALL], path: "live" });
    await expectEraseRefused(gw, fact.id);
    await gw.close();
  });

  it("control: a shared container that never had its own store never trips the guard", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T1 - 100);
    const gw = await boot();
    const fact = observed(FERN, "height", 32, T1 - 200, OP_SEED);
    const bystander = declare(BYSTANDER, "shared", T1 - 85);
    await gw.append([
      fact,
      bystander,
      strike(bystander.id, T1 - 80, { validFrom: T1, validUntil: T2 }),
    ]);
    for (const at of [T1 - 1, T1 + 10, T2, T2 + 5_000]) {
      vi.setSystemTime(at);
      expect(guard(gw)).toEqual({ faults: [] });
    }
    // The door agrees: with no separate store named, erase does its work.
    const report = await gw.erase(fact.id);
    expect(report.erased).toMatch(/^[0-9a-f]+$/);
    expect(gw.reactor.get(fact.id)).toBeUndefined();
    await gw.close();
  });

  it("gate: an EXPIRED separate declaration with a shared successor still names its store", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T1 - 100);
    const gw = await boot();
    const fact = observed(FERN, "height", 33, T1 - 200, OP_SEED);
    await gw.append([
      fact,
      declare(WALL, "separate", T1 - 90, T1),
      declare(BYSTANDER, "shared", T1 - 85),
    ]);
    vi.setSystemTime(T1 - 50);
    expect(guard(gw)).toEqual({ faults: [WALL], path: "live" });

    vi.setSystemTime(T1 + 10); // expired, not negated: the name does not stand, so it re-declares
    await gw.append([declare(WALL, "shared", T1 + 10)]);
    expect(gw.containers().containers.get(WALL)?.posture).toBe("shared");
    expect(guard(gw)).toEqual({ faults: [WALL], path: "lineage" });
    await expectEraseRefused(gw, fact.id);
    await gw.close();
  });

  it("gate: an EXPIRED separate declaration with no successor still names its store", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T1 - 100);
    const gw = await boot();
    const fact = observed(FERN, "height", 34, T1 - 200, OP_SEED);
    await gw.append([
      fact,
      declare(WALL, "separate", T1 - 90, T1),
      declare(BYSTANDER, "shared", T1 - 85),
    ]);

    vi.setSystemTime(T1 + 10);
    expect(gw.containers().containers.has(WALL)).toBe(false);
    expect(guard(gw)).toEqual({ faults: [WALL], path: "ended" });
    await expect(gw.erase(fact.id)).rejects.toThrow(/an expiry is not a forget/);
    expect(gw.reactor.get(fact.id)).toBeDefined();
    await gw.close();
  });

  it("control: a detach record covering the expired store lets erase complete, listing it kept", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T1 - 100);
    const gw = await boot();
    const fact = observed(FERN, "height", 35, T1 - 200, OP_SEED);
    const bystanderFact = observed(FERN, "height", 36, T1 - 190, OP_SEED);
    await gw.append([
      fact,
      bystanderFact,
      declare(WALL, "separate", T1 - 90, T1),
      declare(BYSTANDER, "shared", T1 - 85),
    ]);

    vi.setSystemTime(T1 + 10);
    await gw.append([signClaims(detachClaims(WALL, "parked on the shelf", OP, T1 + 10), OP_SEED)]);
    expect(guard(gw)).toEqual({ faults: [] });
    const report = await gw.erase(fact.id);
    expect(report.kept).toEqual([WALL]);
    expect(gw.reactor.get(fact.id)).toBeUndefined();
    expect(gw.reactor.get(bystanderFact.id)).toBeDefined(); // the erase removed only its target
    await gw.close();
  });

  it("control: the explicit forget still clears the guard: every declaration negated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T1 - 100);
    const gw = await boot();
    const fact = observed(FERN, "height", 37, T1 - 200, OP_SEED);
    const separate = declare(WALL, "separate", T1 - 90, T1);
    await gw.append([fact, separate, declare(BYSTANDER, "shared", T1 - 85)]);
    vi.setSystemTime(T1 - 50);
    expect(guard(gw)).toEqual({ faults: [WALL], path: "live" });

    await gw.append([strike(separate.id, T1 - 80, { validFrom: T1 - 80 })]);
    expect(guard(gw)).toEqual({ faults: [] });
    vi.setSystemTime(T1 + 10); // and after the declaration's own window ends, still cleared
    expect(guard(gw)).toEqual({ faults: [] });
    const report = await gw.erase(fact.id);
    expect(report.kept).toEqual([]);
    expect(gw.reactor.get(fact.id)).toBeUndefined();
    await gw.close();
  });
});
