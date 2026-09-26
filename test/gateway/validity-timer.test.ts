// A claim becomes valid, or stops being valid, at a moment it names, with nothing written at that
// moment. The gateway arms a timer for the next such boundary after every ingest and at open. Each
// case moves a faked clock past the boundary with no later write, and reads a live subscription,
// which follows the maintained view. Every case names a bystander that must stay.

import { afterEach, describe, expect, it, vi } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { CTX_REGISTRATION } from "../../src/gateway/registration.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "6b".repeat(32);
const T0 = 1_000_000;

const genesis = () =>
  assembleGenesis({
    operatorSeed: OP_SEED,
    registrations: [
      { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
    ],
  });

const height = (value: number, validFrom: number, validUntil?: number): Delta => {
  const base = observed(FERN, "height", value, 0, OP_SEED).claims;
  return signClaims(
    { ...base, timestamp: T0, validFrom, ...(validUntil === undefined ? {} : { validUntil }) },
    OP_SEED,
  );
};

type Fern = { plant: { height: number | null; tag: string[] } };

afterEach(() => {
  vi.useRealTimers();
});

describe("a validity boundary moves the live view with no write", () => {
  it("a claim appended with a future end stops showing when its end passes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.boot(new MemoryBackend(), genesis());
    await gw.append([observed(FERN, "tag", "shade", T0, OP_SEED), height(30, T0, T0 + 1_000)]);
    const stream = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
    expect(((await stream.next()).value as Fern).plant).toEqual({ height: 30, tag: ["shade"] });

    const next = stream.next();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(((await next).value as Fern).plant).toEqual({ height: null, tag: ["shade"] });
    await stream.return(undefined);
    await gw.close();
  });

  it("a claim appended with a future start begins showing when its start passes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.boot(new MemoryBackend(), genesis());
    await gw.append([observed(FERN, "tag", "shade", T0, OP_SEED), height(30, T0 + 1_000)]);
    const stream = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
    expect(((await stream.next()).value as Fern).plant).toEqual({ height: null, tag: ["shade"] });

    const next = stream.next();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(((await next).value as Fern).plant).toEqual({ height: 30, tag: ["shade"] });
    await stream.return(undefined);
    await gw.close();
  });

  it("a boundary years away arms one timer, not a loop", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.boot(new MemoryBackend(), genesis());
    const YEAR = 365 * 24 * 3600 * 1000;
    await gw.append([height(30, T0, T0 + 10 * YEAR)]);
    const advance = vi.spyOn(gw.reactor, "advanceTime");
    await vi.advanceTimersByTimeAsync(100);
    expect(advance).not.toHaveBeenCalled();
    await gw.close();
  });

  it("a boundary already held at open is armed by the reopened gateway", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(T0);
    const backend = new MemoryBackend();
    const first = await Gateway.boot(backend, genesis());
    await first.append([observed(FERN, "tag", "shade", T0, OP_SEED), height(30, T0 + 1_000)]);

    const second = await Gateway.open(backend, { seed: OP_SEED });
    const stream = await second.subscribe(
      `subscription { plant(entity: "${FERN}") { height tag } }`,
    );
    expect(((await stream.next()).value as Fern).plant).toEqual({ height: null, tag: ["shade"] });

    const next = stream.next();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(((await next).value as Fern).plant).toEqual({ height: 30, tag: ["shade"] });
    await stream.return(undefined);
    await second.close();
  });
});

// A registration is a claim too. One outside its interval binds nothing, and one whose interval
// starts or ends while the gateway runs is bound or unbound at that moment, with no write. Each case
// names a bystander registration that stays served. Deliberately not asserted: definition deltas
// (the hyperschema and schema entities) with their own intervals. Loam writes none.
describe("a registration binds over its own interval", () => {
  const SHRUB = { ...PLANT, name: "Shrub" };

  /** A genesis with Plant and Shrub, Shrub's registration claim re-signed with `interval`. */
  const storeWithShrub = async (interval: {
    validFrom?: number;
    validUntil?: number;
  }): Promise<MemoryBackend> => {
    const plain = assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
        { hyperschema: SHRUB, schema: PLANT_POLICY, roots: [FERN], writable: [] },
      ],
    });
    const isShrubBinding = (d: Delta): boolean =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
      ) && JSON.stringify(d.claims).includes("registration:hyperschema:Shrub");
    const shrub = plain.deltas.filter(isShrubBinding);
    expect(shrub).toHaveLength(1);
    const timed = signClaims({ ...shrub[0]!.claims, ...interval }, OP_SEED);
    const backend = new MemoryBackend();
    await backend.append(plain.deltas.map((d) => (d === shrub[0] ? timed : d)));
    return backend;
  };

  const names = (gw: Gateway): string[] => gw.registered.map((r) => r.hyperschema.name);

  it("an ended registration is not served at open; the bystander registration is", async () => {
    const backend = await storeWithShrub({ validUntil: T0 });
    const gw = await Gateway.open(backend, { seed: OP_SEED });
    expect(names(gw)).toContain("Plant");
    expect(names(gw)).not.toContain("Shrub");
    await gw.close();
  });

  it("a registration that ends while the gateway runs is unbound at its end", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.open(await storeWithShrub({ validUntil: T0 + 1_000 }), {
      seed: OP_SEED,
    });
    const shrubQuery = async () =>
      (await gw.query(`{ shrub(entity: "${FERN}") { height } }`)).errors;
    const plantQuery = async () =>
      (await gw.query(`{ plant(entity: "${FERN}") { height } }`)).errors;
    expect(names(gw)).toEqual(expect.arrayContaining(["Plant", "Shrub"]));
    expect(await shrubQuery()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(names(gw)).toContain("Plant");
    expect(names(gw)).not.toContain("Shrub");
    expect(await shrubQuery()).toBeDefined(); // the served surface no longer has the field
    expect(await plantQuery()).toBeUndefined();
    await gw.close();
  });

  it("a registration that starts while the gateway runs is bound at its start", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.open(await storeWithShrub({ validFrom: T0 + 1_000 }), {
      seed: OP_SEED,
    });
    expect(names(gw)).toContain("Plant");
    expect(names(gw)).not.toContain("Shrub");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(names(gw)).toEqual(expect.arrayContaining(["Plant", "Shrub"]));
    await gw.close();
  });
});
