import { publicClaims } from "../../dist/index.js";
import { authorForSeed, loamClient, mintSeed } from "../../dist/client/index.js";
import {
  AUTHORS,
  check,
  constitute,
  gql,
  grantAuthor,
  openStore,
  opToken,
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

let almanac;
try {
  almanac = await openStore("almanac");
  await constitute(almanac, ["wren", "miles", "odile", "petra", "miller"], 1_000_000);

  const before = await anonGql(almanac.base, `{ dossier(entity: "person:wren") { bio } }`);
  const declaration = signClaims(
    publicClaims(["Dossier", "TrustedDossier", "GuardedDossier"], almanac.operator, ts),
    almanac.seed,
  );
  await almanac.gateway.append([declaration]);
  const after = await anonGql(almanac.base, `{ dossier(entity: "person:wren") { bio } }`);
  check(
    "13.1",
    "one declaration opens the door: 401 becomes an answer, no token in sight",
    before.status === 401 && after.status === 200 && after.body?.data?.dossier !== undefined,
    `before ${before.status}, after ${after.status}`,
  );

  const write = await anonGql(
    almanac.base,
    `mutation { dossier(entity: "person:wren", bio: "graffiti") { bio } }`,
  );
  const types = await anonGql(almanac.base, `{ __schema { types { name } mutationType { name } } }`);
  const names = (types.body?.data?.__schema?.types ?? []).map((t) => t.name).join(" ");
  check(
    "13.2",
    "no writes, no unlisted shapes: the public surface is a smaller world, honestly introspected",
    (write.body?.errors?.length ?? 0) > 0 &&
      types.body?.data?.__schema?.mutationType === null &&
      names.includes("DossierView") &&
      !names.includes("PresenceView"),
  );

  const seed = mintSeed();
  const ambrose = authorForSeed(seed);
  await grantAuthor(almanac, ambrose, 1_000_900);
  const client = loamClient({ url: almanac.base, token: tok("mallory", "almanac"), seed });
  const receipt = await client.claim([
    { role: "subject", at: "person:ambrose", context: "bio" },
    { role: "value", value: "new in the village; signs for himself" },
  ]);
  const landed = almanac.gateway.reactor.get(receipt.delta);
  check(
    "13.3",
    "the client signs in-page and the delta lands under its OWN author, not the token's",
    receipt.accepted === 1 && landed?.claims.author === ambrose && ambrose !== AUTHORS.mallory,
  );

  const readBack = await anonGql(almanac.base, `{ dossier(entity: "person:ambrose") { bio } }`);
  check(
    "13.4",
    "write through the non-custodial door, read through the open one — no token reads it back",
    readBack.status === 200 && /signs for himself/.test(String(readBack.body?.data?.dossier?.bio)),
    `bio: ${JSON.stringify(readBack.body?.data?.dossier?.bio)}`,
  );

  const { makeNegationClaims } = await import("@bombadil/rhizomatic");
  await almanac.gateway.append([
    signClaims(makeNegationClaims(almanac.operator, ts + 1, declaration.id), almanac.seed),
  ]);
  const closed = await anonGql(almanac.base, `{ dossier(entity: "person:wren") { bio } }`);
  const nowhere = await fetch(`${almanac.base.replace(/almanac$/, "nowhere")}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ __typename }" }),
  });
  check(
    "13.5",
    "one negation closes the door, and closed reads exactly like absent",
    closed.status === 401 && nowhere.status === 401,
    `closed ${closed.status}, absent ${nowhere.status}`,
  );

  await almanac.gateway.append([
    signClaims(
      publicClaims(["Dossier", "TrustedDossier", "GuardedDossier"], almanac.operator, ts + 2),
      almanac.seed,
    ),
  ]);
  const authed = await gql(
    almanac.base,
    opToken("almanac"),
    `{ dossier(entity: "person:wren") { _hex } }`,
  );
  const reopened = await anonGql(almanac.base, `{ dossier(entity: "person:wren") { _hex } }`);
  check(
    "13.6",
    "the door reopens by declaration; the authed surface never flinched",
    authed.status === 200 && reopened.status === 200,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase 13 — the open door");
