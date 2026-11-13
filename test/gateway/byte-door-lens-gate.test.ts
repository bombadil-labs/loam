import { describe, expect, it } from "vitest";
import {
  contentAddress,
  parseSchema,
  signClaims,
  type Delta,
  type Schema,
} from "@bombadil/rhizomatic";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf, type LensName } from "../../src/gateway/registration.js";
import { PLANT } from "./fixtures.js";
import { FERN } from "../spike/garden.js";
const L = (n: string): LensName => n as LensName;

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const BROAD: Schema = parseSchema({
  name: "Plant",
  alg: 1,
  props: { avatar: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const ARCHIVAL: Schema = parseSchema({
  name: "PlantPublic",
  alg: 1,
  props: { avatar: { pick: { order: { byTimestamp: "asc" } } } },
  default: { pick: { order: { byTimestamp: "asc" } } },
});

const OLD_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const NEW_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38]);

const bytesFact = (mime: string, value: Uint8Array, ts: number): Delta =>
  signClaims(
    {
      timestamp: ts,
      validFrom: ts,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "avatar" } } },
        { role: "value", target: { kind: "bytes", mime, value } },
      ],
    },
    OP_SEED,
  );

const boot = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: BROAD, roots: [FERN], writable: ["avatar"] }],
    }),
  );
  await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, [
    "avatar",
  ]);
  await gw.append([bytesFact("image/png", OLD_BYTES, 1000)]);
  await gw.append([bytesFact("image/gif", NEW_BYTES, 2000)]);
  await gw.declarePublic(["PlantPublic"]);
  return gw;
};

const REF_NEW = contentAddress(NEW_BYTES);
const REF_OLD = contentAddress(OLD_BYTES);

describe("§12 — the anonymous byte-door honours the lens, not the program", () => {
  it("PRECONDITION: the two readings share a hyperschema name and resolve to DIFFERENT bytes", async () => {
    const gw = await boot();
    const names = gw.registered.map((r) => ({ program: r.hyperschema.name, lens: lensOf(r) }));
    const plants = names.filter((n) => n.program === "Plant");
    expect(plants.length).toBeGreaterThanOrEqual(2);
    expect(new Set(plants.map((n) => n.lens)).size).toBeGreaterThanOrEqual(2);

    expect(gw.surface("public")?.registered.map(lensOf)).toEqual(["PlantPublic"]);

    expect(gw.serveBytes(REF_NEW, L("Plant"), FERN, "full").status).toBe(200);
    expect(gw.serveBytes(REF_NEW, L("PlantPublic"), FERN, "full").status).toBe(404);
    await gw.close();
  });

  it("THE EXPLOIT: the anonymous door refuses bytes reachable only through an UNDECLARED reading", async () => {
    const gw = await boot();
    const refused = gw.serveBytes(REF_NEW, L("Plant"), FERN, "public");
    expect(refused.status).toBe(404);
    expect(out(refused)).toBe(UNIFORM_REFUSAL);
    await gw.close();
  });

  it("ADMISSION: the DECLARED reading still serves its bytes — a door that refuses everything fails here", async () => {
    const gw = await boot();
    const served = gw.serveBytes(REF_OLD, L("PlantPublic"), FERN, "public");
    expect(served.status).toBe(200);
    expect(served.contentType).toBe("image/png");
    expect([...served.body]).toEqual([...OLD_BYTES]);
    await gw.close();
  });

  it("the refusal is uniform — undeclared and never-existed are indistinguishable in every field", async () => {
    const gw = await boot();
    const undeclared = gw.serveBytes(REF_NEW, L("Plant"), FERN, "public");
    const nonsense = gw.serveBytes(REF_NEW, L("NoSuchLensAtAll"), FERN, "public");
    expect({ ...undeclared, body: [...undeclared.body] }).toEqual({
      ...nonsense,
      body: [...nonsense.body],
    });
    expect(out(undeclared)).toBe(UNIFORM_REFUSAL);
    await gw.close();
  });

  it("the operator's own door still reaches the private reading, as it always could", async () => {
    const gw = await boot();
    const operatorSide = gw.serveBytes(REF_NEW, L("Plant"), FERN, "full");
    expect(operatorSide.status).toBe(200);
    expect([...operatorSide.body]).toEqual([...NEW_BYTES]);
    await gw.close();
  });
});

const out = (r: { body: Uint8Array }): string => new TextDecoder().decode(r.body);

const UNIFORM_REFUSAL = "no such bytes";
