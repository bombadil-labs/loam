// Phase 19 — TWO DOORS, ONE TRUTH (SPEC §17, PRs #60/#61). The almanac has answered GraphQL
// since the founding; today it answers REST from the same registrations, and the village
// checks the doors against each other the way §17 demands: one ground, one registration, the
// same view — _hex for _hex. Then the versioning law, lived: a lens evolves (v2 minted, v1
// still answerable, the two resolving the same ground differently), the operator withdraws
// v1 (410 Gone by its true name — on the operator's door; anonymously every unknown hash is
// the same 404, because history is not anonymous).

import { authorForSeed, parseSchema, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { makeNegationClaims } from "@bombadil/rhizomatic";
import { publicClaims } from "../../dist/index.js";
import { check, openStore, opToken, summary } from "./harness.mjs";

const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const PICK = { pick: { order: { byTimestamp: "desc" } } };

let almanac;
try {
  almanac = await openStore("almanac");
  const operator = almanac.operator;
  const rest = (path, token) =>
    fetch(`${almanac.base}${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  const gql = async (query, token) => {
    const res = await fetch(`${almanac.base}/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ query }),
    });
    return res.json();
  };

  // The phase's own lens, so the act owns its versioning story end to end. The stage is
  // cleared first — the almanac's home persists between runs, and a re-run must start from
  // its own opening line: the operator strikes every surviving Fieldnote version (withdrawal
  // is the same instrument the finale demonstrates; idempotence by law, not by luck).
  for (const stale of almanac.gateway
    .registrationVersions()
    .filter((v) => v.schema.name === "Fieldnote")) {
    await almanac.gateway.append([
      signClaims(
        makeNegationClaims(operator, Date.now(), stale.deltaId, "phase 19 clears its stage"),
        almanac.seed,
      ),
    ]);
  }
  const FIELDNOTE = { name: "Fieldnote", alg: 1, body: parseTerm(GATHER) };
  await almanac.gateway.publishRegistration(
    FIELDNOTE,
    parseSchema({ props: { text: PICK }, default: PICK }),
    ["note:almanac-day"],
  );
  await almanac.gateway.append([
    signClaims(
      {
        timestamp: Date.now(),
        author: operator,
        pointers: [
          {
            role: "subject",
            target: { kind: "entity", entity: { id: "note:almanac-day", context: "text" } },
          },
          { role: "value", target: { kind: "primitive", value: "two doors hung today" } },
        ],
      },
      almanac.seed,
    ),
  ]);

  // 19.1 — the OpenAPI document is a real, live description of this store's lenses
  const specRes = await rest("/openapi.json", opToken("almanac"));
  const spec = await specRes.json();
  const paths = Object.keys(spec.paths ?? {});
  check(
    "19.1",
    "the almanac describes itself: a live OpenAPI document naming its registered lenses",
    specRes.status === 200 && paths.some((p) => p.includes("/Fieldnote/")),
    `${paths.length} paths`,
  );

  // 19.2 — agreement: the same view through both doors, _hex for _hex
  const viaGql = await gql(`{ fieldnote(entity: "note:almanac-day") { text _hex } }`, opToken("almanac"));
  const viaRest = await (
    await rest(`/rest/v1/Fieldnote/${encodeURIComponent("note:almanac-day")}`, opToken("almanac"))
  ).json();
  check(
    "19.2",
    "one ground, one registration, two doors: the same view, _hex for _hex",
    viaGql.data?.fieldnote?._hex !== undefined && viaGql.data.fieldnote._hex === viaRest._hex,
    `${String(viaRest._hex).slice(0, 14)}…`,
  );

  // 19.3 — the versioning law, lived: evolve (v2 minted, v1 answerable, resolutions diverge)
  await almanac.gateway.publishRegistration(
    FIELDNOTE,
    parseSchema({
      props: { text: PICK, tags: { all: { order: { byTimestamp: "asc" } } } },
      default: PICK,
    }),
    ["note:almanac-day"],
  );
  // Give the lenses something to disagree about: one tags fact — v2 declares tags as ALL (a
  // list); v1 never named it, so its DEFAULT answers a scalar. Same ground, two resolutions.
  await almanac.gateway.append([
    signClaims(
      {
        timestamp: Date.now(),
        author: operator,
        pointers: [
          {
            role: "subject",
            target: { kind: "entity", entity: { id: "note:almanac-day", context: "tags" } },
          },
          { role: "value", target: { kind: "primitive", value: "carpentry" } },
        ],
      },
      almanac.seed,
    ),
  ]);
  const versions = almanac.gateway.registrationVersions().filter((v) => v.schema.name === "Fieldnote");
  const v1 = await (
    await rest(`/rest/v1/Fieldnote/${encodeURIComponent("note:almanac-day")}`, opToken("almanac"))
  ).json();
  const v2 = await (
    await rest(`/rest/v2/Fieldnote/${encodeURIComponent("note:almanac-day")}`, opToken("almanac"))
  ).json();
  check(
    "19.3",
    "evolution mints v2 and v1 stays answerable — two lenses, one ground, different addresses",
    versions.length === 2 && v1._hex !== undefined && v2._hex !== undefined && v1._hex !== v2._hex,
    `v1 ${String(v1._hex).slice(0, 10)}… ≠ v2 ${String(v2._hex).slice(0, 10)}…`,
  );

  // 19.4 — withdrawal: struck by its true name; 410 on the operator's door, 404 to strangers
  const v1Hash = versions[0].deltaId;
  await almanac.gateway.append([
    signClaims(makeNegationClaims(operator, Date.now(), v1Hash, "phase 19 retires v1"), almanac.seed),
  ]);
  const gone = await rest(
    `/rest/@${v1Hash}/Fieldnote/${encodeURIComponent("note:almanac-day")}`,
    opToken("almanac"),
  );
  // The stranger's window: declare Fieldnote public, then probe the withdrawn hash tokenless.
  await almanac.gateway.append([
    signClaims(publicClaims(["Fieldnote"], operator, Date.now()), almanac.seed),
  ]);
  const anonProbe = await rest(`/rest/@${v1Hash}/Fieldnote/${encodeURIComponent("note:almanac-day")}`);
  const anonRead = await (
    await rest(`/rest/v1/Fieldnote/${encodeURIComponent("note:almanac-day")}`)
  ).json();
  check(
    "19.4",
    "withdrawn answers 410 by true name on the operator's door; anonymously it is a plain 404 — and the stranger still reads the living lens",
    gone.status === 410 && anonProbe.status === 404 && anonRead._hex !== undefined,
    `410/${anonProbe.status}, anon reads ${String(anonRead._hex).slice(0, 10)}…`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase 19 — two doors, one truth");
