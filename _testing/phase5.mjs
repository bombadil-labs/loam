// Phase 5 — Federation, pairwise: pulls, idempotence, inert foreign law, the hive's lens,
// convergence, and verification at the boundary.

import { makeDelta, signClaims } from "@bombadil/rhizomatic";
import {
  AUTHORS,
  SEEDS,
  check,
  gql,
  openStore,
  opToken,
  pullFrom,
  summary,
  tok,
} from "./harness.mjs";

const stores = {};
const countRegCtx = (gateway) =>
  [...gateway.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
    ),
  ).length;
const countGrumbles = (gateway) =>
  [...gateway.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === "grumbles",
    ),
  ).length;

try {
  for (const name of ["commons", "reel", "hive", "almanac"]) stores[name] = await openStore(name);
  const { commons, reel, hive, almanac } = stores;

  // 5.1 — almanac pulls the commons
  const first = await pullFrom(almanac.gateway, commons.base, opToken("commons"));
  const second = await pullFrom(almanac.gateway, commons.base, opToken("commons"));
  const wrenHere = await gql(
    almanac.base,
    opToken("almanac"),
    `{ dossier(entity: "person:wren") { name bio } }`,
  );
  check(
    "5.1",
    "almanac pulls commons: accepted > 0, re-pull 0, Wren resolves under the almanac's law",
    first.accepted > 0 && second.accepted === 0 && wrenHere.body?.data?.dossier?.name === "Wren",
    `accepted ${first.accepted} then ${second.accepted}; ${JSON.stringify(wrenHere.body?.data?.dossier)}`,
  );

  // 5.2 — foreign law inert: commons' registrations SIT here, bind nothing
  const foreignRegs = countRegCtx(almanac.gateway);
  const circleAbsent = await gql(
    almanac.base,
    opToken("almanac"),
    `{ circle(entity: "person:wren") { _hex } }`,
  );
  check(
    "5.2",
    "commons' registration deltas crossed as data yet bind nothing (no Circle type here)",
    foreignRegs > 5 &&
      /Cannot query field "circle"/.test((circleAbsent.body?.errors ?? []).join(" ")),
    `${foreignRegs} registration-context deltas in the almanac store`,
  );

  // 5.3 — reel pulls commons: companions get their names inside Miles's app
  await pullFrom(reel.gateway, commons.base, opToken("commons"));
  const wrenOnReel = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ person(entity: "person:wren") { name bio } }`,
  );
  check(
    "5.3",
    "reel pulls commons: person profiles resolve inside the reel's own Person view",
    wrenOnReel.body?.data?.person?.name === "Wren",
    JSON.stringify(wrenOnReel.body?.data?.person),
  );

  // 5.4 — the hive federates THROUGH ITS LENS: grumbles stay home
  const hiveGrumbles = countGrumbles(hive.gateway);
  const offered = hive.gateway.offeredDeltas().length;
  const held = [...hive.gateway.reactor.snapshot()].length;
  const pulled = await pullFrom(almanac.gateway, hive.base, opToken("hive"));
  const almanacGrumbles = countGrumbles(almanac.gateway);
  const attendance = await gql(
    almanac.base,
    opToken("almanac"),
    `{ dossier(entity: "person:wren") { attended } }`,
  );
  check(
    "5.4",
    "the lens holds: gatherings cross, the grumble does not",
    hiveGrumbles >= 1 &&
      almanacGrumbles === 0 &&
      offered < held &&
      pulled.accepted > 0 &&
      JSON.stringify(attendance.body?.data?.dossier?.attended)?.includes("gathering:harvest-1"),
    `hive holds ${held}, offers ${offered} (grumbles home: ${hiveGrumbles}); almanac grumbles: ${almanacGrumbles}; wren attended ${JSON.stringify(attendance.body?.data?.dossier?.attended)}`,
  );

  // 5.5 — convergence: an entity whose deltas fully crossed resolves to the SAME hex under
  // the SAME law on two different machines. person:odile — profile + follows (commons) +
  // one companionship (reel) — is exactly reel's holdings after its pull; the almanac, having
  // pulled reel too, holds the same slice for her.
  await pullFrom(almanac.gateway, reel.base, opToken("reel"));
  const q = `{ person(entity: "person:odile") { _hex } }`;
  const onReel = (await gql(reel.base, tok("miles", "reel"), q)).body?.data?.person?._hex;
  const onAlmanac = (await gql(almanac.base, opToken("almanac"), q)).body?.data?.person?._hex;
  check(
    "5.5",
    "convergence: identical deltas + identical law → identical _hex on two stores",
    typeof onReel === "string" && onReel === onAlmanac,
    `reel ${onReel?.slice(0, 24)}… almanac ${onAlmanac?.slice(0, 24)}…`,
  );

  // 5.6 — verification at the boundary: forgery and anonymity refused, honesty lands
  const honest = signClaims(
    {
      timestamp: Date.now(),
      author: AUTHORS.odile,
      pointers: [
        {
          role: "subject",
          target: { kind: "entity", entity: { id: "colony:1", context: "yield" } },
        },
        { role: "value", target: { kind: "primitive", value: 15 } },
      ],
    },
    SEEDS.odile,
  );
  const forged = { ...honest, id: `1e20${"00".repeat(32)}` };
  const unsigned = makeDelta({
    timestamp: Date.now(),
    author: "did:key:zNobody",
    pointers: [
      { role: "subject", target: { kind: "entity", entity: { id: "colony:1", context: "yield" } } },
      { role: "value", target: { kind: "primitive", value: 0 } },
    ],
  });
  const report = await almanac.gateway.federate([forged, unsigned, honest]);
  check(
    "5.6",
    "a forged id and an unsigned delta are refused; the honest neighbor lands",
    report.rejected === 2 && report.accepted === 1,
    `offered ${report.offered}, accepted ${report.accepted}, rejected ${report.rejected}`,
  );
} finally {
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 5");
