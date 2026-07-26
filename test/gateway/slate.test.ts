// T64 (SPEC §29) — what a SLATE IS, at both levels: the two deltas, the knobs the door enforces,
// the membership frozen by ENFORCEMENT rather than by promise, the required window, and forgiveness
// on both sides of the cut.
//
// Criteria 1, 2, 3, 15, 17. The door rails here are the ones that must hold before any closure
// matters: a separate-store slate is refused BY CONSTRUCTION (it would hold a second copy of every
// condemned delta and report a byte-verified clean discard over the legible originals — H7 wearing a
// container), and a membership that could still move is refused rather than trusted.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT: the three closures in depth (slate-doors.test.ts), the
// cut (slate-cut.test.ts), the graveyard arithmetic (graveyard.test.ts), and the receipt
// (slate-receipt.test.ts). It DOES assert per rail that a door which should not close has not —
// that half needs the closures to exist, so it arrives with them. Two-sidedness is kept throughout:
// every rail that proves something is refused also names something that still answers.

import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { CONTAINER_CONTEXTS, termClaims } from "../../src/gateway/container.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import {
  CTX_GRAVEYARD,
  CTX_SLATE,
  SLATE_CONTEXTS,
  frozenMembershipTerm,
  graveyardCompleteness,
  readSlates,
  slateClaims,
} from "../../src/gateway/slate.js";
import { FERN, observed } from "../spike/garden.js";
import {
  AFTER_DEADLINE,
  BEFORE_DEADLINE,
  groundIds,
  DEADLINE,
  OP,
  OP_SEED,
  REQUESTED_AT,
  bootSlateStore,
  declareContainer,
  standSlate,
  strike,
} from "./slating.js";

describe("T64 criterion 1 — a slate is a curated SHARED container plus a record", () => {
  it("a separate-store slate is REFUSED at the door, naming both knobs", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([condemned, bystander]);
    await expect(
      standSlate(gw, {
        container: "container:slate:separate",
        members: [condemned],
        closes: ["egress", "cite"],
        posture: "separate",
      }),
    ).rejects.toThrow(/curated\/shared/);
    // The refusal names BOTH knobs, so a reader learns which one to change.
    await expect(
      standSlate(gw, {
        container: "container:slate:separate2",
        members: [condemned],
        closes: ["egress", "cite"],
        posture: "separate",
      }),
    ).rejects.toThrow(/curated\/separate/);
    // Two-sided: the valid PROPERTY slate over the same members resolves.
    const stood = await standSlate(gw, { members: [condemned], closes: ["egress", "cite"] });
    const slates = gw.slates(BEFORE_DEADLINE);
    expect(slates).toHaveLength(1);
    expect(slates[0]!.container).toBe(stood.container);
    expect(slates[0]!.members).toEqual([condemned.id]);
    expect(slates[0]!.unresolved).toBeUndefined();
    await gw.close();
  });

  it("an UNTRUSTED slate is refused too — untrusted cannot take posture shared (§28.3)", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    // The container declaration itself refuses the untrusted/property pair, so the slate can never
    // point at one: the two refusals compose rather than leaving a gap between them.
    await expect(
      standSlate(gw, { members: [condemned], closes: ["cite"], trust: "untrusted" }),
    ).rejects.toThrow(/untrusted.*cannot take posture "shared"/s);
    await gw.close();
  });

  it("with a slate standing, an ordinary erase(unrelated) still COMPLETES", async () => {
    // The load-bearing half: a slate must never trip §27.7's unreachable-wall guard, which a
    // separate-store slate WOULD — every subsequent erase would refuse while the slate stood.
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const unrelated = observed(FERN, "tag", "fronds", 1100, OP_SEED);
    await gw.append([condemned, unrelated]);
    await standSlate(gw, { members: [condemned], closes: ["egress", "cite", "read"] });
    const result = await gw.erase(unrelated.id);
    expect(result.erased).toBe(unrelated.id);
    expect(await gw.backend.holds(unrelated.id)).toBe(false);
    // Two-sided: the SLATED delta is untouched by that erase — no byte of it moved.
    expect(await gw.backend.holds(condemned.id)).toBe(true);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).toEqual([condemned.id]);
    await gw.close();
  });

  it("the join is a POINTER: a container NAMED like a slate with no record is not one", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    const term = frozenMembershipTerm([condemned.id]);
    const published = signClaims(termClaims(term, OP, 50_000), OP_SEED);
    await gw.append([published]);
    await gw.append([
      declareContainer(
        {
          container: "container:slate:looks-like-one",
          trust: "curated",
          posture: "shared",
          membershipAt: published.id,
          version: gw.freeze(term).id,
        },
        50_001,
      ),
    ]);
    // A conventional name is a COMMENT: nothing can verify it, and a prefix code parses becomes law
    // by accident (the H6 register). No record, no slate — so no door closes.
    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    expect(gw.offeredDeltas().map((d) => d.id)).toContain(condemned.id);
    await gw.close();
  });
});

describe("T64 criterion 2 — membership is frozen by ENFORCEMENT, at both levels", () => {
  it("delta level: a membership that does not freeze to its declared version is REFUSED", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const other = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([condemned, other]);
    await expect(
      standSlate(gw, {
        members: [condemned],
        closes: ["cite"],
        wrongVersion: gw.freeze(frozenMembershipTerm([other.id])).id,
      }),
    ).rejects.toThrow(/does not freeze to the version it declares/);
    // A CONTAINER that points somewhere else than the record PINS is refused: the record's pair is
    // immutable, so a re-declaration cannot re-identify the set underneath a standing slate.
    await expect(
      standSlate(gw, {
        container: "container:slate:unfrozen",
        members: [condemned],
        closes: ["cite"],
        omitVersion: true,
      }),
    ).rejects.toThrow(/while the standing record PINS/);
    // And a RECORD carrying no pins at all is refused, naming why pinning only on the container is
    // not enough: a declaration is latest-wins on the pair, so the set could GROW after identification.
    const loose = frozenMembershipTerm([condemned.id]);
    const pub = signClaims(termClaims(loose, OP, 55_000), OP_SEED);
    await gw.append([pub]);
    await gw.append([
      declareContainer(
        {
          container: "container:slate:nopins",
          trust: "curated",
          posture: "shared",
          membershipAt: pub.id,
          version: gw.freeze(loose).id,
        },
        55_001,
      ),
    ]);
    const pinned = slateClaims(
      {
        container: "container:slate:nopins",
        membershipAt: pub.id,
        version: gw.freeze(loose).id,
        requestedBy: "subject:42",
        requestedByForm: "plain",
        requestedAt: REQUESTED_AT,
        deadline: DEADLINE,
        closes: ["cite"],
      },
      OP,
      55_002,
    );
    for (const role of ["membershipAt", "version"]) {
      await expect(
        gw.append([
          signClaims(
            { ...pinned, pointers: pinned.pointers.filter((x) => x.role !== role) },
            OP_SEED,
          ),
        ]),
      ).rejects.toThrow(new RegExp(`PINS its condemned set: exactly one string \`${role}\``));
    }
    // Two-sided: the agreeing declaration binds.
    const stood = await standSlate(gw, {
      container: "container:slate:agrees",
      members: [condemned],
      closes: ["cite"],
    });
    expect(gw.slates(BEFORE_DEADLINE).map((s) => s.container)).toEqual([stood.container]);
    await gw.close();
  });

  it("THE OVER-PURGE PROBE: a container re-declared WIDER mid-window cannot widen the cut", async () => {
    // The whole point of §29.2, at the one level that matters: a container declaration is LATEST-WINS
    // on membershipAt/version (only trust/posture are fixed to the earliest), so pinning the condemned
    // set only there would let one further operator-signed declaration re-point it — every door
    // passing, the cut destroying the widened set, and the graveyard recording the WIDENED address so
    // every receipt would prove completeness over the set that was cut rather than the set identified.
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystanders = [
      observed(FERN, "height", 31, 1001, OP_SEED),
      observed(FERN, "height", 32, 1002, OP_SEED),
      observed(FERN, "tag", "shade", 1100, OP_SEED),
    ];
    await gw.append([condemned, ...bystanders]);
    const stood = await standSlate(gw, { members: [condemned], closes: ["egress", "cite"] });

    // The operator re-declares the SAME container over ALL FOUR deltas, with a self-consistent pair.
    const wide = frozenMembershipTerm([condemned.id, ...bystanders.map((d) => d.id)]);
    const widePub = signClaims(termClaims(wide, OP, 56_000), OP_SEED);
    await gw.append([widePub]);
    await gw.append([
      declareContainer(
        {
          container: stood.container,
          trust: "curated",
          posture: "shared",
          membershipAt: widePub.id,
          version: gw.freeze(wide).id,
        },
        56_001,
      ),
    ]);

    // THE RECORD'S PINS GOVERN. The condemned set did not move, the doors still enforce over the
    // ORIGINAL one, and the operator is told their re-declaration bound nothing.
    const report = gw.slates(BEFORE_DEADLINE)[0]!;
    expect(report.members).toEqual([condemned.id]);
    expect(report.membershipAt).toBe(stood.membershipAt);
    expect(report.disagreement).toMatch(/cannot be re-pointed underneath it/);
    expect([...report.enforced].sort()).toEqual(["cite", "egress"]);
    expect((await gw.health(BEFORE_DEADLINE)).slates.disagreeing).toEqual([stood.container]);

    // And the CUT refuses outright rather than choosing a reading: a graveyard's frozen set is
    // durable, so the two readings must not be allowed to differ in a permanent record.
    const before = groundIds(gw);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      /container and the record disagree/,
    );
    expect(groundIds(gw)).toEqual(before);
    // TWO-SIDED, and this is the over-purge half: not one of the three bystanders lost a byte.
    for (const d of bystanders) expect(await gw.backend.holds(d.id)).toBe(true);
    expect(await gw.backend.holds(condemned.id)).toBe(true);
    await gw.close();
  });

  it("a NON-EXTENSIONAL membership Term is refused — an empty id set is not a frozen one", async () => {
    // `author eq OP` freezes to a perfectly honest address, so an agreement check alone certifies it
    // while the id set reads EMPTY: all three closures would withhold nothing, the review would tell
    // the operator "nothing", and no field would say anything was wrong. A removal order that closes
    // nothing and reports nothing wrong is the worst possible shape for this surface.
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    await expect(
      standSlate(gw, {
        members: [condemned],
        closes: ["egress", "cite"],
        liveTerm: {
          op: "select",
          pred: { match: { field: "author", cmp: "eq", const: OP } },
          in: "input",
        },
      }),
    ).rejects.toThrow(/not an EXTENSIONAL id set/);
    // Two-sided: no slate stands, so nothing reports itself enforcing, and every door still serves.
    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    expect(gw.offeredDeltas().map((d) => d.id)).toContain(condemned.id);
    // And the extensional form over the same member is accepted — the refusal is about SHAPE.
    const ok = await standSlate(gw, {
      container: "container:slate:extensional",
      members: [condemned],
      closes: ["egress"],
    });
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).toEqual([condemned.id]);
    expect(ok.version).not.toBe("");
    await gw.close();
  });

  it("object level: a delta satisfying the ORIGINAL predicate after slating does NOT join", async () => {
    const gw = await bootSlateStore();
    const first = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([first]);
    const stood = await standSlate(gw, { members: [first], closes: ["egress"] });
    const before = gw.containerScope({ containers: [stood.container] }).map((d) => d.id);
    expect(before).toEqual([first.id]);
    // The identifying predicate was "the operator's height observations". A NEW one arrives.
    const later = observed(FERN, "height", 34, 2000, OP_SEED);
    await gw.append([later]);
    // Extensional membership: the slate did not GROW, at the object level, through the container.
    expect(gw.containerScope({ containers: [stood.container] }).map((d) => d.id)).toEqual([
      first.id,
    ]);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).toEqual([first.id]);
    // Two-sided: the later delta is a live bystander — the egress door still offers it.
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).not.toContain(later.id);
    expect(gw.offeredDeltas().map((d) => d.id)).toContain(later.id);
    expect(gw.offeredDeltas().map((d) => d.id)).not.toContain(first.id);
    await gw.close();
  });
});

describe("T64 criterion 3 — `closes` and `deadline` are required, and `none` is sayable", () => {
  it("no `closes` refuses NAMING THE RECOMMENDATION; no `deadline` refuses", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    const term = frozenMembershipTerm([condemned.id]);
    const published = signClaims(termClaims(term, OP, 50_000), OP_SEED);
    await gw.append([published]);
    const container = "container:slate:knobs";
    await gw.append([
      declareContainer(
        {
          container,
          trust: "curated",
          posture: "shared",
          membershipAt: published.id,
          version: gw.freeze(term).id,
        },
        50_001,
      ),
    ]);
    const base = {
      container,
      membershipAt: published.id,
      version: gw.freeze(term).id,
      requestedBy: "subject:42",
      requestedByForm: "plain" as const,
      requestedAt: REQUESTED_AT,
      deadline: DEADLINE,
    };
    const drop = (claims: ReturnType<typeof slateClaims>, role: string) =>
      signClaims({ ...claims, pointers: claims.pointers.filter((p) => p.role !== role) }, OP_SEED);
    await expect(
      gw.append([drop(slateClaims({ ...base, closes: ["cite"] }, OP, 50_002), "closes")]),
    ).rejects.toThrow(/egress,cite/);
    await expect(
      gw.append([drop(slateClaims({ ...base, closes: ["cite"] }, OP, 50_003), "deadline")]),
    ).rejects.toThrow(/exactly one numeric `deadline`/);
    // The recommendation lives in the refusal, never in a silent default.
    await expect(
      gw.append([drop(slateClaims({ ...base, closes: ["cite"] }, OP, 50_004), "closes")]),
    ).rejects.toThrow(/REQUIRED with no silent/);
    await gw.close();
  });

  it("`closes: none` is ACCEPTED and closes nothing — every door still serves", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    const stood = await standSlate(gw, { members: [condemned], closes: [] });
    const report = gw.slates(BEFORE_DEADLINE);
    expect(report).toHaveLength(1);
    expect(report[0]!.closes).toEqual([]);
    expect(report[0]!.declared).toEqual([]);
    // `enforced` is EMPTY, and every door proves it: egress still offers the member, the append door
    // still admits a citation of it, and the read door still serves it.
    expect(report[0]!.enforced).toEqual([]);
    expect(gw.offeredDeltas().map((d) => d.id)).toContain(condemned.id);
    const citation = signClaims(
      {
        timestamp: 60_000,
        author: OP,
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: condemned.id } } },
          { role: "declares", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      OP_SEED,
    );
    await expect(gw.append([citation])).resolves.toBeDefined();
    const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((res.data as { plant: { height: number } }).plant.height).toBe(30);
    expect(stood.version).not.toBe("");
    await gw.close();
  });

  it("a slate record NAMES the form its requested-by took, and refuses without it", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    const term = frozenMembershipTerm([condemned.id]);
    const published = signClaims(termClaims(term, OP, 50_000), OP_SEED);
    await gw.append([published]);
    const container = "container:slate:form";
    await gw.append([
      declareContainer(
        {
          container,
          trust: "curated",
          posture: "shared",
          membershipAt: published.id,
          version: gw.freeze(term).id,
        },
        50_001,
      ),
    ]);
    const claims = slateClaims(
      {
        container,
        membershipAt: published.id,
        version: gw.freeze(term).id,
        requestedBy: "a".repeat(64),
        requestedByForm: "sealed",
        requestedAt: REQUESTED_AT,
        deadline: DEADLINE,
        closes: ["cite"],
      },
      OP,
      50_002,
    );
    await expect(
      gw.append([
        signClaims(
          { ...claims, pointers: claims.pointers.filter((p) => p.role !== "requested-by-form") },
          OP_SEED,
        ),
      ]),
    ).rejects.toThrow(/NAMES the form/);
    // Two-sided: WITH the form named, a sealed request stands and the form rides out to a reader,
    // so nobody has to guess whether a 64-hex identifier is a preimage or a commitment.
    await gw.append([signClaims(claims, OP_SEED)]);
    const report = gw.slates(BEFORE_DEADLINE);
    expect(report[0]!.requestedByForm).toBe("sealed");
    expect(report[0]!.requestedBy).toBe("a".repeat(64));
    await gw.close();
  });

  it("a slate is the OPERATOR's alone: a granted author's record binds nothing", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    const stood = await standSlate(gw, { members: [condemned], closes: ["cite"] });
    // A stranger's record at the same container, federated in, is refused at that door and — even
    // if it somehow sat in the ground — binds nothing at the reader.
    const strangerSeed = "d4".repeat(32);
    const stranger = signClaims(
      slateClaims(
        {
          container: stood.container,
          membershipAt: stood.membershipAt,
          version: stood.version,
          requestedBy: "subject:99",
          requestedByForm: "plain",
          requestedAt: REQUESTED_AT,
          deadline: DEADLINE,
          closes: ["read"],
        },
        (await import("@bombadil/rhizomatic")).authorForSeed(strangerSeed),
        50_010,
      ),
      strangerSeed,
    );
    const report = await gw.federate([stranger], { admit: () => true });
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    // Two-sided: the operator's own slate still stands, and READ is still open (the stranger's
    // record did not tighten it).
    expect(gw.slates(BEFORE_DEADLINE).map((s) => s.closes)).toEqual([["cite"]]);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.enforced).toEqual(["cite"]);
    const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((res.data as { plant: { height: number } }).plant.height).toBe(30);
    await gw.close();
  });
});

describe("T64 criterion 15 — forgiveness, both sides of the cut", () => {
  it("BEFORE the cut: striking the declaration reopens every door, and no byte moved", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([condemned, bystander]);
    const stood = await standSlate(gw, {
      members: [condemned],
      closes: ["egress", "cite", "read"],
    });
    expect(gw.offeredDeltas().map((d) => d.id)).not.toContain(condemned.id);
    const beforeRead = await gw.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((beforeRead.data as { plant: { height: number | null } }).plant.height).toBeNull();

    await gw.append([strike(stood.declaration, 60_000)]);

    // Every closed door reopens on the NEXT read — the table is re-resolved live, so un-slating is
    // a delta and never a restart.
    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    expect(gw.offeredDeltas().map((d) => d.id)).toContain(condemned.id);
    const after = await gw.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((after.data as { plant: { height: number } }).plant.height).toBe(30);
    // NOT ONE BYTE MOVED, and the request record still resolves: someone asked, and that is a fact
    // §11 already holds. Withdrawing the slate and withdrawing the request are two acts.
    expect(await gw.backend.holds(condemned.id)).toBe(true);
    expect(gw.reactor.get(stood.record)).toBeDefined();
    await gw.close();
  });

  it("AFTER the cut: striking a tombstone permits the id's return but restores no bytes", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([condemned, bystander]);
    const stood = await standSlate(gw, { members: [condemned], closes: ["egress", "cite"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const tombstone = report.members[0]!.tombstone;
    expect(await gw.backend.holds(condemned.id)).toBe(false);

    await gw.append([strike(tombstone, 70_000)]);

    // The graveyard is UNTOUCHED — it records an event that happened, not a standing assertion
    // about the present — and the bytes are still gone: forgiveness cannot restore what nobody holds.
    expect(gw.graveyards().map((g) => g.id)).toEqual([report.graveyard]);
    expect(await gw.backend.holds(condemned.id)).toBe(false);
    // The DURABLE arithmetic reports it as forgiven WITH its strike id rather than as a missing
    // tombstone: the graveyard records an event that happened, and forgiveness is a later event.
    const check = graveyardCompleteness(gw.reactor, OP, report.graveyard);
    expect(check.forgiven).toEqual([
      { member: condemned.id, strike: strike(tombstone, 70_000).id },
    ]);
    expect(check.missing).toEqual([]);
    expect(check.holds).toBe(false);
    expect(check.cutCompleted).toBe(true);
    // And the re-derived receipt reports FORGIVEN with its strike id, not still-forgotten.
    const receipt = await gw.receipt(report.graveyard, { now: AFTER_DEADLINE });
    const member = receipt.members.find((m) => m.member === condemned.id)!;
    expect(member.forgiven).toBe(strike(tombstone, 70_000).id);
    expect(member.tombstone).toBeUndefined();
    expect(member.presentAgain).toBe(false);
    // Two-sided: the bystander was never touched, on any tier or in any report.
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(receipt.members.map((m) => m.member)).toEqual([condemned.id]);
    await gw.close();
  });
});

describe("T64 criterion 17 — the mint is new vocabulary only, so no §20 step is engaged", () => {
  it("a PRE-MINT fixture store opens with identical delta ids and identical views", async () => {
    const backend = new MemoryBackend();
    const first = await bootSlateStore(backend);
    const facts = [
      observed(FERN, "height", 30, 1000, OP_SEED),
      observed(FERN, "tag", "shade", 1100, OP_SEED),
    ];
    await first.append(facts);
    const beforeIds = [...first.reactor.snapshot()].map((d) => d.id).sort();
    const beforeView = await first.query(`{ plant(entity: "${FERN}") { height tag _hex } }`);
    await first.flush();
    // Reopened under the code that HAS the mint: not one id moved, not one view changed. No delta any
    // store already holds gains or loses a role, which is why §20 is not engaged.
    const second = await bootSlateStore(backend);
    expect([...second.reactor.snapshot()].map((d) => d.id).sort()).toEqual(beforeIds);
    expect(await second.query(`{ plant(entity: "${FERN}") { height tag _hex } }`)).toEqual(
      beforeView,
    );
    await second.close();
  });

  it("a tombstone with NO slate pointer still binds at both doors and in readTombstones", async () => {
    const gw = await bootSlateStore();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    // A tombstone minted the pre-T64 way — five pointers, no `slate` join.
    const legacy = signClaims(
      eraseClaims(target.id, OP, OP, 60_000, "an old removal order"),
      OP_SEED,
    );
    expect(legacy.claims.pointers.some((p) => p.role === "slate")).toBe(false);
    await gw.append([legacy]);
    // It binds: the append door refuses the id's return, and so does the federation door.
    await expect(gw.append([target])).rejects.toThrow(/was erased/);
    const fed = await gw.federate([target], { admit: () => true });
    expect(fed.accepted).toBe(0);
    const health = await gw.health(BEFORE_DEADLINE);
    expect(health.erasure.promised).toBe(1);
    expect(health.slates).toEqual({
      open: 0,
      lapsed: 0,
      lapsedIds: [],
      unresolved: [],
      disagreeing: [],
    });
    expect(health.forgiven).toEqual({ count: 0, present: 0, ids: [], unreadable: [] });
    // Two-sided: a MALFORMED slate pointer is refused, so the optionality is not a hole.
    const bad = signClaims(
      {
        timestamp: 60_100,
        author: OP,
        pointers: [
          ...eraseClaims(target.id, OP, OP, 60_100).pointers,
          { role: "slate", target: { kind: "primitive", value: "container:slate:x" } },
        ],
      },
      OP_SEED,
    );
    await expect(gw.append([bad])).rejects.toThrow(/at most one `slate` pointer/);
    await gw.close();
  });

  it("the vocabulary rail: two new contexts, under the prefix discipline", () => {
    expect([...SLATE_CONTEXTS]).toEqual([CTX_SLATE, CTX_GRAVEYARD]);
    for (const ctx of SLATE_CONTEXTS) {
      expect(ctx.startsWith("loam.erasure.")).toBe(true);
      // Its own vocabulary, never the quarantine's: a reader must not confuse a staging area
      // (things coming IN to canon) with a slate (things going OUT).
      expect(CONTAINER_CONTEXTS as readonly string[]).not.toContain(ctx);
    }
    expect(new Set(SLATE_CONTEXTS).size).toBe(SLATE_CONTEXTS.length);
  });

  it("readSlates fails closed on a MISSING moment rather than reading its own clock", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    await standSlate(gw, { members: [condemned], closes: ["cite"] });
    expect(() => readSlates(gw.reactor, OP, undefined as unknown as number)).toThrow(
      /no moment was passed/,
    );
    await gw.close();
  });
});
