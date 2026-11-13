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
  type CutMemberReport,
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

const DEADLINE = 4_070_908_800_000;
const REQUESTED_AT = DEADLINE - 86_400_000;
const NOW = DEADLINE - 600_000;

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
  priorErasure: [],
};

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
      validFrom: timestamp,
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
    expect(SLATE_CONTEXTS).toEqual([CTX_SLATE, CTX_GRAVEYARD]);
    expect(CTX_SLATE).toBe("loam.erasure.slate");
    expect(CTX_GRAVEYARD).toBe("loam.erasure.graveyard");
    expect(SLATE_ENTITY).toBe("loam:slate");
    expect(RECOMMENDED_CLOSES).toBe("egress,cite");

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

    expect(slatePointer(CONTAINER)).toEqual({
      role: "slate",
      target: { kind: "entity", entity: { id: CONTAINER, context: CTX_SLATE } },
    });
    expect(frozenMembershipTerm(["b".repeat(64), "a".repeat(64)])).toEqual({
      op: "select",
      pred: { match: { field: "id", cmp: "inSet", const: ["a".repeat(64), "b".repeat(64)] } },
      in: "input",
    });

    expect(
      RECEIPT_FIELDS.filter((f) => f.side === "observation")
        .map((f) => f.field)
        .sort(),
    ).toEqual(["negated", "presentAgain", "tiers"]);
  });

  it("does NOT export the plumbing behind the doors", () => {
    const names = Object.keys(loam);
    for (const internal of [
      "cutImpl",
      "deriveReceiptImpl",
      "slateReportsImpl",
      "slateHealth",
      "negatedHealth",
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
    expect(slateDefect(record, gw.reactor, gw.validityNow(), OP)).toBeUndefined();
    const IMPOSTOR_SEED = "9b".repeat(32);
    const forged = signClaims(
      slateClaims(
        { ...SPEC, membershipAt: published.id, version },
        authorForSeed(IMPOSTOR_SEED),
        5002,
      ),
      IMPOSTOR_SEED,
    );
    expect(slateDefect(forged, gw.reactor, gw.validityNow(), OP)).toMatch(/operator/);
    await gw.append([record]);

    const reports: SlateReport[] = reviewDoor(gw, NOW);
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.record).toBe(record.id);
    expect(report.members).toEqual(condemned);
    expect(report.enforced).toEqual(["cite", "egress"]);
    expect(report.lapsed).toBe(false);
    const duplicates: readonly Duplicate[] = report.duplicates;
    expect(duplicates).toEqual([]);
    const slates: Slate[] = readSlates(gw.reactor, gw.validityNow(), OP, NOW);
    expect(slates).toHaveLength(1);
    expect(slates[0]!.record).toBe(record.id);
    expect([...slates[0]!.members].sort()).toEqual(condemned);
    expect(enforcedBy(slates[0]!)).toEqual(report.enforced);

    const cut: CutReport = await cutDoor(gw, CONTAINER, { now: NOW + 1000 });
    expect(cut.record).toBe(record.id);
    expect(cut.version).toBe(version);
    expect(cut.memberCount).toBe(2);
    expect(cut.members.map((m) => m.member).sort()).toEqual(condemned);
    const perMember: readonly CutMemberReport[] = cut.members;
    for (const m of perMember) {
      expect(loam.isErasure(gw.reactor.get(m.erasure)!.claims)).toBe(true);
      const tiers: readonly TierVerdict[] = m.tiers;
      const verdicts: ByteVerdict[] = tiers.map((t) => t.holds);
      expect(verdicts).not.toContain(true);
    }
    expect(gw.reactor.get(a.id)).toBeUndefined();
    expect(gw.reactor.get(b.id)).toBeUndefined();

    const graves: GraveyardRecord[] = graveyardsDoor(gw);
    expect(graves).toHaveLength(1);
    const grave = graves[0]!;
    expect(grave.id).toBe(cut.graveyard);
    expect(grave.container).toBe(CONTAINER);
    expect(grave.memberCount).toBe(2);
    expect(readGraveyards(gw.reactor, gw.validityNow(), OP)).toEqual(graves);
    const completeness: CompletenessCheck = graveyardCompleteness(
      gw.reactor,
      gw.validityNow(),
      OP,
      grave.id,
    );
    expect(completeness.readable).toBe(true);
    expect(completeness.cutCompleted).toBe(true);
    expect(completeness.holds).toBe(true);
    expect(completeness.members).toEqual(condemned);

    const receipt: Receipt = await receiptDoor(gw, grave.id, { now: NOW + 2000 });
    expect(receipt.graveyard).toBe(grave.id);
    expect(receipt.completeness.cutCompleted).toBe(true);
    const members: readonly ReceiptMember[] = receipt.members;
    expect(members.map((m) => m.member).sort()).toEqual(condemned);
    for (const m of members) {
      expect(m.erasure).toBeDefined();
      expect(m.presentAgain).toBe(false);
    }
    expect(receipt.nonClaim.length).toBeGreaterThan(0);

    await gw.close();
  });
});
