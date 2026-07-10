// Phase 3 — Many schemas, one ground: several lenses over the same entities, moved by one write.

import {
  appendAs,
  check,
  followClaims,
  gql,
  openStore,
  opToken,
  sseOpen,
  summary,
  tok,
} from "./harness.mjs";

const stores = {};
try {
  stores.commons = await openStore("commons");
  stores.almanac = await openStore("almanac");
  const { commons, almanac } = stores;

  // 3.1 — Dossier and Presence: same body, two policies, one root. person:zephyr is a local
  // test entity (untenanted on the almanac → the operator's own to write; also NOT in the
  // registered roots, so this exercises the lazy-materialization path).
  await gql(
    almanac.base,
    opToken("almanac"),
    `mutation { dossier(entity: "person:zephyr", name: "Zephyr", bio: "a test wind") { name } }`,
  );
  const d1 = await gql(
    almanac.base,
    opToken("almanac"),
    `{ dossier(entity: "person:zephyr") { name bio _hex } }`,
  );
  const p1 = await gql(
    almanac.base,
    opToken("almanac"),
    `{ presence(entity: "person:zephyr") { name _hex } }`,
  );
  const dv = d1.body?.data?.dossier;
  const pv = p1.body?.data?.presence;
  const presenceHasBio = JSON.stringify(p1.body).includes("a test wind");
  check(
    "3.1",
    "Dossier and Presence both answer at one root; Presence is the strict subset",
    dv?.name === "Zephyr" && dv?.bio === "a test wind" && pv?.name === "Zephyr" && !presenceHasBio,
    `dossier=${JSON.stringify(dv)} presence=${JSON.stringify(pv)}`,
  );

  // 3.2 — one write moves BOTH views, and they stay mutually consistent
  await gql(
    almanac.base,
    opToken("almanac"),
    `mutation { dossier(entity: "person:zephyr", name: "Zephyr the Test Wind") { name } }`,
  );
  const d2 = (
    await gql(
      almanac.base,
      opToken("almanac"),
      `{ dossier(entity: "person:zephyr") { name _hex } }`,
    )
  ).body?.data?.dossier;
  const p2 = (
    await gql(
      almanac.base,
      opToken("almanac"),
      `{ presence(entity: "person:zephyr") { name _hex } }`,
    )
  ).body?.data?.presence;
  check(
    "3.2",
    "one write moves both lenses; the views agree on the shared prop",
    d2?._hex !== dv?._hex && p2?._hex !== pv?._hex && d2?.name === p2?.name,
    `name=${d2?.name}`,
  );

  // 3.3 / 3.4 — on the commons: Person and Circle subscribers over the SAME entity, one edge
  const personStream = await sseOpen(
    commons.base,
    tok("wren", "commons"),
    `subscription { person(entity: "person:wren") { follows _changed } }`,
  );
  const circleStream = await sseOpen(
    commons.base,
    tok("wren", "commons"),
    `subscription { circle(entity: "person:wren") { follows _changed } }`,
  );
  await personStream.nextFrame();
  await circleStream.nextFrame();

  await appendAs(commons.gateway, "wren", [
    followClaims("person:wren", "person:petra", Date.now()),
  ]);
  const personPatch = await personStream.nextFrame();
  const circlePatch = await circleStream.nextFrame();
  const flatFollows = JSON.stringify(personPatch?.person?.follows);
  const nestedFollows = JSON.stringify(circlePatch?.circle?.follows);
  check(
    "3.3",
    "one follows-edge write patches BOTH the flat Person and the expanded Circle",
    flatFollows?.includes("person:petra") && nestedFollows !== undefined,
    `person.follows=${flatFollows?.slice(0, 90)}`,
  );
  check(
    "3.4",
    "each stream got its OWN shape from the one delta (flat refs vs expanded views)",
    personPatch?.person?._changed?.includes("follows") &&
      circlePatch?.circle?._changed?.includes("follows") &&
      flatFollows !== nestedFollows,
    `circle.follows=${nestedFollows?.slice(0, 120)}`,
  );
  await personStream.close();
  await circleStream.close();
} finally {
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 3");
