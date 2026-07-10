// Phase 6 — The living ecosystem: all four stores up, the pulse running, subscribers parked on
// the almanac while writes land two federation hops away.

import { signClaims } from "@bombadil/rhizomatic";
import {
  AUTHORS,
  SEEDS,
  appendAs,
  attendClaims,
  check,
  companionClaims,
  constitute,
  filmOfClaims,
  gql,
  openStore,
  opToken,
  pullFrom,
  sleep,
  sseOpen,
  summary,
  tok,
} from "./harness.mjs";

const stores = {};
let pulsing = true;
let pulseError;

// The anti-entropy pulse: reel reads the commons; the almanac reads everyone. ~1.2s cadence.
async function pulse() {
  while (pulsing) {
    try {
      await pullFrom(stores.reel.gateway, stores.commons.base, opToken("commons"));
      await pullFrom(stores.almanac.gateway, stores.commons.base, opToken("commons"));
      await pullFrom(stores.almanac.gateway, stores.reel.base, opToken("reel"));
      await pullFrom(stores.almanac.gateway, stores.hive.base, opToken("hive"));
    } catch (err) {
      pulseError = err;
    }
    await sleep(1200);
  }
}

// Read frames until the predicate is satisfied (patches may coalesce or arrive split).
async function framesUntil(stream, pred, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await stream.nextFrame(Math.max(500, deadline - Date.now()));
    if (pred(last)) return last;
    if (Date.now() > deadline) throw new Error(`condition not met; last: ${JSON.stringify(last)}`);
  }
}

try {
  for (const name of ["commons", "reel", "hive", "almanac"]) stores[name] = await openStore(name);
  const { commons, reel, hive, almanac } = stores;
  const pulseDone = pulse();

  // 6.1 — the centerpiece subscriber
  const wrenDossier = await sseOpen(
    almanac.base,
    opToken("almanac"),
    `subscription { dossier(entity: "person:wren") { name bio companioned attended _hex _changed } }`,
  );
  const snap = await wrenDossier.nextFrame();
  check(
    "6.1",
    "a subscriber watches Wren's dossier on the ALMANAC over SSE",
    snap?.dossier?.name === "Wren",
    JSON.stringify(snap?.dossier)?.slice(0, 160),
  );

  // 6.2 — THE HEADLINE: a write on the reel patches a subscription on the almanac
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { screening(entity: "screening:s4", date: "2026-07-09", venue: "the barn", rating: 5) { rating } }`,
  );
  await appendAs(reel.gateway, "miles", [
    filmOfClaims("screening:s4", "film:the-secret-garden", Date.now()),
    companionClaims("screening:s4", "person:wren", Date.now() + 1),
  ]);
  const patch62 = await framesUntil(wrenDossier, (f) =>
    JSON.stringify(f?.dossier?.companioned ?? "").includes("screening:s4"),
  );
  check(
    "6.2",
    "HEADLINE: Miles writes on the reel → Wren's almanac dossier patches, across federation",
    patch62.dossier.companioned.includes("screening:s4"),
    `companioned=${JSON.stringify(patch62.dossier.companioned)} changed=${JSON.stringify(patch62.dossier._changed)}`,
  );

  // 6.3 — a second app moves the same dossier
  await gql(
    commons.base,
    tok("wren", "commons"),
    `mutation { person(entity: "person:wren", bio: "keeper of the commons; the fern archive grows") { bio } }`,
  );
  const patch63 = await framesUntil(wrenDossier, (f) =>
    (f?.dossier?.bio ?? "").includes("fern archive"),
  );
  check(
    "6.3",
    "Wren's commons bio update patches the SAME almanac stream (two apps, one dossier)",
    patch63.dossier.bio.includes("fern archive"),
  );

  // 6.4 — Petra arrives: live constitutional change, then two stores compose her dossier
  await constitute(commons, ["petra"], 2_000_000);
  const petraDossier = await sseOpen(
    almanac.base,
    opToken("almanac"),
    `subscription { dossier(entity: "person:petra") { name attended _changed } }`,
  );
  await petraDossier.nextFrame(); // snapshot (likely sparse)
  await gql(
    commons.base,
    tok("petra", "commons"),
    `mutation { person(entity: "person:petra", name: "Petra", bio: "new to the village, old to bees") { name } }`,
  );
  await gql(
    hive.base,
    tok("odile", "hive"),
    `mutation { gathering(entity: "gathering:harvest-2", date: "2026-07-09", honey: 9) { honey } }`,
  );
  await appendAs(hive.gateway, "odile", [
    attendClaims("gathering:harvest-2", "person:petra", Date.now()),
  ]);
  const patch64 = await framesUntil(
    petraDossier,
    (f) =>
      f?.dossier?.name === "Petra" &&
      JSON.stringify(f?.dossier?.attended ?? "").includes("gathering:harvest-2"),
  );
  check(
    "6.4",
    "Petra arrives: profile (commons) + attendance (hive) compose in one dossier",
    true,
    `${patch64.dossier.name} attended ${JSON.stringify(patch64.dossier.attended)}`,
  );
  await petraDossier.close();

  // 6.5 — the reel's schema evolution crossed as DATA and rebound nothing here
  const genBefore = almanac.gateway.materializationFor("Dossier");
  await sleep(1500); // at least one full pulse
  const genAfter = almanac.gateway.materializationFor("Dossier");
  const noScreening = await gql(
    almanac.base,
    opToken("almanac"),
    `{ screening(entity: "screening:s4") { _hex } }`,
  );
  check(
    "6.5",
    "reel's Screening definitions sit in the almanac as data; its own surface never rebinds",
    genBefore === genAfter &&
      /Cannot query field "screening"/.test((noScreening.body?.errors ?? []).join(" ")),
    `generation stable; screening type absent`,
  );

  // 6.6 — the trust lens: Mallory's NEWER forgery wins pick-latest, loses byAuthorRank
  const forgery = signClaims(
    {
      timestamp: Date.now() + 10_000_000, // the newest claim about Wren's bio, by far
      author: AUTHORS.mallory,
      pointers: [
        {
          role: "subject",
          target: { kind: "entity", entity: { id: "person:wren", context: "bio" } },
        },
        { role: "value", target: { kind: "primitive", value: "definitely a raccoon in a coat" } },
      ],
    },
    SEEDS.mallory,
  );
  const admitted = await almanac.gateway.federate([forgery]);
  const plain = (
    await gql(almanac.base, opToken("almanac"), `{ dossier(entity: "person:wren") { bio } }`)
  ).body?.data?.dossier?.bio;
  const trusted = (
    await gql(almanac.base, opToken("almanac"), `{ trustedDossier(entity: "person:wren") { bio } }`)
  ).body?.data?.trustedDossier?.bio;
  check(
    "6.6",
    "same ground, two truths: pick-latest shows the forgery, byAuthorRank keeps Wren's word",
    admitted.accepted === 1 &&
      plain === "definitely a raccoon in a coat" &&
      trusted !== plain &&
      trusted?.startsWith("keeper of the commons"),
    `plain="${plain}" trusted="${trusted}"`,
  );

  // 6.7 — the four-store audit: subsets + cross-store convergence, post-saga
  const ids = (g) => new Set([...g.reactor.snapshot()].map((d) => d.id));
  const subset = (a, b) => [...a].every((id) => b.has(id));
  const almanacIds = ids(almanac.gateway);
  const hiveOffered = new Set(hive.gateway.offeredDeltas().map((d) => d.id));
  const q = `{ person(entity: "person:odile") { _hex } }`;
  const odileReel = (await gql(reel.base, tok("miles", "reel"), q)).body?.data?.person?._hex;
  const odileAlmanac = (await gql(almanac.base, opToken("almanac"), q)).body?.data?.person?._hex;
  check(
    "6.7",
    "audit: commons ⊆ almanac, reel ⊆ almanac, hive-offered ⊆ almanac; odile converges",
    subset(ids(commons.gateway), almanacIds) &&
      subset(ids(reel.gateway), almanacIds) &&
      subset(hiveOffered, almanacIds) &&
      odileReel === odileAlmanac,
    `counts: commons ${ids(commons.gateway).size}, reel ${ids(reel.gateway).size}, hive-offered ${hiveOffered.size}, almanac ${almanacIds.size}`,
  );

  // 6.8 — restart the almanac cold: the whole confluence replays from deltas
  await wrenDossier.close();
  pulsing = false;
  await pulseDone;
  const beforeHex = (
    await gql(almanac.base, opToken("almanac"), `{ dossier(entity: "person:wren") { _hex } }`)
  ).body?.data?.dossier?._hex;
  await almanac.close();
  stores.almanac = await openStore("almanac");
  const afterHex = (
    await gql(
      stores.almanac.base,
      opToken("almanac"),
      `{ dossier(entity: "person:wren") { _hex } }`,
    )
  ).body?.data?.dossier?._hex;
  const freshStream = await sseOpen(
    stores.almanac.base,
    opToken("almanac"),
    `subscription { dossier(entity: "person:wren") { name } }`,
  );
  const freshSnap = await freshStream.nextFrame();
  await freshStream.close();
  check(
    "6.8",
    "cold restart: every schema replays, the dossier answers with the SAME _hex, streams reopen",
    beforeHex === afterHex && freshSnap?.dossier?.name === "Wren",
    `${beforeHex?.slice(0, 24)}… === ${afterHex?.slice(0, 24)}…`,
  );
  if (pulseError) console.log(`  note: pulse saw an error at some point: ${pulseError}`);
} finally {
  pulsing = false;
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 6");
