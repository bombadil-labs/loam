// Source membership and law authorship are independent receiving boundaries.
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
import { expect, it } from "vitest";
import {
  Reactor,
  authorForSeed,
  makeNegationClaims,
  publishHyperSchemaClaims,
  publishSchemaClaims,
  resolveView,
  signClaims,
  type Delta,
  type HyperSchema,
  type Schema,
} from "@bombadil/rhizomatic";
import { freezeMembers } from "../../src/gateway/container-identity.js";
import { entityGatherBody } from "../../src/gateway/gather.js";
import { projectLiveReceiving } from "../../src/gateway/receive-policy.js";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const R = "61".repeat(32),
  A = "62".repeat(32),
  B = "63".repeat(32);
const receiver = authorForSeed(R),
  authorA = authorForSeed(A),
  authorB = authorForSeed(B);
const foreignProgram: HyperSchema = { ...PLANT, body: entityGatherBody({ authoredBy: authorB }) };
const foreignSchema: Schema = {
  ...PLANT_POLICY,
  props: new Map([
    ...PLANT_POLICY.props,
    ["height", { kind: "pick", order: { kind: "byTimestamp", dir: "asc" } }],
  ]),
};
const base = {
  kind: "binding",
  relationship: "media-to-outbox",
  source: "media",
  destination: "outbox",
  sourceAuthor: authorA,
  entity: "hyperschema:Plant",
  reading: "Plant",
  mode: "live",
};
function decision(value: object): Delta {
  return signClaims(
    {
      author: receiver,
      timestamp: 50,
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
    R,
  );
}
function law(seed: string, timestamp: number, program: HyperSchema, schema: Schema): Delta[] {
  const author = authorForSeed(seed);
  const c = registrationDeltaClaims(
    base.entity,
    base.reading,
    schema,
    [FERN],
    author,
    () => timestamp,
  );
  return [
    signClaims(publishHyperSchemaClaims(program, base.entity, author, timestamp), seed),
    ...[c.living, c.snapshot, c.binding].map((claims) => signClaims(claims, seed)),
  ];
}
const a = law(A, 10, PLANT, PLANT_POLICY),
  b = law(B, 20, foreignProgram, foreignSchema);
function decisions(
  mode: "live" | "one-time" | "paused",
  members: Delta[],
  registration: Delta,
  sourceAuthor = authorA,
) {
  const binding = decision({ ...base, sourceAuthor });
  const selection = {
    source: base.source,
    registrationId: registration.id,
    memberIds: members.map((d) => d.id),
    versionId: freezeMembers(members).id,
  };
  if (mode === "live") return [binding];
  if (mode === "one-time") return [decision({ ...base, sourceAuthor, mode, selection })];
  return [
    binding,
    decision({
      kind: "pause",
      relationship: base.relationship,
      reading: base.reading,
      bindingId: binding.id,
      selection,
    }),
  ];
}
const run = (members: Delta[], policy: Delta[]) =>
  projectLiveReceiving({
    receiver,
    destination: base.destination,
    decisions: policy,
    sources: [{ id: base.source, deltas: members }],
  });
function assertSelected(
  result: ReturnType<typeof run>,
  registration: Delta,
  program: HyperSchema,
  expected: number,
) {
  expect(result).toHaveLength(1);
  expect(result[0]!.status).toBe("selected");
  const selected = result[0]!.registration!;
  expect(selected.boundId).toBe(registration.id);
  expect(selected.boundBy).toBe(registration.claims.author);
  expect(selected.hyperschema.body).toEqual(program.body);
  const data = new Reactor();
  for (const d of [
    observed(FERN, "height", 11, 100, B),
    observed(FERN, "height", 33, 101, B),
    observed(FERN, "height", 22, 102, R),
  ])
    data.ingest(d);
  data.register("selected", selected.hyperschema.body, selected.roots);
  const view = resolveView(selected.schema, data.materializedView("selected", FERN)!);
  expect(view).toMatchObject({ height: expected });
}

it("selects the bound author despite newer valid competing law in the same live source", () => {
  const members = [...a, ...b],
    policy = decisions("live", members, a[3]!);
  const result = run(members, policy);
  assertSelected(result, a[3]!, PLANT, 22);
  assertSelected(
    run(members, decisions("live", members, b[3]!, authorB)),
    b[3]!,
    foreignProgram,
    11,
  );
  expect(run([...members].reverse().concat(members), [...policy, ...policy])).toEqual(result);
});

for (const mode of ["one-time", "paused"] as const) {
  it(`${mode} ignores foreign definitions of the selected author's exact law entities`, () => {
    const ref = a[3]!.claims.pointers.find((p) => p.role === "schemaVersion")!.target;
    if (ref.kind !== "entity") throw new Error("fixture schema reference");
    const foreignDefinition = signClaims(
      publishSchemaClaims({ ...foreignSchema, name: "Plant", alg: 1 }, ref.entity.id, authorB, 30),
      B,
    );
    const members = [...a, ...b, foreignDefinition],
      before = JSON.stringify(members);
    const policy = decisions(mode, members, a[3]!);
    const result = run(members, policy);
    assertSelected(result, a[3]!, PLANT, 22);
    for (const pinned of [a[0]!, a[2]!]) {
      const withdrawal = signClaims(makeNegationClaims(authorA, 40, pinned.id), A);
      const withdrawn = run([...members, withdrawal], policy);
      if (mode === "paused") {
        expect(withdrawn[0]!.status).toBe("unavailable");
        expect(withdrawn[0]!.registration).toBeUndefined();
      } else assertSelected(withdrawn, a[3]!, PLANT, 22);
      const restore = signClaims(makeNegationClaims(authorA, 41, withdrawal.id), A);
      assertSelected(run([...members, withdrawal, restore], policy), a[3]!, PLANT, 22);
    }
    for (const unselected of [b[0]!, foreignDefinition]) {
      const withdrawal = signClaims(makeNegationClaims(authorA, 42, unselected.id), A);
      assertSelected(run([...members, withdrawal], policy), a[3]!, PLANT, 22);
    }
    expect(
      run([...members].reverse().concat(members), [...policy].reverse().concat(policy)),
    ).toEqual(result);
    expect(JSON.stringify(members)).toBe(before);
  });
  it(`${mode} refuses valid foreign-only selection and accepts its matching-author control`, () => {
    const before = JSON.stringify(b);
    const refused = run(b, decisions(mode, b, b[3]!));
    expect(refused[0]!.status).toBe("invalid-selection");
    expect(refused[0]!.registration).toBeUndefined();
    assertSelected(run(b, decisions(mode, b, b[3]!, authorB)), b[3]!, foreignProgram, 11);
    expect(JSON.stringify(b)).toBe(before);
  });
}
