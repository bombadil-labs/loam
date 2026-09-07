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
});
