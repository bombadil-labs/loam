// T282: signed immutable law operands; no signer or ingestion adapter in the projector.
//
// RAILS-RED on origin/main, this file copied in: the suite does not LOAD there. It imports
// src/gateway/receive-policy.js and src/gateway/receive-snapshot.js, both of which this slice adds,
// so vitest reports one failed suite rather than per-case failures. That measures the import graph;
// the revert probes below are the instrument for the cases.
//
// REVERT PROBES, MEASURED against the four receiving rails together (49 cases). Each probe deletes
// one guard in the projection and records how many cases go red.
//   two surviving bindings for one relationship no longer refuse   → 2 red, 47 green
//   programs carrying expand/fix/resolve are no longer refused      → 2 red, 47 green
//   a stranger's decision deltas acquire recipient policy authority → 2 red, 47 green
//   a manifest with duplicate memberIds is admitted                 → 1 red, 48 green
//   a manifest carrying extra keys is admitted                      → 1 red, 48 green
// Measured again at 56 cases, one guard deleted per probe:
//   the registrationId guard is removed                             → 1 red, 55 green
//   two candidates for one lens count as one                        → 1 red, 55 green
//   two registration rows for one lens are served, not a conflict   → 1 red, 55 green
//   only fix programs are refused, not expand or resolve            → 1 red, 55 green
//   a struck malformed decision is parsed before its strike is read → 1 red, 55 green
//   a pause on a one-time binding is ignored instead of refused     → 1 red, 55 green
//   NUL is accepted inside a decision identity                      → 1 red, 55 green
//   a selection is admitted on a live binding                       → 1 red, 55 green
// Measured again at 60 cases:
//   a curse under a sibling reading curses this reading too          → 1 red, 59 green
//   a pause on a binding the receiver struck is refused, not inert   → 1 red, 59 green
//   any delta the policy holds counts as a binding for a pause       → 1 red, 59 green
// Measured again at 61 cases:
//   any struck receiver delta makes a pause inert, not only a binding → 1 red, 60 green
//   a pause naming another relationship's binding leaves it serving  → 1 red, 60 green
//   a pause under a relationship with no binding is ignored          → 1 red, 60 green
//   a pause naming any receiver binding is honoured                  → 2 red, 59 green
// Measured again at 61 cases:
//   a struck binding of any relationship makes a pause inert          → 1 red, 60 green
//   a stray relationship with no row for this destination is silent   → 1 red, 60 green
//   a pause naming no binding of the receiver is ignored            → 1 red, 59 green
//   the snapshot path drops its lens-name filter                    → 1 red, 59 green
//   the live path drops its hyperschema-entity filter               → 1 red, 59 green
//   an empty receiver or destination projects [] instead of refusing → 1 red, 59 green
// HOLLOW-TEST SURVIVORS that are equivalent, and why:
//   receive-policy.ts parse: `return undefined` → `return null` yields a decision with no kind,
//     which every kind filter drops; no output changes.
//   receive-snapshot.ts manifest: dropping one field from the nonempty check; the same field is
//     compared against the binding, the registration, or the version address two lines later and
//     refuses with the same status.
//   receive-snapshot.ts definitionId: the id tie-break; the substrate hands definition rows in id
//     order already, so the comparator's tie branch is never the deciding read. The case
//     "equal-timestamp definitions pin the lower id" pins the observable order either way.
// No probe is green. The projection is pure and unwired: no door reaches it, and these rails are
// the whole of what proves it.
import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  signClaims,
  makeNegationClaims,
  publishHyperSchemaClaims,
  Reactor,
  resolveView,
  type Delta,
  type Schema,
} from "@bombadil/rhizomatic";
import { projectLiveReceiving } from "../../src/gateway/receive-policy.js";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { freezeMembers } from "../../src/gateway/container-identity.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
const R = "11".repeat(32),
  S = "22".repeat(32),
  X = "33".repeat(32);
const receiver = authorForSeed(R),
  author = authorForSeed(S);
const body = {
  kind: "binding",
  relationship: "source-to-destination",
  source: "source",
  destination: "destination",
  sourceAuthor: author,
  entity: "hyperschema:Plant",
  reading: "Plant",
  mode: "live",
};
function decision(value: object, seed = R, timestamp = 1): Delta {
  return signClaims(
    {
      author: authorForSeed(seed),
      timestamp,
      pointers: [
        {
          role: "decision",
          target: {
            kind: "entity",
            entity: { id: "receive-policy", context: "loam.receive.experimental.v1" },
          },
        },
        { role: "payload", target: { kind: "primitive", value: JSON.stringify(value) } },
      ],
    },
    seed,
  );
}
const binding = decision(body);
function law(ts = 10, schema: Schema = PLANT_POLICY): Delta[] {
  const c = registrationDeltaClaims(
    body.entity,
    "Plant",
    schema,
    [FERN],
    author,
    () => ts,
    undefined,
    undefined,
    { computedHeight: { rung: "a", type: "number", code: "throw new Error('never execute')" } },
  );
  return [
    signClaims(publishHyperSchemaClaims(PLANT, body.entity, author, ts), S),
    ...[c.living, c.snapshot, c.binding].map((c) => signClaims(c, S)),
  ];
}
const strike = (d: Delta, seed = S, ts = 50) =>
  signClaims(makeNegationClaims(authorForSeed(seed), ts, d.id), seed);
const selection = (ds: Delta[], registrationId = ds[ds.length - 1]!.id) => ({
  source: body.source,
  registrationId,
  memberIds: ds.map((d) => d.id),
  versionId: freezeMembers(ds).id,
});
const once = (ds: Delta[]) => decision({ ...body, mode: "one-time", selection: selection(ds) });
const pause = (ds: Delta[] | null, extra: object = {}) =>
  decision(
    {
      kind: "pause",
      relationship: body.relationship,
      reading: body.reading,
      bindingId: binding.id,
      selection: ds === null ? null : selection(ds),
      ...extra,
    },
    R,
    30,
  );
const run = (ds: Delta[], decisions = [binding]) =>
  projectLiveReceiving({
    receiver,
    destination: body.destination,
    decisions,
    sources: [{ id: body.source, deltas: ds }],
  });
function height(result: ReturnType<typeof run>[number], extra = false) {
  expect(result.status).toBe("selected");
  const reg = result.registration!;
  const data = new Reactor();
  for (const d of [
    observed(FERN, "height", 11, 100, R),
    observed(FERN, "height", 22, 101, S),
    ...(extra ? [observed(FERN, "height", 33, 102, X), observed(FERN, "height", 9, 99, X)] : []),
  ])
    data.ingest(d);
  data.register("reading", reg.hyperschema.body, reg.roots);
  const view = resolveView(reg.schema, data.materializedView("reading", FERN)!);
  if (view === null || typeof view !== "object" || Array.isArray(view))
    throw new Error("expected object view");
  if (!("height" in view)) throw new Error("expected height field");
  return view.height;
}
const olderPolicy: Schema = {
  ...PLANT_POLICY,
  props: new Map([
    ...PLANT_POLICY.props,
    ["height", { kind: "pick", order: { kind: "byTimestamp", dir: "asc" } }],
  ]),
};
describe("exact receiving snapshot operands", () => {
  it("has a signed live control resolving actual destination data", () => {
    const a = law();
    expect(run(a)[0]!.registration!.boundId).toBe(a[3]!.id);
    expect(height(run(a)[0]!)).toBe(22);
  });
  it("freezes law while live follows M2 and current destination data changes both", () => {
    const a = law(),
      b = law(20, olderPolicy),
      one = once(a);
    expect(height(run(a, [one])[0]!)).toBe(22);
    const fixed = run([...a, ...b], [one])[0]!,
      live = run([...a, ...b])[0]!;
    expect(fixed.registration!.boundId).toBe(a[3]!.id);
    expect(live.registration!.boundId).toBe(b[3]!.id);
    expect(height(fixed, true)).toBe(33);
    expect(height(live, true)).toBe(9);
  });
  it("pause excludes late backdated registrations and changed gather definitions, replay invariant", () => {
    const a = law(),
      p = pause(a),
      replacement = signClaims(
        publishHyperSchemaClaims({ ...PLANT, body: { kind: "input" } }, body.entity, author, 40),
        S,
      );
    const ds = [...a, ...law(20, olderPolicy), replacement],
      result = run(ds, [binding, p]);
    expect(result[0]!.status).toBe("selected");
    expect(result[0]!.registration!.hyperschema.body).toEqual(PLANT.body);
    expect(height(result[0]!)).toBe(22);
    expect(run([...ds].reverse().concat(ds), [p, binding, p])).toEqual(result);
  });
  for (const target of ["registration", "hyperschema", "resolution"] as const)
    it(`withdrawn pinned ${target} never falls back and strike-of-strike restores`, () => {
      const a = law(),
        older = law(5),
        ds = [...older, ...a];
      // Include two valid definitions of the SAME resolution entity with identical content.
      const schemaRef = a[3]!.claims.pointers.find((p) => p.role === "schemaVersion")!.target;
      if (schemaRef.kind !== "entity") throw Error("fixture");
      const oldSchema = signClaims({ ...a[2]!.claims, timestamp: 4 }, S);
      const members = [oldSchema, ...ds],
        p = pause(members, { selection: selection(members, a[3]!.id) }),
        one = decision({ ...body, mode: "one-time", selection: selection(members, a[3]!.id) });
      const pinned = target === "registration" ? a[3]! : target === "hyperschema" ? a[0]! : a[2]!;
      const withdrawn = strike(pinned),
        all = [...members, withdrawn];
      expect(run(members, [binding, p])[0]!.status).toBe("selected");
      expect(run(all, [binding, p])[0]!.status).toBe("unavailable");
      expect(height(run(all, [one])[0]!)).toBe(22);
      expect(height(run([...all, strike(withdrawn, S, 60)], [binding, p])[0]!)).toBe(22);
      expect(height(run([...members, strike(pinned, X)], [binding, p])[0]!)).toBe(22);
    });
  it("equal-timestamp definitions pin the lower id, whatever order the manifest lists them", () => {
    const a = law();
    // A second hyperschema publication for the SAME entity at the SAME timestamp, different content.
    const twin = signClaims(
      publishHyperSchemaClaims({ ...PLANT, body: { kind: "input" } }, body.entity, author, 10),
      S,
    );
    const [low, high] = [a[0]!, twin].sort((x, y) => (x.id < y.id ? -1 : 1));
    // Both ingestion orders: a tie-break that falls back to insertion order fails one of them.
    for (const members of [
      [high!, ...a.slice(1), low!],
      [low!, ...a.slice(1), high!],
    ]) {
      const p = pause(members, { selection: selection(members, a[3]!.id) });
      expect(run(members, [binding, p])[0]!.status).toBe("selected");
      expect(run([...members, strike(low!)], [binding, p])[0]!.status).toBe("unavailable");
      expect(run([...members, strike(high!)], [binding, p])[0]!.status).toBe("selected");
    }
  });
  it("a stranger cannot lift pause to follow held M2", () => {
    const a = law(),
      b = law(20, olderPolicy),
      p = pause(a);
    const result = run([...a, ...b], [binding, p, strike(p, X)])[0]!;
    expect(result.status).toBe("selected");
    expect(result.registration!.boundId).toBe(a[3]!.id);
    expect(height(result)).toBe(22);
  });
  it("withdrawal of unselected older definitions preserves the selected law", () => {
    const a = law(),
      older = law(5);
    const oldSchema = signClaims({ ...a[2]!.claims, timestamp: 4 }, S);
    const members = [...older, ...a, oldSchema];
    const p = pause(members, { selection: selection(members, a[3]!.id) });
    const result = run([...members, strike(older[0]!), strike(oldSchema)], [binding, p])[0]!;
    expect(result.status).toBe("selected");
    expect(result.registration!.boundId).toBe(a[3]!.id);
    expect(result.registration!.hyperschema.body).toEqual(PLANT.body);
    expect(height(result)).toBe(22);
  });
  it("null pause remains empty and resume immediately follows already held M2", () => {
    const a = law(),
      b = law(20, olderPolicy);
    for (const [p, status] of [
      [pause(a), "selected"],
      [pause(null), "unavailable"],
    ] as const) {
      expect(run([...a, ...b], [binding, p])[0]!.status).toBe(status);
      const result = run([...a, ...b], [binding, p, strike(p, R)])[0]!;
      expect(result.registration!.boundId).toBe(b[3]!.id);
      expect(height(result)).toBe(11);
    }
  });
  for (const defect of [
    "missing",
    "duplicate",
    "address",
    "registration",
    "superseded-registration",
    "contested-lens",
    "source",
  ] as const)
    it(`refuses ${defect} manifest with explicit status`, () => {
      const a = law(),
        older = law(5),
        absent = observed(FERN, "height", 99, 90, S);
      // A second registration entity by the same author, naming the same hyperschema and lens.
      const other = signClaims(
        {
          ...a[3]!.claims,
          pointers: a[3]!.claims.pointers.map((p) =>
            p.target.kind === "entity" && p.target.entity.context === "loam.registration"
              ? {
                  ...p,
                  target: { ...p.target, entity: { ...p.target.entity, id: "registration:other" } },
                }
              : p,
          ),
        },
        S,
      );
      const members =
        defect === "superseded-registration"
          ? [...older, ...a]
          : defect === "contested-lens"
            ? [...a, other]
            : a;
      const s = selection(
        defect === "missing" ? [...a, absent] : members,
        defect === "superseded-registration" ? older[3]!.id : a[3]!.id,
      );
      if (defect === "duplicate") Object.assign(s, selection([...a, a[0]!], a[3]!.id));
      if (defect === "address") s.versionId = "wrong";
      if (defect === "registration") s.registrationId = a[0]!.id;
      if (defect === "source") s.source = "other";
      expect(run(members, [decision({ ...body, mode: "one-time", selection: s })])[0]!.status).toBe(
        "invalid-selection",
      );
    });
  it("a manifest pinning a registration under another lens name is refused", () => {
    const c = registrationDeltaClaims(
      body.entity,
      "PlantB",
      PLANT_POLICY,
      [FERN],
      author,
      () => 10,
    );
    const members = [
      signClaims(publishHyperSchemaClaims(PLANT, body.entity, author, 10), S),
      ...[c.living, c.snapshot, c.binding].map((c) => signClaims(c, S)),
    ];
    const s = selection(members, members[3]!.id);
    expect(run(members, [decision({ ...body, mode: "one-time", selection: s })])[0]!.status).toBe(
      "invalid-selection",
    );
  });
  it("a pause on a one-time binding is refused, not ignored", () => {
    const a = law(),
      one = once(a);
    expect(run(a, [one])[0]!.status).toBe("selected");
    expect(run(a, [one, pause(null, { bindingId: one.id })])[0]!.status).toBe("invalid-selection");
    expect(run(a, [one, pause(a, { bindingId: one.id })])[0]!.status).toBe("invalid-selection");
  });
  it("accepts an exact manifest at a one-character source identity", () => {
    const a = law();
    const signed = decision({
      ...body,
      source: "s",
      mode: "one-time",
      selection: { ...selection(a), source: "s" },
    });
    const result = projectLiveReceiving({
      receiver,
      destination: body.destination,
      decisions: [signed],
      sources: [{ id: "s", deltas: a }],
    })[0]!;
    expect(result.status).toBe("selected");
    expect(result.registration!.boundId).toBe(a[3]!.id);
    expect(height(result)).toBe(22);
  });
  for (const malformed of [
    "null",
    "extra-key",
    "nonarray-members",
    "empty-source",
    "nul-member",
    "number-member",
    "object-registration",
  ] as const)
    it(`refuses malformed ${malformed} manifest as invalid-selection`, () => {
      const a = law();
      const selected = selection(a);
      const invalid =
        malformed === "null"
          ? null
          : malformed === "extra-key"
            ? { ...selected, unexpected: "not permitted" }
            : malformed === "nonarray-members"
              ? { ...selected, memberIds: {} }
              : malformed === "empty-source"
                ? { ...selected, source: "" }
                : malformed === "nul-member"
                  ? { ...selected, memberIds: [...selected.memberIds, "\0"] }
                  : malformed === "object-registration"
                    ? { ...selected, registrationId: { length: 1 } }
                    : { ...selected, memberIds: [...selected.memberIds, 17] };
      expect(run(a, [decision({ ...body, mode: "one-time", selection: invalid })])[0]!.status).toBe(
        "invalid-selection",
      );
    });
  it("refuses foreign relationship targets and incompatible surviving pauses", () => {
    const a = law();
    expect(run(a, [binding, pause(a, { relationship: "other" })])[0]!.status).toBe(
      "invalid-selection",
    );
    expect(run(a, [binding, pause(a), pause(null)])[0]!.status).toBe("conflict");
  });
  it("a pause on withdrawn binding A cannot pin its replacement B", () => {
    const a = law(),
      b = law(20, olderPolicy);
    const replacement = decision(body, R, 40);
    const result = run([...a, ...b], [binding, pause(a), strike(binding, R), replacement])[0]!;
    expect(result.status).toBe("selected");
    expect(result.registration!.boundId).toBe(b[3]!.id);
    expect(height(result)).toBe(11);
  });
  it("checks every signature before duplicate collapse", () => {
    const a = law();
    expect(run([...a, { ...a[0]!, sig: "00" }], [once(a)])[0]!.status).toBe("invalid-input");
  });
  it("receiver curse, lawful lift and binding withdrawal hold for each mode without byte mutation", () => {
    const a = law(),
      ids = a.map((d) => d.id),
      curse = decision({ kind: "curse", relationship: body.relationship, reading: "Plant" }, R, 35);
    for (const decisions of [[binding], [once(a)], [binding, pause(a)]]) {
      expect(run(a, [...decisions, curse])[0]!.status).toBe("cursed");
      expect(run(a, [...decisions, curse, strike(curse, X)])[0]!.status).toBe("cursed");
      expect(height(run(a, [...decisions, curse, strike(curse, R)])[0]!)).toBe(22);
      expect(run(a, [...decisions, strike(decisions[0]!, R)])).toEqual([]);
    }
    expect(a.map((d) => d.id)).toEqual(ids);
  });
  it("source-only and stranger recipient decisions do not become local authority", () => {
    const a = law(),
      p = pause(null),
      foreign = decision(
        {
          kind: "pause",
          relationship: body.relationship,
          reading: "Plant",
          bindingId: binding.id,
          selection: null,
        },
        X,
        30,
      );
    expect(height(run([...a, p, once(a)], [binding, foreign])[0]!)).toBe(22);
    expect(run([...a, binding, p], [])).toEqual([]);
  });
  it("retains resolver withholding and dependency refusal in snapshot modes", () => {
    const a = law();
    for (const ds of [[once(a)], [binding, pause(a)]]) {
      const result = run(a, ds)[0]!;
      expect(result.status).toBe("selected");
      expect(result.withheldResolverFields).toEqual(["computedHeight"]);
      expect(result.registration!.resolvers).toBeUndefined();
    }
    const dependent = signClaims(
      publishHyperSchemaClaims(
        { ...PLANT, body: { kind: "fix", schema: { kind: "name", name: "Other" }, entity: FERN } },
        body.entity,
        author,
        20,
      ),
      S,
    );
    const members = [...a, dependent];
    expect(
      run(members, [
        decision({ ...body, mode: "one-time", selection: selection(members, a[3]!.id) }),
      ])[0]!.status,
    ).toBe("unsupported");
  });
});
