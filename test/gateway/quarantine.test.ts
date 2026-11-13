import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { eraseClaims, readErasures } from "../../src/gateway/erase-law.js";
import { PLANT } from "./fixtures.js";
import { inPoolVoice } from "../helpers/pool-voice.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = {
  props: new Map<string, Policy>([
    ["height", pick],
    ["message", pick],
  ]),
  default: pick,
};

const bootPrimary = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height", "message"] },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  return gw;
};

const holds = (gw: Gateway, id: string): boolean =>
  [...gw.reactor.snapshot()].some((d) => d.id === id);
const heightOf = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
  return (res.data as { plant?: { height?: unknown } } | undefined)?.plant?.height;
};

describe("§24.1/§24.2 the quarantine pool — a separate store, one-way glass", () => {
  it("the pool resolves the primary's LIVING ground; dropping it leaves the primary untouched", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    expect(await heightOf(q.gateway)).toBe(42);
    await q.drop();
    expect(await heightOf(primary)).toBe(42);
    await primary.close();
  });

  it("the glass is ONE-WAY: a write in the pool never reaches the primary", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const poolWrite = inPoolVoice(q.gateway, observed(FERN, "height", 999, 5000, OP_SEED));
    await q.gateway.append([poolWrite]);
    expect(holds(q.gateway, poolWrite.id)).toBe(true);
    expect(await heightOf(q.gateway)).toBe(999);
    expect(holds(primary, poolWrite.id)).toBe(false);
    expect(await heightOf(primary)).toBe(42);
    await q.drop();
    await primary.close();
  });

  it("the ground live-follows: a fact added to the primary after seeding reaches the pool on a pulse", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const later = observed(FERN, "message", "news", 3000, OP_SEED);
    await primary.append([later]);
    expect(holds(q.gateway, later.id)).toBe(false);
    await q.reseed();
    expect(holds(q.gateway, later.id)).toBe(true);
    await q.drop();
    await primary.close();
  });
});

describe("§24.8 erasure reaches the quarantine — the law, no evasion", () => {
  it("erasing a primary fact forgets it in the pool too, byte-for-byte, with no re-entry", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "a thing to be forgotten", 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new MemoryBackend();
    const q = await primary.openQuarantine({ backend: poolBackend });
    expect(holds(q.gateway, secret.id)).toBe(true);

    await primary.erase(secret.id, { reason: "the subject asked to be forgotten" });

    expect(
      readErasures(q.gateway.reactor, q.gateway.validityNow(), q.gateway.operatorAuthor).has(
        secret.id,
      ),
    ).toBe(true);
    expect(holds(q.gateway, secret.id)).toBe(false);
    expect((await poolBackend.deltasSince(new Set())).some((d) => d.id === secret.id)).toBe(false);
    const report = await q.gateway.federate([secret]);
    expect(report.accepted).toBe(0);
    expect(holds(q.gateway, secret.id)).toBe(false);
    expect([...q.gateway.reactor.snapshot()].every((d) => d.id !== secret.id)).toBe(true);
    expect(holds(primary, secret.id)).toBe(false);
    await q.drop();
    await primary.close();
  });

  it("a FORGED erasure cannot drive a purge in the pool (a purge is the operator's alone)", async () => {
    const primary = await bootPrimary();
    const fact = observed(FERN, "message", "not yours to forget", 2100, OP_SEED);
    await primary.append([fact]);
    const q = await primary.openQuarantine();
    expect(holds(q.gateway, fact.id)).toBe(true);
    const ALT_SEED = "a1".repeat(32);
    const forged = signClaims(
      eraseClaims(fact.id, OP, authorForSeed(ALT_SEED), 3000, "i'll forget this for you"),
      ALT_SEED,
    );
    await expect(q.gateway.eraseReplica(forged, fact.id)).rejects.toThrow(/operator/);
    expect(holds(q.gateway, fact.id)).toBe(true);
    await q.drop();
    await primary.close();
  });

  it("no COMPOSED read scope resurrects a purged byte — primary ⊎ pool holds zero bytes of it (§24.8 assert 4)", async () => {
    const FORGOTTEN = "the-exact-bytes-to-be-forgotten-everywhere";
    const primaryBackend = new MemoryBackend();
    const primary = await Gateway.boot(
      primaryBackend,
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          { hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height", "message"] },
        ],
      }),
    );
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new MemoryBackend();
    const q = await primary.openQuarantine({ backend: poolBackend });
    expect(holds(q.gateway, secret.id)).toBe(true);

    await primary.erase(secret.id, { reason: "forgotten everywhere, or nowhere" });

    const composed = [...primary.reactor.snapshot(), ...q.gateway.reactor.snapshot()];
    expect(composed.some((d) => d.id === secret.id)).toBe(false);
    expect(JSON.stringify(composed)).not.toContain(FORGOTTEN);
    for (const backend of [primaryBackend, poolBackend]) {
      const atRest = await backend.deltasSince(new Set());
      expect(atRest.some((d) => d.id === secret.id)).toBe(false);
      expect(JSON.stringify(atRest)).not.toContain(FORGOTTEN);
    }
    await q.drop();
    await primary.close();
  });

  it("a purge in the primary reaches EVERY attached pool", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "erase me everywhere", 2500, OP_SEED);
    await primary.append([secret]);
    const a = await primary.openQuarantine();
    const b = await primary.openQuarantine();
    expect(holds(a.gateway, secret.id) && holds(b.gateway, secret.id)).toBe(true);
    await primary.erase(secret.id);
    expect(holds(a.gateway, secret.id)).toBe(false);
    expect(holds(b.gateway, secret.id)).toBe(false);
    await a.drop();
    await b.drop();
    await primary.close();
  });
});
