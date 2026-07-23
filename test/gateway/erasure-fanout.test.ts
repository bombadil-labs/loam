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

// A pool backend that ACCEPTS the removal order and quietly keeps the bytes — `purge` reports 0 and
// removes nothing. The read-only-mount shape, on the tier §11 is easiest to evade. Honest about
// what it holds: `holds` is inherited unchanged, so it tells the truth about the retention.
class RetainingBackend extends MemoryBackend {
  retain = true;
  override async purge(ids: Iterable<string>): Promise<number> {
    if (this.retain) return 0;
    return super.purge(ids);
  }
}

describe("§24.8 rail (g) — a pool that retains makes the primary's erase REFUSE (ticket T67)", () => {
  it("a retaining pool cannot report a completion it did not deliver", async () => {
    // Before T67 the fan-out called `purge` and discarded the count entirely — it did not even have
    // the ambiguous `removed === 0` gate the mirror path had. A pool whose store silently kept the
    // bytes reported success outward, and the primary's `erase` resolved over it: a forgotten
    // record living on inside the operator's own walls, which is the one thing §24.8 exists to stop.
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
    expect(await poolBackend.holds(secret.id)).toBe(true); // the rail's premise, still true

    // And the remedy works: fix the pool's store, re-run, and the erasure completes.
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
    const rBackend = new RetainingBackend(); // only the DEEPEST replica retains
    const q = await primary.openQuarantine({ backend: qBackend });
    const r = await q.gateway.openQuarantine({ backend: rBackend });
    expect(await rBackend.holds(secret.id)).toBe(true);

    await expect(primary.erase(secret.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HOLDS|pool/i,
    );
    await r.drop();
    await q.drop();
    await primary.close();
  });

  it("a pool that retains AND a nested pool that retains are reported TOGETHER, not one per re-run", async () => {
    // The remedy every erasure error prescribes is "resolve the fault and re-run" — so a report
    // that surfaces one fault at a time from a set the code already collected costs the operator
    // a re-run per replica. Both faults, one message: the pool's own retention must not mask the
    // nested refusal it gathered a line earlier, nor the reverse.
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "every-fault-once", 2000, OP_SEED);
    await primary.append([secret]);
    const qBackend = new RetainingBackend(); // the pool retains...
    const q = await primary.openQuarantine({ backend: qBackend });
    const rBackend = new RetainingBackend(); // ...and so does its child
    const r = await q.gateway.openQuarantine({ backend: rBackend });

    const rejection = await primary.erase(secret.id, { reason: "the subject asked" }).then(
      () => undefined,
      (err: Error) => err.message,
    );
    expect(rejection).toBeDefined();
    expect(rejection).toMatch(/2 fault\(s\)/);
    await r.drop();
    await q.drop();
    await primary.close();
  });

  it("a retaining pool does not starve the pools ORDERED BEHIND it", async () => {
    // The verdict is thrown AFTER the transitive walk, and the walk is settled before reporting.
    // Placed before, the first retaining pool aborts the sequential fan-out: every sibling and
    // every nested pool behind it receives neither the tombstone nor the purge, so they keep the
    // bytes AND stay able to re-admit the id — and the retry fails identically for as long as the
    // one faulty replica is broken. That trades a silent leak in one replica for a blocking leak
    // across all the others.
    const FORGOTTEN = "a-broken-replica-must-not-shield-the-others";
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", FORGOTTEN, 2000, OP_SEED);
    await primary.append([secret]);
    const sick = new RetainingBackend();
    const healthy = new MemoryBackend();
    const q1 = await primary.openQuarantine({ backend: sick }); // attached FIRST
    const q2 = await primary.openQuarantine({ backend: healthy }); // ...and ordered behind it

    await expect(primary.erase(secret.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HOLDS|pool/i,
    );

    // The healthy replica was still swept and still tombstoned, despite its sibling's fault.
    await backendForgot(healthy, secret.id, FORGOTTEN);
    expect(readTombstones(q2.gateway.reactor, OP).has(secret.id)).toBe(true);
    await q2.drop();
    await q1.drop();
    await primary.close();
  });

  it("a pool attached beneath TWO parents is visited exactly once — the walk claims before it awaits", async () => {
    // quarantinePools is a public mutable set, so a diamond is reachable; under the concurrent
    // fan-out a membership claim recorded only after the child's own awaits would let both
    // parents dispatch the same gateway. Two overlapping federate/flush/reseat sequences against
    // one reactor is the blast radius; visited-once is the property.
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "one-visit-only", 2000, OP_SEED);
    await primary.append([secret]);
    const p1 = await primary.openQuarantine({ backend: new MemoryBackend() });
    const p2 = await primary.openQuarantine({ backend: new MemoryBackend() });
    const cBackend = new MemoryBackend();
    const c = await p1.gateway.openQuarantine({ backend: cBackend });
    p2.gateway.quarantinePools.add(c.gateway); // the diamond: C beneath P1 AND P2

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

  it("a pool that never HELD the id but never RECEIVED the tombstone is outstanding work: the retry completes it", async () => {
    // The guard's fault model is the verdict's fault model. The verdict rejects on failed
    // tombstone delivery; a guard that asked only about BYTES then stranded exactly that erasure —
    // the pool held nothing, so the retry read "nothing to erase" while the pool still lacked the
    // one delta that keeps it from re-admitting the id forever.
    const primary = await bootPrimary();
    const secret = observed(FERN, "message", "delivery-is-work-too", 2000, OP_SEED);
    await primary.append([secret]);
    const poolBackend = new FailingBackend();
    // Seeded empty on purpose: the pool never holds the secret's bytes, so ONLY the missing
    // tombstone can mark the erasure outstanding here.
    const q = await primary.openQuarantine({ backend: poolBackend, admit: () => false });
    expect(holds(q.gateway, secret.id)).toBe(false);

    poolBackend.fail = true; // the pool's store refuses the tombstone during the fan-out
    await expect(primary.erase(secret.id, { reason: "the subject asked" })).rejects.toThrow();

    poolBackend.fail = false; // the operator repairs the pool and re-runs, as instructed
    await expect(primary.erase(secret.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: secret.id,
    });
    expect(readTombstones(q.gateway.reactor, OP).has(secret.id)).toBe(true); // delivered at last
    await q.drop();
    await primary.close();
  });

  it("POSITIVE CONTROL: the same two-pool shape with nothing retained completes normally", async () => {
    // Without this, both rails above would pass against an `erase` that always threw.
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
