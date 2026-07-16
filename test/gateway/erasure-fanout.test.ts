// The erasure fan-out re-derives its own reach (SPEC §24.8 — the T16 correction). Audit 2 found
// the fan-out TRUSTING conditions instead of RE-DERIVING them, three ways: a pool whose trust
// policy is `closed` silently swallowed the operator's tombstone (trust policy is not the erasure
// law's business — the pool is the operator's OWN replica, §24.1, and §11 reaches through the glass
// unconditionally); a NESTED pool sat outside the fan-out entirely; and a domain-shaped seeding
// `admit` dropped the primary's pre-existing tombstones, leaving the pool ready to re-admit purged
// bytes. These rails pin the law: erase in the primary, and the forgotten byte is gone from every
// attached pool, byte-for-byte — or the operator LEARNS the erasure did not complete. Never a
// silent success.

import { describe, expect, it } from "vitest";
import { authorForSeed, type Delta, type Policy, type Schema } from "@bombadil/rhizomatic";
import { signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { isTombstone, readTombstones } from "../../src/gateway/erase.js";
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

// The at-rest assertion the composed-scope rail established: not the id, not the content STRING —
// the bytes exist nowhere in the backend.
const backendForgot = async (
  backend: MemoryBackend,
  id: string,
  content: string,
): Promise<void> => {
  const atRest = await backend.deltasSince(new Set());
  expect(atRest.some((d) => d.id === id)).toBe(false);
  expect(JSON.stringify(atRest)).not.toContain(content);
};

// A backend that can be made to fail on append — the honest construction of "a tombstone that
// genuinely cannot land" (an IO failure at the pool's door), no mocking of the guard under test.
class FailingBackend extends MemoryBackend {
  fail = false;
  override async append(deltas: Iterable<Delta>): Promise<number> {
    if (this.fail) throw new Error("the pool's disk is gone");
    return super.append(deltas);
  }
}

describe("§24.8 rail (a) — a closed-trust pool cannot evade erasure", () => {
  it("erasing under a `closed` trust policy still purges the pool, byte-for-byte", async () => {
    const FORGOTTEN = "closed-doors-do-not-stop-the-erasure-law";
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    // The operator closes the door — a documented, legitimate posture (trust.ts). The pool seeds
    // while its own ground is still empty (policy defaults open), so the closed declaration
    // federates in and, being operator-authored, BINDS there.
    await primary.append([signClaims(trustClaims("closed", [], OP, 2100), OP_SEED)]);
    const poolBackend = new MemoryBackend();
    const q = await primary.openQuarantine({ backend: poolBackend });
    expect(holds(q.gateway, secret.id)).toBe(true); // the pool holds the secret before the erasure

    // Trust policy is admission CONFIGURATION; erasure is LAW. §11 reaches through the glass
    // unconditionally — the tombstone crosses regardless of what the pool's door would admit.
    await primary.erase(secret.id, {
      reason: "closed means closed, but forgotten means forgotten",
    });

    expect(readTombstones(q.gateway.reactor, OP).has(secret.id)).toBe(true);
    expect(holds(q.gateway, secret.id)).toBe(false);
    await backendForgot(poolBackend, secret.id, FORGOTTEN);
    await q.drop();
    await primary.close();
  });
});

describe("§24.8 rail (b) — failure is loud", () => {
  it("a pool whose tombstone genuinely cannot land makes erase() REJECT", async () => {
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "this erasure will not complete", 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new FailingBackend();
    const q = await primary.openQuarantine({ backend: poolBackend });
    expect(holds(q.gateway, secret.id)).toBe(true);

    poolBackend.fail = true; // the pool's store dies under the fan-out
    // Best-effort-and-loud (spec/24): the operator LEARNS the erasure did not complete.
    await expect(primary.erase(secret.id)).rejects.toThrow();
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
    const r = await q.gateway.openQuarantine({ backend: rBackend }); // a pool over the pool
    expect(holds(r.gateway, secret.id)).toBe(true); // R is a live in-process replica holding the byte

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
    // The erasure PRE-DATES the pool: the tombstone is already ground when the pool seeds.
    await primary.erase(secret.id, { reason: "forgotten before any pool existed" });

    // A domain-shaped admit (§24.2's hand-picked-subset knob): only domain facts pass. Naively
    // applied, it rejects `loam.erasure` tombstones — they are just offered deltas.
    const poolBackend = new MemoryBackend();
    const q = await primary.openQuarantine({
      backend: poolBackend,
      admit: (d) => d.claims.pointers.some((p) => p.role === "subject"),
    });
    // A quarantine inherits the holes along with the ground.
    expect(readTombstones(q.gateway.reactor, OP).has(secret.id)).toBe(true);

    // A lagging peer (or a saved offer) re-sends the purged bytes: the door remembers the hole.
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
    // Admit heights only — the tombstone exception must not have broken the domain filter.
    const q = await primary.openQuarantine({
      admit: (d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "height",
        ),
    });
    expect(holds(q.gateway, height.id)).toBe(true); // selected → seen
    expect(holds(q.gateway, message.id)).toBe(false); // not selected → never seen
    expect([...q.gateway.reactor.snapshot()].some((d) => isTombstone(d.claims))).toBe(false);

    // An erasure of the unseen fact still fans out its tombstone (the hole crosses even where
    // the byte never did — a later widened reseed must not resurrect it).
    await primary.erase(message.id);
    expect(readTombstones(q.gateway.reactor, OP).has(message.id)).toBe(true);
    expect(holds(q.gateway, height.id)).toBe(true); // the filter's positive selection is untouched
    await q.drop();
    await primary.close();
  });
});
