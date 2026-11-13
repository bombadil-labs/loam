import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { overlay } from "../helpers/faultable-backend.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { readErasures } from "../../src/gateway/erase-law.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { POOL_KEYS_ENTITY, recordedPoolKey } from "../../src/gateway/pool-keys.js";
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
              posture: "shared",
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
      gw.openContainer({ trust: "untrusted", posture: "shared", membership: HEIGHTS }),
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
          { container: `container:${trust}-wall`, trust, posture: "separate", membership: HEIGHTS },
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
    expect(c.posture).toBe("separate");
    expect(c.trust).toBe(trust);
    expect(c.gateway).toBeDefined();

    expect(await wallStore.holds(h.id)).toBe(true);
    expect(recordedPoolKey(gw.reactor, OP, `container:${trust}-wall`)).toBe(
      c.gateway!.operatorAuthor,
    );
    const keyRecords = [...gw.reactor.byTarget(POOL_KEYS_ENTITY)];
    expect(keyRecords).toHaveLength(1);
    const primaryAfter = [...gw.reactor.snapshot()].map((d) => d.id).sort();
    expect(primaryAfter).toEqual([...primaryBefore, ...keyRecords].sort());
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
            posture: "separate",
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
    expect(await wallStore.holds(secret.id)).toBe(true);

    await gw.erase(secret.id, { reason: "the fan-out crosses the generalized wall" });

    expect(await wallStore.holds(secret.id)).toBe(false);
    const wall = c.gateway!;
    expect(readErasures(wall.reactor, wall.validityNow(), wall.operatorAuthor).has(secret.id)).toBe(
      true,
    );
    await c.drop();
    await gw.close();
  });

  it("drop verifies the §25 pen at the bytes — a discardRow that lies is refused (H7)", async () => {
    const gw = await boot();
    const inner = new MemoryBackend();
    const stuckRow = { key: "corrupt-row-1", reason: "unparseable" as const, preview: "…" };
    const lying = overlay(inner, {
      quarantine: () => Promise.resolve([stuckRow]),
      discardRow: () => Promise.resolve(true),
    });
    const pool = await gw.openQuarantine({ backend: lying });
    await expect(pool.drop()).rejects.toThrow(/pen still holds/);
    expect(gw.quarantinePools.has(pool.gateway)).toBe(true);
    await pool.detach();
    await gw.close();
  });

  it("the guard survives a struck-declaration posture flip — §28.4 has no survival-algebra door", async () => {
    const gw = await boot();
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([fact]);
    const d1 = signClaims(
      containerClaims(
        { container: "container:flip", trust: "curated", posture: "separate" },
        OP,
        9400,
      ),
      OP_SEED,
    );
    await gw.append([d1]);
    const d2 = signClaims(
      containerClaims(
        {
          container: "container:flip",
          trust: "curated",
          posture: "shared",
          membership: HEIGHTS,
        },
        OP,
        9500,
      ),
      OP_SEED,
    );
    await gw.federate([d2], { admit: () => true });
    await gw.append([retraction(d1.id, OP, OP_SEED, 9600)]);
    expect(gw.containers().containers.get("container:flip")?.posture).toBe("shared");

    await expect(gw.erase(fact.id)).rejects.toThrow(/container:flip/);
    await gw.append([retraction(d2.id, OP, OP_SEED, 9700)]);
    await expect(gw.erase(fact.id)).resolves.toMatchObject({ erased: fact.id });
    await gw.close();
  });

  it("dropping a named wall strikes its declaration — a proven-empty store owes no guard", async () => {
    const gw = await boot();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:gone", trust: "untrusted", posture: "separate" },
          OP,
          9300,
        ),
        OP_SEED,
      ),
    ]);
    const c = await gw.openContainer({ name: "container:gone", backend: new MemoryBackend() });
    await c.drop();
    expect(gw.containers().containers.has("container:gone")).toBe(false);
    const fact = observed(FERN, "height", 7, 2000, OP_SEED);
    await gw.append([fact]);
    await expect(gw.erase(fact.id)).resolves.toMatchObject({ erased: fact.id });
    await gw.close();
  });
});
