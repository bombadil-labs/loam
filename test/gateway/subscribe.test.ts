// Step 4's live half: GraphQL subscribe. A subscription is a dynamic view — an initial
// snapshot, then one patch per relevant change: `_fromHex → _hex`, what moved, and the fields
// re-resolved. Backed by a lazily-created, cached materialization per (schema, entity);
// irrelevant writes are silence; ending the iterator ends the delivery.

import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, garden } from "./fixtures.js";

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
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  return gateway;
}

async function nextPatch(
  events: AsyncGenerator<Record<string, unknown>>,
  ms = 500,
): Promise<PlantPatch> {
  const timeout = new Promise<never>((_res, rej) =>
    setTimeout(() => rej(new Error(`no event within ${ms}ms`)), ms),
  );
  const item = await Promise.race([events.next(), timeout]);
  if (item.done === true) throw new Error("stream ended");
  return (item.value as { plant: PlantPatch }).plant;
}

async function expectSilence(events: AsyncGenerator<Record<string, unknown>>): Promise<void> {
  await expect(nextPatch(events, 100)).rejects.toThrow(/no event/);
}

describe("subscribe: an initial snapshot, then patches", () => {
  it("emits the snapshot first, then a patch when a relevant mutation lands", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);

    const initial = await nextPatch(events);
    expect(initial._fromHex).toBeNull(); // a snapshot comes from nowhere
    expect(initial.height).toBe(34);

    await gateway.query(`mutation { plant(entity: "${FERN}", height: 40) { height } }`);
    const patch = await nextPatch(events);
    expect(patch._fromHex).toBe(initial._hex); // old-hash → new-hash
    expect(patch._hex).not.toBe(initial._hex);
    expect(patch._changed).toContain("height");
    expect(patch.height).toBe(40);

    await events.return(undefined);
    await gateway.close();
  });

  it("irrelevant writes are silence", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(events); // the snapshot
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

    await a.return(undefined); // a leaves the garden
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 41) { height } }`);
    expect((await nextPatch(b)).height).toBe(41);
    expect((await a.next()).done).toBe(true); // a left; its stream is over, not just quiet

    await b.return(undefined);
    await gateway.close();
  });

  it("a change that leaves the view identical is silence, not a no-op patch", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(events); // the snapshot (height 34, picked latest)
    // A NEW delta (later timestamp) claiming the same height: the HView moves, the View doesn't.
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 34) { height } }`);
    await expectSilence(events);
    await events.return(undefined);
    await gateway.close();
  });

  it("a slow reader coalesces: one pending patch, hex chain intact, changes unioned", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    const initial = await nextPatch(events);
    // Three writes while nobody reads:
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 40) { height } }`);
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 41) { height } }`);
    await gateway.query(`mutation { plant(entity: "${FERN}", tag: "tall") { tag } }`);
    const patch = await nextPatch(events);
    expect(patch._fromHex).toBe(initial._hex); // the chain starts where the reader left off
    expect(patch.height).toBe(41); // and ends at the present
    expect(patch._changed).toEqual(expect.arrayContaining(["height", "tag"]));
    await expectSilence(events); // nothing else pending: the three writes were one patch
    await events.return(undefined);
    await gateway.close();
  });

  it("a patch coalescing into an undrained snapshot stays a snapshot", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    // Nobody has read the initial snapshot yet; a mutation lands on top of it.
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 40) { height } }`);
    const first = await nextPatch(events);
    expect(first._fromHex).toBeNull(); // still a snapshot — just a newer one
    expect(first._changed).toBeNull(); // both signals agree
    expect(first.height).toBe(40);
    await expectSilence(events); // and it was ONE event
    await events.return(undefined);
    await gateway.close();
  });

  it("a sink that cannot re-resolve fails its own stream with the error, even parked", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(SUBSCRIPTION);
    await nextPatch(events); // drain the snapshot; the reader parks next
    const parked = events.next();
    // Sabotage re-resolution: gather() throws for every future sink invocation.
    const broken = gateway as unknown as { gather: () => never };
    broken.gather = () => {
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
    const parked = events.next(); // parked, waiting for an event that will never come
    await gateway.close();
    expect((await parked).done).toBe(true);
  });

  it("an unwatched entity can be subscribed: the materialization grows on demand", async () => {
    const gateway = await keeperGateway();
    const events = await gateway.subscribe(`subscription {
      plant(entity: "plant:moss") { _hex _fromHex height }
    }`);
    const initial = (await events.next()).value as { plant: PlantPatch };
    expect(initial.plant.height).toBeNull(); // nothing known yet — an honest empty snapshot

    await gateway.query(`mutation { plant(entity: "plant:moss", height: 3) { height } }`);
    const patch = (await events.next()).value as { plant: PlantPatch };
    expect(patch.plant.height).toBe(3);
    await events.return(undefined);
    await gateway.close();
  });
});
