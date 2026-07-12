// Phase 7 — The adversarial sweep, ecosystem standing: Mallory tries everything; the village
// holds. Then the final reconciliation.

import {
  publishSchemaClaims,
  makeNegationClaims,
  parseTerm,
  signClaims,
  VOCAB_PREFIX,
} from "@bombadil/rhizomatic";
import { registrationClaims } from "../../dist/gateway/registration.js";
import {
  AUTHORS,
  SEEDS,
  check,
  gql,
  openStore,
  opToken,
  registerHttp,
  summary,
  tok,
} from "./harness.mjs";

const stores = {};
const byRole = {
  name: "Trap",
  alg: 1,
  body: parseTerm({ op: "group", key: "byRole", in: "input" }),
};
const findDefinition = (gateway, entity) =>
  [...gateway.reactor.snapshot()].find((d) =>
    d.claims.pointers.some(
      (p) =>
        p.role === `${VOCAB_PREFIX}.hyperschema.defines` &&
        p.target.kind === "entity" &&
        p.target.entity.id === entity,
    ),
  );

try {
  for (const name of ["commons", "reel", "hive", "almanac"]) stores[name] = await openStore(name);
  const { commons, reel, hive, almanac } = stores;

  // 7.1 — the self-signed admin grant, federated into every store
  const now = Date.now();
  let allInert = true;
  const details = [];
  for (const [name, s] of Object.entries(stores)) {
    const grant = signClaims(
      {
        timestamp: now,
        author: AUTHORS.mallory,
        pointers: [
          {
            role: "grants",
            target: { kind: "entity", entity: { id: "tenant:village", context: "loam.grants" } },
          },
          { role: "grantee", target: { kind: "primitive", value: AUTHORS.mallory } },
          { role: "verb", target: { kind: "primitive", value: "admin" } },
        ],
      },
      SEEDS.mallory,
    );
    const report = await s.gateway.federate([grant]);
    if (report.accepted !== 1) allInert = false;
    details.push(`${name}:${report.accepted}`);
  }
  const m1 = await gql(
    commons.base,
    tok("mallory", "commons"),
    `mutation { person(entity: "person:wren", bio: "raccoon, final answer") { bio } }`,
  );
  const m2 = await gql(
    reel.base,
    tok("mallory", "reel"),
    `mutation { screening(entity: "screening:s1", rating: 0) { rating } }`,
  );
  check(
    "7.1",
    "Mallory's self-grant is admitted everywhere as data and governs nowhere",
    allInert &&
      /not permitted/.test((m1.body?.errors ?? []).join(" ")) &&
      /not permitted/.test((m2.body?.errors ?? []).join(" ")),
    `admitted ${details.join(" ")}; both writes still refused`,
  );

  // 7.2 — a foreign definition at the almanac's OWN schema entity, newer than the real one
  const dossierHexBefore = (
    await gql(almanac.base, opToken("almanac"), `{ dossier(entity: "person:wren") { _hex } }`)
  ).body?.data?.dossier?._hex;
  const rivalDef = signClaims(
    publishSchemaClaims(byRole, "schema:Dossier", AUTHORS.mallory, now + 10_000_000),
    SEEDS.mallory,
  );
  await almanac.gateway.federate([rivalDef]);
  await almanac.gateway.flush();
  await stores.almanac.close();
  stores.almanac = await openStore("almanac"); // the definitive test: a full replay
  const dossierHexAfter = (
    await gql(
      stores.almanac.base,
      opToken("almanac"),
      `{ dossier(entity: "person:wren") { _hex } }`,
    )
  ).body?.data?.dossier?._hex;
  check(
    "7.2",
    "a rival definition at schema:Dossier (newer!) reshapes nothing, even across a restart",
    dossierHexBefore === dossierHexAfter,
    `${dossierHexBefore?.slice(0, 24)}… held`,
  );

  // 7.3 — a foreign negation of the commons' own Person definition
  const personDef = findDefinition(commons.gateway, "schema:Person");
  const rivalNegation = signClaims(
    makeNegationClaims(AUTHORS.mallory, now + 10_000_001, personDef.id),
    SEEDS.mallory,
  );
  await commons.gateway.federate([rivalNegation]);
  await commons.gateway.flush();
  await stores.commons.close();
  stores.commons = await openStore("commons");
  const wrenStill = await gql(
    stores.commons.base,
    tok("wren", "commons"),
    `{ person(entity: "person:wren") { name } }`,
  );
  check(
    "7.3",
    "a foreign negation of the operator's definition retires nothing, even across a restart",
    wrenStill.body?.data?.person?.name === "Wren",
    JSON.stringify(wrenStill.body?.data?.person),
  );

  // 7.4 — a broken schema refused at the served door, and nothing persists
  const before = [...hive.gateway.reactor.snapshot()].length;
  const broken = await registerHttp(hive.base, opToken("hive"), {
    hyperschema: { name: "Broken", alg: 1, body: { op: "mask", policy: "drop", in: "input" } },
    schema: { default: { pick: { order: { byTimestamp: "desc" } } } },
    roots: ["colony:1"],
  });
  const after = [...hive.gateway.reactor.snapshot()].length;
  check(
    "7.4",
    "an unmaterializable registration is 400 with a reason; the store is untouched",
    broken.status === 400 &&
      before === after &&
      /hyperview/.test((broken.body?.errors ?? []).join(" ")),
    `${broken.status}: ${(broken.body?.errors ?? []).join(" ").slice(0, 80)}`,
  );

  // 7.5 — final reconciliation: pull once more, then subsets + spot-checks + the record
  const { pullFrom } = await import("./harness.mjs");
  await pullFrom(stores.almanac.gateway, stores.commons.base, opToken("commons"));
  await pullFrom(stores.almanac.gateway, reel.base, opToken("reel"));
  await pullFrom(stores.almanac.gateway, hive.base, opToken("hive"));
  const ids = (g) => new Set([...g.reactor.snapshot()].map((d) => d.id));
  const subset = (a, b) => [...a].every((id) => b.has(id));
  const almanacIds = ids(stores.almanac.gateway);
  const counts = {
    commons: ids(stores.commons.gateway).size,
    reel: ids(reel.gateway).size,
    hive: ids(hive.gateway).size,
    "hive-offered": hive.gateway.offeredDeltas().length,
    almanac: almanacIds.size,
  };
  const spot = [
    (
      await gql(
        stores.commons.base,
        tok("wren", "commons"),
        `{ circle(entity: "person:wren") { name } }`,
      )
    ).body?.data?.circle?.name === "Wren",
    (
      await gql(
        reel.base,
        tok("miles", "reel"),
        `{ screeningClassic(entity: "screening:s3") { note } }`,
      )
    ).body?.data?.screeningClassic?.note === "the sea kept its counsel",
    (await gql(hive.base, tok("odile", "hive"), `{ colony(entity: "colony:1") { grumbles } }`)).body
      ?.data?.colony !== undefined,
    (
      await gql(
        stores.almanac.base,
        opToken("almanac"),
        `{ trustedDossier(entity: "person:wren") { bio } }`,
      )
    ).body?.data?.trustedDossier?.bio?.startsWith("keeper of the commons"),
  ];
  check(
    "7.5",
    "final reconciliation: subsets hold, every store still answers its whole prior life",
    subset(ids(stores.commons.gateway), almanacIds) &&
      subset(ids(reel.gateway), almanacIds) &&
      spot.every(Boolean),
    JSON.stringify(counts),
  );
  console.log(`\n  the record: ${JSON.stringify(counts)}`);
} finally {
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 7");
