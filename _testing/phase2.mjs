// Phase 2 — Live views: SSE mechanics on single stores.

import { check, gql, openStore, sseOpen, summary, tok } from "./harness.mjs";

const stores = {};
try {
  stores.commons = await openStore("commons");
  stores.reel = await openStore("reel");
  const { commons, reel } = stores;

  // 2.1 — snapshot semantics
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

  // 2.2 — a bio update patches with the hex chain
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

  // 2.3 — two subscribers, two entities: each hears only their own
  const milesStream = await sseOpen(
    commons.base,
    tok("miles", "commons"),
    `subscription { person(entity: "person:miles") { bio _changed } }`,
  );
  await milesStream.nextFrame(); // miles snapshot
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

  // 2.4 — a view-identical write is silence, not a no-op patch
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

  // 2.5 — reel: a rating revision patches with the chain
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
