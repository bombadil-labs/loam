// §24.5's quarantine resource envelope (ticket T34) — the DECLARATION half. Under container-scoped
// trust an operator delegates almost everything to a child container: a child may admit deltas its
// parent does not trust. Exactly two powers stay with the operator — erasure reach (§24.8, built) and
// THE BILL. These rails pin the bill: a quarantine pool's renders run on slots, a wall clock, and a
// memory ceiling that the OPERATOR declares on the PARENT's ground, live, as data.
//
// What these rails assert at BOTH levels: the delta level is the operator-authored declaration at
// `loam:envelope` (well-formedness at the door, lawful voice, live re-resolution, forward tolerance);
// the object level is what a caller actually experiences when the pool's slots are gone — a clean
// refusal that leaks nothing, and a report the operator can read naming WHICH pool hit WHICH limit.
//
// What they deliberately do NOT assert: that the primary keeps answering under quarantine load. That
// is the isolation rail, and it lives in quarantine-envelope-isolation.test.ts.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { containerClaims } from "../../src/gateway/container.js";
import {
  CTX_ENVELOPE,
  DEFAULT_QUARANTINE_ENVELOPE,
  ENVELOPE_ANY,
  ENVELOPE_ENTITY,
  envelopeClaims,
  envelopeDefect,
  readEnvelopePolicy,
  workerLimitsOf,
} from "../../src/gateway/envelope.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, SURVEYOR, SURVEYOR_SEED, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const OK = "export default (n) => `<p>height: ${n.view.height}</p>`;";
// Occupies its slot for the pool's whole wall clock, then is terminated. The §23.9 idiom.
const HANG = "export default () => { while (true) {} };";

// A primary with two published renderers and a public door, ready to be shadowed by pools. Its own
// render clock is left generous so a rail never races the PRIMARY's timer while measuring a POOL's.
async function primary(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    { renderTimeoutMs: 5000 },
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
  await gw.publishRenderer({ route: "hang", schema: "Plant", consumes: ["height"], bundle: HANG });
  await gw.declarePublic(["Plant"]);
  return gw;
}

const declare = (
  gw: Gateway,
  subject: string,
  limits: Readonly<Record<string, number>>,
  ts = Date.now(),
): Promise<unknown> => gw.append([signClaims(envelopeClaims(subject, limits, OP, ts), OP_SEED)]);

// One strike, the shape every reader in this repo suppresses on: a lone `negates` pointer, no
// entity and no context — which is exactly why a per-entity candidate filter can never find it.
const strikeOf = (target: string, ts: number): Claims => ({
  timestamp: ts,
  author: OP,
  pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: target } } }],
});

const serve = (gw: Gateway, route: string): Promise<{ status: number; body: string }> =>
  gw.serveRoute(route, FERN, "full");

describe("T34: the floor a pool starts from", () => {
  it("the built-in envelope is TIGHTER than §23.9's anonymous render fan, and it is named", () => {
    // Pinned by value, not read symbolically, because the floor is a promise: an unconfigured store
    // must be no more permissive for a quarantine than for its own anonymous door (default 16).
    expect(DEFAULT_QUARANTINE_ENVELOPE).toEqual({
      maxConcurrentRenders: 4,
      renderTimeoutMs: 500,
      maxMemoryMb: 128,
    });
    // `maxMemoryMb` is the WHOLE heap, so the generations SPLIT it. V8 sizes old and young
    // independently and a worker may hold both at once — giving each the declared number would
    // permit twice what the report prints, which is a ceiling that does not bound what it names.
    // The sum is the declaration, exactly, at every size.
    for (const maxMemoryMb of [1, 4, 16, 32, 128, 4096]) {
      const { maxOldMb, maxYoungMb } = workerLimitsOf({
        ...DEFAULT_QUARANTINE_ENVELOPE,
        maxMemoryMb,
      });
      expect(maxYoungMb).toBeGreaterThanOrEqual(1); // a 1MB pool still starts a worker
      expect(maxYoungMb).toBeLessThanOrEqual(32); // never a scavenger bigger than §23.9's constant
      expect(maxOldMb + maxYoungMb).toBe(Math.max(maxMemoryMb, 2));
    }
    expect(workerLimitsOf({ ...DEFAULT_QUARANTINE_ENVELOPE, maxMemoryMb: 16 })).toEqual({
      maxOldMb: 12,
      maxYoungMb: 4,
    });
    // The floor is now strictly tighter than §23.9's own worker (128 + 32 = 160), on memory too —
    // not merely equal to it, which is what the old un-split reading made it.
    expect(workerLimitsOf(DEFAULT_QUARANTINE_ENVELOPE)).toEqual({ maxOldMb: 96, maxYoungMb: 32 });
  });

  it("an anonymous pool has a HANDLE for the report and no subject a declaration could name", async () => {
    const gw = await primary();
    const first = await gw.openQuarantine();
    const second = await gw.openQuarantine();
    const rows = gw.envelopeReports();
    expect(rows.map((r) => r.pool)).toEqual(["anonymous#1", "anonymous#2"]);
    // The handle is NOT a subject. Printing it where a subject goes would invite a declaration the
    // door accepts and the resolver ignores — a success returned over a no-op.
    expect(rows.every((r) => r.container === undefined)).toBe(true);
    await gw.append([
      signClaims(envelopeClaims("anonymous#1", { maxConcurrentRenders: 32 }, OP, 9800), OP_SEED),
    ]);
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(
      DEFAULT_QUARANTINE_ENVELOPE.maxConcurrentRenders,
    );
    await first.drop();
    await second.drop();
    await gw.close();
  }, 20000);

  it("a NESTED pool is reported, and its opener cannot hand it more than it holds", async () => {
    // A pool may open a pool, and the inner one resolves against the OUTER one's ground — which is
    // untrusted. Two things must hold: the operator can still see the nested bill (erasure reach is
    // recursive, and a depth-1 report would hide a whole pool's spending), and the outer pool cannot
    // widen. Here the outer holds 1 slot and its own ground says 8; the inner still gets 1.
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 9900);
    const outer = await gw.openQuarantine();
    await declare(
      outer.gateway,
      ENVELOPE_ANY,
      { maxConcurrentRenders: 8, renderTimeoutMs: 3000 },
      9950,
    );
    const inner = await outer.gateway.openQuarantine();

    const rows = gw.envelopeReports();
    expect(rows.map((r) => r.pool)).toEqual(["anonymous#1", "anonymous#1/anonymous#1"]);
    expect(rows[1]!.envelope.maxConcurrentRenders).toBe(1); // clamped by the opener, not 8
    expect(rows[1]!.envelope.renderTimeoutMs).toBe(3000);

    const both = await Promise.all([serve(inner.gateway, "ok"), serve(inner.gateway, "ok")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 503]);
    expect(gw.envelopeReports()[1]!.refusedForSlots).toBe(1);

    await inner.drop();
    await outer.drop();
    await gw.close();
  }, 30000);

  it("a bundle that returns something other than HTML is COUNTED, not silently idle", async () => {
    const gw = await primary();
    await gw.publishRenderer({
      route: "notHtml",
      schema: "Plant",
      consumes: ["height"],
      bundle: "export default () => ({ not: 'html' });",
    });
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 2, renderTimeoutMs: 3000 });
    const pool = await gw.openQuarantine();
    expect((await serve(pool.gateway, "notHtml")).status).toBe(500);
    const row = gw.envelopeReports()[0]!;
    // A pool whose every render fails must not read like a pool that served everything cleanly.
    expect([row.malformed, row.timedOut, row.faulted, row.refusedForSlots]).toEqual([1, 0, 0, 0]);
    await pool.drop();
    await gw.close();
  }, 20000);
});

describe("T34 delta level: the envelope is one operator-authored declaration, read live", () => {
  it("a declared slot cap of 1 refuses the second CONCURRENT pool render", async () => {
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 700 });
    const pool = await gw.openQuarantine();

    // Delta level: the operator's declaration is what the pool resolves, read from the parent's ground.
    expect(readEnvelopePolicy(gw.reactor, OP).get(ENVELOPE_ANY)?.maxConcurrentRenders).toBe(1);
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(1);
    // Object level: what a caller meets when the slots are gone.
    const [a, b] = await Promise.all([serve(pool.gateway, "hang"), serve(pool.gateway, "hang")]);
    expect([a.status, b.status].sort()).toEqual([500, 503]); // one ran to its clock, one was refused

    await pool.drop();
    await gw.close();
  }, 20000);

  it("raising the declaration to 3 is a DELTA, not a restart: the same pool then serves 3", async () => {
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 1_000_000);
    const pool = await gw.openQuarantine();
    const before = await Promise.all([serve(pool.gateway, "ok"), serve(pool.gateway, "ok")]);
    expect(before.map((r) => r.status).sort()).toEqual([200, 503]);

    // The pool is NOT reopened. One appended delta, and the same live handle widens.
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 3, renderTimeoutMs: 3000 }, 2_000_000);
    const after = await Promise.all([
      serve(pool.gateway, "ok"),
      serve(pool.gateway, "ok"),
      serve(pool.gateway, "ok"),
    ]);
    expect(after.map((r) => r.status)).toEqual([200, 200, 200]);

    await pool.drop();
    await gw.close();
  }, 20000);

  it("a pool with NO declaration is BOUNDED by the built-in default, not unmetered", async () => {
    // The one place this shape diverges from budget.ts on purpose: an author with no declaration is
    // unmetered because they are the operator's own grantee; an unmetered QUARANTINE is exactly the
    // unbounded bill §24.5 exists to close. Without this rail the whole feature could be deleted and
    // a declaration-only suite would stay green.
    const gw = await primary();
    const cap = DEFAULT_QUARANTINE_ENVELOPE.maxConcurrentRenders;
    const pool = await gw.openQuarantine();

    const results = await Promise.all(
      Array.from({ length: cap + 1 }, () => serve(pool.gateway, "hang")),
    );
    expect(results.filter((r) => r.status === 503)).toHaveLength(1);
    expect(results.filter((r) => r.status === 500)).toHaveLength(cap);

    await pool.drop();
    await gw.close();
  }, 30000);

  it("a declaration INSIDE the pool cannot raise the pool's own ceiling", async () => {
    // The undelegatable half, asserted. A child may admit deltas its parent does not trust — so if
    // the ceiling were read from the child's ground, the child could admit its own raise.
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 1_000_000);
    const pool = await gw.openQuarantine();

    // Lawful, well-formed, operator-signed — and landed on the POOL's ground, where it binds nothing.
    await declare(pool.gateway, ENVELOPE_ANY, { maxConcurrentRenders: 32 }, 3_000_000);
    expect(readEnvelopePolicy(pool.gateway.reactor, OP).get(ENVELOPE_ANY)).toEqual({
      maxConcurrentRenders: 32, // the pool's OWN ground really does say 32…
    });

    const both = await Promise.all([serve(pool.gateway, "ok"), serve(pool.gateway, "ok")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 503]); // still the PARENT's number

    await pool.drop();
    await gw.close();
  }, 20000);

  it("a completed pool render RELEASES its slot", async () => {
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 });
    const pool = await gw.openQuarantine();
    for (let i = 0; i < 3; i += 1) {
      expect((await serve(pool.gateway, "ok")).status).toBe(200);
    }
    await pool.drop();
    await gw.close();
  }, 20000);

  it("the pool renders on ITS OWN wall clock, not the primary's", async () => {
    // A LOWER bound, deliberately: the pool's hanging render must still be running well past the
    // primary's 500ms default clock, which is the only way to see that the pool's own number is the
    // one in force. Asserting a tight upper bound here would be measuring the scheduler.
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 2, renderTimeoutMs: 1500 });
    const pool = await gw.openQuarantine();

    const started = Date.now();
    const r = await serve(pool.gateway, "hang");
    const elapsed = Date.now() - started;
    expect(r.status).toBe(500);
    expect(elapsed).toBeGreaterThan(1200);

    await pool.drop();
    await gw.close();
  }, 20000);

  it("only the OPERATOR's voice sets an envelope — the same content, two authors", async () => {
    // A PAIR, deliberately: the non-operator half alone would pass with the lawful filter deleted,
    // because the built-in default also fails to move the ceiling.
    const same = { maxConcurrentRenders: 32 } as const;

    const mine = await primary();
    await mine.append([signClaims(envelopeClaims(ENVELOPE_ANY, same, OP, 9002), OP_SEED)]);
    const minePool = await mine.openQuarantine();
    expect(mine.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(32);
    await minePool.drop();
    await mine.close();

    const theirs = await primary();
    await theirs.append([
      signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OP, 9001), OP_SEED),
    ]);
    // The surveyor holds write standing, so the declaration LANDS as data — and binds nothing.
    await theirs.append([
      signClaims(envelopeClaims(ENVELOPE_ANY, same, SURVEYOR, 9002), SURVEYOR_SEED),
    ]);
    const theirPool = await theirs.openQuarantine();
    expect(theirs.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(
      DEFAULT_QUARANTINE_ENVELOPE.maxConcurrentRenders,
    );
    await theirPool.drop();
    await theirs.close();
  }, 30000);

  it("a per-pool declaration beats the wildcard, dimension by dimension", async () => {
    const gw = await primary();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "loam:pool:north", trust: "untrusted", posture: "separate" },
          OP,
          9100,
        ),
        OP_SEED,
      ),
    ]);
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 7, renderTimeoutMs: 900 }, 9200);
    // Names ONLY the slot count. The wildcard's clock must survive it, not reset to the built-in.
    await declare(gw, "loam:pool:north", { maxConcurrentRenders: 1 }, 9300);

    const north = await gw.openContainer({ name: "loam:pool:north" });
    const anon = await gw.openQuarantine();
    const rows = gw.envelopeReports();
    const northRow = rows.find((r) => r.pool === "loam:pool:north")!;
    expect(northRow.envelope.maxConcurrentRenders).toBe(1); // the per-pool subject wins…
    expect(northRow.envelope.renderTimeoutMs).toBe(900); // …dimension by dimension
    expect(northRow.envelope.renderTimeoutMs).not.toBe(DEFAULT_QUARANTINE_ENVELOPE.renderTimeoutMs);
    expect(rows.find((r) => r !== northRow)!.envelope.maxConcurrentRenders).toBe(7);

    await north.drop();
    await anon.drop();
    await gw.close();
  }, 20000);

  it("an UNRECOGNIZED dimension is tolerated and leaves the recognized ones in force", async () => {
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 2, maxSockets: 9 });
    const pool = await gw.openQuarantine();
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(2);
    await pool.drop();
    await gw.close();
  }, 20000);

  it("a malformed envelope declaration is refused at the APPEND door, by name", async () => {
    const gw = await primary();
    const declares = {
      role: "declares",
      target: { kind: "entity" as const, entity: { id: ENVELOPE_ENTITY, context: CTX_ENVELOPE } },
    };
    const noSubject: Claims = { timestamp: 9001, author: OP, pointers: [declares] };
    await expect(gw.append([signClaims(noSubject, OP_SEED)])).rejects.toThrow(/subject/i);

    const zeroSlots = envelopeClaims(ENVELOPE_ANY, { maxConcurrentRenders: 0 }, OP, 9002);
    await expect(gw.append([signClaims(zeroSlots, OP_SEED)])).rejects.toThrow(
      /maxConcurrentRenders/,
    );

    // Well-formed lands; non-declarations are left entirely alone.
    await expect(
      declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 2 }, 9003),
    ).resolves.toBeTruthy();
    expect(envelopeDefect(observed(FERN, "height", 1, 1, OP_SEED).claims)).toBeUndefined();
    expect(envelopeDefect(envelopeClaims(ENVELOPE_ANY, { maxConcurrentRenders: 2 }, OP, 1))).toBe(
      undefined,
    );
    await gw.close();
  }, 20000);

  it("a DUPLICATED dimension is refused by the reader too, not resolved by pointer order", async () => {
    // The door refuses a declaration that names one dimension twice. `federate` never asks the door,
    // and it is the path a foreign store's bytes arrive on — so the reader re-checks, exactly as it
    // already re-checks the subject. Reading the LAST pointer would let the ORDER of a delta's
    // pointers pick the ceiling, and last-wins is the widening direction.
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 9100);
    const twice: Claims = {
      timestamp: 9200, // later than the honest one, so a reader that accepted it would supersede
      author: OP,
      pointers: [
        {
          role: "declares",
          target: { kind: "entity", entity: { id: ENVELOPE_ENTITY, context: CTX_ENVELOPE } },
        },
        { role: "subject", target: { kind: "primitive", value: ENVELOPE_ANY } },
        { role: "renderTimeoutMs", target: { kind: "primitive", value: 3000 } },
        { role: "maxConcurrentRenders", target: { kind: "primitive", value: 1 } },
        { role: "maxConcurrentRenders", target: { kind: "primitive", value: 64 } },
      ],
    };
    const signed = signClaims(twice, OP_SEED);
    expect(envelopeDefect(twice)).toMatch(/at most one maxConcurrentRenders/);
    await expect(gw.append([signed])).rejects.toThrow(/at most one maxConcurrentRenders/);
    // In through the door-less path. It lands as bytes; it must bind nothing.
    await gw.federate([signed], { admit: () => true });
    expect(gw.reactor.get(signed.id)).toBeDefined();

    // Delta level: the reader drops the whole declaration, so the honest earlier one still governs.
    expect(readEnvelopePolicy(gw.reactor, OP).get(ENVELOPE_ANY)?.maxConcurrentRenders).toBe(1);
    // Object level: the pool meters at 1, not at the duplicate's 64.
    const pool = await gw.openQuarantine();
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(1);
    const both = await Promise.all([serve(pool.gateway, "ok"), serve(pool.gateway, "ok")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 503]);

    await pool.drop();
    await gw.close();
  }, 20000);
});

describe("T34 object level: what a caller meets, and what the operator can read", () => {
  it("the busy refusal leaks nothing about the route, the lens, or the entity", async () => {
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 700 });
    const pool = await gw.openQuarantine();
    const [a, b] = await Promise.all([serve(pool.gateway, "hang"), serve(pool.gateway, "hang")]);
    const busy = [a, b].find((r) => r.status === 503)!;
    expect(busy.body).not.toMatch(/hang|Plant|fern|bundle|worker|export/i);
    await pool.drop();
    await gw.close();
  }, 20000);

  it("exhaustion is ATTRIBUTABLE: the report names which pool hit which limit", async () => {
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 700 });
    const busyPool = await gw.openQuarantine();
    const quietPool = await gw.openQuarantine();

    await Promise.all([serve(busyPool.gateway, "hang"), serve(busyPool.gateway, "hang")]);

    const rows = gw.envelopeReports();
    expect(rows).toHaveLength(2);
    const [busy, quiet] = [rows[0]!, rows[1]!];
    expect(busy.refusedForSlots).toBe(1);
    expect(busy.timedOut).toBe(1);
    expect(busy.envelope.maxConcurrentRenders).toBe(1);
    // The second pool is the mis-attribution rail: a shared counter would light this row up too.
    expect(quiet.refusedForSlots).toBe(0);
    expect(quiet.timedOut).toBe(0);
    expect(busy.pool).not.toBe(quiet.pool);

    await busyPool.drop();
    await quietPool.drop();
    await gw.close();
  }, 30000);

  it("closing a pool releases its envelope — the row goes, and the SAME pool reopens at zero", async () => {
    // Reattached under the SAME declared entity on purpose: a fresh anonymous pool would get a fresh
    // handle, so its zeroes would prove nothing about an implementation that kept counters in a
    // registry keyed by name. This one goes red against that. detach() is the reattachable close
    // (drop() strikes the declaration, so a dropped name cannot be reopened at all — which is the
    // stronger release, asserted at the end).
    const gw = await primary();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "loam:pool:again", trust: "untrusted", posture: "separate" },
          OP,
          9600,
        ),
        OP_SEED,
      ),
    ]);
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 2, renderTimeoutMs: 900 }, 9700);
    const pool = await gw.openContainer({ name: "loam:pool:again" });

    const inFlight = serve(pool.gateway!, "hang");
    await new Promise((r) => setTimeout(r, 250));
    expect(gw.envelopeReports()[0]!.inFlight).toBe(1); // the accounting is live, not a post-hoc tally
    await inFlight;
    expect(gw.envelopeReports()[0]!.timedOut).toBe(1);

    await pool.detach();
    expect(gw.envelopeReports()).toHaveLength(0);

    const again = await gw.openContainer({ name: "loam:pool:again" });
    const row = gw.envelopeReports()[0]!;
    expect(row.pool).toBe("loam:pool:again");
    expect([row.inFlight, row.timedOut, row.refusedForSlots, row.faulted, row.malformed]).toEqual([
      0, 0, 0, 0, 0,
    ]);
    await again.drop();
    expect(gw.envelopeReports()).toHaveLength(0);
    await gw.close();
  }, 30000);
});

describe("T34 scope: the envelope meters the child that admits what its parent does not trust", () => {
  it("a CURATED separate container is not enveloped — it keeps the primary's ordinary budgets", async () => {
    // Named rather than implied. `quarantinePools` is a bare Set<Gateway> and holds every separate
    // container; enveloping all of them would silently cap the operator's own curated container.
    const gw = await primary();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "loam:pool:curated", trust: "curated", posture: "separate" },
          OP,
          9400,
        ),
        OP_SEED,
      ),
    ]);
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 9500);
    const curated = await gw.openContainer({ name: "loam:pool:curated" });
    const quarantined = await gw.openQuarantine();

    expect(gw.envelopeReports().map((r) => r.pool)).not.toContain("loam:pool:curated");
    // The cap that bites the quarantine does not bite the curated container.
    const cur = await Promise.all([serve(curated.gateway!, "ok"), serve(curated.gateway!, "ok")]);
    expect(cur.map((r) => r.status)).toEqual([200, 200]);
    const quar = await Promise.all([
      serve(quarantined.gateway, "ok"),
      serve(quarantined.gateway, "ok"),
    ]);
    expect(quar.map((r) => r.status).sort()).toEqual([200, 503]);

    await curated.drop();
    await quarantined.drop();
    await gw.close();
  }, 30000);
});

describe("T34 suppression: a struck declaration stops binding, at both levels", () => {
  it("striking a per-pool declaration reverts that pool to the WILDCARD, not to the floor", async () => {
    const gw = await primary();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "loam:pool:struck", trust: "untrusted", posture: "separate" },
          OP,
          9100,
        ),
        OP_SEED,
      ),
    ]);
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 3, renderTimeoutMs: 3000 }, 9200);
    const tightening = signClaims(
      envelopeClaims("loam:pool:struck", { maxConcurrentRenders: 1 }, OP, 9300),
      OP_SEED,
    );
    await gw.append([tightening]);
    const pool = await gw.openContainer({ name: "loam:pool:struck" });
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(1);
    const before = await Promise.all([serve(pool.gateway!, "ok"), serve(pool.gateway!, "ok")]);
    expect(before.map((r) => r.status).sort()).toEqual([200, 503]);

    // A GRANTED author's strike first. Only the strike widens, so this direction needs its own pair:
    // without it the lawful-voice filter on the negation could be deleted and this rail stay green.
    await gw.append([signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OP, 9250), OP_SEED)]);
    await gw.append([
      signClaims(
        { ...strikeOf(tightening.id, gw.nextTimestamp()), author: SURVEYOR },
        SURVEYOR_SEED,
      ),
    ]);
    expect(readEnvelopePolicy(gw.reactor, OP).get("loam:pool:struck")).toEqual({
      maxConcurrentRenders: 1, // a stranger's strike retires nothing the operator planted
    });
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(1);

    // Now the operator's. Delta level first, then what a caller meets.
    await gw.append([signClaims(strikeOf(tightening.id, gw.nextTimestamp()), OP_SEED)]);
    expect(readEnvelopePolicy(gw.reactor, OP).has("loam:pool:struck")).toBe(false);
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(3);
    const after = await Promise.all([
      serve(pool.gateway!, "ok"),
      serve(pool.gateway!, "ok"),
      serve(pool.gateway!, "ok"),
    ]);
    expect(after.map((r) => r.status)).toEqual([200, 200, 200]);

    await pool.drop();
    await gw.close();
  }, 30000);

  it("striking the WILDCARD too lands the pool on the floor", async () => {
    const gw = await primary();
    const wide = signClaims(
      envelopeClaims(ENVELOPE_ANY, { maxConcurrentRenders: 9 }, OP, 9400),
      OP_SEED,
    );
    await gw.append([wide]);
    const pool = await gw.openQuarantine();
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(9);

    await gw.append([signClaims(strikeOf(wide.id, gw.nextTimestamp()), OP_SEED)]);
    expect(readEnvelopePolicy(gw.reactor, OP).size).toBe(0);
    expect(gw.envelopeReports()[0]!.envelope).toEqual(DEFAULT_QUARANTINE_ENVELOPE);

    await pool.drop();
    await gw.close();
  }, 20000);

  it("a per-pool declaration this store can read NOTHING from lands on the floor, never the wildcard", async () => {
    // A ceiling nobody can read takes the tightest reading. Falling through to a permissive wildcard
    // would answer an operator's unreadable TIGHTENING with a widening.
    const gw = await primary();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "loam:pool:future", trust: "untrusted", posture: "separate" },
          OP,
          9500,
        ),
        OP_SEED,
      ),
    ]);
    // The wildcard is LOOSER on slots and TIGHTER on the clock, so "fall to the floor" and "take the
    // tighter of floor and wildcard" give different answers and the rail can tell them apart.
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 9, renderTimeoutMs: 120 }, 9600);
    await declare(gw, "loam:pool:future", { maxSockets: 4 }, 9700);
    const pool = await gw.openContainer({ name: "loam:pool:future" });
    expect(gw.envelopeReports()[0]!.envelope).toEqual({
      maxConcurrentRenders: DEFAULT_QUARANTINE_ENVELOPE.maxConcurrentRenders, // the floor, not 9
      renderTimeoutMs: 120, // the operator's TIGHTER clock, not the floor's 500
      maxMemoryMb: DEFAULT_QUARANTINE_ENVELOPE.maxMemoryMb,
    });
    await pool.drop();
    await gw.close();
  }, 20000);

  it("a pool under a CURATED container is clamped by the operator's LIVE ground, and named", async () => {
    // The curated container's ground is a one-way seeded copy: a strike landed on the parent after
    // seeding never crosses. A pool nested inside must therefore be bounded by what the operator's
    // ground says NOW, not by the copy it sits on — and it must still be attributable in the report.
    const gw = await primary();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "loam:pool:middle", trust: "curated", posture: "separate" },
          OP,
          9800,
        ),
        OP_SEED,
      ),
    ]);
    const wide = signClaims(
      envelopeClaims(ENVELOPE_ANY, { maxConcurrentRenders: 9, renderTimeoutMs: 3000 }, OP, 9900),
      OP_SEED,
    );
    await gw.append([wide]);
    // The container has a subject of its OWN, and a generous one. Without it the opener's ceiling
    // would resolve the very declaration under test, both inputs to the clamp would be the same
    // struck delta, and the rail would pass on a coincidence rather than on the closure.
    await declare(gw, "loam:pool:middle", { maxConcurrentRenders: 9, renderTimeoutMs: 3000 }, 9910);
    const middle = await gw.openContainer({ name: "loam:pool:middle" });
    // Struck AFTER the seeding: the copy inside `middle` still carries the wide declaration.
    await gw.append([signClaims(strikeOf(wide.id, gw.nextTimestamp()), OP_SEED)]);
    expect(readEnvelopePolicy(middle.gateway!.reactor, OP).get(ENVELOPE_ANY)).toEqual({
      maxConcurrentRenders: 9,
      renderTimeoutMs: 3000,
    });

    const inner = await middle.gateway!.openQuarantine();
    const rows = gw.envelopeReports();
    expect(rows.map((r) => r.pool)).toEqual(["loam:pool:middle/anonymous#1"]);
    expect(rows[0]!.envelope.maxConcurrentRenders).toBe(
      DEFAULT_QUARANTINE_ENVELOPE.maxConcurrentRenders,
    );
    // Object level: the caller meets the floor too, so the report and the gate cannot disagree.
    const served = await Promise.all(
      Array.from({ length: DEFAULT_QUARANTINE_ENVELOPE.maxConcurrentRenders + 1 }, () =>
        serve(inner.gateway, "hang"),
      ),
    );
    expect(served.filter((r) => r.status === 503)).toHaveLength(1);

    await inner.drop();
    await middle.drop();
    await gw.close();
  }, 30000);
});

describe("T34 reach: metering rides DOWN, whatever the child declares", () => {
  it("a CURATED container opened INSIDE a pool is metered — trust decides only at the top", async () => {
    // A curated container on the PRIMARY keeps the store's ordinary budgets (asserted above). One
    // opened inside a pool is a different creature: its `trust` knob is read from the pool's seeded
    // copy of the container table, where a strike on the parent never lands. Letting that knob decide
    // metering would let a metered pool host an unmetered child at the operator's expense.
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 9990);
    const pool = await gw.openQuarantine();
    await pool.gateway.append([
      signClaims(
        containerClaims(
          { container: "loam:pool:inner", trust: "curated", posture: "separate" },
          OP,
          9991,
        ),
        OP_SEED,
      ),
    ]);
    const inner = await pool.gateway.openContainer({ name: "loam:pool:inner" });

    const rows = gw.envelopeReports();
    expect(rows.map((r) => r.pool)).toEqual(["anonymous#1", "anonymous#1/loam:pool:inner"]);
    expect(rows[1]!.envelope.maxConcurrentRenders).toBe(1);
    const both = await Promise.all([serve(inner.gateway!, "ok"), serve(inner.gateway!, "ok")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 503]);

    await inner.drop();
    await pool.drop();
    await gw.close();
  }, 30000);

  it("a descendant with a GENEROUS subject of its own is still clamped to its opener's slots", async () => {
    // THE RAIL THAT ISOLATES THE CLAMP. Every other nested fixture in this file gives the inner pool
    // an anonymous handle, so its own ceiling resolves through the wildcard to the same number the
    // clamp would produce — root-ground resolution and the clamp are two independent mechanisms and
    // those fixtures make them coincide. Delete the clamp and they all stay green.
    //
    // Here the two mechanisms DISAGREE by 63 slots. The operator's wildcard is 1, and the operator
    // also wrote a per-pool declaration of 64 for a container named `loam:pool:big`. An anonymous
    // pool (ceiling 1) then opens a container by that name, so its OWN envelope resolves to 64 — from
    // the root's ground, and from the pool's seeded copy of it, which is why neither wrong path can
    // masquerade as the right one. Only the clamp brings it back to 1.
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 9970);
    await declare(gw, "loam:pool:big", { maxConcurrentRenders: 64, renderTimeoutMs: 3000 }, 9971);
    // The generous subject is real and readable: without this the rail could pass because the
    // declaration never bound, rather than because the clamp caught it.
    expect(readEnvelopePolicy(gw.reactor, OP).get("loam:pool:big")?.maxConcurrentRenders).toBe(64);

    const pool = await gw.openQuarantine();
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(1);
    await pool.gateway.append([
      signClaims(
        containerClaims(
          { container: "loam:pool:big", trust: "untrusted", posture: "separate" },
          OP,
          9972,
        ),
        OP_SEED,
      ),
    ]);
    const inner = await pool.gateway.openContainer({ name: "loam:pool:big" });

    // Report level: the operator reads 1, not the 64 the inner pool's own subject grants.
    const rows = gw.envelopeReports();
    expect(rows.map((r) => r.pool)).toEqual(["anonymous#1", "anonymous#1/loam:pool:big"]);
    expect(rows[1]!.envelope.maxConcurrentRenders).toBe(1);
    // Gate level, asserted with the report because a clamp that printed 1 and admitted 64 would be
    // the same defect wearing an honest report. Two concurrent renders, one slot: one is refused.
    const both = await Promise.all([serve(inner.gateway!, "ok"), serve(inner.gateway!, "ok")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 503]);
    expect(gw.envelopeReports()[1]!.refusedForSlots).toBe(1);

    await inner.drop();
    await pool.drop();
    await gw.close();
  }, 30000);
});
