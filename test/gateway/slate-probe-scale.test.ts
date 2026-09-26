// A store with no slate record answers from the target index at SLATE_ENTITY, with no pass over the
// whole store, on every read and every write (H8). A probe through `reactor.snapshot()` copied and
// walked the whole store each time. Deliberately not asserted: a store that holds slates. Past the
// probe, a cold container table or a membership evaluation can still take a snapshot.

import { describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { readSlates } from "../../src/gateway/slate.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "d3".repeat(32);

describe("reading slates in a store with none takes no snapshot of the store", () => {
  it("a store with no slate record answers empty without a snapshot, on a read and on a write", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
      }),
    );
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    const snapshot = vi.spyOn(gw.reactor, "snapshot");

    expect(readSlates(gw.reactor, gw.validityNow(), authorForSeed(OP_SEED), Date.now())).toEqual(
      [],
    );
    expect(snapshot).not.toHaveBeenCalled();

    // The same through the served path: a query and a mutation read slates on the way.
    await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    await gw.query(`mutation { plant(entity: "${FERN}", height: 31) { height } }`);
    const fromSlates = snapshot.mock.calls.length;
    expect(fromSlates, "readSlates and readClosedIds must not snapshot").toBe(0);
    await gw.close();
  });
});
