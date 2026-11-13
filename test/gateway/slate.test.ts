import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { CONTAINER_CONTEXTS, termClaims } from "../../src/gateway/container-law.js";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import {
  SLATE_CONTEXTS,
  frozenMembershipTerm,
  graveyardCompleteness,
  slateClaims,
} from "../../src/gateway/slate.js";
import { CTX_GRAVEYARD, readSlates } from "../../src/gateway/slate-law.js";
import { CTX_SLATE } from "../../src/gateway/slate-vocab.js";
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
    await expect(
      standSlate(gw, {
        container: "container:slate:separate2",
        members: [condemned],
        closes: ["egress", "cite"],
        posture: "separate",
      }),
    ).rejects.toThrow(/curated\/separate/);
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
    await expect(
      standSlate(gw, { members: [condemned], closes: ["cite"], trust: "untrusted" }),
    ).rejects.toThrow(/untrusted.*cannot take posture "shared"/s);
    await gw.close();
  });

  it("with a slate standing, an ordinary erase(unrelated) still COMPLETES", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const unrelated = observed(FERN, "tag", "fronds", 1100, OP_SEED);
    await gw.append([condemned, unrelated]);
    await standSlate(gw, { members: [condemned], closes: ["egress", "cite", "read"] });
    const result = await gw.erase(unrelated.id);
    expect(result.erased).toBe(unrelated.id);
    expect(await gw.backend.holds(unrelated.id)).toBe(false);
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
    await expect(
      standSlate(gw, {
        container: "container:slate:unfrozen",
        members: [condemned],
        closes: ["cite"],
        omitVersion: true,
      }),
    ).rejects.toThrow(/while the standing record PINS/);
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
    const stood = await standSlate(gw, {
      container: "container:slate:agrees",
      members: [condemned],
      closes: ["cite"],
    });
    expect(gw.slates(BEFORE_DEADLINE).map((s) => s.container)).toEqual([stood.container]);
    await gw.close();
  });

  it("THE OVER-PURGE PROBE: a container re-declared WIDER mid-window cannot widen the cut", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystanders = [
      observed(FERN, "height", 31, 1001, OP_SEED),
      observed(FERN, "height", 32, 1002, OP_SEED),
      observed(FERN, "tag", "shade", 1100, OP_SEED),
    ];
    await gw.append([condemned, ...bystanders]);
    const stood = await standSlate(gw, { members: [condemned], closes: ["egress", "cite"] });

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

    const report = gw.slates(BEFORE_DEADLINE)[0]!;
    expect(report.members).toEqual([condemned.id]);
    expect(report.membershipAt).toBe(stood.membershipAt);
    expect(report.disagreement).toMatch(/cannot be re-pointed underneath it/);
    expect([...report.enforced].sort()).toEqual(["cite", "egress"]);
    expect((await gw.health(BEFORE_DEADLINE)).slates.disagreeing).toEqual([stood.container]);

    const before = groundIds(gw);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).rejects.toThrow(
      /container and the record disagree/,
    );
    expect(groundIds(gw)).toEqual(before);
    for (const d of bystanders) expect(await gw.backend.holds(d.id)).toBe(true);
    expect(await gw.backend.holds(condemned.id)).toBe(true);
    await gw.close();
  });

  it("a NON-EXTENSIONAL membership Term is refused — an empty id set is not a frozen one", async () => {
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
    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    expect(gw.offeredDeltas().map((d) => d.id)).toContain(condemned.id);
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
    const later = observed(FERN, "height", 34, 2000, OP_SEED);
    await gw.append([later]);
    expect(gw.containerScope({ containers: [stood.container] }).map((d) => d.id)).toEqual([
      first.id,
    ]);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).toEqual([first.id]);
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
    expect(report[0]!.enforced).toEqual([]);
    expect(gw.offeredDeltas().map((d) => d.id)).toContain(condemned.id);
    const citation = signClaims(
      {
        timestamp: 60_000,
        validFrom: 60_000,
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
    expect(gw.slates(BEFORE_DEADLINE).map((s) => s.closes)).toEqual([["cite"]]);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.enforced).toEqual(["cite"]);
    const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((res.data as { plant: { height: number } }).plant.height).toBe(30);
    await gw.close();
  });
});

describe("T64 criterion 15 — negation, both sides of the cut", () => {
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

    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    expect(gw.offeredDeltas().map((d) => d.id)).toContain(condemned.id);
    const after = await gw.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((after.data as { plant: { height: number } }).plant.height).toBe(30);
    expect(await gw.backend.holds(condemned.id)).toBe(true);
    expect(gw.reactor.get(stood.record)).toBeDefined();
    await gw.close();
  });

  it("AFTER the cut: negating an erasure restores no bytes, and the id stays refused", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([condemned, bystander]);
    const stood = await standSlate(gw, { members: [condemned], closes: ["egress", "cite"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const erasure = report.members[0]!.erasure;
    expect(await gw.backend.holds(condemned.id)).toBe(false);

    await gw.append([strike(erasure, 70_000)]);

    expect(gw.graveyards().map((g) => g.id)).toEqual([report.graveyard]);
    expect(await gw.backend.holds(condemned.id)).toBe(false);
    const check = graveyardCompleteness(gw.reactor, gw.validityNow(), OP, report.graveyard);
    expect(check.negated).toEqual([{ member: condemned.id, negation: strike(erasure, 70_000).id }]);
    expect(check.missing).toEqual([]);
    expect(check.holds).toBe(false);
    expect(check.cutCompleted).toBe(true);
    const receipt = await gw.receipt(report.graveyard, { now: AFTER_DEADLINE });
    const member = receipt.members.find((m) => m.member === condemned.id)!;
    expect(member.negated).toBe(strike(erasure, 70_000).id);
    expect(member.erasure).toBeUndefined();
    await expect(gw.append([condemned])).rejects.toThrow(/erased/);
    expect(member.presentAgain).toBe(false);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(receipt.members.map((m) => m.member)).toEqual([condemned.id]);
    await gw.close();
  });

  it("AFTER the cut: the receipt names the negation that holds, not a negated one", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([condemned, bystander]);
    const stood = await standSlate(gw, { members: [condemned], closes: ["egress", "cite"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const erasure = report.members[0]!.erasure;

    const countered = strike(erasure, 70_000);
    let at = 72_000;
    while (strike(erasure, at).id < countered.id) at += 1;
    const holding = strike(erasure, at);
    expect(countered.id < holding.id).toBe(true);
    await gw.append([countered, strike(countered.id, 71_000), holding]);

    const check = graveyardCompleteness(gw.reactor, gw.validityNow(), OP, report.graveyard);
    expect(check.negated).toEqual([{ member: condemned.id, negation: holding.id }]);
    expect(check.members).toEqual([condemned.id]);
    expect(check.missing).toEqual([]);
    const receipt = await gw.receipt(report.graveyard, { now: AFTER_DEADLINE });
    const member = receipt.members.find((m) => m.member === condemned.id)!;
    expect(member.negated).toBe(holding.id);
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
    const second = await bootSlateStore(backend);
    expect([...second.reactor.snapshot()].map((d) => d.id).sort()).toEqual(beforeIds);
    expect(await second.query(`{ plant(entity: "${FERN}") { height tag _hex } }`)).toEqual(
      beforeView,
    );
    await second.close();
  });

  it("an erasure with NO slate pointer still binds at both doors and in readErasures", async () => {
    const gw = await bootSlateStore();
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    const legacy = signClaims(
      eraseClaims(target.id, OP, OP, 60_000, "an old removal order"),
      OP_SEED,
    );
    expect(legacy.claims.pointers.some((p) => p.role === "slate")).toBe(false);
    await gw.append([legacy]);
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
    expect(health.negated).toEqual({ count: 0, present: 0, ids: [], unreadable: [] });
    const bad = signClaims(
      {
        timestamp: 60_100,
        validFrom: 60_100,
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
      expect(CONTAINER_CONTEXTS as readonly string[]).not.toContain(ctx);
    }
    expect(new Set(SLATE_CONTEXTS).size).toBe(SLATE_CONTEXTS.length);
  });

  it("readSlates fails closed on a MISSING moment rather than reading its own clock", async () => {
    const gw = await bootSlateStore();
    const condemned = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([condemned]);
    await standSlate(gw, { members: [condemned], closes: ["cite"] });
    expect(() =>
      readSlates(gw.reactor, gw.validityNow(), OP, undefined as unknown as number),
    ).toThrow(/no moment was passed/);
    await gw.close();
  });
});
