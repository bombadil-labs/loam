// SPEC §55 criteria (a) and (b) — the container census (T254; the working spec at
// .adlc/specs/55-container-census.md, settled in chat 2026-08-29). Three numbers per
// container: PHYSICAL (residents of its own attached store), LINKED (selected out of the
// primary by its membership), and DARK (data-class members no surviving lens can gather).
// Dark is the read-side soup detector, §49.5's complement.
//
// STATED, NOT ASSERTED: dark is an approximation in the safe direction. The predicate is the
// listing door's own — does any entity-pointer context appear in a surviving program's context
// union — and a Term can filter a delta whose context matches, so true darkness is
// undercounted. An advisory metric must never over-alarm; the page says so in its own words
// (§55 criterion c's file).

import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { describe, expect, it } from "vitest";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerCensusImpl, survivingContextsOf } from "../../src/gateway/container-census.js";
import { containerClaims } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, pickLatest } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ADA_SEED = "0a".repeat(32);
const ADA = authorForSeed(ADA_SEED);

const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

/** A lit observation: `height` is a prop the Plant reading resolves, so its context is lit. */
const litClaim = (t: number) => observed(FERN, "height", t % 50, t, ADA_SEED);

/** A stray: no surviving lens reads the `unregistered-scratch` context. */
const strayClaim = (t: number) =>
  signClaims(
    {
      timestamp: t,
      author: ADA,
      pointers: [
        {
          role: "note",
          target: { kind: "entity", entity: { id: "scrap:idea", context: "unregistered-scratch" } },
        },
        { role: "text", target: { kind: "primitive", value: `stray ${t}` } },
      ],
    } as never,
    ADA_SEED,
  );

async function store(): Promise<{ gw: Gateway; ts: () => number }> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let t = 1000;
  const ts = () => ++t;
  await gw.append([
    signClaims(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, ts()), OPERATOR_SEED),
    signClaims(
      containerClaims(
        { container: "garden", trust: "curated", posture: "shared", membership: authoredBy(ADA) },
        OPERATOR,
        ts(),
      ),
      OPERATOR_SEED,
    ),
  ]);
  return { gw, ts };
}

describe("§55(a) — physical and linked fall out of the posture model", () => {
  it("a shared container counts its selected members as LINKED, and the total matches the scope", async () => {
    const { gw } = await store();
    await gw.append([litClaim(2000)]);
    await gw.append([strayClaim(2100)]);

    const census = containerCensusImpl(gw, "garden");
    expect(census.linked).toBe(2);
    expect(census.physical).toBe(0);
    expect(census.linked + census.physical).toBe(
      gw.containerScope({ containers: ["garden"] }).length,
    );
  });

  it("a separate container counts its pool residents as PHYSICAL", async () => {
    const { gw, ts } = await store();
    await gw.append([
      signClaims(
        containerClaims(
          { container: "vault", trust: "untrusted", posture: "separate" },
          OPERATOR,
          ts(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    await gw.openContainer({ name: "vault", backend: new MemoryBackend() });
    const pool = gw.attachedContainers.get("vault");
    expect(pool, "the separate container did not attach").toBeDefined();
    await pool!.federate([litClaim(3000)]);

    // The pool seeds ONE-WAY from the primary at open, so residents include the seeded copies
    // plus the federated arrival — every one of them physical, none linked. The property under
    // test is the BUCKETING by posture; the magnitude belongs to the seeding.
    const census = containerCensusImpl(gw, "vault");
    expect(census.physical).toBeGreaterThanOrEqual(1);
    expect(census.linked).toBe(0);
    expect(census.physical).toBe(gw.containerScope({ containers: ["vault"] }).length);
  });
});

describe("§55(a) — a parent's inbox pools are physical ELSEWHERE, named by pool", () => {
  it("the parent's gather composes the pool, the census names it apart, and a stranger's pool is not counted", async () => {
    const { gw, ts } = await store();
    // Two parents, one inbox pool each: the census for "garden" must name garden-inbox's
    // contribution and never other-inbox's — an inverted parent match would swap exactly that.
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "other",
            trust: "curated",
            posture: "shared",
            membership: authoredBy(OPERATOR),
          },
          OPERATOR,
          ts(),
        ),
        OPERATOR_SEED,
      ),
      signClaims(
        containerClaims(
          { container: "garden-in", trust: "untrusted", posture: "separate", inboxOf: "garden" },
          OPERATOR,
          ts(),
        ),
        OPERATOR_SEED,
      ),
      signClaims(
        containerClaims(
          { container: "other-in", trust: "untrusted", posture: "separate", inboxOf: "other" },
          OPERATOR,
          ts(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    await gw.openContainer({ name: "garden-in", backend: new MemoryBackend() });
    await gw.openContainer({ name: "other-in", backend: new MemoryBackend() });
    await gw.attachedContainers.get("garden-in")!.federate([litClaim(4000)]);

    const census = containerCensusImpl(gw, "garden");
    const mine = census.physicalElsewhere.find((c) => c.pool === "garden-in");
    expect(mine, "the parent's own inbox pool is not named").toBeDefined();
    expect(mine!.count).toBeGreaterThanOrEqual(1);
    expect(census.physicalElsewhere.find((c) => c.pool === "other-in")).toBeUndefined();
  });
});

describe("§55(b) — the two levels: ground buckets count strikes, lit/dark counts survivors", () => {
  it("a struck stray stops alarming: not dark, not lit; its strike counts vocabulary; the ground count keeps both", async () => {
    const { gw, ts } = await store();
    const stray = strayClaim(2100);
    await gw.append([stray]);
    // Ada retracts her own stray: the strike rides the same membership (authoredBy ada).
    await gw.append([
      signClaims(
        {
          timestamp: ts(),
          author: ADA,
          pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: stray.id } } }],
        } as never,
        ADA_SEED,
      ),
    ]);
    const census = containerCensusImpl(gw, "garden");
    // Ground level: both bytes are members — the claim and its strike.
    expect(census.linked).toBe(2);
    // Reading level: the struck stray alarms nobody, and the strike is bookkeeping, not soup.
    expect(census.dark).toBe(0);
    expect(census.lit).toBe(0);
    expect(census.vocabulary).toBe(1);
  });
});

describe("§55(b) — dark is decided by the surviving-lens context union, two-sided", () => {
  it("a lit member is not dark; a member no lens reads is dark", async () => {
    const { gw } = await store();
    gw.register(PLANT, PLANT_POLICY, [FERN]);
    await gw.append([litClaim(2000)]);
    await gw.append([strayClaim(2100)]);

    const census = containerCensusImpl(gw, "garden");
    expect(census.dark).toBe(1);
    expect(census.lit).toBe(1);
    expect(census.vocabulary).toBe(0);
  });

  it("a data member wearing loam vocabulary lands in the vocabulary bucket, not darkness", async () => {
    const { gw } = await store();
    // Ada-authored, inside the membership, wearing a trust-shaped context: inert law is a
    // bucketed member, never soup (§55 position 3).
    await gw.append([
      signClaims(
        {
          timestamp: 2500,
          author: ADA,
          pointers: [
            {
              role: "user",
              target: { kind: "entity", entity: { id: "user:guest", context: "loam.role" } },
            },
          ],
        } as never,
        ADA_SEED,
      ),
    ]);
    const census = containerCensusImpl(gw, "garden");
    expect(census.vocabulary).toBe(1);
    expect(census.dark).toBe(0);
  });

  it("two COEXISTING lens names over one program both keep their contexts in the union", async () => {
    const { gw } = await store();
    gw.register(PLANT, PLANT_POLICY, [FERN]);
    const bound = gw.registered[gw.registered.length - 1]!;
    // Two NAMED sibling lenses over the SAME hyperschema — the at-rest shape the registration
    // door mints one-per-schema-name (fabricated pure: the in-process register refuses a
    // duplicate materialization). The grouping keys lenses by LENS name, so both survive side
    // by side; a dedup keyed by PROGRAM name would collapse them and the losing sibling's
    // whole readership would count dark — the H6 substitution this rail exists to see (the
    // unnamed-schema supersession fixture below shares both names and cannot).
    const tall = {
      ...bound,
      lensName: "Tall",
      schema: { name: "Tall", props: new Map([["height", pickLatest]]), default: pickLatest },
    };
    const tagged = {
      ...bound,
      lensName: "Tagged",
      schema: { name: "Tagged", props: new Map([["tag", pickLatest]]), default: pickLatest },
    };
    const union = survivingContextsOf([tall, tagged]);
    expect(union.has("height")).toBe(true);
    expect(union.has("tag"), "a coexisting sibling lens lost its contexts").toBe(true);
  });

  it("the union spans EVERY program: two lenses over two hyperschemas both light their members", async () => {
    const { gw } = await store();
    gw.register(PLANT, PLANT_POLICY, [FERN]);
    // A second PROGRAM (its own hyperschema name, its own body instance), reading `weight`:
    // a union that read only the last program would leave `height` dark and OVER-ALARM —
    // the one direction the metric forbids.
    gw.register(
      { name: "Scale", alg: 1, body: structuredClone(PLANT.body) },
      { name: "Scale", props: new Map([["weight", pickLatest]]), default: pickLatest },
      ["scale:kitchen"],
    );
    await gw.append([litClaim(2000)]); // height — PLANT's program
    await gw.append([observed("scale:kitchen", "weight", 7, 2100, ADA_SEED)]); // Scale's program

    const census = containerCensusImpl(gw, "garden");
    expect(census.lit).toBe(2);
    expect(census.dark).toBe(0);
  });

  it("a SUPERSEDED binding's contexts light nothing: the union reads the grouping, not the flat list", async () => {
    const { gw } = await store();
    gw.register(PLANT, PLANT_POLICY, [FERN]);
    const bound = gw.registered[gw.registered.length - 1]!;
    // The at-rest re-registration shape: the flat list legitimately holds a superseded binding
    // BESIDE its evolution (same lens name, evolved schema). The grouping's lens map is
    // latest-wins, so only the evolution's contexts survive — a union drawn from the flat list
    // would keep lighting `height` forever (the H6 family).
    const evolved = {
      ...bound,
      schema: { props: new Map([["girth", pickLatest]]), default: pickLatest },
    };
    const union = survivingContextsOf([bound, evolved]);
    expect(union.has("girth")).toBe(true);
    expect(union.has("height"), "a superseded binding's context survived the union").toBe(false);
  });
});
