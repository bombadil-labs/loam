import { check, gql, openStore, sseOpen, summary, tok } from "./harness.mjs";

const stores = {};
try {
  stores.commons = await openStore("commons");
  stores.reel = await openStore("reel");
  const { commons, reel } = stores;

  const wrenStream = await sseOpen(
    commons.base,
    tok("wren", "commons"),
    `subscription { person(entity: "person:wren") { name bio _hex _fromHex _changed } }`,
  );
  const snap = await wrenStream.nextFrame();
  check(
    "2.1",
    "SSE snapshot: current state, _fromHex null",
    snap?.person?.name === "Wren" &&
      snap?.person?._fromHex === null &&
      snap?.person?._changed === null,
    JSON.stringify(snap?.person)?.slice(0, 140),
  );

  const beforeHex = snap.person._hex;
  await gql(
    commons.base,
    tok("wren", "commons"),
    `mutation { person(entity: "person:wren", bio: "keeper of the commons; the moss remembers") { bio } }`,
  );
  const patch = await wrenStream.nextFrame();
  check(
    "2.2",
    "a bio update patches: _fromHex chains, _changed names the prop",
    patch?.person?._fromHex === beforeHex &&
      JSON.stringify(patch?.person?._changed) === '["bio"]' &&
      patch?.person?.bio?.includes("moss remembers"),
    `changed=${JSON.stringify(patch?.person?._changed)}`,
  );

  const milesStream = await sseOpen(
    commons.base,
    tok("miles", "commons"),
    `subscription { person(entity: "person:miles") { bio _changed } }`,
  );
  await milesStream.nextFrame();
  await gql(
    commons.base,
    tok("miles", "commons"),
    `mutation { person(entity: "person:miles", bio: "cinephile; projectionist of the barn") { bio } }`,
  );
  const milesPatch = await milesStream.nextFrame();
  const wrenSilence = await wrenStream.expectSilence(1500);
  check(
    "2.3",
    "concurrent subscribers are isolated per entity",
    milesPatch?.person?.bio?.includes("projectionist") && wrenSilence.silent,
    wrenSilence.silent
      ? "wren stream stayed silent"
      : `LEAKED: ${JSON.stringify(wrenSilence.frame)}`,
  );

  await gql(
    commons.base,
    tok("wren", "commons"),
    `mutation { person(entity: "person:wren", bio: "keeper of the commons; the moss remembers") { bio } }`,
  );
  const noop = await wrenStream.expectSilence(1500);
  check(
    "2.4",
    "a view-identical re-claim produces NO frame",
    noop.silent,
    noop.silent ? "" : JSON.stringify(noop.frame),
  );

  const sStream = await sseOpen(
    reel.base,
    tok("miles", "reel"),
    `subscription { screening(entity: "screening:s1") { rating _hex _fromHex _changed } }`,
  );
  const sSnap = await sStream.nextFrame();
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { screening(entity: "screening:s1", rating: 5) { rating } }`,
  );
  const sPatch = await sStream.nextFrame();
  check(
    "2.5",
    "reel: a rating revision patches with the hex chain",
    sSnap?.screening?.rating === 4 &&
      sPatch?.screening?.rating === 5 &&
      sPatch?.screening?._fromHex === sSnap?.screening?._hex,
    `4 → ${sPatch?.screening?.rating}`,
  );

  await wrenStream.close();
  await milesStream.close();
  await sStream.close();
} finally {
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 2");
