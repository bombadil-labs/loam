import { describe, expect, it } from "vitest";
import { authorForSeed, type Policy, type Schema } from "@bombadil/rhizomatic";
import { signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FaultableBackend } from "../helpers/faultable-backend.js";
import { isErasure, readErasures } from "../../src/gateway/erase-law.js";
import { trustClaims } from "../../src/gateway/trust.js";
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

const bootPrimary = async (backend: MemoryBackend = new MemoryBackend()): Promise<Gateway> =>
  Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height", "message"] },
      ],
    }),
  );

const holds = (gw: Gateway, id: string): boolean =>
  [...gw.reactor.snapshot()].some((d) => d.id === id);

const backendForgot = async (
  backend: MemoryBackend,
  id: string,
  content: string,
): Promise<void> => {
  const atRest = await backend.deltasSince(new Set());
  expect(atRest.some((d) => d.id === id)).toBe(false);
  expect(JSON.stringify(atRest)).not.toContain(content);
};

class FailingBackend extends FaultableBackend {
  fail = false;
  override checkWrite(): Promise<void> {
    return this.fail ? Promise.reject(new Error("the pool's disk is gone")) : Promise.resolve();
  }
}

describe("§24.8 rail (a) — a closed-trust pool cannot evade erasure", () => {
  it("erasing under a `closed` trust policy still purges the pool, byte-for-byte", async () => {
    const FORGOTTEN = "closed-doors-do-not-stop-the-erasure-law";
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    await primary.append([signClaims(trustClaims("closed", [], OP, 2100), OP_SEED)]);
    const poolBackend = new MemoryBackend();
    const q = await primary.openQuarantine({ backend: poolBackend });
    expect(holds(q.gateway, secret.id)).toBe(true);

    await primary.erase(secret.id, {
      reason: "closed means closed, but forgotten means forgotten",
    });

    expect(
      readErasures(q.gateway.reactor, q.gateway.validityNow(), q.gateway.operatorAuthor).has(
        secret.id,
      ),
    ).toBe(true);
    expect(holds(q.gateway, secret.id)).toBe(false);
    await backendForgot(poolBackend, secret.id, FORGOTTEN);
    await q.drop();
    await primary.close();
  });
});

describe("§24.8 rail (b) — failure is loud", () => {
  it("a pool whose erasure genuinely cannot land makes erase() REJECT", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "this erasure will not complete", 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new FailingBackend();
    const q = await primary.openQuarantine({ backend: poolBackend });
    expect(holds(q.gateway, secret.id)).toBe(true);

    poolBackend.fail = true;
    await expect(primary.erase(secret.id)).rejects.toThrow();
    await q.drop();
    await primary.close();
  });
});

class RetainingBackend extends MemoryBackend {
  retain = true;
  override async purge(ids: Iterable<string>): Promise<number> {
    if (this.retain) return 0;
    return super.purge(ids);
  }
}

describe("§24.8 rail (g) — a pool that retains makes the primary's erase REFUSE (ticket T67)", () => {
  it("a retaining pool cannot report a completion it did not deliver", async () => {
    const FORGOTTEN = "a-pool-is-not-a-hiding-place";
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new RetainingBackend();
    const q = await primary.openQuarantine({ backend: poolBackend });
    expect(await poolBackend.holds(secret.id)).toBe(true);

    await expect(primary.erase(secret.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HOLDS|pool/i,
    );
    expect(await poolBackend.holds(secret.id)).toBe(true);

    poolBackend.retain = false;
    await expect(primary.erase(secret.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: secret.id,
    });
    await backendForgot(poolBackend, secret.id, FORGOTTEN);
    await q.drop();
    await primary.close();
  });

  it("a NESTED pool that retains refuses outward too — the law is transitive", async () => {
    const FORGOTTEN = "depth-is-not-a-defence";
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    const qBackend = new MemoryBackend();
    const rBackend = new RetainingBackend();
    const q = await primary.openQuarantine({ backend: qBackend });
    const r = await q.gateway.openQuarantine({ backend: rBackend });
    expect(await rBackend.holds(secret.id)).toBe(true);

    await expect(primary.erase(secret.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HOLDS|pool/i,
    );
    await r.detach();
    await q.drop();
    await primary.close();
  });

  it("a pool that retains AND a nested pool that retains are reported TOGETHER, not one per re-run", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "every-fault-once", 2000, OP_SEED);
    await primary.append([secret]);
    const qBackend = new RetainingBackend();
    const q = await primary.openQuarantine({ backend: qBackend });
    const rBackend = new RetainingBackend();
    const r = await q.gateway.openQuarantine({ backend: rBackend });

    const rejection = await primary.erase(secret.id, { reason: "the subject asked" }).then(
      () => undefined,
      (err: Error) => err.message,
    );
    expect(rejection).toBeDefined();
    expect(rejection).toMatch(/2 fault\(s\)/);
    await r.detach();
    await q.detach();
    await primary.close();
  });

  it("a retaining pool does not starve the pools ORDERED BEHIND it", async () => {
    const FORGOTTEN = "a-broken-replica-must-not-shield-the-others";
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    const sick = new RetainingBackend();
    const healthy = new MemoryBackend();
    const q1 = await primary.openQuarantine({ backend: sick });
    const q2 = await primary.openQuarantine({ backend: healthy });

    await expect(primary.erase(secret.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HOLDS|pool/i,
    );

    await backendForgot(healthy, secret.id, FORGOTTEN);
    expect(
      readErasures(q2.gateway.reactor, q2.gateway.validityNow(), q2.gateway.operatorAuthor).has(
        secret.id,
      ),
    ).toBe(true);
    await q2.drop();
    await q1.detach();
    await primary.close();
  });

  it("a pool attached beneath TWO parents is visited exactly once — the walk claims before it awaits", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "one-visit-only", 2000, OP_SEED);
    await primary.append([secret]);
    const p1 = await primary.openQuarantine({ backend: new MemoryBackend() });
    const p2 = await primary.openQuarantine({ backend: new MemoryBackend() });
    const cBackend = new MemoryBackend();
    const c = await p1.gateway.openQuarantine({ backend: cBackend });
    p2.gateway.quarantinePools.add(c.gateway);

    let visits = 0;
    const orig = c.gateway.eraseReplica.bind(c.gateway);
    c.gateway.eraseReplica = (tomb, id, seen) => {
      visits += 1;
      return orig(tomb, id, seen);
    };

    await expect(primary.erase(secret.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: secret.id,
    });
    expect(visits).toBe(1);
    await backendForgot(cBackend, secret.id, "one-visit-only");
    p2.gateway.quarantinePools.delete(c.gateway);
    await c.drop();
    await p2.drop();
    await p1.drop();
    await primary.close();
  });

  it("a pool that never HELD the id but never RECEIVED the erasure is outstanding work: the retry completes it", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "delivery-is-work-too", 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new FailingBackend();
    const q = await primary.openQuarantine({ backend: poolBackend, admit: () => false });
    expect(holds(q.gateway, secret.id)).toBe(false);

    poolBackend.fail = true;
    await expect(primary.erase(secret.id, { reason: "the subject asked" })).rejects.toThrow();

    poolBackend.fail = false;
    await expect(primary.erase(secret.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: secret.id,
    });
    expect(
      readErasures(q.gateway.reactor, q.gateway.validityNow(), q.gateway.operatorAuthor).has(
        secret.id,
      ),
    ).toBe(true);
    await q.drop();
    await primary.close();
  });

  it("POSITIVE CONTROL: the same two-pool shape with nothing retained completes normally", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "control", 2000, OP_SEED);
    await primary.append([secret]);
    const q = await primary.openQuarantine({ backend: new MemoryBackend() });
    const r = await q.gateway.openQuarantine({ backend: new MemoryBackend() });
    await expect(primary.erase(secret.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: secret.id,
    });
    await r.drop();
    await q.drop();
    await primary.close();
  });
});

describe("§24.8 rail (d) — the fan-out is transitive", () => {
  it("erase in P purges P → Q → R: a nested pool holds zero bytes", async () => {
    const FORGOTTEN = "nested-pools-are-not-outside-the-law";
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    const qBackend = new MemoryBackend();
    const rBackend = new MemoryBackend();
    const q = await primary.openQuarantine({ backend: qBackend });
    const r = await q.gateway.openQuarantine({ backend: rBackend });
    expect(holds(r.gateway, secret.id)).toBe(true);

    await primary.erase(secret.id, { reason: "forgotten at every depth" });

    for (const backend of [qBackend, rBackend]) await backendForgot(backend, secret.id, FORGOTTEN);
    expect(holds(q.gateway, secret.id)).toBe(false);
    expect(holds(r.gateway, secret.id)).toBe(false);
    await r.drop();
    await q.drop();
    await primary.close();
  });
});

describe("§24.8 rails (e)/(f) — the seeding filter narrows what a pool SEES, never what it must FORGET", () => {
  it("(e) a pool seeded past a pre-attachment erasure inherits the hole: re-federation is refused", async () => {
    const FORGOTTEN = "erased-before-the-pool-was-ever-opened";
    const primaryBackend = new MemoryBackend();
    const primary = await bootPrimary(primaryBackend);
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    await primary.erase(secret.id, { reason: "forgotten before any pool existed" });

    const poolBackend = new MemoryBackend();
    const q = await primary.openQuarantine({
      backend: poolBackend,
      admit: (d) => d.claims.pointers.some((p) => p.role === "subject"),
    });
    expect(
      readErasures(q.gateway.reactor, q.gateway.validityNow(), q.gateway.operatorAuthor).has(
        secret.id,
      ),
    ).toBe(true);

    const report = await q.gateway.federate([secret]);
    expect(report.accepted).toBe(0);
    expect(holds(q.gateway, secret.id)).toBe(false);
    await backendForgot(poolBackend, secret.id, FORGOTTEN);
    await q.drop();
    await primary.close();
  });

  it("(f) the narrowing knob still narrows: ordinary domain deltas obey the admit filter", async () => {
    const primary = await bootPrimary();
    const height = observed(FERN, "height", 7, 2000, OP_SEED);
    const message = observed(FERN, "message", "not for this pool's eyes", 2100, OP_SEED);
    await primary.append([height, message]);
    const q = await primary.openQuarantine({
      admit: (d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "height",
        ),
    });
    expect(holds(q.gateway, height.id)).toBe(true);
    expect(holds(q.gateway, message.id)).toBe(false);
    expect([...q.gateway.reactor.snapshot()].some((d) => isErasure(d.claims))).toBe(false);

    await primary.erase(message.id);
    expect(
      readErasures(q.gateway.reactor, q.gateway.validityNow(), q.gateway.operatorAuthor).has(
        message.id,
      ),
    ).toBe(true);
    expect(holds(q.gateway, height.id)).toBe(true);
    await q.drop();
    await primary.close();
  });
});
