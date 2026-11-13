import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, termCanonicalHex } from "@bombadil/rhizomatic";
import {
  entityGatherBody,
  entityGatherJson,
  expandedGatherBody,
  expandedGatherJson,
} from "../../src/gateway/gather.js";
import { TENANT, governedGatherBody } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, PLANT_BODY, observed } from "../spike/garden.js";
import { PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "7a".repeat(32);
const OP = authorForSeed(OP_SEED);

const PLAIN_LITERAL = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};

const EXPANDED_LITERAL = {
  op: "expand",
  role: { exact: "friend" },
  schema: "Person",
  reading: "Person",
  in: PLAIN_LITERAL,
};

const villageBody = (file: string): unknown =>
  (
    JSON.parse(readFileSync(`demos/village/schemas/${file}`, "utf8")) as {
      hyperschema: { body: unknown };
    }
  ).hyperschema.body;

describe("T83 — the plain-entity gather", () => {
  it("is byte-identical to the hand-written literal, in both dialects", () => {
    expect(entityGatherJson()).toEqual(PLAIN_LITERAL);
    expect(termCanonicalHex(entityGatherBody())).toBe(termCanonicalHex(parseTerm(PLAIN_LITERAL)));
  });

  it("is byte-identical to the term a stock village schema already ships", () => {
    expect(termCanonicalHex(entityGatherBody())).toBe(
      termCanonicalHex(parseTerm(villageBody("person.json"))),
    );
  });

  it("carries the mask through — the knob is load-bearing, not decoration", () => {
    const drop = termCanonicalHex(entityGatherBody());
    const annotated = termCanonicalHex(entityGatherBody({ mask: "annotate" }));
    const governed = termCanonicalHex(governedGatherBody(OP));
    expect(new Set([drop, annotated, governed]).size).toBe(3);
    expect(annotated).toBe(
      termCanonicalHex(
        parseTerm({
          ...PLAIN_LITERAL,
          in: { ...PLAIN_LITERAL.in, in: { op: "mask", policy: "annotate", in: "input" } },
        }),
      ),
    );
    expect(entityGatherJson({ mask: "annotate" })).toEqual({
      ...PLAIN_LITERAL,
      in: { ...PLAIN_LITERAL.in, in: { op: "mask", policy: "annotate", in: "input" } },
    });
  });
});

describe("T83 — the expanded gather", () => {
  it("is byte-identical to the literal and to the village's own edge schema", () => {
    const spec = { role: "friend", schema: "Person", reading: "Person" };
    expect(expandedGatherJson(spec)).toEqual(EXPANDED_LITERAL);
    expect(termCanonicalHex(expandedGatherBody(spec))).toBe(
      termCanonicalHex(parseTerm(EXPANDED_LITERAL)),
    );
    expect(termCanonicalHex(expandedGatherBody(spec))).toBe(
      termCanonicalHex(parseTerm(villageBody("circle.json"))),
    );
  });

  it("omits `reading` when none is named, rather than writing undefined", () => {
    const json = expandedGatherJson({ role: "friend", schema: "Person" });
    expect("reading" in json).toBe(false);
    expect(termCanonicalHex(expandedGatherBody({ role: "friend", schema: "Person" }))).not.toBe(
      termCanonicalHex(parseTerm(EXPANDED_LITERAL)),
    );
  });
});

const boot = async (body: unknown): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: { name: "Plant", alg: 1, body: parseTerm(body) },
          schema: PLANT_POLICY,
          roots: [FERN],
          writable: ["height"],
        },
      ],
    }),
  );
  await gw.append([
    observed(FERN, "height", 30, 1000, OP_SEED),
    observed(FERN, "height", 41, 1100, OP_SEED),
    observed(FERN, "tag", "shade", 1200, OP_SEED),
  ]);
  return gw;
};

describe("T83 — a schema registered through the constructor resolves the literal's view", () => {
  it("answers the same view, field for field, through the same door", async () => {
    const viaConstructor = await boot(entityGatherJson());
    const viaLiteral = await boot(PLAIN_LITERAL);

    const q = `{ plant(entity: "${FERN}") { height tag } }`;
    const a = await viaConstructor.query(q);
    const b = await viaLiteral.query(q);

    expect(a.errors).toBeUndefined();
    expect(a.data).toEqual({ plant: { height: 41, tag: ["shade"] } });
    expect(b.data).toEqual(a.data);

    await viaConstructor.close();
    await viaLiteral.close();
  });

  it("is the same body the store binds — a re-registration under one name is accepted as identical", async () => {
    const gw = await boot(PLAIN_LITERAL);
    const out = await gw.publishRegistration(
      { name: "Plant", alg: 1, body: entityGatherBody() },
      PLANT_POLICY,
      [FERN],
      { actor: OP_SEED },
    );
    expect(out.persisted).toBe(true);
    expect(out.bound).toBe(true);
    const after = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(after.data).toEqual({ plant: { height: 41 } });
    await gw.close();
  });
});

describe("T83 — the converted call sites", () => {
  it("leaves test/spike/garden.ts's PLANT_BODY the same program", () => {
    expect(termCanonicalHex(PLANT_BODY)).toBe(termCanonicalHex(parseTerm(PLAIN_LITERAL)));
  });

  it("leaves accounts.ts's TENANT gather the same program", () => {
    expect(termCanonicalHex(TENANT.body)).toBe(termCanonicalHex(parseTerm(PLAIN_LITERAL)));
  });
});
