// The translator's reconciliation retracts renderings signed by ANY key of its principal
// (`keysEverOf`): a rendering minted under an old key R has since bound is R's to retract. The
// rail is two-sided, because this widens what the pass negates: the bound old key's rendering is
// retracted, and a bystander translator's rendering of the same struck source stays live and is
// counted as stranded. Both are asserted at the delta level (a surviving strike, or none) and in
// the pass's own report. The object level for renderings is pinned by translate-suppression.test.ts.

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

describe("the translator retracts what any key of its principal rendered", () => {
  it("without a binding, R's pass retracts neither K's nor Y's rendering", async () => {
    const { gw, source } = await world();
    const report = await translate(gw, { seed: R_SEED });
    expect(report.retracted ?? 0).toBe(0);
    expect(report.stranded).toBe(2);
    expect(isSuppressed(gw, renderingBy(gw, K, source.id).id)).toBe(false);
    expect(isSuppressed(gw, renderingBy(gw, Y, source.id).id)).toBe(false);
    await gw.close();
  });

  it("once R binds K, R's pass retracts K's rendering and leaves the bystander's live", async () => {
    const { gw, source } = await world();
    await gw.append([binding(K, 6500)]);
    const report = await translate(gw, { seed: R_SEED });
    expect(report.retracted).toBe(1);
    expect(report.stranded).toBe(1);
    expect(isSuppressed(gw, renderingBy(gw, K, source.id).id)).toBe(true);
    expect(isSuppressed(gw, renderingBy(gw, Y, source.id).id)).toBe(false);
    await gw.close();
  });
});
