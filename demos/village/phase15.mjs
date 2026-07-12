// Phase 15 (Unit 3c) — MULTIPLAYER IS FEDERATION: two villagers, two DIFFERENT stores, no
// game-server authority. Ana writes on the almanac; Ben writes on the commons; one pulse and
// the union renders the same, byte for byte, to any reader through the open door. Then the
// sock-knocker: she takes the village home — a fresh store, HER OWN operator, one pull — and
// the paradigm keeps its word twice: the whole ground arrives, and the village's law binds
// NOTHING on her machine. She writes her own lens, and the village answers through it, with
// her in it. Sovereignty both ways: the almanac's open-door declaration sits in her ground as
// data, and her door stays closed until SHE says otherwise.

import {
  Gateway,
  MemoryBackend,
  publicClaims,
  readPublicSchemas,
  trustClaims,
} from "../../dist/index.js";
import { authorForSeed, loamClient, mintSeed } from "../../dist/client/index.js";
import { parseSchema, parseTerm } from "@bombadil/rhizomatic";
import { readFileSync } from "node:fs";
import {
  check,
  constitute,
  grantAuthor,
  join,
  openStore,
  opToken,
  pullFrom,
  SCHEMAS,
  signClaims,
  summary,
  tok,
} from "./harness.mjs";

const ts = Date.now();
const anonGql = async (base, query) => {
  const res = await fetch(`${base}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
};

let almanac, commons, laptop;
try {
  almanac = await openStore("almanac");
  commons = await openStore("commons");
  await constitute(almanac, ["wren", "miles", "odile", "petra", "miller"], 1_000_000);
  await constitute(commons, ["wren", "miles", "odile", "petra"], 1_000_000);
  await almanac.gateway.append([
    signClaims(publicClaims(["Dossier"], almanac.operator, ts), almanac.seed),
    // The living village's forgery arc may have left the almanac ROSTERED (trust is data and
    // the door obeys whatever declaration survives) — this phase states its own posture: an
    // aggregator by choice, so a stranger's honest deltas can cross from the commons.
    signClaims(trustClaims("open", [], almanac.operator, ts + 1), almanac.seed),
  ]);

  // Ana joins the almanac through the gate's steps; Ben holds standing on the COMMONS — two
  // writers, two sovereign stores, no shared authority anywhere.
  const anaSeed = mintSeed();
  const benSeed = mintSeed();
  const ana = `person:ana-${ts % 100000}`;
  const ben = `person:ben-${ts % 100000}`;
  await grantAuthor(almanac, authorForSeed(anaSeed), Date.now());
  await grantAuthor(commons, authorForSeed(benSeed), Date.now());
  const anaClient = loamClient({ url: almanac.base, token: tok("gate", "almanac"), seed: anaSeed });
  const benClient = loamClient({ url: commons.base, token: tok("gate", "commons"), seed: benSeed });

  // 15.1 — interleaved writes on different stores; one pulse; one union
  await anaClient.claim([
    { role: "subject", at: ana, context: "bio" },
    { role: "value", value: "came in from the almanac side" },
  ]);
  await benClient.claim([
    { role: "subject", at: ben, context: "bio" },
    { role: "value", value: "wrote himself in from the commons" },
  ]);
  await benClient.claim([
    { role: "subject", at: ben, context: "follows" },
    { role: "friend", at: ana, context: "circle" },
  ]);
  await pullFrom(almanac.gateway, commons.base, opToken("commons"));
  const anaRead = await anonGql(almanac.base, `{ dossier(entity: "${ana}") { bio circle } }`);
  const benRead = await anonGql(almanac.base, `{ dossier(entity: "${ben}") { bio } }`);
  check(
    "15.1",
    "two writers, two stores, no shared authority — one pulse and the union holds them both",
    /almanac side/.test(String(anaRead.body?.data?.dossier?.bio)) &&
      /from the commons/.test(String(benRead.body?.data?.dossier?.bio)) &&
      JSON.stringify(anaRead.body?.data?.dossier?.circle ?? []).includes(ben),
  );

  // 15.2 — two independent readers agree byte for byte: the content address IS the agreement
  const q = `{ a: dossier(entity: "${ana}") { _hex } b: dossier(entity: "${ben}") { _hex } }`;
  const readerX = await loamClient({ url: almanac.base }).query(q);
  const readerY = await loamClient({ url: almanac.base }).query(q);
  check(
    "15.2",
    "independent tokenless readers render the union identically — _hex for _hex",
    readerX.data?.a?._hex === readerY.data?.a?._hex &&
      readerX.data?.b?._hex === readerY.data?.b?._hex &&
      typeof readerX.data?.a?._hex === "string",
  );

  // 15.3 — THE TAKE-HOME, part one: a fresh store, HER OWN operator, one pull. The whole
  // ground arrives; the village's law does not bind — her store has no surface until she
  // gives it one. (In the demo the operator hands her the pull token: his village, his key.)
  const herSeed = mintSeed();
  laptop = await Gateway.open(new MemoryBackend(), { seed: herSeed });
  const pulled = await pullFrom(laptop, almanac.base, opToken("almanac"));
  let lawless = "";
  try {
    await laptop.query(`{ dossier(entity: "${ana}") { bio } }`);
  } catch (err) {
    lawless = String(err.message);
  }
  check(
    "15.3",
    "one pull brings the whole ground; foreign law binds nothing — no surface until hers",
    pulled.accepted > 0 && /nothing is registered/.test(lawless),
    `${pulled.accepted} deltas accepted`,
  );

  // 15.4 — part two: she writes her own lens, and the village answers through it — with her
  // in it (Ana is hers now too; the ground never belonged to the store it crossed from)
  const spec = JSON.parse(readFileSync(join(SCHEMAS, "dossier.json"), "utf8"));
  laptop.register(
    { name: spec.hyperschema.name, alg: spec.hyperschema.alg ?? 1, body: parseTerm(spec.hyperschema.body) },
    parseSchema(spec.schema),
    [...spec.roots, ana, ben],
  );
  const hers = await laptop.query(
    `{ a: dossier(entity: "${ana}") { bio } w: dossier(entity: "person:wren") { _hex } }`,
  );
  check(
    "15.4",
    "she registers her own Dossier lens and the village resolves through HER law, her villager included",
    /almanac side/.test(String(hers.data?.a?.bio)) && typeof hers.data?.w?._hex === "string",
  );

  // 15.5 — sovereignty both ways: the almanac's open-door declaration RODE THE PULL and sits
  // in her ground as data — and her door is still closed, because on her store that voice is
  // foreign. Nothing is public until SHE declares it.
  const declarationPresent = [...laptop.reactor.snapshot()].some((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.id === "loam:public",
    ),
  );
  check(
    "15.5",
    "the village's open-door declaration is in her ground, and her door is still closed",
    declarationPresent &&
      readPublicSchemas(laptop.reactor, authorForSeed(herSeed)).size === 0 &&
      !laptop.hasPublicSurface(),
  );
} finally {
  await laptop?.close().catch(() => {});
  await almanac?.close().catch(() => {});
  await commons?.close().catch(() => {});
}
summary("phase 15 — multiplayer is federation");
