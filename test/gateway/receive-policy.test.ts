// T281: internal LIVE projection proof; real signed law and literal resolved values.
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
// Measured again at 62 cases:
//   a dependency nested inside another term is not walked             → 1 red, 61 green
//   pause keys keep memberIds order, so permutations conflict         → 1 red, 61 green
//   result rows keep arrival order instead of relationship order      → 1 red, 61 green
//   a pause naming no binding of the receiver is ignored            → 1 red, 59 green
//   the snapshot path drops its lens-name filter                    → 1 red, 59 green
//   the live path drops its hyperschema-entity filter               → 1 red, 59 green
//   an empty receiver or destination projects [] instead of refusing → 1 red, 59 green
// HOLLOW-TEST SURVIVORS (uncapped run, 175 mutants) that are equivalent, and why:
//   receive-policy.ts parse: `return undefined` → `return null` yields a decision with no kind,
//     which every kind filter drops; no output changes.
//   receive-policy.ts pause pre-check: the `paused` flag passed to selectReceivingSnapshot; only
//     the invalid-selection status is read there, and that status does not depend on the flag.
//   receive-policy.ts pause keys: `JSON.stringify(value)` for a non-object selection → null; the
//     only non-object selection is null, so every such pause still shares one key.
//   receive-policy.ts resolver envelope: the primitive-or-string clause; a malformed envelope is
//     dropped by the legacy reader and refused as unsupported before this line runs.
//   receive-snapshot.ts manifest: dropping one field from the nonempty check; the same field is
//     compared against the binding, the registration, or the version address two lines later and
//     refuses with the same status.
//   receive-snapshot.ts definitionId: the id tie-break; the substrate hands definition rows in id
//     order already, so the comparator's tie branch is never the deciding read. The case
//     "equal-timestamp definitions pin the lower id" pins the observable order either way.
//   receive-snapshot.ts author clause: readRegistrations already filtered to the source author, so
//     the clause cannot fail; it stays for the type narrowing it provides.
import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  signClaims,
  makeNegationClaims,
  publishHyperSchemaClaims,
  resolveView,
  Reactor,
  type Delta,
  type Schema,
} from "@bombadil/rhizomatic";
import { projectLiveReceiving } from "../../src/gateway/receive-policy.js";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
const R = "11".repeat(32),
  S = "22".repeat(32),
  X = "33".repeat(32);
const receiver = authorForSeed(R),
  author = authorForSeed(S);
const destination = "alice_outbox",
  entity = "hyperschema:Plant";
const body = {
  kind: "binding",
  relationship: "media-to-alice",
  source: "media_log",
  destination,
  sourceAuthor: author,
  entity,
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
    entity,
    "Plant",
    schema,
    [FERN],
    author,
    () => ts,
    undefined,
    undefined,
    { height: { rung: "a", type: "number", code: "export default () => 999" } },
  );
  return [
    signClaims(publishHyperSchemaClaims(PLANT, entity, author, ts), S),
    ...[c.living, c.snapshot, c.binding].map((c) => signClaims(c, S)),
  ];
}
const strike = (d: Delta, seed = S, ts = 40) =>
  signClaims(makeNegationClaims(authorForSeed(seed), ts, d.id), seed);
const run = (deltas: Delta[], decisions = [binding], source = "media_log") =>
  projectLiveReceiving({ receiver, destination, decisions, sources: [{ id: source, deltas }] });
function values(reg: NonNullable<ReturnType<typeof run>[number]>["registration"]): unknown {
  expect(reg).toBeDefined();
  const data = new Reactor();
  const local = observed(FERN, "tag", "local", 100, R),
    first = observed(FERN, "tag", "movie", 101, S),
    second = observed(FERN, "tag", "book", 102, X);
  const rootDecoy = observed(FERN, "tag", "SECRET", 103, X);
  expect(rootDecoy.claims.pointers).toHaveLength(2);
  for (const d of [local, first, second]) data.ingest(d);
  data.register("received", reg!.hyperschema.body, reg!.roots);
  return resolveView(reg!.schema, data.materializedView("received", FERN)!);
}
describe("experimental live receiving projection", () => {
  it("selects signed source law without a receiver signer and resolves the entire explicit destination operand", () => {
    const ds = law();
    const result = run(ds);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: "selected",
      relationship: body.relationship,
      source: "media_log",
      destination,
      reading: "Plant",
      withheldResolvers: true,
    });
    expect(result[0]!.registration!.boundId).toBe(ds[3]!.id);
    expect(result[0]!.registration!.boundBy).toBe(author);
    expect(result[0]!.registration!.resolvers).toBeUndefined();
    expect(values(result[0]!.registration)).toMatchObject({ tag: ["local", "movie", "book"] });
  });
  it("follows revisions, lawful withdrawals and withdrawals of withdrawals; stranger strikes have no authority", () => {
    const a = law(),
      b = law(20, {
        ...PLANT_POLICY,
        default: { kind: "all", order: { kind: "byTimestamp", dir: "asc" } },
      }),
      withdraw = strike(b[3]!);
    expect(run([...a, ...b])[0]!.registration!.boundId).toBe(b[3]!.id);
    expect(run([...a, ...b, strike(b[3]!, X)])[0]!.registration!.boundId).toBe(b[3]!.id);
    expect(run([...a, ...b, withdraw])[0]!.registration!.boundId).toBe(a[3]!.id);
    expect(run([...a, ...b, withdraw, strike(withdraw, S, 50)])[0]!.registration!.boundId).toBe(
      b[3]!.id,
    );
    expect(run([...a, strike(a[3]!)])[0]!.status).toBe("unavailable");
  });
  it("keeps receiver curses local and durable across revisions and replay; only lawful lift restores", () => {
    const ds = law(),
      curse = decision({ kind: "curse", relationship: body.relationship, reading: "Plant" }, R, 30);
    expect(run(ds, [binding, curse])[0]!.status).toBe("cursed");
    expect(run([...ds, ...law(20)], [binding, curse, strike(curse, X)])[0]!.status).toBe("cursed");
    const lifted = [binding, curse, strike(curse, R)];
    expect(run(ds, lifted)[0]!.status).toBe("selected");
    expect(
      run(ds, [
        binding,
        decision({ kind: "curse", relationship: body.relationship, reading: "Plant" }, X),
      ])[0]!.status,
    ).toBe("selected");
    expect(ds).toHaveLength(4);
    const all = [...ds, ...law(20)];
    expect(run([...all].reverse().concat(all), [...lifted].reverse().concat(lifted))).toEqual(
      run(all, lifted),
    );
  });
  it("separates identical authors at distinct sources and refuses missing source or destination fallback", () => {
    const a = law(),
      b = law(20);
    const decisions = [
      binding,
      decision({ ...body, relationship: "other", source: "other", reading: "Plant2" }),
    ];
    const r = projectLiveReceiving({
      receiver,
      destination,
      decisions,
      sources: [
        { id: "media_log", deltas: a },
        { id: "other", deltas: b },
      ],
    });
    expect(r.find((x) => x.relationship === body.relationship)!.registration!.boundId).toBe(
      a[3]!.id,
    );
    expect(r.find((x) => x.relationship === "other")!.status).toBe("unavailable");
    expect(run(a, [binding], "other")[0]!.status).toBe("missing-source");
    expect(
      projectLiveReceiving({
        receiver,
        destination: "elsewhere",
        decisions: [binding],
        sources: [{ id: "media_log", deltas: a }],
      }),
    ).toEqual([]);
  });
  it("fails closed on conflicting/malformed decisions, invalid IDs/signatures, unsupported modes and duplicate source identities", () => {
    const ds = law();
    expect(run(ds, [binding, decision({ ...body, source: "other" }, R, 2)])[0]!.status).toBe(
      "conflict",
    );
    expect(run(ds, [decision({ ...body, mode: "one-time" })])[0]!.status).toBe("unsupported");
    expect(run(ds, [decision({ ...body, source: "" })])[0]!.status).toBe("invalid-input");
    expect(run(ds, [{ ...binding, id: "bad" }])[0]!.status).toBe("invalid-input");
    expect(run([{ ...ds[0]!, sig: "00" }, ...ds.slice(1)])[0]!.status).toBe("invalid-input");
    expect(
      projectLiveReceiving({
        receiver,
        destination,
        decisions: [binding],
        sources: [
          { id: "media_log", deltas: ds },
          { id: "media_log", deltas: ds },
        ],
      })[0]!.status,
    ).toBe("invalid-input");
    expect(run(ds.slice(1))[0]!.status).toBe("unavailable");
    const dependent = signClaims(
      publishHyperSchemaClaims(
        { ...PLANT, body: { kind: "fix", schema: { kind: "name", name: "Other" }, entity: FERN } },
        entity,
        author,
        90,
      ),
      S,
    );
    expect(run([...ds, dependent])[0]!.status).toBe("unsupported");
    // A dependency nested inside another term is refused the same way.
    const nested = signClaims(
      publishHyperSchemaClaims(
        {
          ...PLANT,
          body: {
            kind: "prune",
            keep: "all",
            of: { kind: "fix", schema: { kind: "name", name: "Other" }, entity: FERN },
          },
        },
        entity,
        author,
        91,
      ),
      S,
    );
    expect(run([...ds, nested])[0]!.status).toBe("unsupported");
  });
  it("refuses expand and resolve programs, NUL identities and a selection on a live binding", () => {
    const ds = law();
    for (const program of [
      {
        kind: "expand",
        role: { kind: "exact", value: "tag" },
        schema: { kind: "name", name: "Other" },
        of: { kind: "input" },
      },
      { kind: "resolve", schema: PLANT_POLICY, of: { kind: "input" } },
    ] as const) {
      const dependent = signClaims(
        publishHyperSchemaClaims({ ...PLANT, body: program }, entity, author, 90),
        S,
      );
      expect(run([...ds, dependent])[0]!.status).toBe("unsupported");
    }
    expect(run(ds, [decision({ ...body, source: "media\0log" })])[0]!.status).toBe("invalid-input");
    expect(run(ds, [decision({ ...body, selection: null })])[0]!.status).toBe("invalid-input");
  });
  it("a struck malformed decision is not input; a surviving one still refuses the batch", () => {
    const ds = law();
    const bad = decision({ kind: "binding" }, R, 2);
    expect(run(ds, [binding, bad])[0]!.status).toBe("invalid-input");
    expect(run(ds, [binding, bad, strike(bad, R)])[0]!.status).toBe("selected");
    expect(run(ds, [binding, bad, strike(bad, X)])[0]!.status).toBe("invalid-input");
  });
  it("a curse under a sibling reading leaves this reading alone; a pause must name one of the receiver's bindings", () => {
    const ds = law();
    // Spec 60: the curse key is (relationship, served reading); it is not a content-global ban.
    const sibling = decision(
      { kind: "curse", relationship: body.relationship, reading: "Other" },
      R,
      30,
    );
    expect(run(ds, [binding, sibling])[0]!.status).toBe("selected");
    const own = decision(
      { kind: "curse", relationship: body.relationship, reading: "Plant" },
      R,
      32,
    );
    expect(run(ds, [binding, sibling, own])[0]!.status).toBe("cursed");
    // A pause naming a stranger's binding, the receiver's curse on another relationship, or an id
    // never held: refused, never ignored.
    const strangers = decision(body, X, 33);
    const elsewhere = decision({ kind: "curse", relationship: "other", reading: "Plant" }, R, 32);
    for (const named of [strangers.id, elsewhere.id, "ff".repeat(32)])
      expect(
        run(ds, [
          binding,
          strangers,
          elsewhere,
          decision(
            {
              kind: "pause",
              relationship: body.relationship,
              reading: body.reading,
              bindingId: named,
              selection: null,
            },
            R,
            34,
          ),
        ])[0]!.status,
      ).toBe("invalid-selection");
    const stray = decision(
      {
        kind: "pause",
        relationship: body.relationship,
        reading: body.reading,
        bindingId: "ff".repeat(32),
        selection: null,
      },
      R,
      31,
    );
    expect(run(ds, [binding, stray])[0]!.status).toBe("invalid-selection");
  });
  it("a pause is refused unless it names one of the receiver's bindings under that binding's own relationship", () => {
    const ds = law();
    const pauseOn = (bindingId: string, relationship = body.relationship, ts = 40) =>
      decision(
        { kind: "pause", relationship, reading: body.reading, bindingId, selection: null },
        R,
        ts,
      );
    // A struck curse and a struck malformed decision are receiver-authored and withdrawn, but they
    // were never bindings: a pause naming either is refused, not inert.
    const curse = decision(
      { kind: "curse", relationship: body.relationship, reading: "Plant" },
      R,
      30,
    );
    const bad = decision({ kind: "binding" }, R, 31);
    for (const struck of [curse, bad])
      expect(run(ds, [binding, struck, strike(struck, R), pauseOn(struck.id)])[0]!.status).toBe(
        "invalid-selection",
      );
    // A pause that claims relationship A but names B's binding refuses both relationships.
    const other = decision({ ...body, relationship: "zz-other" }, R, 3);
    expect(run(ds, [binding, other, pauseOn(other.id)]).map((r) => r.status)).toEqual([
      "invalid-selection",
      "invalid-selection",
    ]);
    // A pause under a relationship with no binding earns its own refusal row; the binding it
    // does not touch still serves.
    expect(
      run(ds, [binding, pauseOn("ff".repeat(32), "no-such-rel")]).map((r) => [
        r.relationship,
        r.status,
      ]),
    ).toEqual([
      [body.relationship, "selected"],
      ["no-such-rel", "invalid-selection"],
    ]);
    // The inert branch asks the same question: a struck binding of ANOTHER relationship does not
    // make a pause inert, and the pause's claimed relationship still refuses.
    expect(
      run(ds, [binding, other, strike(other, R), pauseOn(other.id)]).map((r) => [
        r.relationship,
        r.status,
      ]),
    ).toEqual([
      [body.relationship, "invalid-selection"],
      ["zz-other", "invalid-selection"],
    ]);
    // A stray relationship whose only binding serves another destination is still reported here.
    const elsewhere = decision(
      { ...body, relationship: "zz-other", destination: "bob_outbox", reading: "Plant2" },
      R,
      4,
    );
    expect(
      run(ds, [binding, elsewhere, pauseOn(elsewhere.id, "zz-other")]).map((r) => [
        r.relationship,
        r.status,
      ]),
    ).toEqual([
      [body.relationship, "selected"],
      ["zz-other", "invalid-selection"],
    ]);
    // Rows are ordered by relationship, not by the order decisions arrived.
    expect(
      run(ds, [binding, pauseOn("ff".repeat(32), "aaa-stray")]).map((r) => [
        r.relationship,
        r.status,
      ]),
    ).toEqual([
      ["aaa-stray", "invalid-selection"],
      [body.relationship, "selected"],
    ]);
    // Control: a pause naming the binding under its own relationship is honoured.
    expect(run(ds, [binding, pauseOn(binding.id)])[0]!.status).toBe("unavailable");
  });
  it("refuses an empty receiver or destination as invalid input, not as an empty projection", () => {
    const ds = law();
    for (const input of [{ receiver: "" }, { destination: "" }])
      expect(
        projectLiveReceiving({
          receiver,
          destination,
          decisions: [binding],
          sources: [{ id: "media_log", deltas: ds }],
          ...input,
        }),
      ).toEqual([{ status: "invalid-input" }]);
  });
  it("a source registration of another hyperschema entity under the same lens is not this binding's law", () => {
    const c = registrationDeltaClaims(
      "hyperschema:Other",
      "Plant",
      PLANT_POLICY,
      [FERN],
      author,
      () => 10,
    );
    const other = [
      signClaims(publishHyperSchemaClaims(PLANT, "hyperschema:Other", author, 10), S),
      ...[c.living, c.snapshot, c.binding].map((c) => signClaims(c, S)),
    ];
    expect(run(other)[0]!.status).toBe("unavailable");
  });
  it("two source registration entities claiming one lens are a conflict, not a pick", () => {
    const ds = law();
    const other = signClaims(
      {
        ...ds[3]!.claims,
        pointers: ds[3]!.claims.pointers.map((p) =>
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
    expect(run([...ds, other])[0]!.status).toBe("conflict");
  });
});
