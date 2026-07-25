// T83 — the gather constructors produce the term the tree already wrote by hand, and nothing else.
//
// The whole value of a named constructor for a copy-pasted literal is that the two CANNOT DRIFT, so
// the rail is byte-identity at the CANONICAL FORM (`termCanonicalHex` — the CBOR bytes a hyperschema
// definition is addressed by), never a snapshot of the constructor's own output. A snapshot would
// re-record whatever the constructor happens to emit and go green through a silent change of
// program.
//
// Identity is proved against TWO independent witnesses, on purpose:
//   1. a literal written out longhand in this file — the pin, so a change to the constructor has to
//      be argued here as well;
//   2. `demos/village/schemas/*.json` READ OFF DISK — a member of the 73-file corpus this ticket
//      exists to de-duplicate, written by nobody in this change and converted by nobody in it
//      (the village is parked). If the constructor matched only the copy in this file, the corpus
//      would be exactly where the drift hid.
//
// And identity of bytes is not identity of MEANING, so the object level rides too: a schema
// registered through the constructor resolves the same VIEW as one registered with the literal, on
// the same ground, read through the same door.

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

// Witness 1: the idiom, longhand. Do not fold this into the constructor — it is the pin.
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

// Witness 2: the corpus. A stock village schema, read as bytes — the body a real author shipped.
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
    // person.json is one of the 73 sites. If this ever diverges, the constructor is not the idiom.
    expect(termCanonicalHex(entityGatherBody())).toBe(
      termCanonicalHex(parseTerm(villageBody("person.json"))),
    );
  });

  it("carries the mask through — the knob is load-bearing, not decoration", () => {
    // A constructor that ignored `mask` would satisfy every assertion above and produce the WRONG
    // program for the governed and annotated postures. These three must be three programs.
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
    // The governed body is the same skeleton with a trust policy — it must still BE this gather,
    // which is what makes `governedGatherBody` a caller of the constructor rather than a rival.
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
    // circle.json expands `friend` into each Person's own view — the shape, from the corpus.
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

// --- the OBJECT level ----------------------------------------------------------------------------
//
// Byte-identity says the two programs are the same delta. It does not say the door resolves them
// the same way, and the door is what a consumer actually meets.

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
  // The same ground in both stores: two heights and a tag, one author, fixed timestamps.
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
    // Asserted against a KNOWN answer as well as against each other: two stores that both resolved
    // nothing would agree perfectly and prove nothing.
    expect(a.data).toEqual({ plant: { height: 41, tag: ["shade"] } });
    expect(b.data).toEqual(a.data);

    await viaConstructor.close();
    await viaLiteral.close();
  });

  it("is the same body the store binds — a re-registration under one name is accepted as identical", async () => {
    // The registry refuses two bindings for one hyperschema name with DIFFERENT bodies (a termHash
    // mismatch). Re-publishing the constructor's body over a store booted on the literal therefore
    // PASSES only if the two are the same program to the store itself, not merely to this test.
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

// The suite's own most-reused fixture now comes from the constructor, so the ~40 existing tests that
// read through `PLANT_BODY` exercise it. Kept as an assertion rather than a comment: this is the
// claim that made the conversion safe, and it holds in both directions — before the conversion it
// says the fixture IS the idiom, after it says the constructor reproduced the fixture exactly.
describe("T83 — the converted call sites", () => {
  it("leaves test/spike/garden.ts's PLANT_BODY the same program", () => {
    expect(termCanonicalHex(PLANT_BODY)).toBe(termCanonicalHex(parseTerm(PLAIN_LITERAL)));
  });

  it("leaves accounts.ts's TENANT gather the same program", () => {
    // TENANT is the UNGOVERNED audit body — `drop`, every negation binding. Its governed twin is
    // covered by the mask leg above; between them the three accounts.ts sites are pinned.
    expect(termCanonicalHex(TENANT.body)).toBe(termCanonicalHex(parseTerm(PLAIN_LITERAL)));
  });

  // NOT asserted, and named rather than papered over: nothing anywhere pins `TENANT.alg`, so the
  // mutation gate flips it 1 → 2 and survives. It is inert TODAY because TENANT is resolved in
  // memory as the audit schema and never published — and `alg` only becomes load-bearing at rest,
  // where it joins a hyperschema's law address (`loam.law.hyperschema|name|alg|body`, adopt-law.ts).
  // An `expect(TENANT.alg).toBe(1)` here would assert a constant against itself; the rail that would
  // genuinely close it is a law-address assertion on a PUBLISHED Tenant, which nothing needs yet.
});
