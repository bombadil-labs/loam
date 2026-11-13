import { publicClaims } from "../../dist/index.js";
import { authorForSeed, loamClient, mintSeed } from "../../dist/client/index.js";
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

  const { attachMill, ensurePresence, plantMill } = await import("./mill.mjs");
  await ensurePresence(almanac.base, opToken("almanac"));
  await plantMill(almanac);
  await attachMill(almanac);

  const seed = mintSeed();
  const player = authorForSeed(seed);
  const person = `person:visitor-${ts % 100000}`;
  const client = loamClient({ url: almanac.base, token: tok("gate", "almanac"), seed });

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

  const spec = loadSpec("dossier.json");
  const evolved = await registerHttp(almanac.base, opToken("almanac"), {
    ...spec,
    roots: [...spec.roots, person],
  });
  if (evolved.status !== 200) throw new Error(`roll evolution refused: ${JSON.stringify(evolved.body)}`);
  await attachMill(almanac);

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

  await sleep(400);
  const milled = await anonGql(almanac.base, `{ dossier(entity: "${person}") { presence } }`);
  const presence = milled.body?.data?.dossier?.presence;
  check(
    "14.4",
    "the mill grinds the newcomer's presence — flour for the stranger, same as the founders",
    presence !== null && presence !== undefined,
    JSON.stringify(presence?.value ?? presence).slice(0, 60),
  );

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
