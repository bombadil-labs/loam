// Phase 13 (SPEC §12) — THE OPEN DOOR: the almanac becomes a store a stranger's browser can
// simply read. One operator-signed declaration at loam:public opens the dossier lenses to
// tokenless query + subscribe; every write path stays gated; one negation closes the door
// again, live. And the browser client walks through it: a NEW villager mints a seed in-page,
// signs locally, writes through /append under a borrowed transport token — and the delta
// lands under the villager's OWN name, because the token authenticates transport, never
// authority. The client here is the SHIPPED artifact (dist/client — the browser bundle).

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

  // 13.1 — before any declaration, the anonymous caller meets a wall indistinguishable from
  // no store at all; after ONE operator delta, the dossier answers tokenless
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

  // 13.2 — the open door is READ-shaped: a tokenless mutation is a validation impossibility
  // (no Mutation type exists on the public surface), and Presence — never declared — is
  // invisible even to introspection
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

  // 13.3 — the browser client: a NEW villager (Ambrose, say) mints a seed where it will live,
  // the operator grants standing, and the claim rides Mallory's transport token — landing
  // under Ambrose's own signature. Non-custodial: the server never saw the seed.
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

  // 13.4 — and the freshly-written bio is readable back through the open door, tokenless
  const readBack = await anonGql(almanac.base, `{ dossier(entity: "person:ambrose") { bio } }`);
  check(
    "13.4",
    "write through the non-custodial door, read through the open one — no token reads it back",
    readBack.status === 200 && /signs for himself/.test(String(readBack.body?.data?.dossier?.bio)),
    `bio: ${JSON.stringify(readBack.body?.data?.dossier?.bio)}`,
  );

  // 13.5 — revocation is one negation, live: the door closes mid-conversation, and the
  // refusal is indistinguishable from a mount that never existed
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

  // 13.6 — reopen for the living village (idempotent fixed timestamp rides village.mjs too);
  // an authed read never noticed any of this
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
