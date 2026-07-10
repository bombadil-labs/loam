// Phase 4 — The schema lifecycle: create → use → evolve live → both shapes at once →
// deprecate → revive → and the old ground under old law answers exactly as it always did.

import { makeNegationClaims, signClaims, VOCAB_PREFIX } from "@bombadil/rhizomatic";
import { Gateway, SqliteBackend } from "../dist/index.js";
import {
  appendAs,
  check,
  companionClaims,
  copyFileSync,
  filmOfClaims,
  gql,
  homeOf,
  join,
  loadSpec,
  openStore,
  opToken,
  registerHttp,
  sseOpen,
  summary,
  tok,
} from "./harness.mjs";

const S3 = "screening:s3";
const V1_FIELDS = `{ film date venue rating note with _hex }`;
const findDefinition = (gateway, entity) =>
  [...gateway.reactor.snapshot()].find((d) =>
    d.claims.pointers.some(
      (p) =>
        p.role === `${VOCAB_PREFIX}.schema.defines` &&
        p.target.kind === "entity" &&
        p.target.entity.id === entity,
    ),
  );

let reel = await openStore("reel");
const copyPath = join(homeOf("reel"), "reel-at-T.sqlite");
let recordedHex;
try {
  // Seed s3: the screening the whole phase watches.
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { screening(entity: "${S3}", date: "2026-07-08", venue: "the barn", rating: 4, note: "the sea kept its counsel") { rating } }`,
  );
  await appendAs(reel.gateway, "miles", [
    filmOfClaims(S3, "film:local-hero", Date.now()),
    companionClaims(S3, "person:wren", Date.now() + 1),
  ]);

  // 4.1 — pin the hex AND the ground itself
  const at_T = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screening(entity: "${S3}") ${V1_FIELDS} }`,
  );
  recordedHex = at_T.body?.data?.screening?._hex;
  await reel.close(); // single writer: close before copying the file
  copyFileSync(join(homeOf("reel"), "store.sqlite"), copyPath);
  reel = await openStore("reel");
  check(
    "4.1",
    "pinned: v1 _hex recorded, sqlite ground copied aside",
    typeof recordedHex === "string",
    recordedHex?.slice(0, 32) + "…",
  );

  // 4.2 — a v1 subscriber, watching
  const v1Stream = await sseOpen(
    reel.base,
    tok("miles", "reel"),
    `subscription { screening(entity: "${S3}") { rating note _hex _fromHex } }`,
  );
  const v1Snap = await v1Stream.nextFrame();
  check(
    "4.2",
    "a pre-evolution stream opens under v1 (note and all)",
    v1Snap?.screening?.note === "the sea kept its counsel",
    JSON.stringify(v1Snap?.screening)?.slice(0, 120),
  );

  // 4.3 — EVOLVE, live, over HTTP
  const evolved = await registerHttp(reel.base, opToken("reel"), loadSpec("screening-v2.json"));
  check(
    "4.3",
    "republish at the same entity: 200, no restart",
    evolved.status === 200 && evolved.body?.entity === "schema:Screening",
    JSON.stringify(evolved.body),
  );

  // 4.4 — new readers see v2
  const noteGone = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screening(entity: "${S3}") { note } }`,
  );
  const v2Read = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screening(entity: "${S3}") { rating rewatch date } }`,
  );
  check(
    "4.4",
    "v2: `note` unanswerable, `rewatch` queryable, history still resolves",
    /Cannot query field "note"/.test((noteGone.body?.errors ?? []).join(" ")) &&
      v2Read.body?.errors === undefined &&
      v2Read.body?.data?.screening?.rating === 4 &&
      v2Read.body?.data?.screening?.date === "2026-07-08",
    JSON.stringify(v2Read.body?.data?.screening),
  );

  // 4.5 — the old stream keeps its promised shape
  await gql(
    reel.base,
    tok("miles", "reel"),
    `mutation { screening(entity: "${S3}", rating: 5) { rating } }`,
  );
  const v1Patch = await v1Stream.nextFrame();
  check(
    "4.5",
    "the pre-evolution stream patches AND still carries `note` (captured shape)",
    v1Patch?.screening?.rating === 5 && v1Patch?.screening?.note === "the sea kept its counsel",
    JSON.stringify(v1Patch?.screening)?.slice(0, 120),
  );
  await v1Stream.close();

  // 4.6 — both shapes at once: v1's law re-registered at its own entity
  const classic = await registerHttp(
    reel.base,
    opToken("reel"),
    loadSpec("screening-classic.json"),
  );
  const classicRead = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screeningClassic(entity: "${S3}") { rating note } }`,
  );
  const v2Again = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screening(entity: "${S3}") { rating rewatch } }`,
  );
  check(
    "4.6",
    "ScreeningClassic (v1 shape) and Screening (v2) serve CONCURRENTLY over the same deltas",
    classic.status === 200 &&
      classicRead.body?.data?.screeningClassic?.note === "the sea kept its counsel" &&
      classicRead.body?.data?.screeningClassic?.rating === 5 &&
      v2Again.body?.errors === undefined,
    `classic=${JSON.stringify(classicRead.body?.data?.screeningClassic)}`,
  );

  // 4.7 — nothing ever breaks: old ground + old law = the exact old answer
  const frozen = await Gateway.open(new SqliteBackend(copyPath), { seed: reel.seed });
  const replayed = await frozen.query(`{ screening(entity: "${S3}") ${V1_FIELDS} }`);
  const frozenHex = replayed.data?.screening?._hex;
  await frozen.close();
  check(
    "4.7",
    "the phase-start sqlite copy reproduces the recorded _hex byte-identically",
    frozenHex === recordedHex,
    `${frozenHex?.slice(0, 32)}… === ${recordedHex?.slice(0, 32)}…`,
  );

  // 4.8 — deprecation is negation
  const classicDef = findDefinition(reel.gateway, "schema:ScreeningClassic");
  const retirement = signClaims(
    makeNegationClaims(reel.operator, Date.now(), classicDef.id),
    reel.seed,
  );
  await reel.gateway.append([retirement]);
  await reel.gateway.flush();
  await reel.close();
  reel = await openStore("reel");
  const gone = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screeningClassic(entity: "${S3}") { rating } }`,
  );
  check(
    "4.8",
    "a negated definition drops its type on rebuild; the deltas all remain",
    /Cannot query field "screeningClassic"/.test((gone.body?.errors ?? []).join(" ")),
    (gone.body?.errors ?? []).join(" ").slice(0, 90),
  );

  // 4.9 — revival: negate the negation
  await reel.gateway.append([
    signClaims(makeNegationClaims(reel.operator, Date.now(), retirement.id), reel.seed),
  ]);
  await reel.gateway.flush();
  await reel.close();
  reel = await openStore("reel");
  const back = await gql(
    reel.base,
    tok("miles", "reel"),
    `{ screeningClassic(entity: "${S3}") { note } }`,
  );
  check(
    "4.9",
    "negating the negation revives the type, data intact",
    back.body?.data?.screeningClassic?.note === "the sea kept its counsel",
    JSON.stringify(back.body?.data ?? back.body?.errors),
  );

  // 4.10 — an identical republish binds nothing new
  const genBefore = reel.gateway.materializationFor("Screening");
  await registerHttp(reel.base, opToken("reel"), loadSpec("screening-v2.json"));
  const genAfter = reel.gateway.materializationFor("Screening");
  check(
    "4.10",
    "identical republish of v2 → no rebind (generation stable)",
    genBefore === genAfter,
  );
} finally {
  await reel.close().catch(() => {});
}
summary("phase 4");
