// Records how Loam's negation readers treat a strike with its own validity interval, before step 4
// replaces them. Each strike is read at the moment before its boundary, at it, and after it. Beside
// Loam's readers sits the substrate's answer: a `trust` mask for the operator, evaluated at the
// read time. Where the two differ, step 4 moves a decision.
// Scope: raw ingest for the readers; one booted gateway for a registration's served surface.

import { afterEach, describe, it, vi } from "vitest";
import {
  evalTerm,
  parseTerm,
  signClaims,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { dataStruck, honoredStrikeOn } from "../../src/gateway/accounts.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { CTX_REGISTRATION, lawfulNegated } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY } from "../../test/gateway/fixtures.js";
import { bothOrders, idsOf, KEY, record, SEEDS, signed, strike, type Who } from "./corpus.js";

const T = 100; // every boundary in this corpus

afterEach(() => {
  vi.useRealTimers();
});

const claim = (t: number, label: string): Delta => {
  const claims: Claims = {
    timestamp: t,
    validFrom: t,
    author: KEY.writer,
    pointers: [
      { role: "height", target: { kind: "primitive", value: t } },
      { role: "plant", target: { kind: "entity", entity: { id: "plant:fern", context: "h" } } },
    ],
  };
  return signed(claims, "writer", label);
};

/** A strike on `target` by `by`, created at 50 and valid over `interval`. */
const timedStrike = (
  target: Delta,
  by: Who,
  interval: { validFrom: number; validUntil?: number },
  label: string,
): Delta => signed({ ...strike(target, by, 50).claims, ...interval }, by, label);

const starts = claim(10, "claim/struck-from-T");
const ends = claim(11, "claim/struck-until-T");
const revives = claim(12, "claim/counterstruck-from-T");
const plain = claim(13, "claim/never-struck");

const startsStrike = timedStrike(starts, "operator", { validFrom: T }, "strike/from-T");
const endsStrike = timedStrike(
  ends,
  "operator",
  { validFrom: 50, validUntil: T },
  "strike/until-T",
);
const revivesStrike = signed(strike(revives, "operator", 20).claims, "operator", "strike/plain");
const counter = timedStrike(revivesStrike, "operator", { validFrom: T }, "counter/from-T");

const CORPUS: readonly Delta[] = [
  starts,
  ends,
  revives,
  plain,
  startsStrike,
  endsStrike,
  revivesStrike,
  counter,
];
const CLAIMS = [starts, ends, revives, plain];

// The substrate's own answer: which claims survive the operator's strikes at `now`.
const substrateLive = (r: Reactor, now: number): Set<string> => {
  const term = parseTerm({
    op: "mask",
    policy: { trust: { match: { field: "author", cmp: "eq", const: KEY.operator } } },
    in: "input",
  });
  const out = evalTerm(term, r.snapshot(), now);
  if (out.sort !== "dset") throw new Error("a mask evaluates to a delta set");
  return new Set([...out.set].map((d) => d.id));
};

describe("recordings: suppression across a strike's validity boundary", () => {
  it("content addresses of the corpus", async () => {
    await record("suppression-time.ids", idsOf(CORPUS));
  });

  it("each reader at T-1, T and T+1", async () => {
    const at = (now: number) =>
      bothOrders(CORPUS, (r) => {
        const lawful = lawfulNegated(r, KEY.operator);
        const struck = dataStruck(r, KEY.operator);
        const live = substrateLive(r, now);
        return Object.fromEntries(
          CLAIMS.map((d) => [
            d.id,
            {
              lawfulNegated: lawful(d.id),
              dataStruck: struck(d.id),
              honoredStrikeOn: honoredStrikeOn(r, d.id, KEY.operator) !== undefined,
              substrateStruck: !live.has(d.id),
            },
          ]),
        );
      });
    await record("suppression-time.verdicts", {
      "now = T-1": at(T - 1),
      "now = T": at(T),
      "now = T+1": at(T + 1),
    });
  });

  it("a registration struck from T: the served names at T-1, T and T+1", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const T0 = 1_000_000;
    vi.setSystemTime(T0 - 1);
    const genesis = assembleGenesis({
      operatorSeed: SEEDS.operator,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: ["plant:fern"], writable: [] },
        {
          hyperschema: { ...PLANT, name: "Shrub" },
          schema: PLANT_POLICY,
          roots: ["plant:fern"],
          writable: [],
        },
      ],
    });
    const shrub = genesis.deltas.find(
      (d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
        ) && JSON.stringify(d.claims).includes("registration:hyperschema:Shrub"),
    )!;
    const gw = await Gateway.boot(new MemoryBackend(), genesis);
    const negation = signClaims(
      { ...strike(shrub, "operator", T0 - 1).claims, validFrom: T0 },
      SEEDS.operator,
    );
    await gw.append([negation]);
    const names = () => gw.registered.map((r) => r.hyperschema.name).sort();
    const out: Record<string, string[]> = { "now = T-1": names() };
    await vi.advanceTimersByTimeAsync(1);
    out["now = T"] = names();
    await vi.advanceTimersByTimeAsync(1);
    out["now = T+1"] = names();
    await record("suppression-time.registration", out);
    await gw.close();
  });
});
