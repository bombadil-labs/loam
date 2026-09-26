// When no schema definition holds at the read time, the explanation names the first later moment
// one holds, or says none ever does. A negation that starts later leaves the definition live until
// then, so the first moment is the definition's own start, not "never".

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  DeltaSet,
  makeNegationClaims,
  publishHyperSchemaClaims,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
import { explainMissingDefinition } from "../../src/gateway/adopt-law.js";
import { PLANT } from "./fixtures.js";

const SEED = "c4".repeat(32);
const OP = authorForSeed(SEED);
const ENTITY = "hyperschema:Plant";

const definition = (validFrom: number): Delta =>
  signClaims({ ...publishHyperSchemaClaims(PLANT, ENTITY, OP, validFrom), validFrom }, SEED);
const strike = (target: Delta, validFrom: number): Delta =>
  signClaims({ ...makeNegationClaims(OP, validFrom, target.id), validFrom }, SEED);

describe("explaining a missing schema definition", () => {
  it("a definition that starts later names its start", () => {
    const d = definition(100);
    expect(explainMissingDefinition(DeltaSet.from([d]), ENTITY, 50)).toBe(
      `the schema definition for ${ENTITY} is valid only from 100, and this store reads at 50`,
    );
  });

  it("a negation that starts later still leaves the definition live from its own start", () => {
    const d = definition(100);
    expect(explainMissingDefinition(DeltaSet.from([d, strike(d, 200)]), ENTITY, 50)).toBe(
      `the schema definition for ${ENTITY} is valid only from 100, and this store reads at 50`,
    );
  });

  it("a definition struck from before its start is never live", () => {
    const d = definition(100);
    expect(explainMissingDefinition(DeltaSet.from([d, strike(d, 50)]), ENTITY, 50)).toBe(
      `no surviving schema definition for ${ENTITY}`,
    );
  });

  it("no definition at all says so (a control)", () => {
    expect(explainMissingDefinition(DeltaSet.from([]), ENTITY, 50)).toBe(
      `no surviving schema definition for ${ENTITY}`,
    );
  });
});
