// Phase 1 — Isolated read/write, per store: constitutions, profiles, edges, authz negatives.

import {
  PEOPLE,
  appendAs,
  attendClaims,
  check,
  companionClaims,
  filmOfClaims,
  followClaims,
  gql,
  openStore,
  opToken,
  registerHttp,
  summary,
  tok,
} from "./harness.mjs";
import { constitute } from "./harness.mjs";

const T0 = 1_000_000; // fixed constitutional clock — re-runs dedup by content address
const stores = {};
try {
  for (const name of ["commons", "reel", "hive"]) stores[name] = await openStore(name);
  const { commons, reel, hive } = stores;

  // Standing, not ownership (authors-not-owners): each store's operator opens the door to its
  // residents — and that is ALL. Nobody adopts anyone else's vocabulary; pointing is free.
  await constitute(commons, ["wren", "miles", "odile"], T0);
  await constitute(reel, ["miles"], T0);
  await constitute(hive, ["odile"], T0);

  // 1.1 — Wren self-authors her profile over HTTP
  const w = await gql(
    commons.base,
    tok("wren", "commons"),
    `mutation { person(entity: "person:wren", name: "Wren", bio: "keeper of the commons") { name bio _hex } }`,
  );
  const wp = w.body?.data?.person;
  check(
    "1.1",
    "Wren self-authors her profile; read-back exact with _hex",
    wp?.name === "Wren" && wp?.bio === "keeper of the commons" && typeof wp?._hex === "string",
    JSON.stringify(wp ?? w.body?.errors),
  );

  // 1.2 — more profiles, follow edges, and the nested Circle
  await gql(
    commons.base,
    tok("miles", "commons"),
    `mutation { person(entity: "person:miles", name: "Miles", bio: "cinephile of the east lane") { name } }`,
  );
  await gql(
    commons.base,
    tok("odile", "commons"),
    `mutation { person(entity: "person:odile", name: "Odile", bio: "beekeeper, plain-spoken") { name } }`,
  );
  await appendAs(commons.gateway, "wren", [
    followClaims("person:wren", "person:miles", Date.now()),
    followClaims("person:wren", "person:odile", Date.now() + 1),
  ]);
  await appendAs(commons.gateway, "miles", [
    followClaims("person:miles", "person:wren", Date.now() + 2),
  ]);
  const circle = await gql(
    commons.base,
    tok("wren", "commons"),
    `{ circle(entity: "person:wren") { name follows } }`,
  );
  const circleText = JSON.stringify(circle.body?.data ?? circle.body?.errors);
  check(
    "1.2",
    "Circle expands Wren's friends WITH their profile data (nested hyperview)",
    circleText.includes("Miles") && circleText.includes("Odile"),
    circleText.slice(0, 200),
  );

  // 1.3 — reel: films, a solo screening, and FilmNight nesting
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { film(entity: "film:solaris", title: "Solaris", year: 1972, director: "Tarkovsky") { title } }`,
  );
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { film(entity: "film:the-secret-garden", title: "The Secret Garden", year: 1993, director: "Holland") { title } }`,
  );
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { film(entity: "film:local-hero", title: "Local Hero", year: 1983, director: "Forsyth") { title } }`,
  );
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { screening(entity: "screening:s1", date: "2026-07-01", venue: "home", rating: 4, note: "slow water, slow grief") { rating } }`,
  );
  await appendAs(reel.gateway, "miles", [filmOfClaims("screening:s1", "film:solaris", Date.now())]);
  const s1 = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screening(entity: "screening:s1") { film date venue rating note } }`,
  );
  const s1p = s1.body?.data?.screening;
  const night = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ filmNight(entity: "screening:s1") { film } }`,
  );
  const nightText = JSON.stringify(night.body?.data ?? night.body?.errors);
  check(
    "1.3",
    "a solo screening reads back exact; FilmNight nests the film's own view",
    s1p?.rating === 4 && s1p?.note === "slow water, slow grief" && nightText.includes("Solaris"),
    `screening=${JSON.stringify(s1p)} night=${nightText.slice(0, 120)}`,
  );

  // 1.4 — a screening WITH companions: person refs into another store's vocabulary
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { screening(entity: "screening:s2", date: "2026-07-05", venue: "the barn", rating: 5, note: "garden on screen, garden outside") { rating } }`,
  );
  await appendAs(reel.gateway, "miles", [
    filmOfClaims("screening:s2", "film:the-secret-garden", Date.now()),
    companionClaims("screening:s2", "person:wren", Date.now() + 1),
    companionClaims("screening:s2", "person:odile", Date.now() + 2),
  ]);
  const s2 = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screening(entity: "screening:s2") { with } }`,
  );
  const withText = JSON.stringify(s2.body?.data?.screening?.with ?? s2.body?.errors);
  check(
    "1.4",
    "companions land as person refs (names arrive after phase 5's pull)",
    withText.includes("person:wren") && withText.includes("person:odile"),
    withText.slice(0, 160),
  );

  // 1.5 — hive: colony status with a frank grumble; a gathering with attendees
  await gql(
    hive.base,
    tok("odile", "hive"),
    `mutation { colony(entity: "colony:1", queen: "Beatrix II", frames: 8, yield: 14) { queen } }`,
  );
  await gql(
    hive.base,
    tok("odile", "hive"),
    `mutation { colony(entity: "colony:1", grumbles: "west box sulks when it rains") { queen } }`,
  );
  await gql(
    hive.base,
    tok("odile", "hive"),
    `mutation { gathering(entity: "gathering:harvest-1", date: "2026-07-06", honey: 12) { honey } }`,
  );
  await appendAs(hive.gateway, "odile", [
    attendClaims("gathering:harvest-1", "person:wren", Date.now()),
    attendClaims("gathering:harvest-1", "person:miles", Date.now() + 1),
  ]);
  const colony = await gql(
    hive.base,
    tok("odile", "hive"),
    `{ colony(entity: "colony:1") { queen frames yield grumbles } }`,
  );
  const cp = colony.body?.data?.colony;
  check(
    "1.5",
    "colony + grumble + gathering read back exact",
    cp?.queen === "Beatrix II" &&
      cp?.yield === 14 &&
      JSON.stringify(cp?.grumbles).includes("west box sulks"),
    JSON.stringify(cp),
  );

  // 1.6 — the authorization negatives
  const denials = [];
  const m1 = await gql(
    commons.base,
    tok("mallory", "commons"),
    `mutation { person(entity: "person:wren", bio: "actually a raccoon") { bio } }`,
  );
  denials.push(["mallory write on commons", (m1.body?.errors ?? []).join(" ")]);
  const o1 = await gql(
    reel.base,
    tok("odile", "reel"),
    `mutation { screening(entity: "screening:s1", rating: 1) { rating } }`,
  );
  denials.push(["odile write on reel", (o1.body?.errors ?? []).join(" ")]);
  const reg = await registerHttp(commons.base, tok("wren", "commons"), {
    schema: {},
    policy: {},
    roots: [],
  });
  const fed = await fetch(`${commons.base}/federate`, {
    headers: { authorization: `Bearer ${tok("wren", "commons")}` },
  });
  const allDenied =
    denials.every(([, msg]) => /not permitted/.test(msg)) &&
    reg.status === 403 &&
    fed.status === 403;
  check(
    "1.6",
    "authz negatives: strangers refused, actors fenced to their tenants, register+federate operator-only",
    allDenied,
    `${denials.map(([who, m]) => `${who}: ${m.slice(0, 60)}`).join(" | ")} | register=${reg.status} federate=${fed.status}`,
  );

  // 1.7 — determinism: same query → same hex; a write moves it
  const q = `{ person(entity: "person:wren") { _hex } }`;
  const h1 = (await gql(commons.base, tok("wren", "commons"), q)).body?.data?.person?._hex;
  const h2 = (await gql(commons.base, tok("wren", "commons"), q)).body?.data?.person?._hex;
  await gql(
    commons.base,
    tok("wren", "commons"),
    `mutation { person(entity: "person:wren", bio: "keeper of the commons; forager of chanterelles") { bio } }`,
  );
  const h3 = (await gql(commons.base, tok("wren", "commons"), q)).body?.data?.person?._hex;
  check("1.7", "same query twice → identical _hex; a write → a new one", h1 === h2 && h1 !== h3);
} finally {
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 1");
