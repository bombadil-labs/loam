// §21.7 Coexistence rails (ticket T2) — two lenses (resolution Schemas) over one hyperschema,
// per-lens at every door, with the degenerate single-lens case BYTE-IDENTICAL to what ships today.
//
// The rails were written BEFORE the build (P3), on the pre-coexistence code:
//   - The PINNING suite passed from the day it was written: its snapshots capture the single-lens
//     SDL / OpenAPI / REST paths as they stood on main, and the build must never move them —
//     "nothing at rest moves" is §21.7's on-wire verdict, and this is its serving-side twin.
//   - The COEXISTENCE suite failed on the pre-build code (registering a second lens EVICTED the
//     first — the §21 body's honesty note) and turning it green IS the ticket.

import { describe, expect, it } from "vitest";
import {
  buildClientSchema,
  getIntrospectionQuery,
  printSchema,
  type IntrospectionQuery,
} from "graphql";
import { parseSchema, parseTerm, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { buildOpenApi } from "../../src/surface/rest.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

// The broad reading: every field. The narrow archival sibling: height only, its own clock.
const BROAD: Schema = parseSchema({
  name: "Plant",
  alg: 1,
  props: {
    height: { pick: { order: { byTimestamp: "desc" } } },
    message: { pick: { order: { byTimestamp: "desc" } } },
  },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const ARCHIVAL: Schema = parseSchema({
  name: "PlantClassic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "asc" } } } },
  default: { pick: { order: { byTimestamp: "asc" } } },
});

const bootSingle = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: BROAD, roots: [FERN], writable: ["height", "message"] },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  return gw;
};

const sdlOf = async (gw: Gateway): Promise<string> => {
  const res = await gw.query(getIntrospectionQuery());
  return printSchema(buildClientSchema(res.data as unknown as IntrospectionQuery));
};

describe("§21.7 pinning — the degenerate single-lens case is byte-identical", () => {
  it("the single-lens SDL never moves", async () => {
    const gw = await bootSingle();
    expect(await sdlOf(gw)).toMatchSnapshot();
    await gw.close();
  });

  it("the single-lens OpenAPI document never moves", async () => {
    const gw = await bootSingle();
    expect(JSON.stringify(buildOpenApi(gw, "full", "store"), null, 2)).toMatchSnapshot();
    await gw.close();
  });

  it("the single-lens REST path list never moves", async () => {
    const gw = await bootSingle();
    const doc = buildOpenApi(gw, "full", "store") as { paths?: Record<string, unknown> };
    expect(Object.keys(doc.paths ?? {}).sort()).toMatchSnapshot();
    await gw.close();
  });
});

describe("§21.7 coexistence — two lenses over one hyperschema", () => {
  it("latest-per-lens: registering the archival sibling no longer evicts the broad lens", async () => {
    const gw = await bootSingle();
    await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, [
      "height",
    ]);
    // BOTH lenses answer, each through its own reading (desc vs asc over the same ground).
    await gw.append([observed(FERN, "height", 7, 2000, OP_SEED)]);
    const broad = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    const classic = await gw.query(`{ plantClassic(entity: "${FERN}") { height } }`);
    expect(broad.data?.plant).toMatchObject({ height: 7 }); // latest wins in the broad lens
    expect(classic.data?.plantClassic).toMatchObject({ height: 42 }); // oldest wins in the archival one
    await gw.close();
  });

  it("each lens evolves alone: republishing the archival lens leaves the broad lens untouched", async () => {
    const gw = await bootSingle();
    await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, [
      "height",
    ]);
    const evolved: Schema = parseSchema({
      name: "PlantClassic",
      alg: 1,
      props: { message: { pick: { order: { byTimestamp: "asc" } } } },
      default: { pick: { order: { byTimestamp: "asc" } } },
    });
    await gw.publishRegistration(PLANT, evolved, [FERN], undefined, undefined, undefined, [
      "message",
    ]);
    const broad = await gw.query(`{ plant(entity: "${FERN}") { height message } }`);
    expect(broad.errors).toBeUndefined(); // the sibling's evolution reshaped nothing here
    const classicOld = await gw.query(`{ plantClassic(entity: "${FERN}") { height } }`);
    expect((classicOld.errors ?? []).join(" ")).toMatch(/height/); // the archival lens moved on
    await gw.close();
  });

  it("grouping refusal: one hyperschema name with two DIFFERENT bodies is refused loudly", async () => {
    const gw = await bootSingle();
    // A genuinely different gather under the SAME hyperschema name (different termHash): the
    // extra top-level select makes the bodies distinct while both still materialize.
    const rival: typeof PLANT = {
      name: PLANT.name,
      alg: PLANT.alg,
      body: parseTerm({
        op: "group",
        key: "byTargetContext",
        in: {
          op: "select",
          pred: { hasPointer: { targetEntity: { var: "root" } } },
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: { op: "mask", policy: "drop", in: "input" },
          },
        },
      }),
    };
    await expect(
      gw.publishRegistration(
        rival,
        parseSchema({
          name: "PlantRival",
          alg: 1,
          props: { height: { pick: { order: { byTimestamp: "desc" } } } },
          default: { pick: { order: { byTimestamp: "desc" } } },
        }),
        [FERN],
      ),
    ).rejects.toThrow(/hyperschema|body|differ|answers/i);
    await gw.close();
  });

  it("per-lens loam.public: publishing the broad lens reveals nothing of the archival one", async () => {
    const gw = await bootSingle();
    await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, [
      "height",
    ]);
    await gw.declarePublic(["Plant"]);
    const pub = await gw.queryPublic(`{ plant(entity: "${FERN}") { height } }`);
    expect(pub.errors).toBeUndefined();
    const leak = await gw.queryPublic(`{ plantClassic(entity: "${FERN}") { height } }`);
    expect((leak.errors ?? []).join(" ")).toMatch(/plantClassic/); // unknown field — uniform silence
    await gw.close();
  });

  it("writability honesty: a field writable through one sibling lens is writable (§14's posture)", async () => {
    const gw = await bootSingle();
    // The archival lens opens NO fields; the broad lens opens height. A write through the broad
    // lens lands, and the archival lens reads the same ground — behavior, not a bypass-guard.
    await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, []);
    const written = await gw.query(`mutation { plant(entity: "${FERN}", height: 9) { height } }`);
    expect(written.errors).toBeUndefined();
    const classic = await gw.query(`{ plantClassic(entity: "${FERN}") { height } }`);
    expect(classic.data?.plantClassic).toMatchObject({ height: 42 }); // asc still picks the oldest
    await gw.close();
  });
});
