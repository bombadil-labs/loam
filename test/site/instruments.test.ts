// The Ground pane's classifier (SPEC §19): kind badges are recognized by the constitutional
// contexts and pointer shapes Loam itself uses. This suite pins the classification over REAL
// deltas built by the library's own constructors — a badge that misnames a record would
// teach a falsehood on every row.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import { operatorMarkerClaims, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { publicClaims } from "../../src/gateway/public.js";
import { registrationClaims } from "../../src/gateway/registration.js";
import { trustClaims } from "../../src/gateway/trust.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
// The page and this test share the classifier — same import discipline as the arc.
import { classifyDelta, isReadOnlyDocument } from "../../demos/tutorial/instruments.mjs";

const SEED = "0e".repeat(32);
const ME = authorForSeed(SEED);
const sign = (claims: Parameters<typeof signClaims>[0]) => signClaims(claims, SEED);

const kindOf = (delta: Parameters<typeof classifyDelta>[0], self = ME) =>
  classifyDelta(delta, self).kind;

describe("isReadOnlyDocument: only reads may re-run themselves", () => {
  it("admits queries, refuses mutations, subscriptions, mixed documents, and garbage", () => {
    expect(isReadOnlyDocument(`{ film(entity: "f") { title } }`)).toBe(true);
    expect(isReadOnlyDocument(`query A { film(entity: "f") { title } }`)).toBe(true);
    expect(isReadOnlyDocument(`mutation { film(entity: "f", rating: 9) { rating } }`)).toBe(false);
    expect(isReadOnlyDocument(`subscription { film(entity: "f") { title } }`)).toBe(false);
    expect(
      isReadOnlyDocument(
        `query A { film(entity: "f") { title } } mutation B { film(entity: "f", rating: 1) { rating } }`,
      ),
    ).toBe(false);
    expect(isReadOnlyDocument(`not graphql at all`)).toBe(false);
  });
});

describe("classifyDelta: every badge earns its name", () => {
  it("recognizes the constitution", () => {
    expect(kindOf(sign(operatorMarkerClaims(ME)))).toBe("constitution");
  });

  it("recognizes a registration", () => {
    const policy = {
      props: new Map(),
      default: { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } },
    };
    expect(kindOf(sign(registrationClaims("schema:Plant", policy as never, [FERN], ME, 5)))).toBe(
      "registration",
    );
  });

  it("recognizes a grant", () => {
    expect(kindOf(sign(grantClaims(STORE_ENTITY, GARDENER, "write", ME, 6)))).toBe("grant");
  });

  it("recognizes a trust posture", () => {
    expect(kindOf(sign(trustClaims("open", [], ME, 7)))).toBe("trust");
  });

  it("recognizes an open-door declaration", () => {
    expect(kindOf(sign(publicClaims(["Plant"], ME, 8)))).toBe("public");
  });

  it("recognizes a tombstone", () => {
    expect(kindOf(sign(eraseClaims("1e20" + "ab".repeat(34), GARDENER, ME, 9)))).toBe("tombstone");
  });

  it("recognizes a negation (and a tombstone is NOT merely a negation)", () => {
    const target = observed(FERN, "height", 30, 1000, SEED);
    expect(kindOf(sign(makeNegationClaims(ME, 10, target.id, "retracted")))).toBe("negation");
  });

  it("recognizes a derived record (a runner's emission)", () => {
    // a derived delta carries the runner's provenance pointer `rhizomatic.derived.by`
    expect(
      kindOf(
        sign({
          timestamp: 11,
          author: ME,
          pointers: [
            { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "tally" } } },
            { role: "value", target: { kind: "primitive", value: "2 screenings" } },
            {
              role: "rhizomatic.derived.by",
              target: { kind: "entity", entity: { id: "fn:tally", context: "definition" } },
            },
          ],
        }),
      ),
    ).toBe("derived");
  });

  it("recognizes a schema definition", () => {
    expect(
      kindOf(
        sign({
          timestamp: 3,
          author: ME,
          pointers: [
            {
              role: "rhizomatic.schema.defines",
              target: { kind: "entity", entity: { id: "schema:Plant", context: "definition" } },
            },
          ],
        }),
      ),
    ).toBe("schema");
  });

  it("a grant is recognized by the gateway's own grammar (context, not entity id)", () => {
    // A non-default tenant's grant is still a grant...
    expect(kindOf(sign(grantClaims("tenant:garden", GARDENER, "write", ME, 6)))).toBe("grant");
    // ...and a delta that merely MENTIONS loam:store under some other context is a fact —
    // badging it "standing changing hands" would teach a falsehood.
    expect(
      kindOf(
        sign({
          timestamp: 4,
          author: ME,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: STORE_ENTITY, context: "note" } },
            },
            { role: "value", target: { kind: "primitive", value: "just talking about it" } },
          ],
        }),
      ),
    ).toBe("fact");
  });

  it("foreign constitutional records get the DATA note, not the sovereign one", () => {
    const theirs = signClaims(operatorMarkerClaims(GARDENER), GARDENER_SEED);
    const cls = classifyDelta(theirs, ME);
    expect(cls.kind).toBe("constitution");
    expect(cls.foreign).toBe(true);
    expect(cls.note).toMatch(/binds nothing here/);
  });

  it("a plain claim is a fact, and someone else's is foreign", () => {
    const mine = observed(FERN, "height", 30, 1000, SEED);
    const theirs = observed(FERN, "height", 34, 2000, GARDENER_SEED);
    expect(kindOf(mine)).toBe("fact");
    expect((classifyDelta(mine, ME) as { foreign: boolean }).foreign).toBe(false);
    expect((classifyDelta(theirs, ME) as { foreign: boolean }).foreign).toBe(true);
  });
});
