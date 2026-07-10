// Phase 14 (Unit 3b) — THE PLAYER: the welcome flow is the constitution as gameplay. A
// stranger's page mints its own key, and the FIRST thing the door says is no — the knock is a
// real refusal, because a transport token lends no authority. Then the petition (a delta the
// stranger signs), the operator's grant, and from there the newcomer writes under their own
// name, is readable back through the open door, and the mill grinds their presence like
// anyone else's. The client is the SHIPPED bundle (dist/client), the same file the page loads.

import { publicClaims } from "../dist/index.js";
import { authorForSeed, loamClient, mintSeed } from "../dist/client/index.js";
import {
  check,
  constitute,
  gql,
  grantAuthor,
  loadSpec,
  openStore,
  opToken,
  registerHttp,
  signClaims,
  sleep,
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

let almanac;
try {
  almanac = await openStore("almanac");
  await constitute(almanac, ["wren", "miles", "odile", "petra", "miller"], 1_000_000);
  await almanac.gateway.append([
    signClaims(
      publicClaims(["Dossier", "TrustedDossier", "GuardedDossier"], almanac.operator, ts),
      almanac.seed,
    ),
  ]);

  // THE MILL turns for this phase too — the newcomer's presence must grind like anyone's.
  const { attachMill, ensurePresence, plantMill } = await import("./mill.mjs");
  await ensurePresence(almanac.base, opToken("almanac"));
  await plantMill(almanac);
  await attachMill(almanac);

  // The player: a key minted where it will live, an author derived from it, no standing yet.
  const seed = mintSeed();
  const player = authorForSeed(seed);
  const person = `person:visitor-${ts % 100000}`;
  const client = loamClient({ url: almanac.base, token: tok("gate", "almanac"), seed });

  // 14.1 — the knock is a real refusal: the gate token carries the request, but the author
  // holds no standing, so the door says no
  let refusal = "";
  try {
    await client.claim([
      { role: "subject", at: person, context: "bio" },
      { role: "value", value: "let me in?" },
    ]);
  } catch (err) {
    refusal = String(err.message);
  }
  check(
    "14.1",
    "before the grant, the stranger's write is refused — the token lent nothing",
    /not permitted/.test(refusal),
    refusal.slice(0, 60),
  );

  // 14.2 — the petition is a delta the stranger signs; the operator grants standing FIRST
  // (an unstanding author's delta is refused, which is the point), then lands the record of
  // asking. This is what village.mjs's /petition endpoint does, in-process here.
  const petition = client.sign([
    { role: "petitions", at: "loam:gate", context: "loam.petition" },
    { role: "name", value: "Visitor" },
  ]);
  await grantAuthor(almanac, player, Date.now());
  const landed = await client.append([petition]);
  check(
    "14.2",
    "the operator grants standing; the petition itself lands as the record of asking",
    landed.accepted === 1,
  );

  // Joining is constitutional twice over: standing at the door, AND a place on the dossier
  // roll — the operator evolves the Dossier registration's roots (registration is data;
  // evolution is one append) and the mill re-attaches to the new generation, so the wheel
  // turns for the newcomer exactly as it does for the founders.
  const spec = loadSpec("dossier.json");
  const evolved = await registerHttp(almanac.base, opToken("almanac"), {
    ...spec,
    roots: [...spec.roots, person],
  });
  if (evolved.status !== 200) throw new Error(`roll evolution refused: ${JSON.stringify(evolved.body)}`);
  await attachMill(almanac);

  // 14.3 — the newcomer writes under their own name; the open door reads it back tokenless
  const receipt = await client.claim([
    { role: "subject", at: person, context: "bio" },
    { role: "value", value: "new in the village; signs for himself" },
  ]);
  await client.claim([
    { role: "gathering", at: "gathering:harvest-2", context: "attendee" },
    { role: "attendee", at: person, context: "attended" },
  ]);
  const readBack = await anonGql(almanac.base, `{ dossier(entity: "${person}") { bio attended } }`);
  check(
    "14.3",
    "bio and attendance land under the player's own signature, readable tokenless",
    almanac.gateway.reactor.get(receipt.delta)?.claims.author === player &&
      /signs for himself/.test(String(readBack.body?.data?.dossier?.bio)) &&
      JSON.stringify(readBack.body?.data?.dossier?.attended ?? []).includes("harvest-2"),
  );

  // 14.4 — the mill grinds the newcomer like anyone else: presence appears, derived and
  // signed by the miller, without the newcomer asking for it
  await sleep(400); // the runner drains derivations on ingest; give the write-through a beat
  const milled = await anonGql(almanac.base, `{ dossier(entity: "${person}") { presence } }`);
  const presence = milled.body?.data?.dossier?.presence;
  check(
    "14.4",
    "the mill grinds the newcomer's presence — flour for the stranger, same as the founders",
    presence !== null && presence !== undefined,
    JSON.stringify(presence?.value ?? presence).slice(0, 60),
  );

  // 14.5 — the dossier is watchable through the open door as a LAZY public watch (the
  // newcomer is no registered root — this is exactly what Unit 2's public budget carries)
  const sse = await fetch(
    `${almanac.base}/subscribe?query=${encodeURIComponent(
      `subscription { dossier(entity: "${person}") { bio } }`,
    )}`,
    { headers: { accept: "text/event-stream" } },
  );
  let snapshot = "";
  if (sse.status === 200) {
    const reader = sse.body.getReader();
    const { value } = await reader.read();
    snapshot = new TextDecoder().decode(value);
    await reader.cancel();
  }
  check(
    "14.5",
    "the newcomer's card streams tokenless — a lazy watch on the public door's own budget",
    sse.status === 200 && snapshot.includes("signs for himself"),
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase 14 — the player");
