// §22.6's declared type BINDS (ticket T18, audit-2 MED) — a resolver's signed definition names its
// output type, and the doors advertise it; before this ticket nothing ENFORCED it, so a resolver
// declaring `string` and returning an object made GraphQL null-with-error while REST emitted the
// object verbatim — a concrete two-doors-DISAGREE, precisely the §17 invariant §22.6 claims to
// keep. The fix validates at the apply seam, ONCE, where every door inherits it, and a mismatch
// does exactly what a THROWING resolver already does: fall back to the field's Policy value,
// blast radius of one field.
//
// Written BEFORE the build (P3): the mismatch rails failed on pre-fix code (GraphQL erroring where
// it now answers the Policy value).

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { handleRest } from "../../src/surface/rest.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

const bootWith = async (resolvers: Record<string, unknown>): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
  );
  await gw.publishRegistration(
    PLANT,
    PLANT_POLICY,
    [FERN],
    undefined,
    undefined,
    undefined,
    [...PLANT_WRITABLE],
    resolvers as never,
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  return gw;
};

const gqlHeight = async (gw: Gateway): Promise<unknown> =>
  (
    (await gw.query(`{ plant(entity: "${FERN}") { height } }`)).data?.plant as
      Record<string, unknown> | undefined
  )?.["height"];

const restHeight = async (gw: Gateway): Promise<unknown> => {
  const res = await handleRest(gw, "full", "GET", ["v1", "Plant", FERN], undefined);
  return (JSON.parse(String(res.body)) as { height?: unknown }).height;
};

describe("§22.6: the resolver's declared type binds at the apply seam — two doors, one answer", () => {
  it("a resolver declaring `string` but returning an OBJECT falls back per-field, and BOTH doors agree", async () => {
    const gw = await bootWith({
      height: { rung: "a", type: "string", code: "export default () => ({ oops: true });" },
    });
    const viaGql = await gqlHeight(gw);
    const viaRest = await restHeight(gw);
    expect(viaGql).toBe(42); // the Policy value — the mismatch narrowed to its own field
    expect(viaRest).toBe(42); // the SAME answer — that is the §17 invariant, asserted directly
    await gw.close();
  });

  it("each declared type accepts its own valid value", async () => {
    const cases: Array<[string, string, unknown]> = [
      ["string", "export default (b) => `count:${b.length}`;", "count:1"],
      ["number", "export default (b) => b.length;", 1],
      ["boolean", "export default (b) => b.length > 0;", true],
      ["list", "export default (b) => b.map(() => 1);", [1]],
      ["object", "export default (b) => ({ n: b.length });", { n: 1 }],
    ];
    for (const [type, code, expected] of cases) {
      const gw = await bootWith({ height: { rung: "a", type, code } });
      expect(await gqlHeight(gw)).toEqual(expected);
      await gw.close();
    }
  });

  it("one mistyped resolver never takes down the view or the door", async () => {
    const gw = await bootWith({
      height: { rung: "a", type: "number", code: 'export default () => "not a number";' },
    });
    const res = await gw.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect(res.errors).toBeUndefined(); // the read still answers
    expect(res.data?.plant).toMatchObject({ height: 42 }); // the field fell back to its Policy value
    await gw.close();
  });
});
