// Phase 8 (PR #17) — the 0.2.0 lenses in the village: "trusted, then latest" fixes the
// founding saga's field-note bug, and the GuardedDossier ends the heckler's veto.

import { makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import {
  AUTHORS,
  SEEDS,
  check,
  gql,
  guardedDossierSpec,
  loadSpec,
  openStore,
  opToken,
  pullFrom,
  registerHttp,
  summary,
  tok,
} from "./harness.mjs";

const stores = {};
try {
  stores.commons = await openStore("commons");
  stores.almanac = await openStore("almanac");
  const { commons, almanac } = stores;

  // Upgrade the almanac's law to 0.2.0: TrustedDossier's chain order, and the GuardedDossier.
  // Evolution is append — republishing at the same entities reshapes the running store.
  const chainUp = await registerHttp(almanac.base, opToken("almanac"), loadSpec("trusted-dossier.json"));
  const guardedUp = await registerHttp(
    almanac.base,
    opToken("almanac"),
    guardedDossierSpec(almanac.operator),
  );
  check(
    "8.1",
    "the almanac evolves to 0.2.0 lenses live: chain-ordered TrustedDossier + GuardedDossier",
    chainUp.status === 200 && guardedUp.status === 200,
    `trusted=${chainUp.status} guarded=${guardedUp.status}`,
  );

  // Fresh ground: Wren speaks her LATEST word; Mallory forges a newer one.
  await gql(commons.base, tok("wren", "commons"),
    `mutation { person(entity: "person:wren", bio: "keeper of the commons; the lenses are new") { bio } }`);
  await pullFrom(almanac.gateway, commons.base, opToken("commons"));
  const forgery = signClaims(
    {
      timestamp: Date.now() + 10_000_000,
      author: AUTHORS.mallory,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: "person:wren", context: "bio" } } },
        { role: "value", target: { kind: "primitive", value: "still definitely a raccoon" } },
      ],
    },
    SEEDS.mallory,
  );
  await almanac.gateway.federate([forgery]);

  // 8.2 — chain: trusted AND latest (the founding saga's TrustedDossier showed an OLD bio)
  const trusted = (await gql(almanac.base, opToken("almanac"),
    `{ trustedDossier(entity: "person:wren") { bio } }`)).body?.data?.trustedDossier?.bio;
  check(
    "8.2",
    "chain[byAuthorRank, byTimestamp]: the trusted author's LATEST word wins",
    trusted === "keeper of the commons; the lenses are new",
    `trusted="${trusted}"`,
  );

  // 8.3 — the strike: Mallory negates Wren's latest bio delta by federation
  const struck = [...almanac.gateway.reactor.snapshot()]
    .filter(
      (d) =>
        d.claims.author === AUTHORS.wren &&
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "bio",
        ),
    )
    .sort((a, b) => b.claims.timestamp - a.claims.timestamp)[0];
  await almanac.gateway.federate([
    signClaims(
      makeNegationClaims(AUTHORS.mallory, Date.now() + 10_000_001, struck.id),
      SEEDS.mallory,
    ),
  ]);
  const plain = (await gql(almanac.base, opToken("almanac"),
    `{ dossier(entity: "person:wren") { bio } }`)).body?.data?.dossier?.bio;
  const guarded = (await gql(almanac.base, opToken("almanac"),
    `{ guardedDossier(entity: "person:wren") { bio } }`)).body?.data?.guardedDossier?.bio;
  check(
    "8.3",
    "the heckler's veto ends at the governed lens: plain loses Wren's word, Guarded keeps it",
    plain !== "keeper of the commons; the lenses are new" &&
      guarded === "keeper of the commons; the lenses are new",
    `plain="${plain}" guarded="${guarded}"`,
  );
} finally {
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 8");
