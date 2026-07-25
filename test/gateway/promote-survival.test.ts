// SURVIVAL, NOT PRESENCE, AT THE PROMOTION DOOR (SPEC §24.3, ticket T39) — the fact-side twin of
// T33's criterion 25. `test/gateway/promote-survival-probe.test.ts` is the reproduction (one output,
// struck by its own author in the pool, adopted anyway); this file rails the DECISION around it, in
// both directions.
//
// THE RULE. Promotion REFUSES an output that does not survive in the source, naming the strike — it
// does not carry the strike across. Refusing is the reversible choice: promotion is content-addressed
// on the source (§11 rung 2's inherited timestamp), so a carried negation would kill the adopted id
// FOREVER — forgiving the output in the pool could never re-land it, and the idempotence
// short-circuit would report success over a delta no reader can see. Refusal leaves nothing behind:
// forgive in the pool, promote again, and the value lands (the `revives` rail below is that claim).
//
// WHOSE STRIKE BINDS is T33's rule, not a second one: **only the struck delta's OWN AUTHOR retires
// it**, scoped at every rung. Both failures of an unscoped algebra are railed — a third party must
// not veto a lawful adoption, and a third party must not revive what the author withdrew.
//
// WHY `assertPreservesSuppression` IS NOT USED HERE, and what replaces it. That helper asks whether
// delta X reads as live at the destination, keyed BY ID. Promotion is a RE-ASSERTION, not a filter:
// the crossing mints a different id, so the source id is trivially absent from the primary and the
// helper would pass vacuously (its own header names re-assertion as the durable form of H1). The
// honest delta-level question is therefore asked of the RE-SIGNED counterpart — `wouldAdopt` below
// recomputes the exact id `promoteImpl` would mint, and the `revives` rail proves that computation
// right by matching it against a real promotion, so the absence assertions cannot be vacuous. The
// `retraction` / `isSuppressed` helpers are shared with the narrowing suite.
//
// Asserted at BOTH levels throughout: what the primary HOLDS (present / struck / the adoption trail)
// and what a reader RESOLVES through the door (`messageOf`).

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { isSuppressed, retraction } from "./narrowing.js";
import {
  FERN,
  GARDENER,
  GARDENER_SEED,
  SURVEYOR,
  SURVEYOR_SEED,
  observed,
} from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = { props: new Map<string, Policy>([["message", pick]]), default: pick };

const bootPrimary = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["message"] }],
    }),
  );

// What a reader resolves through the door — the object-level question. `null` means the primary
// serves nothing for FERN's message, whatever its deltas happen to hold.
const messageOf = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { message } }`);
  return (res.data as { plant?: { message?: unknown } } | undefined)?.plant?.message;
};

// The app's output: a stranger's interpretation, made inside the pool under its granted author.
const output = (value: string, ts: number) => observed(FERN, "message", value, ts, GARDENER_SEED);

// The id promotion WOULD mint for `src`: the same content, re-signed by the operator, inheriting the
// source timestamp. Nothing here cites another delta, so no pointer is rewritten.
const wouldAdopt = (src: { claims: { timestamp: number; pointers: unknown } }): string =>
  signClaims(
    {
      timestamp: src.claims.timestamp,
      author: OP,
      pointers: src.claims.pointers as never,
    },
    OP_SEED,
  ).id;

const refusalOf = async (gw: Gateway, from: Gateway, id: string): Promise<string | undefined> => {
  try {
    await gw.promote(from, id);
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
};

describe("§24.3 promotion asks SURVIVAL at the source (T39)", () => {
  it("refuses an output its own author retracted in the pool, naming the strike", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("the app said this, then took it back", 2000);
    const strike = retraction(fact.id, GARDENER, GARDENER_SEED, 2100);
    await pool.gateway.federate([fact, strike]);
    expect(isSuppressed(pool.gateway, fact.id)).toBe(true); // the fixture bites at the source

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain("promotion refused");
    expect(refusal).toContain(strike.id); // the refusal NAMES the retraction, not just its verdict
    expect(refusal).toContain(GARDENER); // …and whose word it was

    // Delta level: the re-signed counterpart never landed, and no trail was written.
    expect(primary.reactor.get(wouldAdopt(fact))).toBeUndefined();
    expect(primary.adoptions()).toHaveLength(0);
    // Object level: a reader through the door resolves nothing for the withdrawn claim.
    expect(await messageOf(primary)).toBeNull();

    await pool.drop();
    await primary.close();
  });

  it("still promotes an output a THIRD PARTY struck — a stranger holds no veto", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("the app stands by this", 3000);
    const heckle = retraction(fact.id, SURVEYOR, SURVEYOR_SEED, 3100);
    await pool.gateway.federate([fact, heckle]);
    expect(pool.gateway.reactor.get(heckle.id)).toBeDefined(); // the strike is really there

    const { promoted } = await primary.promote(pool.gateway, fact.id);
    expect(promoted).toBe(wouldAdopt(fact));
    expect(primary.reactor.get(promoted)?.claims.author).toBe(OP);
    expect(isSuppressed(primary, promoted)).toBe(false);
    expect(await messageOf(primary)).toBe("the app stands by this");

    await pool.drop();
    await primary.close();
  });

  it("refuses still when a third party strikes the author's own retraction — no foreign revival", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("withdrawn, and a stranger objects", 4000);
    const strike = retraction(fact.id, GARDENER, GARDENER_SEED, 4100);
    const foreignRevival = retraction(strike.id, SURVEYOR, SURVEYOR_SEED, 4200);
    await pool.gateway.federate([fact, strike, foreignRevival]);

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain(strike.id);
    expect(primary.reactor.get(wouldAdopt(fact))).toBeUndefined();
    expect(await messageOf(primary)).toBeNull();

    await pool.drop();
    await primary.close();
  });

  it("revives: the author's own counter-strike lets the same output promote again", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("taken back, then stood behind again", 5000);
    const strike = retraction(fact.id, GARDENER, GARDENER_SEED, 5100);
    await pool.gateway.federate([fact, strike]);
    expect(await refusalOf(primary, pool.gateway, fact.id)).toContain(strike.id);

    // The app changes its mind in its own voice — the strike is struck, so the output stands again.
    await pool.gateway.federate([retraction(strike.id, GARDENER, GARDENER_SEED, 5200)]);

    const { promoted } = await primary.promote(pool.gateway, fact.id);
    expect(promoted).toBe(wouldAdopt(fact)); // the id a carried negation would have killed forever
    expect(primary.adoptions().map((a) => a.sourceDelta)).toContain(fact.id);
    expect(await messageOf(primary)).toBe("taken back, then stood behind again");

    await pool.drop();
    await primary.close();
  });

  it("leaves an adoption already made alone when the pool retracts afterwards", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("adopted while it stood", 6000);
    await pool.gateway.federate([fact]);
    const { promoted } = await primary.promote(pool.gateway, fact.id);

    // The pool withdraws the output AFTER the operator adopted it. Canonical history is not mutable
    // by a sandbox (§24): the adopted delta is the operator's own claim now, and withdrawing it is
    // the operator's own §14 act, never an echo of the pool's.
    await pool.gateway.federate([retraction(fact.id, GARDENER, GARDENER_SEED, 6100)]);
    expect(isSuppressed(pool.gateway, fact.id)).toBe(true);

    expect(primary.reactor.get(promoted)).toBeDefined();
    expect(isSuppressed(primary, promoted)).toBe(false);
    expect(primary.adoptions().map((a) => a.adoptedDelta)).toContain(promoted);
    expect(await messageOf(primary)).toBe("adopted while it stood");

    // But a NEW promotion is a NEW act, judged against the pool as it stands now — so the door
    // refuses it, and the earlier adoption is untouched by that refusal.
    expect(await refusalOf(primary, pool.gateway, fact.id)).toContain("promotion refused");
    expect(await messageOf(primary)).toBe("adopted while it stood");

    await pool.drop();
    await primary.close();
  });
});
