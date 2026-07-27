// T109 — the slate surface (SPEC §29) is reachable from the package barrel, on T82's rule: the
// barrel IS the package, so a name absent from `src/index.ts` is a name no consumer can import
// except by a deep `dist/gateway/*.js` path that carries no semver promise. This rail pins BOTH
// SIDES of that line for the slate/graveyard surface — the doors' vocabulary is public, the doors'
// plumbing is not.
//
// A NEW file rather than an extension of `test/index-surface.test.ts`, deliberately: that file is
// T82's frozen rail (rails freeze at landing; the CI backstop fails any edit), so each surface
// arrival earns its rails in its own file. Same idiom, same three levels:
//   NAME    — the export is present at runtime (a value) or at compile time (a type).
//   SIGNATURE — each door's signature is EXPRESSIBLE from public names alone. A type re-export
//               pointing at the wrong thing satisfies the name level and fails here.
//   OBJECT  — a slate is stood, reviewed, cut, and receipted through NOTHING but the barrel and
//             the substrate. That is the consumer's actual position, and the only level that
//             catches a name that is present, correctly typed, and unusable.
//
// Deliberately NOT asserted here: §29's semantics (the T64 suite's frozen rails own refusals,
// closures, and the erasure arithmetic) and the tarball (`test/cli/pack-slate.test.ts` pins the
// `.d.ts` files these re-exports resolve through).

import { describe, expect, it } from "vitest";
import { authorForSeed, parseSchema, signClaims } from "@bombadil/rhizomatic";
import * as loam from "../src/index.js";
import {
  CTX_GRAVEYARD,
  CTX_SLATE,
  Gateway,
  MemoryBackend,
  RECEIPT_FIELDS,
  RECOMMENDED_CLOSES,
  SLATE_CONTEXTS,
  SLATE_ENTITY,
  assembleGenesis,
  containerClaims,
  enforcedBy,
  entityGatherBody,
  frozenMembershipTerm,
  graveyardClaims,
  graveyardCompleteness,
  isGraveyard,
  isSlateRecord,
  readGraveyards,
  readSlates,
  slateClaims,
  slateDefect,
  slatePointer,
  termClaims,
  type ByteVerdict,
  type CompletenessCheck,
  type CutReport,
  type Duplicate,
  type GraveyardRecord,
  type GraveyardSpec,
  type Receipt,
  type ReceiptMember,
  type Slate,
  type SlateClosure,
  type SlateReport,
  type SlateSpec,
  type TierVerdict,
} from "../src/index.js";

const OP_SEED = "7a".repeat(32);
const OP = authorForSeed(OP_SEED);
const FERN = "plant:fern";
const CONTAINER = "container:slate:subject-7";

// WALL-CLOCK moments, passed explicitly — never `Date.now()`, never a race. The deadline sits far
// in the future so no assertion here depends on the day it runs.
const DEADLINE = 4_070_908_800_000; // 2099-01-01
const REQUESTED_AT = DEADLINE - 86_400_000;
const NOW = DEADLINE - 600_000;

// --- the SIGNATURE level -------------------------------------------------------------------------
//
// Each binding is an annotated alias of a real door, written from PUBLIC names only — it compiles
// exactly when the barrel re-exports the same types the method uses, which is the promise, and is
// not implied by the names being present.

const reviewDoor: (gw: Gateway, now: number) => SlateReport[] = (gw, now) => gw.slates(now);
const graveyardsDoor: (gw: Gateway) => GraveyardRecord[] = (gw) => gw.graveyards();
const cutDoor: (gw: Gateway, slate: string, opts: { now?: number }) => Promise<CutReport> = (
  gw,
  slate,
  opts,
) => gw.cut(slate, opts);
const receiptDoor: (gw: Gateway, graveyard: string, opts: { now?: number }) => Promise<Receipt> = (
  gw,
  graveyard,
  opts,
) => gw.receipt(graveyard, opts);

// The at-rest vocabulary, described from public names: the specs the claim builders eat.
const SPEC: SlateSpec = {
  container: CONTAINER,
  membershipAt: "d".repeat(64),
  version: "e".repeat(64),
  requestedBy: "subject:7",
  requestedByForm: "plain",
  requestedAt: REQUESTED_AT,
  deadline: DEADLINE,
  closes: ["egress", "cite"] satisfies readonly SlateClosure[],
};
const GRAVE_SPEC: GraveyardSpec = {
  container: CONTAINER,
  record: "f".repeat(64),
  version: "e".repeat(64),
  membershipAt: "d".repeat(64),
  memberCount: 2,
  opened: REQUESTED_AT,
  cutAt: NOW,
  closes: ["egress", "cite"],
  affected: [],
  priorTombstone: [],
};

// --- the world, built from the barrel alone ------------------------------------------------------

const PLANT_BODY = entityGatherBody();
const PLANT_SCHEMA = parseSchema({
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: { name: "Plant", alg: 1, body: PLANT_BODY },
          schema: PLANT_SCHEMA,
          roots: [FERN],
          writable: ["height"],
        },
      ],
    }),
  );

const height = (value: number, timestamp: number) =>
  signClaims(
    {
      timestamp,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "height" } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    OP_SEED,
  );

describe("T109 — the slate surface is reachable from the package barrel", () => {
  it("exports the vocabulary and the claim builders", () => {
    // The CONTEXT mint: a consumer recognizing slate law on the wire needs every one of them, and
    // `SLATE_CONTEXTS` is the enumerable whole.
    expect(SLATE_CONTEXTS).toEqual([CTX_SLATE, CTX_GRAVEYARD]);
    expect(CTX_SLATE).toBe("loam.erasure.slate");
    expect(CTX_GRAVEYARD).toBe("loam.erasure.graveyard");
    expect(SLATE_ENTITY).toBe("loam:erasure");
    expect(RECOMMENDED_CLOSES).toBe("egress,cite");

    // The builders, by their behavior rather than by `typeof` — a name bound to the wrong function
    // is a `function` too. A slate record declares the marker entity and pins the frozen pair.
    const record = slateClaims(SPEC, OP, 100);
    expect(record.pointers).toContainEqual({
      role: "declares",
      target: { kind: "entity", entity: { id: SLATE_ENTITY, context: CTX_SLATE } },
    });
    expect(record.pointers).toContainEqual({
      role: "membershipAt",
      target: { kind: "primitive", value: SPEC.membershipAt },
    });
    expect(isSlateRecord(record)).toBe(true);
    expect(isGraveyard(record)).toBe(false);

    // An empty closure set is SAYABLE (`none`), never silent.
    const open = slateClaims({ ...SPEC, closes: [] }, OP, 100);
    expect(open.pointers).toContainEqual({
      role: "closes",
      target: { kind: "primitive", value: "none" },
    });

    const grave = graveyardClaims(GRAVE_SPEC, OP, 200);
    expect(grave.pointers).toContainEqual({
      role: "graveyard",
      target: { kind: "entity", entity: { id: CONTAINER, context: CTX_GRAVEYARD } },
    });
    expect(isGraveyard(grave)).toBe(true);
    expect(isSlateRecord(grave)).toBe(false);

    // The §29.6 JOIN a cut stamps on each tombstone, and the extensional Term `termClaims`
    // publishes — the two builders a consumer needs to stand a slate over their own ids.
    expect(slatePointer(CONTAINER)).toEqual({
      role: "slate",
      target: { kind: "entity", entity: { id: CONTAINER, context: CTX_SLATE } },
    });
    expect(frozenMembershipTerm(["b".repeat(64), "a".repeat(64)])).toEqual({
      op: "select",
      pred: { match: { field: "id", cmp: "inSet", const: ["a".repeat(64), "b".repeat(64)] } },
      in: "input",
    });

    // §29.7's partition is a formatter's contract: a HISTORY field may be reprinted forever, an
    // OBSERVATION field never — reprinting one is the dry-run mistake wearing letterhead.
    expect(
      RECEIPT_FIELDS.filter((f) => f.side === "observation")
        .map((f) => f.field)
        .sort(),
    ).toEqual(["forgiven", "presentAgain", "tiers"]);
  });

  it("does NOT export the plumbing behind the doors", () => {
    // Each name below is exported from `src/gateway/slate.ts` for one reason — another module in
    // this package reaches it — and every one takes a `Gateway`/`Reactor` seam or exists to wire
    // the closures into ingest and reads. The door is the method; publishing the body would freeze
    // a seam as API.
    const names = Object.keys(loam);
    for (const internal of [
      "cutImpl",
      "deriveReceiptImpl",
      "slateReportsImpl",
      "slateHealth",
      "forgivenHealth",
      "slateRefusal",
      "egressWithheld",
      "readClosedIds",
      "readGround",
      "readGroundAsOf",
      "condemnedClosure",
      "landsReadClosure",
      "requireMoment",
      "freezeAgreement",
      "readFrozenTerm",
    ]) {
      expect(names).not.toContain(internal);
    }
  });

  it("stands, reviews, cuts, and receipts a slate through the barrel alone", async () => {
    const gw = await boot();
    const a = height(30, 1000);
    const b = height(31, 2000);
    await gw.append([a, b]);
    const condemned = [a.id, b.id].sort();

    // IDENTIFY (§29.2), every step from the barrel: publish the frozen Term, declare the SHARED
    // container citing it with the version it freezes to, land the record pinning the same pair.
    const term = frozenMembershipTerm(condemned);
    const published = signClaims(termClaims(term, OP, 5000), OP_SEED);
    await gw.append([published]);
    const version = gw.freeze(term).id;
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: CONTAINER,
            trust: "curated",
            posture: "shared",
            membershipAt: published.id,
            version,
          },
          OP,
          5001,
        ),
        OP_SEED,
      ),
    ]);
    const record = signClaims(
      slateClaims({ ...SPEC, membershipAt: published.id, version }, OP, 5002),
      OP_SEED,
    );
    // The door's own verdict is reachable, so a caller can pre-check before `append`: lawful is
    // silence, and any other author than the operator is refused in the door's own voice.
    expect(slateDefect(record, gw.reactor, OP)).toBeUndefined();
    const IMPOSTOR_SEED = "9b".repeat(32);
    const forged = signClaims(
      slateClaims(
        { ...SPEC, membershipAt: published.id, version },
        authorForSeed(IMPOSTOR_SEED),
        5002,
      ),
      IMPOSTOR_SEED,
    );
    expect(slateDefect(forged, gw.reactor, OP)).toMatch(/operator/);
    await gw.append([record]);

    // REVIEW through the door AND through the exported reader — the two must agree, or the barrel
    // is publishing a reader that answers a different question than the gateway.
    const reports: SlateReport[] = reviewDoor(gw, NOW);
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.record).toBe(record.id);
    expect(report.members).toEqual(condemned);
    expect(report.enforced).toEqual(["cite", "egress"]);
    expect(report.lapsed).toBe(false);
    const duplicates: readonly Duplicate[] = report.duplicates;
    expect(duplicates).toEqual([]);
    const slates: Slate[] = readSlates(gw.reactor, OP, NOW);
    expect(slates).toHaveLength(1);
    expect(slates[0]!.record).toBe(record.id);
    expect([...slates[0]!.members].sort()).toEqual(condemned);
    expect(enforcedBy(slates[0]!)).toEqual(report.enforced);

    // THE CUT (§29.5), through the door. Component report types named from the barrel: a per-tier
    // verdict is tri-state, and the annotations compile only if the barrel exports the same shapes
    // the report is made of.
    const cut: CutReport = await cutDoor(gw, CONTAINER, { now: NOW + 1000 });
    expect(cut.record).toBe(record.id);
    expect(cut.version).toBe(version);
    expect(cut.memberCount).toBe(2);
    expect(cut.members.map((m) => m.member).sort()).toEqual(condemned);
    for (const m of cut.members) {
      // The minted tombstone RESOLVES in the ground and is one — not just a plausible-looking id.
      expect(loam.isTombstone(gw.reactor.get(m.tombstone)!.claims)).toBe(true);
      const tiers: readonly TierVerdict[] = m.tiers;
      const verdicts: ByteVerdict[] = tiers.map((t) => t.holds);
      expect(verdicts).not.toContain(true); // no tier still holds the bytes
    }
    // Both levels (delta and object): the bytes are gone from the ground, and the door that
    // answers erasure law still answers — the deep semantics stay T64's frozen rails' subject.
    expect(gw.reactor.get(a.id)).toBeUndefined();
    expect(gw.reactor.get(b.id)).toBeUndefined();

    // THE GRAVEYARD (§29.6), door and reader agreeing, and the arithmetic checkable from durable
    // ground alone through `graveyardCompleteness`.
    const graves: GraveyardRecord[] = graveyardsDoor(gw);
    expect(graves).toHaveLength(1);
    const grave = graves[0]!;
    expect(grave.id).toBe(cut.graveyard);
    expect(grave.container).toBe(CONTAINER);
    expect(grave.memberCount).toBe(2);
    expect(readGraveyards(gw.reactor, OP)).toEqual(graves);
    const completeness: CompletenessCheck = graveyardCompleteness(gw.reactor, OP, grave.id);
    expect(completeness.readable).toBe(true);
    expect(completeness.cutCompleted).toBe(true);
    expect(completeness.holds).toBe(true);
    expect(completeness.members).toEqual(condemned);

    // THE RECEIPT (§29.7), re-derived at a named moment: per-member facts carry the barrel's own
    // shapes, and the non-claims are printed beside the verdicts, never as a footnote.
    const receipt: Receipt = await receiptDoor(gw, grave.id, { now: NOW + 2000 });
    expect(receipt.graveyard).toBe(grave.id);
    expect(receipt.completeness.cutCompleted).toBe(true);
    const members: readonly ReceiptMember[] = receipt.members;
    expect(members.map((m) => m.member).sort()).toEqual(condemned);
    for (const m of members) {
      expect(m.tombstone).toBeDefined();
      expect(m.presentAgain).toBe(false);
    }
    expect(receipt.nonClaim.length).toBeGreaterThan(0);

    await gw.close();
  });
});
