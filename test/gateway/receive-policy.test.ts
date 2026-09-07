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
//   a curse under another reading is ignored, not refused           → 1 red, 59 green
//   a pause naming a binding the policy never held is ignored       → 1 red, 59 green
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
  it("refuses a curse under another reading and a pause naming a binding the policy never held", () => {
    const ds = law();
    const foreign = decision(
      { kind: "curse", relationship: body.relationship, reading: "Other" },
      R,
      30,
    );
    expect(run(ds, [binding, foreign])[0]!.status).toBe("invalid-selection");
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
