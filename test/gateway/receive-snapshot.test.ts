// T282: signed immutable law operands; no signer or ingestion adapter in the projector.
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
  return resolveView(reg.schema, data.materializedView("reading", FERN)!).height;
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
    const ds = [...a, ...law(5, olderPolicy), replacement],
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
  for (const defect of ["missing", "duplicate", "address", "registration", "source"] as const)
    it(`refuses ${defect} manifest with explicit status`, () => {
      const a = law(),
        s = selection(a);
      if (defect === "missing") s.memberIds.push("missing");
      if (defect === "duplicate") s.memberIds.push(a[0]!.id);
      if (defect === "address") s.versionId = "wrong";
      if (defect === "registration") s.registrationId = a[0]!.id;
      if (defect === "source") s.source = "other";
      expect(run(a, [decision({ ...body, mode: "one-time", selection: s })])[0]!.status).toBe(
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
