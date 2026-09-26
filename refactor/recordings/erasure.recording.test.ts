// Records Loam's erasure decisions over one corpus of tombstones: the door's shape check, the
// refused-id set, the receipt ledger, the as-of annotation and the strike closure a slate seeds.
// Scope: raw ingest, so no door and no purge runs; this pins decisions, not byte removal.
//
// One recorded behavior is due to change: a struck tombstone is "forgiven" and its id may return.
// Myk ruled on 2026-09-25 (PLAN.md F3) that an erasure is eternal. When Loam implements that, the
// `refused` recordings move, on purpose.

import { describe, it } from "vitest";
import { Reactor, type Claims, type Delta } from "@bombadil/rhizomatic";
import {
  eraseClaims,
  eraseDefect,
  forgottenSince,
  readErasures,
  receiptLedger,
  sealCommitment,
  erasuresIn,
} from "../../src/gateway/erase.js";
import { condemnedClosure } from "../../src/gateway/slate.js";
import { dataStruck } from "../../src/gateway/accounts.js";
import { lawfulNegated } from "../../src/gateway/registration.js";
import {
  bothOrders,
  idsOf,
  ingestTrace,
  KEY,
  Raw,
  reactorOf,
  record,
  signed,
  strike,
  type Who,
} from "./corpus.js";

const claim = (by: Who, t: number, label: string): Delta => {
  const claims: Claims = {
    timestamp: t,
    validFrom: t,
    author: KEY[by],
    pointers: [{ role: "note", target: { kind: "primitive", value: label } }],
  };
  return signed(claims, by, label);
};

const tomb = (target: Delta, spokenBy: Who, by: Who, t: number, label: string, reason?: string) =>
  signed(eraseClaims(target.id, KEY[spokenBy], KEY[by], t, reason), by, label);

const erased = claim("writer", 10, "target/erased");
const forgiven = claim("writer", 11, "target/forgiven");
const reforgotten = claim("writer", 12, "target/forgiven-then-unforgiven");
const byStranger = claim("writer", 13, "target/stranger-tombstone");
const wrongAuthor = claim("writer", 14, "target/wrong-spoken-by");
const bystander = claim("writer", 15, "target/bystander");
const struckClaim = claim("writer", 16, "target/struck-claim");

const t1 = tomb(erased, "writer", "operator", 20, "tomb/operator", "asked by the subject");
const t2 = tomb(forgiven, "writer", "operator", 21, "tomb/forgiven");
const forgive = signed(strike(t2, "operator", 22).claims, "operator", "strike/forgives-tomb");
const t3 = tomb(reforgotten, "writer", "operator", 23, "tomb/re-forgotten");
const forgive3 = signed(strike(t3, "operator", 24).claims, "operator", "strike/forgives-tomb3");
const unforgive3 = signed(strike(forgive3, "operator", 25).claims, "operator", "strike/unforgives");
const t4 = tomb(byStranger, "writer", "stranger", 26, "tomb/by-stranger");
const t5 = tomb(wrongAuthor, "stranger", "operator", 27, "tomb/wrong-spoken-by");
const strikeOnClaim = signed(
  strike(struckClaim, "operator", 28).claims,
  "operator",
  "strike/claim",
);
const t6 = tomb(strikeOnClaim, "operator", "operator", 29, "tomb/erases-a-strike");

const CORPUS: readonly Delta[] = [
  erased,
  forgiven,
  reforgotten,
  byStranger,
  wrongAuthor,
  bystander,
  struckClaim,
  t1,
  t2,
  forgive,
  t3,
  forgive3,
  unforgive3,
  t4,
  t5,
  strikeOnClaim,
  t6,
];
const TOMBSTONES = [t1, t2, t3, t4, t5, t6];
const OPERATORS = { governed: KEY.operator, ungoverned: undefined } as const;

describe("recordings: erasure decisions", () => {
  it("content addresses and the seal commitment", async () => {
    await record("erasure.ids", {
      ids: idsOf(CORPUS),
      seal: new Raw(sealCommitment("salt-1", KEY.writer)),
    });
  });

  it("eraseDefect for each tombstone, with its target present and absent", async () => {
    const withTargets = new Reactor();
    for (const d of CORPUS) withTargets.ingest(d);
    const empty = new Reactor();
    const out: Record<string, unknown> = {};
    for (const [mode, op] of Object.entries(OPERATORS)) {
      out[mode] = Object.fromEntries(
        TOMBSTONES.map((t) => [
          t.id,
          {
            targetPresent: eraseDefect(t, withTargets, op),
            targetAbsent: eraseDefect(t, empty, op),
          },
        ]),
      );
    }
    const malformed: Claims = {
      ...eraseClaims(erased.id, KEY.writer, KEY.operator, 40),
      pointers: [
        ...eraseClaims(erased.id, KEY.writer, KEY.operator, 40).pointers,
        { role: "erases", target: { kind: "delta", deltaRef: { delta: bystander.id } } },
      ],
    };
    out["two erases pointers"] = eraseDefect(
      signed(malformed, "operator"),
      withTargets,
      KEY.operator,
    );
    await record("erasure.defects", out);
  });

  it("refused ids, receipts and the as-of annotation", async () => {
    const out: Record<string, unknown> = {};
    for (const [mode, op] of Object.entries(OPERATORS)) {
      out[mode] = bothOrders(CORPUS, (r) => ({
        refused: readErasures(r, op),
        refusedBeforeBoot: erasuresIn(r.snapshot(), op),
        ledger: receiptLedger(r, op),
        forgottenSince: Object.fromEntries(
          [0, 20, 23, 29].map((t) => [`since ${t}`, forgottenSince(r, op, t)]),
        ),
      }));
    }
    await record("erasure.readers", out);
  });

  it("the substrate accepts every corpus delta", async () => {
    await record("erasure.ingest", ingestTrace(CORPUS).verdicts);
  });

  // F1: erasing a strike brings its target back. Removal is modeled as a ground without the
  // strike's bytes, the state a completed purge leaves; the purge itself is not run here.
  it("a strike's target before and after the strike's bytes are removed", async () => {
    const reading = (deltas: readonly Delta[]) => {
      const r = reactorOf(deltas);
      return {
        lawfulNegated: lawfulNegated(r, KEY.operator)(struckClaim.id),
        dataStruck: dataStruck(r, KEY.operator)(struckClaim.id),
        refused: readErasures(r, KEY.operator).has(strikeOnClaim.id),
      };
    };
    await record("erasure.strike-removal", {
      before: reading(CORPUS),
      after: reading(CORPUS.filter((d) => d.id !== strikeOnClaim.id)),
    });
  });

  it("the strike closure a slate seeds", async () => {
    const out = bothOrders(CORPUS, (r) =>
      Object.fromEntries(
        [
          ["a claim with one strike", [struckClaim.id]],
          ["a forgiven tombstone", [t2.id]],
          ["a chain of three", [t3.id]],
          ["a bystander", [bystander.id]],
        ].map(([name, seed]) => [name as string, condemnedClosure(r, seed as string[])]),
      ),
    );
    await record("erasure.closure", out);
  });
});
