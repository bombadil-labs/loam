import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { PLANT } from "./fixtures.js";
import { isSuppressed, retraction } from "./narrowing.js";
import { inPoolVoice } from "../helpers/pool-voice.js";
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

const messageOf = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { message } }`);
  return (res.data as { plant?: { message?: unknown } } | undefined)?.plant?.message;
};

const output = (value: string, ts: number) => observed(FERN, "message", value, ts, GARDENER_SEED);

const wouldAdopt = (src: { claims: { timestamp: number; pointers: unknown } }): string =>
  signClaims(
    {
      timestamp: src.claims.timestamp,
      validFrom: src.claims.timestamp,
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
  it("refuses an output its own author retracted in the pool, naming the negation", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("the app said this, then took it back", 2000);
    const strike = retraction(fact.id, GARDENER, GARDENER_SEED, 2100);
    await pool.gateway.federate([fact, strike]);
    expect(isSuppressed(pool.gateway, fact.id)).toBe(true);

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain("promotion refused");
    expect(refusal).toContain(strike.id);
    expect(refusal).toContain(GARDENER);

    expect(primary.reactor.get(wouldAdopt(fact))).toBeUndefined();
    expect(primary.adoptions()).toHaveLength(0);
    expect(await messageOf(primary)).toBeNull();

    await pool.drop();
    await primary.close();
  });

  it("refuses an output the OPERATOR negated inside their own pool — the §27 review gesture binds", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("the reviewer said no to this", 2500);
    const reject = inPoolVoice(pool.gateway, retraction(fact.id, OP, OP_SEED, 2600));
    const heckle = retraction(fact.id, SURVEYOR, SURVEYOR_SEED, 2610);
    await pool.gateway.federate([fact, heckle]);
    await pool.gateway.append([
      reject,
      inPoolVoice(pool.gateway, retraction(heckle.id, OP, OP_SEED, 2620)),
    ]);
    expect(await messageOf(pool.gateway)).toBeNull();

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain("the source's own reading has it negated");
    expect(refusal).toContain(reject.id);
    expect(refusal).not.toContain(heckle.id);
    expect(primary.reactor.get(wouldAdopt(fact))).toBeUndefined();
    expect(primary.adoptions()).toHaveLength(0);
    expect(await messageOf(primary)).toBeNull();

    await pool.drop();
    await primary.close();
  });

  it("refuses an output a GRANTEE negated — the data mask's community, not the operator alone", async () => {
    const primary = await bootPrimary();
    await primary.append([
      signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OP, 2700), OP_SEED),
    ]);
    const pool = await primary.openQuarantine();
    const fact = output("a granted reviewer said no", 2800);
    const reject = retraction(fact.id, SURVEYOR, SURVEYOR_SEED, 2900);
    await pool.gateway.federate([fact, reject]);

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain("the source's own reading has it negated");
    expect(refusal).toContain(reject.id);
    expect(primary.reactor.get(wouldAdopt(fact))).toBeUndefined();
    expect(await messageOf(primary)).toBeNull();

    await pool.drop();
    await primary.close();
  });

  it("names the AUTHOR's negation, not a bystander's, when both negated the same output", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("withdrawn, and heckled too", 3200);
    const own = retraction(fact.id, GARDENER, GARDENER_SEED, 3300);
    const heckle = retraction(fact.id, SURVEYOR, SURVEYOR_SEED, 3400);
    await pool.gateway.federate([fact, own, heckle]);

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain(own.id);
    expect(refusal).not.toContain(heckle.id);

    await pool.drop();
    await primary.close();
  });

  it("still promotes an output a THIRD PARTY negated — a stranger holds no veto", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("the app stands by this", 3000);
    const heckle = retraction(fact.id, SURVEYOR, SURVEYOR_SEED, 3100);
    await pool.gateway.federate([fact, heckle]);
    expect(pool.gateway.reactor.get(heckle.id)).toBeDefined();

    const { promoted } = await primary.promote(pool.gateway, fact.id);
    expect(promoted).toBe(wouldAdopt(fact));
    expect(primary.reactor.get(promoted)?.claims.author).toBe(OP);
    expect(isSuppressed(primary, promoted)).toBe(false);
    expect(await messageOf(primary)).toBe("the app stands by this");

    await pool.drop();
    await primary.close();
  });

  it("refuses still when a third party negates the author's own retraction — no foreign revival", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("withdrawn, and a stranger objects", 4000);
    const strike = retraction(fact.id, GARDENER, GARDENER_SEED, 4100);
    const foreignRevival = retraction(strike.id, SURVEYOR, SURVEYOR_SEED, 4200);
    await pool.gateway.federate([fact, strike, foreignRevival]);
    expect(isSuppressed(pool.gateway, strike.id)).toBe(true);

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain(strike.id);
    expect(primary.reactor.get(wouldAdopt(fact))).toBeUndefined();
    expect(await messageOf(primary)).toBeNull();

    await pool.drop();
    await primary.close();
  });

  it("revives: the author's own counter-negation lets the same output promote again", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("taken back, then stood behind again", 5000);
    const strike = retraction(fact.id, GARDENER, GARDENER_SEED, 5100);
    await pool.gateway.federate([fact, strike]);
    expect(await refusalOf(primary, pool.gateway, fact.id)).toContain(strike.id);

    await pool.gateway.federate([retraction(strike.id, GARDENER, GARDENER_SEED, 5200)]);

    const { promoted } = await primary.promote(pool.gateway, fact.id);
    expect(promoted).toBe(wouldAdopt(fact));
    expect(primary.adoptions().map((a) => a.sourceDelta)).toContain(fact.id);
    expect(await messageOf(primary)).toBe("taken back, then stood behind again");

    await pool.drop();
    await primary.close();
  });

  it("asks survival BEFORE the kind — a negated law-shaped delta is refused as negated", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const target = output("something the app later argued about", 5500);
    const lawShaped = retraction(target.id, GARDENER, GARDENER_SEED, 5600);
    const struckLawShaped = retraction(lawShaped.id, GARDENER, GARDENER_SEED, 5700);
    await pool.gateway.federate([target, lawShaped, struckLawShaped]);

    const asStruck = await refusalOf(primary, pool.gateway, lawShaped.id);
    expect(asStruck).toContain("retracted it where it was made");
    expect(asStruck).toContain(struckLawShaped.id);
    expect(asStruck).not.toContain("it is a negation");

    const asKind = await refusalOf(primary, pool.gateway, struckLawShaped.id);
    expect(asKind).toContain("it is a negation");

    await pool.drop();
    await primary.close();
  });

  it("refuses to re-promote over an adoption the OPERATOR later negated here", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("adopted, then thought better of", 5800);
    await pool.gateway.federate([fact]);
    const { promoted } = await primary.promote(pool.gateway, fact.id);

    const lifted = retraction(promoted, OP, OP_SEED, 5900);
    await primary.append([lifted]);
    expect(await messageOf(primary)).toBeNull();

    const refusal = await refusalOf(primary, pool.gateway, fact.id);
    expect(refusal).toContain("already adopted");
    expect(refusal).toContain(lifted.id);
    expect(await messageOf(primary)).toBeNull();

    await primary.append([retraction(lifted.id, OP, OP_SEED, 6000)]);
    expect((await primary.promote(pool.gateway, fact.id)).promoted).toBe(promoted);
    expect(await messageOf(primary)).toBe("adopted, then thought better of");

    await pool.drop();
    await primary.close();
  });

  it("leaves an adoption already made alone when the pool retracts afterwards", async () => {
    const primary = await bootPrimary();
    const pool = await primary.openQuarantine();
    const fact = output("adopted while it stood", 6000);
    await pool.gateway.federate([fact]);
    const { promoted } = await primary.promote(pool.gateway, fact.id);

    await pool.gateway.federate([retraction(fact.id, GARDENER, GARDENER_SEED, 6100)]);
    expect(isSuppressed(pool.gateway, fact.id)).toBe(true);

    expect(primary.reactor.get(promoted)).toBeDefined();
    expect(isSuppressed(primary, promoted)).toBe(false);
    expect(primary.adoptions().map((a) => a.adoptedDelta)).toContain(promoted);
    expect(await messageOf(primary)).toBe("adopted while it stood");

    expect(await refusalOf(primary, pool.gateway, fact.id)).toContain("promotion refused");
    expect(await messageOf(primary)).toBe("adopted while it stood");

    await pool.drop();
    await primary.close();
  });
});
