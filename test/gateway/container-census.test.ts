import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { describe, expect, it } from "vitest";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerCensusImpl, survivingContextsOf } from "../../src/gateway/container-census.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, pickLatest } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { stamped } from "../../src/gateway/stamp.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ADA_SEED = "0a".repeat(32);
const ADA = authorForSeed(ADA_SEED);

const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

const litClaim = (t: number) => observed(FERN, "height", t % 50, t, ADA_SEED);

const strayClaim = (t: number) =>
  signClaims(
    {
      timestamp: t,
      validFrom: t,
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

    const census = containerCensusImpl(gw, "vault");
    expect(census.physical).toBeGreaterThanOrEqual(1);
    expect(census.linked).toBe(0);
    expect(census.physical).toBe(gw.containerScope({ containers: ["vault"] }).length);
  });
});

describe("§55(a) — a parent's inbox pools are physical ELSEWHERE, named by pool", () => {
  it("the parent's gather composes the pool, the census names it apart, and a stranger's pool is not counted", async () => {
    const { gw, ts } = await store();
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
    await gw.append([
      signClaims(
        {
          ...stamped(ts()),
          author: ADA,
          pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: stray.id } } }],
        } as never,
        ADA_SEED,
      ),
    ]);
    const census = containerCensusImpl(gw, "garden");
    expect(census.linked).toBe(2);
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
    await gw.append([
      signClaims(
        {
          timestamp: 2500,
          validFrom: 2500,
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
    gw.register(
      { name: "Scale", alg: 1, body: structuredClone(PLANT.body) },
      { name: "Scale", props: new Map([["weight", pickLatest]]), default: pickLatest },
      ["scale:kitchen"],
    );
    await gw.append([litClaim(2000)]);
    await gw.append([observed("scale:kitchen", "weight", 7, 2100, ADA_SEED)]);

    const census = containerCensusImpl(gw, "garden");
    expect(census.lit).toBe(2);
    expect(census.dark).toBe(0);
  });

  it("a SUPERSEDED binding's contexts light nothing: the union reads the grouping, not the flat list", async () => {
    const { gw } = await store();
    gw.register(PLANT, PLANT_POLICY, [FERN]);
    const bound = gw.registered[gw.registered.length - 1]!;
    const evolved = {
      ...bound,
      schema: { props: new Map([["girth", pickLatest]]), default: pickLatest },
    };
    const union = survivingContextsOf([bound, evolved]);
    expect(union.has("girth")).toBe(true);
    expect(union.has("height"), "a superseded binding's context survived the union").toBe(false);
  });
});
