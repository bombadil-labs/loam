// A reading never shows an erased delta, even while its bytes are still held. An erasure is stored
// before the purge, and an erasure appended directly purges nothing. Asked at the object level,
// through a Schema (present, as-of, and a live subscription), with the bytes checked at the delta
// level first so the test cannot pass because a purge happened. Every case names a bystander.
//
// Deliberately not asserted: `select` and `freeze`. They stay unfiltered, because the erasure run
// reads through them.

import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { eraseClaims } from "../../src/gateway/erase.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "7a".repeat(32);

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

async function fern(gw: Gateway, asOf?: number): Promise<{ height: number | null; tag: string[] }> {
  const arg = asOf === undefined ? "" : `, asOf: ${asOf}`;
  const res = await gw.query(`{ plant(entity: "${FERN}"${arg}) { height tag } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  return (res.data as { plant: { height: number | null; tag: string[] } }).plant;
}

describe("a reading never shows an erased delta", () => {
  it("an erased claim whose bytes remain is absent now and as of before the erasure", async () => {
    const gw = await boot();
    const op = gw.operatorAuthor!;
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    expect(await fern(gw)).toEqual({ height: 30, tag: ["shade"] }); // control

    await gw.append([signClaims(eraseClaims(claim.id, op, op, 2000), OP_SEED)]);
    expect(gw.reactor.get(claim.id)).toBeDefined(); // the bytes are still held

    expect(await fern(gw)).toEqual({ height: null, tag: ["shade"] });
    expect(await fern(gw, 1500)).toEqual({ height: null, tag: ["shade"] });
    await gw.close();
  });

  it("an erased negation whose bytes remain keeps its target hidden (a control: passes on the base; fails if only the negation is hidden)", async () => {
    const gw = await boot();
    const op = gw.operatorAuthor!;
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const negation = signClaims(makeNegationClaims(op, 2000, claim.id), OP_SEED);
    await gw.append([negation]);
    await gw.append([signClaims(eraseClaims(negation.id, op, op, 3000), OP_SEED)]);
    expect(gw.reactor.get(negation.id)).toBeDefined();

    expect(await fern(gw)).toEqual({ height: null, tag: ["shade"] });
    await gw.close();
  });

  // An erasure touches no watched entity, so open streams end with `done`, and a reader
  // resubscribes into the narrowed reading. Both write paths do this.
  it.each([
    ["append", false],
    ["federate", true],
  ])(
    "a live subscription ends when an erasure lands by %s, and a new one omits the claim",
    async (_, viaFederate) => {
      const gw = await boot();
      const op = gw.operatorAuthor!;
      const claim = observed(FERN, "height", 30, 1000, OP_SEED);
      const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
      await gw.append([claim, bystander]);
      const stream = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
      const first = (await stream.next()).value as { plant: { height: number | null } };
      expect(first.plant.height).toBe(30);

      const erasure = signClaims(eraseClaims(claim.id, op, op, 2000), OP_SEED);
      if (viaFederate) await gw.federate([erasure]);
      else await gw.append([erasure]);
      expect((await stream.next()).done).toBe(true);

      const again = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
      const fresh = (await again.next()).value as {
        plant: { height: number | null; tag: string[] };
      };
      expect(fresh.plant).toEqual({ height: null, tag: ["shade"] });
      await again.return(undefined);
      await gw.close();
    },
  );
});
