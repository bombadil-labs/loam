import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 20_000 });

import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { pullFrom } from "../../src/federation/pull.js";
import { translate, translationClaims } from "../../src/federation/translate.js";
import { legibilityWarnings } from "../../src/gateway/repair.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_A = "0a".repeat(32);
const OP_B = "0b".repeat(32);
const TRANSLATOR_SEED = "0d".repeat(32);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10]);

const avatarDelta = (subject: string, ts: number, seed: string): Delta =>
  signClaims(
    {
      timestamp: ts,
      validFrom: ts,
      author: authorForSeed(seed),
      pointers: [
        {
          role: "subject",
          target: { kind: "entity", entity: { id: subject, context: "profile" } },
        },
        { role: "avatar", target: { kind: "bytes", mime: "image/png", value: PNG } },
      ],
    },
    seed,
  );

const bytesTargetOf = (d: Delta) =>
  d.claims.pointers.find((p) => p.target.kind === "bytes")?.target;

const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) await h.close();
  for (const g of gateways.splice(0)) await g.close().catch(() => {});
});

async function instance(
  operatorSeed: string,
): Promise<{ gateway: Gateway; url: string; token: string }> {
  const operator = authorForSeed(operatorSeed);
  const gateway = await Gateway.open(new MemoryBackend(), { seed: operatorSeed });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", operator, 2), operatorSeed),
  ]);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  const token = `tok-${operatorSeed.slice(0, 4)}`;
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { [token]: { operator: true } },
    port: 0,
  });
  gateways.push(gateway);
  handles.push(handle);
  return { gateway, url: `${handle.url}/default`, token };
}

describe("bytes Target kind (rhizomatic 0.4.0, adopted in T8): Loam receives, never crashes", () => {
  it("a bytes-bearing delta survives federation-in over the HTTP wire, its raw bytes intact", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    const delta = avatarDelta("person:wren", 1000, GARDENER_SEED);
    await a.gateway.append([delta]);

    const report = await pullFrom(b.gateway, a.url, a.token);
    expect(report.accepted).toBeGreaterThan(0);

    const landed = [...b.gateway.reactor.snapshot()].find((d) => d.id === delta.id);
    expect(landed).toBeDefined();
    const target = bytesTargetOf(landed!);
    expect(target?.kind).toBe("bytes");
    expect(target?.kind === "bytes" && target.mime).toBe("image/png");
    expect(target?.kind === "bytes" && Array.from(target.value)).toEqual(Array.from(PNG));
  });

  it("gql serialization, the translator, and the repair reader do not crash on a bytes target", async () => {
    const operator = authorForSeed(OP_A);
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OP_A });
    await gateway.append([
      signClaims(
        grantClaims(STORE_ENTITY, authorForSeed(TRANSLATOR_SEED), "write", operator, 1),
        OP_A,
      ),
      signClaims(
        translationClaims(
          "avatars",
          { hasPointer: { role: { exact: "avatar" } } },
          { pointers: [{ role: "seen", value: "avatar" }] },
          operator,
          2,
        ),
        OP_A,
      ),
    ]);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    gateways.push(gateway);

    const delta = avatarDelta("person:wren", 3000, GARDENER_SEED);
    const report = await gateway.federate([delta]);
    expect(report.accepted).toBeGreaterThan(0);

    const res = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(res.errors ?? []).toEqual([]);

    const swept = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(swept.matched).toBeGreaterThan(0);

    expect(() =>
      legibilityWarnings([...gateway.reactor.snapshot()], gateway.operator),
    ).not.toThrow();
  });
});
