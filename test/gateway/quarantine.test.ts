// The quarantine pool — SPEC §24, slice 1. A second store over the operator's own ground, seeded ONE-WAY
// from a primary by federation, where untrusted law may run sequestered. These suites prove the
// foundation: it is a REAL separate store (drop it, the primary is untouched); the glass is ONE-WAY (a pool
// write never reaches the primary); the ground LIVE-FOLLOWS (a new primary fact reaches the pool on a
// pulse); and — the non-negotiable law (§24.8) — an ERASURE in the primary forgets the byte in the pool
// too, byte-for-byte, with no re-entry and no read scope that resurrects it. A quarantine that could hide a
// purged byte would be an erasure-evasion channel inside the operator's own walls (§11), and this forbids it.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { eraseClaims, readTombstones } from "../../src/gateway/erase.js";
import { PLANT } from "./fixtures.js";
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
    expect(await heightOf(q.gateway)).toBe(42); // a real lens over real ground, not raw deltas
    await q.drop();
    expect(await heightOf(primary)).toBe(42); // discard the pool → the primary is unscathed
    await primary.close();
  });

  it("the glass is ONE-WAY: a write in the pool never reaches the primary", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const poolWrite = observed(FERN, "height", 999, 5000, OP_SEED);
    await q.gateway.append([poolWrite]);
    expect(holds(q.gateway, poolWrite.id)).toBe(true); // the pool holds its own write
    expect(await heightOf(q.gateway)).toBe(999);
    expect(holds(primary, poolWrite.id)).toBe(false); // the primary NEVER sees it — inbound edge only
    expect(await heightOf(primary)).toBe(42);
    await q.drop();
    await primary.close();
  });

  it("the ground live-follows: a fact added to the primary after seeding reaches the pool on a pulse", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const later = observed(FERN, "message", "news", 3000, OP_SEED);
    await primary.append([later]);
    expect(holds(q.gateway, later.id)).toBe(false); // not yet — the pool has not re-pulsed
    await q.reseed(); // pulse the one-way inbound edge
    expect(holds(q.gateway, later.id)).toBe(true); // now the pool sees the live ground
    await q.drop();
    await primary.close();
  });
});

describe("§24.8 erasure reaches the quarantine — the law, no evasion", () => {
  it("erasing a primary fact forgets it in the pool too, byte-for-byte, with no re-entry", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "a thing to be forgotten", 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new MemoryBackend(); // held, so we can prove the BYTE is gone from the pool's store
    const q = await primary.openQuarantine({ backend: poolBackend });
    expect(holds(q.gateway, secret.id)).toBe(true); // seeded → the pool holds the secret

    // The operator erases it in the PRIMARY — which fans the erasure OUT to the pool.
    await primary.erase(secret.id, { reason: "the subject asked to be forgotten" });

    // (a) the tombstone propagated IN
    expect(readTombstones(q.gateway.reactor, OP).has(secret.id)).toBe(true);
    // (b) the byte is GONE from the pool — not in its ground, and not in its backend
    expect(holds(q.gateway, secret.id)).toBe(false);
    expect((await poolBackend.deltasSince(new Set())).some((d) => d.id === secret.id)).toBe(false);
    // (c) re-entry refused: re-federating the secret is rejected (the door remembers the hole)
    const report = await q.gateway.federate([secret]);
    expect(report.accepted).toBe(0);
    expect(holds(q.gateway, secret.id)).toBe(false);
    // (d) no read scope resurrects it — gone from the pool's ground, so no lens over the pool can show it
    expect([...q.gateway.reactor.snapshot()].every((d) => d.id !== secret.id)).toBe(true);
    // ...and the primary forgot it too, of course
    expect(holds(primary, secret.id)).toBe(false);
    await q.drop();
    await primary.close();
  });

  it("a FORGED tombstone cannot drive a purge in the pool (a purge is the operator's alone)", async () => {
    const primary = await bootPrimary();
    const fact = observed(FERN, "message", "not yours to forget", 2100, OP_SEED);
    await primary.append([fact]);
    const q = await primary.openQuarantine();
    expect(holds(q.gateway, fact.id)).toBe(true);
    // A tombstone signed by a NON-operator: federate's eraseDefect rejects it, so eraseReplica must NOT purge.
    const ALT_SEED = "a1".repeat(32);
    const forged = signClaims(
      eraseClaims(fact.id, OP, authorForSeed(ALT_SEED), 3000, "i'll forget this for you"),
      ALT_SEED,
    );
    await q.gateway.eraseReplica(forged, fact.id);
    expect(holds(q.gateway, fact.id)).toBe(true); // the byte survives — no unauthorized removal
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
