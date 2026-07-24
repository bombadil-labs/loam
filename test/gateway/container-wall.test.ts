// T32 — a wall is real bytes, and untrusted must be one (criteria 5 and 14). Trust decides which
// postures are LAWFUL (§28.3: untrusted+property is delegated admission over shared ground —
// REFUSED, at the door and at the runtime opener alike); posture decides where bytes are PAID: a
// wall's members live in a genuinely separate store, asserted for both the untrusted wall (the
// quarantine's shape) and the curated wall (tenant isolation's default shape, §28.4). And §24.8's
// erasure law reaches the GENERALIZED wall: a container opened through the Container surface —
// not the quarantine preset — receives the tombstone + purge fan-out, byte-verified.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { readTombstones } from "../../src/gateway/erase.js";
import { containerClaims } from "../../src/gateway/container.js";
import { retraction } from "./narrowing.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "2e".repeat(32);
const OP = authorForSeed(OP_SEED);

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

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

describe("T32 criterion 5 — untrusted must be a wall, and a wall is real bytes", () => {
  it("untrusted + property refuses at the door naming §28.3", async () => {
    const gw = await boot();
    await expect(
      gw.append([
        signClaims(
          containerClaims(
            {
              container: "container:x",
              trust: "untrusted",
              posture: "property",
              membership: HEIGHTS,
            },
            OP,
            9000,
          ),
          OP_SEED,
        ),
      ]),
    ).rejects.toThrow(/§28\.3/);
    await gw.close();
  });

  it("untrusted + property refuses at the runtime opener too — the anonymous path passes no door", async () => {
    const gw = await boot();
    await expect(
      gw.openContainer({ trust: "untrusted", posture: "property", membership: HEIGHTS }),
    ).rejects.toThrow(/§28\.3/);
    await gw.close();
  });

  const wallHoldsRealBytes = async (trust: "untrusted" | "curated"): Promise<void> => {
    const gw = await boot();
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([h]);
    await gw.append([
      signClaims(
        containerClaims(
          { container: `container:${trust}-wall`, trust, posture: "wall", membership: HEIGHTS },
          OP,
          9100,
        ),
        OP_SEED,
      ),
    ]);
    await gw.flush();
    const primaryBefore = [...gw.reactor.snapshot()].map((d) => d.id).sort();

    const wallStore = new MemoryBackend();
    const c = await gw.openContainer({ name: `container:${trust}-wall`, backend: wallStore });
    expect(c.posture).toBe("wall");
    expect(c.trust).toBe(trust);
    expect(c.gateway).toBeDefined();

    // Real bytes: the wall's OWN store holds a copy of the member — discard-with-zero-trace is
    // the one thing sharing cannot provide, so the copy is the point, not an overhead.
    expect(await wallStore.holds(h.id)).toBe(true);
    // And the primary's ground is unchanged by the wall's existence.
    const primaryAfter = [...gw.reactor.snapshot()].map((d) => d.id).sort();
    expect(primaryAfter).toEqual(primaryBefore);
    await c.drop();
    await gw.close();
  };

  it("an untrusted wall's members are byte copies in its own store", () =>
    wallHoldsRealBytes("untrusted"));

  it("a curated wall pays the same copies, on purpose — the lawful tenant shape", () =>
    wallHoldsRealBytes("curated"));
});

describe("T32 criterion 14 — erasure reaches the generalized wall", () => {
  it("an untrusted container opened through the Container surface receives the fan-out", async () => {
    const gw = await boot();
    const secret = observed(FERN, "height", 41, 1000, OP_SEED);
    await gw.append([secret]);
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "container:reach",
            trust: "untrusted",
            posture: "wall",
            membership: HEIGHTS,
          },
          OP,
          9200,
        ),
        OP_SEED,
      ),
    ]);
    const wallStore = new MemoryBackend();
    const c = await gw.openContainer({ name: "container:reach", backend: wallStore });
    expect(await wallStore.holds(secret.id)).toBe(true); // seeded through the glass

    await gw.erase(secret.id, { reason: "the fan-out crosses the generalized wall" });

    // Byte-verified on the wall's own tier, and the tombstone landed there (the wall remembers
    // the hole and refuses re-entry, exactly as the preset always has).
    expect(await wallStore.holds(secret.id)).toBe(false);
    expect(readTombstones(c.gateway!.reactor, OP).has(secret.id)).toBe(true);
    await c.drop();
    await gw.close();
  });

  it("drop verifies the §25 pen at the bytes — a discardRow that lies is refused (H7)", async () => {
    // P5 fold: the pen sweep's only proof used to be discardRow's boolean, which is evidence,
    // never the verdict. A repairable store whose pen row survives every discard must refuse
    // the drop — success over set-aside legible bytes is the erasure-evasion shape.
    const gw = await boot();
    const inner = new MemoryBackend();
    const stuckRow = { key: "corrupt-row-1", reason: "unparseable" as const, preview: "…" };
    const lying: import("../../src/store/quarantine.js").RepairableBackend = {
      append: (d) => inner.append(d),
      deltasSince: (k) => inner.deltasSince(k),
      purge: (ids) => inner.purge(ids),
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
      quarantine: () => Promise.resolve([stuckRow]), // the origin's bytes keep the row, every walk
      discardRow: () => Promise.resolve(true), // "removed it", removing nothing
    };
    const pool = await gw.openQuarantine({ backend: lying });
    await expect(pool.drop()).rejects.toThrow(/pen still holds/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true); // refused = still in erasure reach
    await pool.detach();
    await gw.close();
  });

  it("the guard survives a struck-declaration posture flip — §28.4 has no survival-algebra door", async () => {
    // P5 fold (the erasure lens's finding): land a federated property re-declaration (a named
    // defect, not binding), then strike the EARLIEST declaration — the binding posture would
    // flip wall→property and dissolve the guard while the wall's bytes sit on disk. The guard
    // remembers the struck wall lineage; only a cover, or forgetting the container WHOLE,
    // clears it.
    const gw = await boot();
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([fact]);
    const d1 = signClaims(
      containerClaims({ container: "container:flip", trust: "curated", posture: "wall" }, OP, 9400),
      OP_SEED,
    );
    await gw.append([d1]);
    const d2 = signClaims(
      containerClaims(
        {
          container: "container:flip",
          trust: "curated",
          posture: "property",
          membership: HEIGHTS,
        },
        OP,
        9500,
      ),
      OP_SEED,
    );
    await gw.federate([d2], { admit: () => true }); // the flip lands as data, defect named
    await gw.append([retraction(d1.id, OP, OP_SEED, 9600)]); // the earliest falls; d2 would bind
    expect(gw.containers().containers.get("container:flip")?.posture).toBe("property");

    await expect(gw.erase(fact.id)).rejects.toThrow(/container:flip/); // lineage remembered
    // Forgetting the container WHOLE is still the honest exit.
    await gw.append([retraction(d2.id, OP, OP_SEED, 9700)]);
    await expect(gw.erase(fact.id)).resolves.toMatchObject({ erased: fact.id });
    await gw.close();
  });

  it("dropping a named wall strikes its declaration — a proven-empty store owes no guard", async () => {
    const gw = await boot();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:gone", trust: "untrusted", posture: "wall" },
          OP,
          9300,
        ),
        OP_SEED,
      ),
    ]);
    const c = await gw.openContainer({ name: "container:gone", backend: new MemoryBackend() });
    await c.drop();
    // The drop verified the bytes gone; leaving the declaration standing would turn every future
    // erase into a refusal over a store that provably no longer exists.
    expect(gw.containers().containers.has("container:gone")).toBe(false);
    const fact = observed(FERN, "height", 7, 2000, OP_SEED);
    await gw.append([fact]);
    await expect(gw.erase(fact.id)).resolves.toMatchObject({ erased: fact.id });
    await gw.close();
  });
});
