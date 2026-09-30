// A gateway is a view of one container; the container's journal is the source of truth
// (refactor/audit/step6-container-split.md, ruling 13). So several gateways can serve one store:
// two over the same container serve each other's writes, and two over different containers keep
// each container's writes to itself (ruling 11). The second case is a control: isolation already
// held; it pins that catching up never reaches across containers.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const SEED = "6f".repeat(32);
const OP = authorForSeed(SEED);
const genesis = () =>
  assembleGenesis({
    operatorSeed: SEED,
    registrations: [
      { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
    ],
  });
const height = async (gw: Gateway): Promise<unknown> =>
  ((await gw.query(`{ plant(entity: "${FERN}") { height } }`)).data?.plant as { height: unknown })
    ?.height;

describe("gateways are views of a container's journal", () => {
  it("two gateways over the same container: a write through one is served through the other", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "loam-views-")), "store.sqlite");
    const a = await Gateway.boot(new SqliteBackend(file), genesis());
    const b = await Gateway.open(new SqliteBackend(file), { seed: SEED }); // another handle, another view
    const fact = observed(FERN, "height", 42, 1000, SEED);
    await a.append([fact]);
    // b's reactor is a view: it lacks the write until b reads through a door, which catches up.
    expect(b.reactor.get(fact.id)).toBeUndefined();
    expect(await height(b)).toBe(42);
    expect(b.reactor.get(fact.id)).toBeDefined();
    // And the other way round.
    await b.append([observed(FERN, "height", 43, 1001, SEED)]);
    expect(await height(a)).toBe(43);
    await b.close();
    await a.close();
  });

  it("a lens published through one gateway binds in the other's view of the same container", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "loam-views-")), "store.sqlite");
    const a = await Gateway.boot(new SqliteBackend(file), assembleGenesis({ operatorSeed: SEED }));
    const b = await Gateway.open(new SqliteBackend(file), { seed: SEED });
    await a.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
    ]);
    await a.append([observed(FERN, "height", 9, 1000, SEED)]);
    expect(await height(b)).toBe(9);
    await b.close();
    await a.close();
  });

  it("two gateways over different containers: a write admitted to one is not served by the other", async () => {
    const host = await Gateway.boot(new MemoryBackend(), genesis());
    const p = (await host.openQuarantine()).gateway;
    const q = (await host.openQuarantine()).gateway;
    const fact = observed(FERN, "height", 7, 1000, SEED);
    expect((await p.federate([fact], { admit: () => true })).accepted).toBe(1);
    expect(p.reactor.get(fact.id)).toBeDefined();
    await q.refresh();
    expect(q.reactor.get(fact.id)).toBeUndefined();
    await host.refresh();
    expect(host.reactor.get(fact.id)).toBeUndefined();
    expect(p.operatorAuthor).not.toBe(OP);
    await host.close();
  });
});
