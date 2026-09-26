// Readers that name or count a strike must count it only inside its own validity window. Each case
// holds a strike whose window starts or ends at a boundary T, and reads on both sides of T (or with
// a strike wholly outside its window beside one inside it). Each reader was a raw walk over
// `negationsOf`, which counts a strike whatever its window.
//
// Asserted at both levels where the reader has a door: what the store holds (the strike is there)
// and what a door or command answers. Named gaps:
//   - `survivingOperatorGrantIds` is asserted at the reader only. The panel that calls it needs the
//     whole connector consent flow (`test/server/admin-connections.test.ts` has that fixture); a
//     served rail there would drive `/admin/revoke-confirm` with a strike planted first.
//   - Grant survival at the door (`struck` in accounts.ts) is railed in
//     `test/refactor/grant-strike-window.test.ts`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { boundGroundFor } from "../../src/gateway/reads.js";
import { graveyardCompleteness } from "../../src/gateway/slate.js";
import type { ScryptParams } from "../../src/server/credentials.js";
import { survivingOperatorGrantIds } from "../../src/server/admin-federation.js";
import { roleClaims, rolesOf } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import {
  BEFORE_DEADLINE,
  OP as SLATE_OP,
  OP_SEED as SLATE_SEED,
  bootSlateStore,
  standSlate,
  strike as slateStrike,
} from "../gateway/slating.js";

const OP_SEED = "4d".repeat(32);
const OP = authorForSeed(OP_SEED);
const T = 3_000_000; // the boundary, in fake time

afterEach(() => {
  vi.useRealTimers();
});

/** A negation of `target` by `seed`, ordered at `ts`, valid over `window`. */
const timedStrike = (
  seed: string,
  target: string,
  ts: number,
  window: { validFrom: number; validUntil?: number },
): Delta => signClaims({ ...makeNegationClaims(authorForSeed(seed), ts, target), ...window }, seed);

// --- adopt.ts: the promotion door's two refusals ------------------------------------------------

const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const MESSAGE_SCHEMA: Schema = {
  props: new Map<string, Policy>([["message", pick]]),
  default: pick,
};

const bootPrimary = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: MESSAGE_SCHEMA, roots: [FERN], writable: ["message"] },
      ],
    }),
  );

const refusalOf = async (gw: Gateway, from: Gateway, id: string): Promise<string | undefined> => {
  try {
    await gw.promote(from, id);
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
};

/** Promote `fact`, whose author struck it over `window`, at read time `at`. */
async function promoteAt(
  window: { validFrom: number; validUntil?: number },
  at: number,
): Promise<{ refusal: string | undefined; strike: Delta; adopted: number }> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T - 100);
  const primary = await bootPrimary();
  const pool = await primary.openQuarantine();
  const fact = observed(FERN, "message", "the app said this", T - 500, GARDENER_SEED);
  const strike = timedStrike(GARDENER_SEED, fact.id, T - 400, window);
  await pool.gateway.federate([fact, strike]);
  expect(pool.gateway.reactor.get(strike.id)).toBeDefined(); // the strike is held at the source
  vi.setSystemTime(at);
  const refusal = await refusalOf(primary, pool.gateway, fact.id);
  const adopted = primary.adoptions().length;
  await pool.drop();
  await primary.close();
  return { refusal, strike, adopted };
}

describe("promotion counts the author's own retraction only inside its window", () => {
  it("a retraction valid from T does not refuse before T", async () => {
    const r = await promoteAt({ validFrom: T }, T - 1);
    expect(r.refusal).toBeUndefined();
    expect(r.adopted).toBe(1);
  });

  it("a retraction valid from T refuses at T, naming the retraction (control)", async () => {
    const r = await promoteAt({ validFrom: T }, T);
    expect(r.refusal).toContain("retracted it where it was made");
    expect(r.refusal).toContain(r.strike.id);
    expect(r.adopted).toBe(0);
  });

  it("a retraction valid until T no longer refuses at T", async () => {
    const r = await promoteAt({ validFrom: T - 400, validUntil: T }, T);
    expect(r.refusal).toBeUndefined();
    expect(r.adopted).toBe(1);
  });
});

describe("the source's data strike: the refusal names only strikes that hold now", () => {
  it("names the strike inside its window and not the one whose window ended", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const now = Date.now();
    const fact = observed(FERN, "message", "the reviewer said no", now - 5000, GARDENER_SEED);
    const expired = timedStrike(OP_SEED, fact.id, now - 4000, {
      validFrom: now - 4000,
      validUntil: now - 3000,
    });
    const holding = timedStrike(OP_SEED, fact.id, now - 2000, { validFrom: now - 2000 });
    await pool.gateway.federate([fact]);
    await pool.gateway.append([expired, holding]);
    expect(pool.gateway.reactor.negationsOf(fact.id).sort()).toEqual(
      [expired.id, holding.id].sort(),
    );

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain("the source's own reading has it negated");
    expect(refusal).toContain(holding.id);
    expect(refusal).not.toContain(expired.id);
    expect(primary.adoptions()).toHaveLength(0);
    await pool.drop();
    await primary.close();
  });
});

// --- slate.ts strikeOf: the receipt names the strike that holds ---------------------------------

describe("an erasure's negation is reported only while it holds", () => {
  it("the receipt and the completeness check name the strike inside its window", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, SLATE_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, SLATE_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const erasure = report.members[0]!.erasure;

    const holding = slateStrike(erasure, 80_000);
    // An operator strike whose window ended, chosen so its id sorts BEFORE the holding one: a reader
    // that takes the first operator strike in id order, whatever its window, names this one.
    let expired: Delta | undefined;
    for (let ts = 60_000; expired === undefined; ts += 1) {
      const candidate = signClaims(
        {
          ...makeNegationClaims(SLATE_OP, ts, erasure),
          validFrom: ts,
          validUntil: 70_000,
        } satisfies Claims,
        SLATE_SEED,
      );
      if (candidate.id < holding.id) expired = candidate;
    }
    await gw.append([expired, holding]);

    const check = graveyardCompleteness(gw.reactor, gw.validityNow(), SLATE_OP, report.graveyard);
    expect(check.negated).toEqual([{ member: member.id, negation: holding.id }]);
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE + 1 });
    expect(receipt.members[0]!.negated).toBe(holding.id);
    // Both strikes are held: the reader chose, the store did not lose one.
    expect(gw.reactor.get(expired.id)).toBeDefined();
    await gw.close();
  });
});

// --- reads.ts: a pool-scoped read honours a strike in the primary only inside its window --------

async function homeWithPool(): Promise<{
  gw: Gateway;
  pool: Gateway;
  binding: { container: string; inbox: string };
}> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 500), OP_SEED)]);
  await gw.append([
    signClaims(
      containerClaims(
        {
          container: "home:ada",
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { match: { field: "author", cmp: "eq", const: GARDENER } },
            in: "input",
          },
        },
        OP,
        600,
      ),
      OP_SEED,
    ),
  ]);
  const inbox = (
    await gw.bindConnection({
      container: "home:ada",
      connectionKey: authorForSeed("d1".repeat(32)),
      ownerSeed: GARDENER_SEED,
    })
  ).entity!;
  return {
    gw,
    pool: gw.connectionInboxes.get(inbox)!.gateway!,
    binding: { container: "home:ada", inbox },
  };
}

describe("a bound connection's ground counts the primary's strike only inside its window", () => {
  it("a strike valid from T hides a pool claim at T and not before", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T - 100);
    const { gw, pool, binding } = await homeWithPool();
    const claim = observed(FERN, "height", 12, T - 90, GARDENER_SEED);
    const bystander = observed(FERN, "tag", "shade", T - 90, GARDENER_SEED);
    await pool.append([claim, bystander]);
    await gw.append([timedStrike(OP_SEED, claim.id, T - 80, { validFrom: T })]);
    expect(gw.reactor.get(claim.id)).toBeUndefined(); // the claim lives only in the pool
    // What a bound reader resolves through the Plant Schema.
    const served = () => gw.resolvedNode("Plant", FERN, undefined, undefined, binding).view;

    vi.setSystemTime(T - 1);
    expect(boundGroundFor(gw, binding, Date.now()).has(claim.id)).toBe(true);
    expect(served()["height"]).toBe(12);

    vi.setSystemTime(T);
    const at = boundGroundFor(gw, binding, Date.now());
    expect(at.has(claim.id)).toBe(false);
    expect(at.has(bystander.id)).toBe(true);
    expect(served()["height"] ?? null).toBeNull();
    expect(served()["tag"]).toEqual(["shade"]);
    await gw.close();
  });

  it("a strike valid until T hides a pool claim before T and not at T", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T - 100);
    const { gw, pool, binding } = await homeWithPool();
    const claim = observed(FERN, "height", 12, T - 90, GARDENER_SEED);
    await pool.append([claim]);
    await gw.append([timedStrike(OP_SEED, claim.id, T - 80, { validFrom: T - 80, validUntil: T })]);

    vi.setSystemTime(T - 1);
    expect(boundGroundFor(gw, binding, Date.now()).has(claim.id)).toBe(false);
    vi.setSystemTime(T);
    expect(boundGroundFor(gw, binding, Date.now()).has(claim.id)).toBe(true);
    await gw.close();
  });
});

// --- admin-federation.ts: which grants a connector revoke strikes -------------------------------

describe("the revoke panel strikes every grant the operator's strikes do not hold down now", () => {
  const SUBJECT_SEED = "e7".repeat(32);
  const SUBJECT = authorForSeed(SUBJECT_SEED);

  async function withGrant(): Promise<{ gw: Gateway; grant: Delta; bystander: Delta }> {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
    const grant = signClaims(grantClaims(STORE_ENTITY, SUBJECT, "write", OP, 9001), OP_SEED);
    const bystander = signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9002), OP_SEED);
    await gw.append([grant, bystander]);
    return { gw, grant, bystander };
  }

  it("a strike by an author who is not the operator leaves the grant to be struck", async () => {
    const { gw, grant } = await withGrant();
    await gw.append([signClaims(makeNegationClaims(GARDENER, 9100, grant.id), GARDENER_SEED)]);
    expect(gw.reactor.negationsOf(grant.id)).toHaveLength(1);
    expect(survivingOperatorGrantIds(gw.reactor, Date.now(), OP, SUBJECT)).toEqual([grant.id]);
    expect(survivingOperatorGrantIds(gw.reactor, Date.now(), OP, GARDENER)).toHaveLength(1);
    await gw.close();
  });

  it("an operator strike counts from its validFrom and stops at its validUntil", async () => {
    const { gw, grant } = await withGrant();
    const starts = 5_000_000_000_000;
    await gw.append([timedStrike(OP_SEED, grant.id, 9100, { validFrom: starts })]);
    expect(survivingOperatorGrantIds(gw.reactor, starts - 1, OP, SUBJECT)).toEqual([grant.id]);
    expect(survivingOperatorGrantIds(gw.reactor, starts, OP, SUBJECT)).toEqual([]);

    const { gw: gw2, grant: grant2 } = await withGrant();
    await gw2.append([
      timedStrike(OP_SEED, grant2.id, 9100, { validFrom: 9100, validUntil: 9200 }),
    ]);
    expect(survivingOperatorGrantIds(gw2.reactor, 9199, OP, SUBJECT)).toEqual([]);
    expect(survivingOperatorGrantIds(gw2.reactor, 9200, OP, SUBJECT)).toEqual([grant2.id]);
    await gw.close();
    await gw2.close();
  });
});

// --- channel.ts: lifting a curse -----------------------------------------------------------------

describe("lifting a curse ignores a counter-negation whose window ended", () => {
  it("the lift strikes the curse again, and the lens serves", async () => {
    const SPROUT = { name: "Sprout", alg: 1, body: PLANT.body } as typeof PLANT;
    const store = (seed: string) =>
      Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));
    const alice = await store("a1".repeat(32));
    await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    await alice.publishRegistration(SPROUT, PLANT_POLICY, [FERN]);
    const meSeed = "cc".repeat(32);
    const me = await store(meSeed);
    try {
      const ch = await me.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await ch.sync();
      await me.curseChannelLaw(ch.name, "alice:Plant");
      expect(() => me.def("alice:Plant")).toThrow();

      // Every curse strike, wherever it landed, gets a counter-negation whose window has ended: an
      // earlier lift that no longer holds.
      const now = Date.now();
      const grounds = [me.channelPools.get(ch.name)?.gateway, me].filter(
        (g): g is Gateway => g !== undefined,
      );
      let planted = 0;
      for (const g of grounds) {
        for (const d of [...g.reactor.snapshot()]) {
          for (const n of g.reactor.negationsOf(d.id)) {
            const curse = g.reactor.get(n)!;
            if (curse.claims.author !== authorForSeed(meSeed)) continue;
            if (g.reactor.negationsOf(n).length > 0) continue;
            await g.append([
              timedStrike(meSeed, n, now - 2000, { validFrom: now - 2000, validUntil: now - 1000 }),
            ]);
            planted += 1;
          }
        }
      }
      expect(planted).toBeGreaterThan(0);
      expect(() => me.def("alice:Plant")).toThrow(); // the expired lift revives nothing

      await me.curseChannelLaw(ch.name, "alice:Plant", { lift: true });
      expect(me.def("alice:Plant")).toBeDefined();
      expect(me.def("alice:Sprout")).toBeDefined(); // the channel-mate is untouched
    } finally {
      await alice.close();
      await me.close();
    }
  });
});

// --- cli.ts: removing a role whose earlier strike expired ----------------------------------------

describe("loam user remove-role strikes a role whose earlier strike expired", () => {
  const CHEAP: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
  const password = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP };
  let home: string | undefined;
  afterEach(() => {
    if (home !== undefined) rmSync(home, { recursive: true, force: true, maxRetries: 5 });
    home = undefined;
  });

  it("the role leaves the reader, and a bystander keeps theirs", async () => {
    home = mkdtempSync(join(tmpdir(), "loam-step4-role-"));
    const lines: string[] = [];
    const io = { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) };
    expect(await run(["init", "--home", home], io)).toBe(0);
    for (const name of ["ivy", "kit"]) {
      expect(
        await run(["user", "create", name, "--operator", "--home", home], io, password),
        lines.join("\n"),
      ).toBe(0);
    }
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    const open = () =>
      Gateway.boot(new SqliteBackend(storePath(home!)), assembleGenesis({ operatorSeed: seed }));
    const rolesNow = async (name: string) => {
      const gw = await open();
      try {
        return [...rolesOf(gw.reactor, operator, gw.validityNow(), name)].sort();
      } finally {
        await gw.close();
      }
    };

    // An operator strike on ivy's role claim whose window has ended: the role reads live again.
    const gw = await open();
    const roleClaim = [...gw.reactor.snapshot()].find(
      (d) =>
        JSON.stringify(d.claims.pointers) ===
        JSON.stringify(roleClaims("ivy", "operator", operator, 0).pointers),
    )!;
    expect(roleClaim).toBeDefined();
    const now = Date.now();
    await gw.append([
      timedStrike(seed, roleClaim.id, now - 2000, {
        validFrom: now - 2000,
        validUntil: now - 1000,
      }),
    ]);
    await gw.close();
    expect(await rolesNow("ivy")).toContain("operator");

    expect(
      await run(["user", "remove-role", "ivy", "--role=operator", "--home", home], io),
      lines.join("\n"),
    ).toBe(0);
    expect(await rolesNow("ivy")).not.toContain("operator");
    expect(await rolesNow("kit")).toContain("operator");
  });
});
