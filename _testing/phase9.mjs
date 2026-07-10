// Phase 9 (PR #19) — THE GAUNTLET: a fifth store speaking an alien dialect federates into the
// open almanac; a translation spec renders it into the village's tongue with provenance;
// Wren's dossier gains a screening RECORDED BY A STRANGER'S APP; the roster flips mid-run and
// the pulse obeys; flips back and the backlog normalizes.

import { signClaims } from "@bombadil/rhizomatic";
import { translate, translationClaims, trustClaims } from "../dist/index.js";
import {
  AUTHORS,
  SEEDS,
  appendAs,
  check,
  constitute,
  gql,
  openStore,
  opToken,
  pullFrom,
  summary,
} from "./harness.mjs";

// The cinelog dialect: sasha's app says "viewer watched film on date" its own way.
const cinelogEntry = (viewer, film, date, ts) => ({
  timestamp: ts,
  author: AUTHORS.sasha,
  pointers: [
    { role: "film_watched", target: { kind: "entity", entity: { id: film, context: "log" } } },
    { role: "viewer", target: { kind: "entity", entity: { id: viewer, context: "watch_history" } } },
    { role: "on", target: { kind: "primitive", value: date } },
  ],
});

// The village's rendering: attendance the Dossier already gathers.
const CINELOG_SPEC = {
  recognize: {
    and: [
      { hasPointer: { role: { exact: "film_watched" } } },
      { hasPointer: { role: { exact: "viewer" } } },
    ],
  },
  emit: {
    pointers: [
      { role: "guest", at: { from: { role: "viewer" } }, context: "attended" },
      { role: "film", at: { from: { role: "film_watched" } }, context: "screenings" },
      { role: "date", value: { from: { role: "on" } } },
      { role: "origin", value: "cinelog" },
    ],
  },
};

const stores = {};
try {
  stores.cinelog = await openStore("cinelog");
  stores.almanac = await openStore("almanac");
  const { cinelog, almanac } = stores;

  // 9.1 — the stranger's store lives its own life in its own tongue
  await constitute(cinelog, ["sasha"], 3_000_000);
  await appendAs(cinelog.gateway, "sasha", [
    cinelogEntry("person:wren", "film:stalker", "2026-07-08", Date.now()),
    cinelogEntry("person:sasha", "film:solaris", "2026-07-09", Date.now() + 1),
  ]);
  check(
    "9.1",
    "cinelog is up: an alien dialect, a stranger's standing, no village vocabulary needed",
    [...cinelog.gateway.reactor.snapshot()].some((d) => d.claims.author === AUTHORS.sasha),
  );

  // 9.2 — the OPEN almanac pulls the stranger whole; the spec is published as data
  const pulled = await pullFrom(almanac.gateway, cinelog.base, opToken("cinelog"));
  await almanac.gateway.append([
    signClaims(
      translationClaims("cinelog", CINELOG_SPEC.recognize, CINELOG_SPEC.emit, almanac.operator, Date.now()),
      almanac.seed,
    ),
  ]);
  const before = await gql(almanac.base, opToken("almanac"),
    `{ dossier(entity: "person:wren") { attended } }`);
  check(
    "9.2",
    "open door: the alien deltas cross; the local lens cannot yet see them",
    pulled.accepted >= 2 &&
      !JSON.stringify(before.body?.data?.dossier?.attended ?? []).includes("stalker"),
    `pulled ${pulled.accepted}`,
  );

  // 9.3 — TRANSLATE: the stranger's record becomes the village's, cited, and the dossier sees
  const report = await translate(almanac.gateway, { seed: almanac.seed });
  const after = await gql(almanac.base, opToken("almanac"),
    `{ dossier(entity: "person:wren") { attended _view } }`);
  const seen = JSON.stringify(after.body?.data?.dossier ?? {});
  check(
    "9.3",
    "one pass: Wren's dossier gains a screening recorded by a stranger's app, with provenance",
    report.emitted >= 2 && seen.includes("film:stalker"),
    `emitted ${report.emitted}; attended=${JSON.stringify(after.body?.data?.dossier?.attended)}`,
  );

  // 9.4 — the roster flips mid-run: the pulse obeys; flips back: the backlog crosses
  await almanac.gateway.append([
    signClaims(
      trustClaims("roster", [AUTHORS.wren, AUTHORS.miles, AUTHORS.odile, AUTHORS.petra],
        almanac.operator, Date.now()),
      almanac.seed,
    ),
  ]);
  await appendAs(cinelog.gateway, "sasha", [
    cinelogEntry("person:miles", "film:mirror", "2026-07-10", Date.now() + 2),
  ]);
  const refused = await pullFrom(almanac.gateway, cinelog.base, opToken("cinelog"));
  await almanac.gateway.append([
    signClaims(trustClaims("open", [], almanac.operator, Date.now() + 1), almanac.seed),
  ]);
  const admitted = await pullFrom(almanac.gateway, cinelog.base, opToken("cinelog"));
  const rendered = await translate(almanac.gateway, { seed: almanac.seed });
  check(
    "9.4",
    "roster shuts the stranger out mid-run; reopening admits the backlog; translation resumes",
    refused.accepted === 0 && admitted.accepted >= 1 && rendered.emitted >= 1,
    `refused ${refused.accepted}, then admitted ${admitted.accepted}, rendered ${rendered.emitted}`,
  );
} finally {
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 9 — the gauntlet");
