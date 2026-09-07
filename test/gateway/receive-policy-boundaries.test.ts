// T281 supplemental value/authority rails after first-rail coverage review.
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
  authorForSeed,
  signClaims,
  verifyDelta,
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
const seed = "41".repeat(32),
  author = authorForSeed(seed),
  destination = "outbox";
const input = { receiver: author, destination };
const bind = (source: string, reading = "Plant", relationship = source) => ({
  kind: "binding",
  relationship,
  source,
  destination,
  sourceAuthor: author,
  entity: "hyperschema:Plant",
  reading,
  mode: "live",
});
function decision(value: object, ts = 1): Delta {
  return signClaims(
    {
      author,
      timestamp: ts,
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
function law(ts: number, reading = "Plant", schema: Schema = PLANT_POLICY): Delta[] {
  const c = registrationDeltaClaims(
    "hyperschema:Plant",
    reading,
    schema,
    [FERN],
    author,
    () => ts,
    undefined,
    undefined,
    { height: { rung: "a", type: "number", code: "export default () => 999" } },
  );
  return [
    signClaims(publishHyperSchemaClaims(PLANT, "hyperschema:Plant", author, ts), seed),
    ...[c.living, c.snapshot, c.binding].map((c) => signClaims(c, seed)),
  ];
}
const strike = (d: Delta, ts: number) => signClaims(makeNegationClaims(author, ts, d.id), seed);
function tags(result: ReturnType<typeof projectLiveReceiving>[number]): unknown {
  expect(result.status).toBe("selected");
  const reg = result.registration!,
    r = new Reactor();
  for (const d of [
    observed(FERN, "tag", "local", 100, seed),
    observed(FERN, "tag", "peer", 101, "42".repeat(32)),
    observed(FERN, "tag", "other-peer", 102, "43".repeat(32)),
  ])
    r.ingest(d);
  r.register("law", reg.hyperschema.body, reg.roots);
  return (resolveView(reg.schema, r.materializedView("law", FERN)!) as Record<string, unknown>).tag;
}
it("changes actual values on live revision, fallback and revival without another local decision", () => {
  const a = law(10),
    b = law(20, "Plant", {
      ...PLANT_POLICY,
      props: new Map([["tag", { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } }]]),
    });
  const decisions = [decision(bind("media"))];
  const run = (ds: Delta[]) =>
    projectLiveReceiving({ ...input, decisions, sources: [{ id: "media", deltas: ds }] })[0]!;
  expect(tags(run(a))).toEqual(["local", "peer", "other-peer"]);
  expect(tags(run([...a, ...b]))).toBe("other-peer");
  const withdrawn = strike(b[3]!, 30);
  expect(tags(run([...a, ...b, withdrawn]))).toEqual(["local", "peer", "other-peer"]);
  const final = [...a, ...b, withdrawn, strike(withdrawn, 40)];
  expect(tags(run(final))).toBe("other-peer");
  expect(run([...final].reverse().concat(final))).toEqual(run(final));
  expect(run(final).withheldResolverFields).toEqual(["height"]);
});
it("keeps two valid same-author source programs separate and reports a receiving-name contest", () => {
  const a = law(10, "PlantA"),
    b = law(20, "PlantB", {
      ...PLANT_POLICY,
      props: new Map([["tag", { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } }]]),
    });
  const sources = [
    { id: "a", deltas: a },
    { id: "b", deltas: b },
  ];
  const r = projectLiveReceiving({
    ...input,
    decisions: [decision(bind("a", "PlantA")), decision(bind("b", "PlantB"))],
    sources,
  });
  expect(tags(r[0]!)).toEqual(["local", "peer", "other-peer"]);
  expect(tags(r[1]!)).toBe("other-peer");
  expect(r[0]!.registration!.boundId).toBe(a[3]!.id);
  expect(r[1]!.registration!.boundId).toBe(b[3]!.id);
  const contested = projectLiveReceiving({
    ...input,
    decisions: [decision(bind("a")), decision(bind("b"))],
    sources: [
      { id: "a", deltas: law(10) },
      { id: "b", deltas: law(20) },
    ],
  });
  expect(contested.map((r) => r.status)).toEqual(["conflict", "conflict"]);
  expect(contested.every((r) => r.registration === undefined)).toBe(true);
});
it("never accepts recipient-signed policy solely from source bytes and validates duplicate bytes before dedup", () => {
  const binding = decision(bind("media")),
    curse = decision({ kind: "curse", relationship: "media", reading: "Plant" }, 30),
    ds = law(10);
  expect(
    projectLiveReceiving({
      ...input,
      decisions: [],
      sources: [{ id: "media", deltas: [...ds, binding] }],
    }),
  ).toEqual([]);
  const r = projectLiveReceiving({
    ...input,
    decisions: [binding],
    sources: [{ id: "media", deltas: [...ds, curse] }],
  });
  expect(r[0]!.status).toBe("selected");
  for (const deltas of [
    [...ds, { ...ds[0]!, sig: "00" }],
    [{ ...ds[0]!, sig: "00" }, ...ds],
  ])
    expect(
      projectLiveReceiving({ ...input, decisions: [binding], sources: [{ id: "media", deltas }] }),
    ).toEqual([{ status: "invalid-input" }]);
});
it("reports conflicting relationship decisions identically in either replay order without a spurious winner", () => {
  const a = decision(bind("media", "Plant", "relationship"));
  const b = decision(bind("other", "PlantB", "relationship"), 2);
  const sources = [
    { id: "media", deltas: law(10) },
    { id: "other", deltas: law(20, "PlantB") },
  ];
  const run = (decisions: Delta[]) => projectLiveReceiving({ ...input, decisions, sources });
  expect(run([a, b])).toEqual([{ relationship: "relationship", destination, status: "conflict" }]);
  expect(run([b, a, b])).toEqual(run([a, b]));
});
it("refuses malformed or duplicate resolver metadata instead of silently serving a different field meaning", () => {
  const ds = law(10),
    binding = ds[3]!;
  const resolver = binding.claims.pointers.find((p) => p.role === "resolvers")!;
  const malformed = signClaims(
    {
      ...binding.claims,
      timestamp: 20,
      pointers: binding.claims.pointers.map((p) =>
        p.role === "resolvers"
          ? { role: "resolvers", target: { kind: "primitive" as const, value: "not-json" } }
          : p,
      ),
    },
    seed,
  );
  const duplicate = signClaims(
    { ...binding.claims, timestamp: 20, pointers: [...binding.claims.pointers, resolver] },
    seed,
  );
  for (const candidate of [malformed, duplicate]) {
    const r = projectLiveReceiving({
      ...input,
      decisions: [decision(bind("media"))],
      sources: [{ id: "media", deltas: [...ds, candidate] }],
    });
    expect(r[0]!.status).toBe("unsupported");
    expect(r[0]!.registration).toBeUndefined();
  }
});
it("rejects signed policy envelopes with extra pointers or a wrong decision entity", () => {
  const valid = decision(bind("media"));
  const extra = signClaims(
    {
      ...valid.claims,
      pointers: [
        ...valid.claims.pointers,
        { role: "extra", target: { kind: "primitive", value: "ambiguous" } },
      ],
    },
    seed,
  );
  const wrongEntity = signClaims(
    {
      ...valid.claims,
      pointers: valid.claims.pointers.map((p) =>
        p.role === "decision"
          ? {
              role: "decision",
              target: {
                kind: "entity" as const,
                entity: { id: "unrelated-policy", context: "loam.receive.experimental.v1" },
              },
            }
          : p,
      ),
    },
    seed,
  );
  for (const invalid of [extra, wrongEntity]) {
    expect(
      projectLiveReceiving({
        ...input,
        decisions: [invalid],
        sources: [{ id: "media", deltas: law(10) }],
      }),
    ).toEqual([{ status: "invalid-input" }]);
  }
});

it("rejects a verified nonprimitive payload even when uncommitted extra properties contain valid JSON", () => {
  const valid = decision(bind("media"));
  // Rhizomatic's canonical profile ignores extra target properties; a signature
  // does not turn this extra value into a primitive target.
  const payload = {
    role: "payload",
    target: {
      kind: "entity" as const,
      entity: { id: "payload-carrier" },
      value: JSON.stringify(bind("media")),
    },
  };
  const envelope = signClaims(
    { ...valid.claims, pointers: [valid.claims.pointers[0]!, payload] },
    seed,
  );
  expect(verifyDelta(envelope)).toBe("verified");
  expect(
    projectLiveReceiving({
      ...input,
      decisions: [envelope],
      sources: [{ id: "media", deltas: law(10) }],
    }),
  ).toEqual([{ status: "invalid-input" }]);
});
it("refuses malformed or ambiguous roots rather than returning an unusable reading", () => {
  const ds = law(10),
    binding = ds[3]!;
  const pointers = binding.claims.pointers;
  const roots = pointers.find((p) => p.role === "roots")!;
  const candidates = ["null", '"plant:fern"', "[1]", '[""]'].map((value) =>
    signClaims(
      {
        ...binding.claims,
        timestamp: 20,
        pointers: pointers.map((p) =>
          p.role === "roots" ? { role: "roots", target: { kind: "primitive" as const, value } } : p,
        ),
      },
      seed,
    ),
  );
  candidates.push(
    signClaims({ ...binding.claims, timestamp: 20, pointers: [...pointers, roots] }, seed),
  );
  for (const candidate of candidates) {
    expect(verifyDelta(candidate)).toBe("verified");
    const r = projectLiveReceiving({
      ...input,
      decisions: [decision(bind("media"))],
      sources: [{ id: "media", deltas: [...ds, candidate] }],
    });
    expect(r[0]!.status).toBe("unsupported");
    expect(r[0]!.registration).toBeUndefined();
  }
});
it("refuses resolver envelopes whose signed field names would be lost by the legacy parser", () => {
  const ds = law(10),
    binding = ds[3]!;
  const value = '{"__proto__":{"rung":"a","type":"number","code":"export default () => 999"}}';
  const candidate = signClaims(
    {
      ...binding.claims,
      timestamp: 20,
      pointers: binding.claims.pointers.map((p) =>
        p.role === "resolvers"
          ? { role: "resolvers", target: { kind: "primitive" as const, value } }
          : p,
      ),
    },
    seed,
  );
  expect(verifyDelta(candidate)).toBe("verified");
  const r = projectLiveReceiving({
    ...input,
    decisions: [decision(bind("media"))],
    sources: [{ id: "media", deltas: [...ds, candidate] }],
  });
  expect(r[0]!.status).toBe("unsupported");
  expect(r[0]!.registration).toBeUndefined();
});
it("does not let context discovery on an entity payload validate a wrong-context marker", () => {
  const valid = decision(bind("media"));
  const payload = {
    role: "payload",
    target: {
      kind: "entity" as const,
      entity: { id: "payload-carrier", context: "loam.receive.experimental.v1" },
      value: JSON.stringify(bind("media")),
    },
  };
  const marker = {
    role: "decision",
    target: {
      kind: "entity" as const,
      entity: { id: "receive-policy", context: "unrelated-policy" },
    },
  };
  const envelope = signClaims({ ...valid.claims, pointers: [marker, payload] }, seed);
  expect(verifyDelta(envelope)).toBe("verified");
  expect(
    projectLiveReceiving({
      ...input,
      decisions: [envelope],
      sources: [{ id: "media", deltas: law(10) }],
    }),
  ).toEqual([{ status: "invalid-input" }]);
});
it("rejects signed JSON null, arrays and scalars as policy decisions", () => {
  const valid = decision(bind("media"));
  for (const value of ["null", "[]", '[{"kind":"binding"}]', '"binding"', "42", "true"]) {
    const envelope = signClaims(
      {
        ...valid.claims,
        pointers: valid.claims.pointers.map((p) =>
          p.role === "payload"
            ? { role: "payload", target: { kind: "primitive" as const, value } }
            : p,
        ),
      },
      seed,
    );
    expect(verifyDelta(envelope)).toBe("verified");
    expect(
      projectLiveReceiving({
        ...input,
        decisions: [envelope],
        sources: [{ id: "media", deltas: law(10) }],
      }),
    ).toEqual([{ status: "invalid-input" }]);
  }
});
