import { describe, expect, it, vi } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden, governedBootstrap } from "./fixtures.js";

vi.setConfig({ testTimeout: 20_000 });

const KEEPER_SEED = "c3".repeat(32);

interface PlantPatch {
  _hex: string;
  _fromHex: string | null;
  _changed: string[] | null;
  height: number;
}

const SUBSCRIPTION = `subscription {
  plant(entity: "${FERN}") { _hex _fromHex _changed height }
}`;

async function keeperGateway(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

type Events = AsyncGenerator<Record<string, unknown>>;

const inflight = new WeakMap<Events, Promise<IteratorResult<Record<string, unknown>>>>();

function take(events: Events): Promise<IteratorResult<Record<string, unknown>>> {
  const held = inflight.get(events);
  if (held !== undefined) {
    inflight.delete(events);
    return held;
  }
  return events.next();
}

async function nextPatch(events: Events): Promise<PlantPatch> {
  const item = await take(events);
  if (item.done === true) throw new Error("stream ended");
  return (item.value as { plant: PlantPatch }).plant;
}

async function expectSilence(events: Events, ms = 200): Promise<void> {
  const held = inflight.get(events) ?? events.next();
  inflight.set(events, held);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silent = new Promise<"silent">((resolve) => {
    timer = setTimeout(() => resolve("silent"), ms);
  });
  const outcome = await Promise.race([held.then(() => "event" as const), silent]);
  if (timer !== undefined) clearTimeout(timer);
  if (outcome === "event") {
    inflight.delete(events);
    throw new Error("expected silence but a patch arrived");
  }
}

describe("subscribe: an initial snapshot, then patches", () => {
  it("emits the snapshot first, then a patch when a relevant mutation lands", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);

    const initial = await nextPatch(events);
    expect(initial._fromHex).toBeNull();
    expect(initial.height).toBe(34);

    await gateway.query(`mutation { plant(entity: "${FERN}", height: 40) { height } }`);
    const patch = await nextPatch(events);
    expect(patch._fromHex).toBe(initial._hex);
    expect(patch._hex).not.toBe(initial._hex);
    expect(patch._changed).toContain("height");
    expect(patch.height).toBe(40);

    await events.return(undefined);
    await gateway.close();
  });

  it("irrelevant writes are silence", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(events);
    await gateway.query(`mutation { plant(entity: "plant:moss", height: 3) { height } }`);
    await expectSilence(events);
    await events.return(undefined);
    await gateway.close();
  });

  it("every subscriber hears; a returned iterator hears no more", async () => {
    const gateway = await keeperGateway();
    const a = await gateway.subscribe(SUBSCRIPTION);
    const b = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(a);
    await nextPatch(b);

    await a.return(undefined);
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 41) { height } }`);
    expect((await nextPatch(b)).height).toBe(41);
    expect((await a.next()).done).toBe(true);

    await b.return(undefined);
    await gateway.close();
  });

  it("a change that leaves the view identical is silence, not a no-op patch", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(events);
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 34) { height } }`);
    await expectSilence(events);
    await events.return(undefined);
    await gateway.close();
  });

  it("a slow reader coalesces: one pending patch, hex chain intact, changes unioned", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    const initial = await nextPatch(events);
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 40) { height } }`);
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 41) { height } }`);
    await gateway.query(`mutation { plant(entity: "${FERN}", tag: "tall") { tag } }`);
    const patch = await nextPatch(events);
    expect(patch._fromHex).toBe(initial._hex);
    expect(patch.height).toBe(41);
    expect(patch._changed).toEqual(expect.arrayContaining(["height", "tag"]));
    await expectSilence(events);
    await events.return(undefined);
    await gateway.close();
  });

  it("a patch coalescing into an undrained snapshot stays a snapshot", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 40) { height } }`);
    const first = await nextPatch(events);
    expect(first._fromHex).toBeNull();
    expect(first._changed).toBeNull();
    expect(first.height).toBe(40);
    await expectSilence(events);
    await events.return(undefined);
    await gateway.close();
  });

  it("a sink that cannot re-resolve fails its own stream with the error, even parked", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(events);
    const parked = events.next();
    const broken = gateway.reactor as unknown as { materializedView: () => never };
    broken.materializedView = () => {
      throw new Error("the ground gave way");
    };
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 41) { height } }`);
    await expect(parked).rejects.toThrow(/ground gave way/);
    await gateway.close();
  });

  it("a live subscription survives a later registration", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(events);
    gateway.register(
      { name: "Moss", alg: 1, body: PLANT.body },
      { props: new Map(), default: { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } } },
      ["plant:moss"],
    );
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 45) { height } }`);
    expect((await nextPatch(events)).height).toBe(45);
    await events.return(undefined);
    await gateway.close();
  });

  it("closing the gateway ends every live subscription; parked readers wake with done", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(events);
    const parked = events.next();
    await gateway.close();
    expect((await parked).done).toBe(true);
  });

  it("an unwatched entity can be subscribed: the materialization grows on demand", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(`subscription {
      plant(entity: "plant:moss") { _hex _fromHex height }
    }`);
    const initial = (await events.next()).value as { plant: PlantPatch };
    expect(initial.plant.height).toBeNull();

    await gateway.query(`mutation { plant(entity: "plant:moss", height: 3) { height } }`);
    const patch = (await events.next()).value as { plant: PlantPatch };
    expect(patch.plant.height).toBe(3);
    await events.return(undefined);
    await gateway.close();
  });
});
