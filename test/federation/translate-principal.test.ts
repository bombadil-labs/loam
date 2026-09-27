// The translator's reconciliation retracts only renderings its principal OWNS (`keysEverOf`). A
// SPEC-14 binding is association evidence that any writer can sign about anyone's key, so a
// translator binding a stranger's key must not make that stranger's renderings its own: they stay
// live and are counted as stranded. An earlier key becomes the translator's own only through an
// operator-governed recovery record (step 5, PR 3e). Asserted at the delta level (a surviving
// strike, or none) and in the pass's own report; the object level is translate-suppression.test.ts.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta, type Pointer } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { translate, translationClaims } from "../../src/federation/translate.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { isSuppressed, retraction } from "../gateway/narrowing.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const R_SEED = "1b".repeat(32); // the translator's principal root
const R = authorForSeed(R_SEED);
const K_SEED = "4e".repeat(32); // R's old key, which ran the pass before
const K = authorForSeed(K_SEED);
const Y_SEED = "5f".repeat(32); // a bystander translator
const Y = authorForSeed(Y_SEED);
const SOURCE_SEED = "ab".repeat(32);
const SOURCE = authorForSeed(SOURCE_SEED);

const prim = (role: string, value: string): Pointer => ({
  role,
  target: { kind: "primitive", value },
});

const entry = (ts: number): Delta =>
  signClaims(
    {
      timestamp: ts,
      validFrom: ts,
      author: SOURCE,
      pointers: [
        {
          role: "film_watched",
          target: { kind: "entity", entity: { id: "film:x", context: "log" } },
        },
        { role: "viewer", target: { kind: "entity", entity: { id: "person:w", context: "h" } } },
      ],
    },
    SOURCE_SEED,
  );

const SPEC = {
  recognize: { hasPointer: { role: { exact: "film_watched" } } },
  emit: {
    pointers: [
      { role: "guest", at: { from: { role: "viewer" } }, context: "events_attended" },
      { role: "origin", value: "log" },
    ],
  },
};

const renderingBy = (gw: Gateway, author: string, sourceId: string): Delta =>
  [...gw.reactor.snapshot()].find(
    (d) =>
      d.claims.author === author &&
      d.claims.pointers.some(
        (p) =>
          p.role === "translates" &&
          p.target.kind === "delta" &&
          p.target.deltaRef.delta === sourceId,
      ),
  )!;

const binding = (key: string, t: number): Delta =>
  signClaims(
    {
      timestamp: t,
      validFrom: t,
      author: R,
      pointers: [
        {
          role: "principal",
          target: { kind: "entity", entity: { id: R, context: "rhizomatic.principal" } },
        },
        prim("kind", "binding"),
        prim("key", key),
      ],
    },
    R_SEED,
  );

async function world(): Promise<{ gw: Gateway; source: Delta }> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gw.append([
    ...[R, K, Y, SOURCE].map((who, i) =>
      signClaims(grantClaims(STORE_ENTITY, who, "write", OPERATOR, i + 1), OPERATOR_SEED),
    ),
    signClaims(translationClaims("log", SPEC.recognize, SPEC.emit, OPERATOR, 10), OPERATOR_SEED),
  ]);
  const source = entry(5000);
  await gw.append([source]);
  expect((await translate(gw, { seed: K_SEED })).emitted).toBe(1);
  expect((await translate(gw, { seed: Y_SEED })).emitted).toBe(1);
  await gw.append([retraction(source.id, OPERATOR, OPERATOR_SEED, 6000)]);
  return { gw, source };
}

describe("the translator retracts only what its principal owns", () => {
  it("without a binding, R's pass retracts neither K's nor Y's rendering", async () => {
    const { gw, source } = await world();
    const report = await translate(gw, { seed: R_SEED });
    expect(report.retracted ?? 0).toBe(0);
    expect(report.stranded).toBe(2);
    expect(isSuppressed(gw, renderingBy(gw, K, source.id).id)).toBe(false);
    expect(isSuppressed(gw, renderingBy(gw, Y, source.id).id)).toBe(false);
    await gw.close();
  });

  it("R's own binding for K does not make K's rendering R's to retract (the adversarial case)", async () => {
    const { gw, source } = await world();
    const bind = binding(K, 6500);
    await gw.append([bind]);
    expect(gw.reactor.get(bind.id)).toBeDefined();
    const report = await translate(gw, { seed: R_SEED });
    expect(report.retracted ?? 0).toBe(0);
    expect(report.stranded).toBe(2);
    expect(isSuppressed(gw, renderingBy(gw, K, source.id).id)).toBe(false);
    expect(isSuppressed(gw, renderingBy(gw, Y, source.id).id)).toBe(false);
    await gw.close();
  });
});
