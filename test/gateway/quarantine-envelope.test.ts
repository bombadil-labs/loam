import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { containerClaims } from "../../src/gateway/container-law.js";
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
import type { Stamp } from "../../src/gateway/stamp.js";
import { FERN, SURVEYOR, SURVEYOR_SEED, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const OK = "export default (n) => `<p>height: ${n.view.height}</p>`;";
const HANG = "export default () => { while (true) {} };";

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
): Promise<unknown> =>
  gw.append([gw.signer!.sign(envelopeClaims(subject, limits, gw.operatorAuthor!, ts))]);

const strikeOf = (target: string, at: Stamp): Claims => ({
  ...at,
  author: OP,
  pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: target } } }],
});

const serve = (gw: Gateway, route: string): Promise<{ status: number; body: string }> =>
  gw.serveRoute(route, FERN, "full");

describe("T34: the floor a pool starts from", () => {
  it("the built-in envelope is TIGHTER than §23.9's anonymous render fan, and it is named", () => {
    expect(DEFAULT_QUARANTINE_ENVELOPE).toEqual({
      maxConcurrentRenders: 4,
      renderTimeoutMs: 500,
      maxMemoryMb: 128,
    });
    for (const maxMemoryMb of [1, 4, 16, 32, 128, 4096]) {
      const { maxOldMb, maxYoungMb } = workerLimitsOf({
        ...DEFAULT_QUARANTINE_ENVELOPE,
        maxMemoryMb,
      });
      expect(maxYoungMb).toBeGreaterThanOrEqual(1);
      expect(maxYoungMb).toBeLessThanOrEqual(32);
      expect(maxOldMb + maxYoungMb).toBe(Math.max(maxMemoryMb, 2));
    }
    expect(workerLimitsOf({ ...DEFAULT_QUARANTINE_ENVELOPE, maxMemoryMb: 16 })).toEqual({
      maxOldMb: 12,
      maxYoungMb: 4,
    });
    expect(workerLimitsOf(DEFAULT_QUARANTINE_ENVELOPE)).toEqual({ maxOldMb: 96, maxYoungMb: 32 });
  });

  it("an anonymous pool has a HANDLE for the report and no subject a declaration could name", async () => {
    const gw = await primary();
    const first = await gw.openQuarantine();
    const second = await gw.openQuarantine();
    const rows = gw.envelopeReports();
    expect(rows.map((r) => r.pool)).toEqual(["anonymous#1", "anonymous#2"]);
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
    expect(rows[1]!.envelope.maxConcurrentRenders).toBe(1);
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

    expect(
      readEnvelopePolicy(gw.reactor, gw.validityNow(), OP).get(ENVELOPE_ANY)?.maxConcurrentRenders,
    ).toBe(1);
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(1);
    const [a, b] = await Promise.all([serve(pool.gateway, "hang"), serve(pool.gateway, "hang")]);
    expect([a.status, b.status].sort()).toEqual([500, 503]);

    await pool.drop();
    await gw.close();
  }, 20000);

  it("raising the declaration to 3 is a DELTA, not a restart: the same pool then serves 3", async () => {
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 1_000_000);
    const pool = await gw.openQuarantine();
    const before = await Promise.all([serve(pool.gateway, "ok"), serve(pool.gateway, "ok")]);
    expect(before.map((r) => r.status).sort()).toEqual([200, 503]);

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
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 1_000_000);
    const pool = await gw.openQuarantine();

    await declare(pool.gateway, ENVELOPE_ANY, { maxConcurrentRenders: 32 }, 3_000_000);
    expect(
      readEnvelopePolicy(
        pool.gateway.reactor,
        pool.gateway.validityNow(),
        pool.gateway.operatorAuthor,
      ).get(ENVELOPE_ANY),
    ).toEqual({
      maxConcurrentRenders: 32,
    });

    const both = await Promise.all([serve(pool.gateway, "ok"), serve(pool.gateway, "ok")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 503]);

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
    await declare(gw, "loam:pool:north", { maxConcurrentRenders: 1 }, 9300);

    const north = await gw.openContainer({ name: "loam:pool:north" });
    const anon = await gw.openQuarantine();
    const rows = gw.envelopeReports();
    const northRow = rows.find((r) => r.pool === "loam:pool:north")!;
    expect(northRow.envelope.maxConcurrentRenders).toBe(1);
    expect(northRow.envelope.renderTimeoutMs).toBe(900);
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
    const noSubject: Claims = {
      timestamp: 9001,
      validFrom: 9001,
      author: OP,
      pointers: [declares],
    };
    await expect(gw.append([signClaims(noSubject, OP_SEED)])).rejects.toThrow(/subject/i);

    const zeroSlots = envelopeClaims(ENVELOPE_ANY, { maxConcurrentRenders: 0 }, OP, 9002);
    await expect(gw.append([signClaims(zeroSlots, OP_SEED)])).rejects.toThrow(
      /maxConcurrentRenders/,
    );

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
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 9100);
    const twice: Claims = {
      timestamp: 9200,
      validFrom: 9200,
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
    await gw.federate([signed], { admit: () => true });
    expect(gw.reactor.get(signed.id)).toBeDefined();

    expect(
      readEnvelopePolicy(gw.reactor, gw.validityNow(), OP).get(ENVELOPE_ANY)?.maxConcurrentRenders,
    ).toBe(1);
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
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 });
    const busyPool = await gw.openQuarantine();
    const quietPool = await gw.openQuarantine();

    await Promise.all([serve(busyPool.gateway, "hang"), serve(busyPool.gateway, "hang")]);

    const rows = gw.envelopeReports();
    expect(rows).toHaveLength(2);
    const [busy, quiet] = [rows[0]!, rows[1]!];
    expect(busy.refusedForSlots).toBe(1);
    expect(busy.timedOut).toBe(1);
    expect(busy.envelope.maxConcurrentRenders).toBe(1);
    expect(quiet.refusedForSlots).toBe(0);
    expect(quiet.timedOut).toBe(0);
    expect(busy.pool).not.toBe(quiet.pool);

    await busyPool.drop();
    await quietPool.drop();
    await gw.close();
  }, 30000);

  it("closing a pool releases its envelope — the row goes, and the SAME pool reopens at zero", async () => {
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
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 2, renderTimeoutMs: 3000 }, 9700);
    const pool = await gw.openContainer({ name: "loam:pool:again" });

    const inFlight = serve(pool.gateway!, "hang");
    await new Promise((r) => setTimeout(r, 250));
    expect(gw.envelopeReports()[0]!.inFlight).toBe(1);
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

    await gw.append([signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OP, 9250), OP_SEED)]);
    await gw.append([
      signClaims(
        { ...strikeOf(tightening.id, gw.stamp(SURVEYOR)), author: SURVEYOR },
        SURVEYOR_SEED,
      ),
    ]);
    expect(readEnvelopePolicy(gw.reactor, gw.validityNow(), OP).get("loam:pool:struck")).toEqual({
      maxConcurrentRenders: 1,
    });
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(1);

    await gw.append([signClaims(strikeOf(tightening.id, gw.stamp(OP)), OP_SEED)]);
    expect(readEnvelopePolicy(gw.reactor, gw.validityNow(), OP).has("loam:pool:struck")).toBe(
      false,
    );
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

    await gw.append([signClaims(strikeOf(wide.id, gw.stamp(OP)), OP_SEED)]);
    expect(readEnvelopePolicy(gw.reactor, gw.validityNow(), OP).size).toBe(0);
    expect(gw.envelopeReports()[0]!.envelope).toEqual(DEFAULT_QUARANTINE_ENVELOPE);

    await pool.drop();
    await gw.close();
  }, 20000);

  it("a per-pool declaration this store can read NOTHING from lands on the floor, never the wildcard", async () => {
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
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 9, renderTimeoutMs: 120 }, 9600);
    await declare(gw, "loam:pool:future", { maxSockets: 4 }, 9700);
    const pool = await gw.openContainer({ name: "loam:pool:future" });
    expect(gw.envelopeReports()[0]!.envelope).toEqual({
      maxConcurrentRenders: DEFAULT_QUARANTINE_ENVELOPE.maxConcurrentRenders,
      renderTimeoutMs: 120,
      maxMemoryMb: DEFAULT_QUARANTINE_ENVELOPE.maxMemoryMb,
    });
    await pool.drop();
    await gw.close();
  }, 20000);

  it("a pool under a CURATED container is clamped by the operator's LIVE ground, and named", async () => {
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
    await declare(gw, "loam:pool:middle", { maxConcurrentRenders: 9, renderTimeoutMs: 3000 }, 9910);
    const middle = await gw.openContainer({ name: "loam:pool:middle" });
    await gw.append([signClaims(strikeOf(wide.id, gw.stamp(OP)), OP_SEED)]);
    expect(
      readEnvelopePolicy(middle.gateway!.reactor, middle.gateway!.validityNow(), OP).get(
        ENVELOPE_ANY,
      ),
    ).toEqual({
      maxConcurrentRenders: 9,
      renderTimeoutMs: 3000,
    });

    const inner = await middle.gateway!.openQuarantine();
    const rows = gw.envelopeReports();
    expect(rows.map((r) => r.pool)).toEqual(["loam:pool:middle/anonymous#1"]);
    expect(rows[0]!.envelope.maxConcurrentRenders).toBe(
      DEFAULT_QUARANTINE_ENVELOPE.maxConcurrentRenders,
    );
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
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 9990);
    const pool = await gw.openQuarantine();
    await pool.gateway.append([
      pool.gateway.signer!.sign(
        containerClaims(
          { container: "loam:pool:inner", trust: "curated", posture: "separate" },
          pool.gateway.operatorAuthor!,
          9991,
        ),
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
    const gw = await primary();
    await declare(gw, ENVELOPE_ANY, { maxConcurrentRenders: 1, renderTimeoutMs: 3000 }, 9970);
    await declare(gw, "loam:pool:big", { maxConcurrentRenders: 64, renderTimeoutMs: 3000 }, 9971);
    expect(
      readEnvelopePolicy(gw.reactor, gw.validityNow(), OP).get("loam:pool:big")
        ?.maxConcurrentRenders,
    ).toBe(64);

    const pool = await gw.openQuarantine();
    expect(gw.envelopeReports()[0]!.envelope.maxConcurrentRenders).toBe(1);
    await pool.gateway.append([
      pool.gateway.signer!.sign(
        containerClaims(
          { container: "loam:pool:big", trust: "untrusted", posture: "separate" },
          pool.gateway.operatorAuthor!,
          9972,
        ),
      ),
    ]);
    const inner = await pool.gateway.openContainer({ name: "loam:pool:big" });

    const rows = gw.envelopeReports();
    expect(rows.map((r) => r.pool)).toEqual(["anonymous#1", "anonymous#1/loam:pool:big"]);
    expect(rows[1]!.envelope.maxConcurrentRenders).toBe(1);
    const both = await Promise.all([serve(inner.gateway!, "ok"), serve(inner.gateway!, "ok")]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 503]);
    expect(gw.envelopeReports()[1]!.refusedForSlots).toBe(1);

    await inner.drop();
    await pool.drop();
    await gw.close();
  }, 30000);
});
