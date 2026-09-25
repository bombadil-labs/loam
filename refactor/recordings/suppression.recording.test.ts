// Records Loam's four answers to "whose strike binds" side by side, over one corpus of strike
// chains: `lawfulNegated`, `dataStruck`, `honoredStrikeOn` and `survivalOver`. Step 4 of the plan
// names suppression trust; this recording shows where the four readers agree today and where they
// differ. Scope: raw ingest, forward and reverse order only.

import { describe, it } from "vitest";
import type { Claims, Delta } from "@bombadil/rhizomatic";
import { dataStruck, grantClaims, honoredStrikeOn } from "../../src/gateway/accounts.js";
import { survivalOver } from "../../src/gateway/adopt-law.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { lawfulNegated } from "../../src/gateway/registration.js";
import { bothOrders, idsOf, KEY, record, signed, strike, type Who } from "./corpus.js";

const claim = (by: Who, t: number, label: string): Delta => {
  const claims: Claims = {
    timestamp: t,
    author: KEY[by],
    pointers: [
      { role: "height", target: { kind: "primitive", value: t } },
      { role: "plant", target: { kind: "entity", entity: { id: "plant:fern", context: "h" } } },
    ],
  };
  return signed(claims, by, label);
};

const adminGrant = signed(
  grantClaims(STORE_ENTITY, KEY.admin, "admin", KEY.operator, 1),
  "operator",
  "op→admin:admin",
);
const writerGrant = signed(
  grantClaims(STORE_ENTITY, KEY.writer, "write", KEY.operator, 2),
  "operator",
  "op→writer:write",
);

// One claim per striker, so each reader's verdict on each striker is visible.
const byOperator = claim("writer", 10, "claim/struck-by-operator");
const byAdmin = claim("writer", 11, "claim/struck-by-admin");
const byWriter = claim("writer", 12, "claim/struck-by-its-own-author");
const byStranger = claim("writer", 13, "claim/struck-by-stranger");
const byOtherWriter = claim("operator", 14, "claim/by-operator-struck-by-writer");
// Chains: a strike struck by its own author, and one struck by a stranger.
const revived = claim("writer", 15, "claim/strike-then-counterstrike");
const twice = claim("writer", 16, "claim/two-strikes-one-struck");
const plain = claim("writer", 17, "claim/never-struck");

const s = (target: Delta, by: Who, t: number, label: string): Delta => {
  const d = strike(target, by, t);
  return signed(d.claims, by, label);
};
const opStrike = s(byOperator, "operator", 20, "strike/operator");
const adminStrike = s(byAdmin, "admin", 21, "strike/admin");
const writerStrike = s(byWriter, "writer", 22, "strike/writer-own");
const strangerStrike = s(byStranger, "stranger", 23, "strike/stranger");
const writerOnOperator = s(byOtherWriter, "writer", 24, "strike/writer-on-operator");
const firstStrike = s(revived, "writer", 25, "strike/on-revived");
const counterStrike = s(firstStrike, "operator", 26, "strike/counter-by-operator");
const twiceA = s(twice, "operator", 27, "strike/twice-a-by-operator");
const twiceB = s(twice, "operator", 28, "strike/twice-b-by-operator");
const twiceBStruck = s(twiceB, "operator", 29, "strike/strikes-twice-b");
const strangerOnOpStrike = s(
  opStrike,
  "stranger",
  30,
  "strike/stranger-counter-on-operator-strike",
);

const CORPUS: readonly Delta[] = [
  adminGrant,
  writerGrant,
  byOperator,
  byAdmin,
  byWriter,
  byStranger,
  byOtherWriter,
  revived,
  twice,
  plain,
  opStrike,
  adminStrike,
  writerStrike,
  strangerStrike,
  writerOnOperator,
  firstStrike,
  counterStrike,
  twiceA,
  twiceB,
  twiceBStruck,
  strangerOnOpStrike,
];

describe("recordings: suppression, four readers side by side", () => {
  it("content addresses of the corpus", async () => {
    await record("suppression.ids", idsOf(CORPUS));
  });

  it("each reader's verdict on each delta", async () => {
    const out: Record<string, unknown> = {};
    for (const [mode, op] of [
      ["governed", KEY.operator],
      ["ungoverned", undefined],
    ] as const) {
      out[mode] = bothOrders(CORPUS, (r) => {
        const lawful = lawfulNegated(r, op);
        const struck = dataStruck(r, op);
        const selfOnly = survivalOver([...r.snapshot()]);
        return Object.fromEntries(
          CORPUS.map((d) => [
            d.id,
            {
              lawfulNegated: lawful(d.id),
              dataStruck: struck(d.id),
              honoredStrikeOn: honoredStrikeOn(r, d.id, op),
              survivalOver: selfOnly(d.id),
            },
          ]),
        );
      });
    }
    await record("suppression.verdicts", out);
  });
});
