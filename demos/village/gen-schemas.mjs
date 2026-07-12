// Generate every register-file in demos/village/schemas/. Deterministic; safe to re-run.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AUTHORS, PEOPLE, SCHEMAS } from "./harness.mjs";

mkdirSync(SCHEMAS, { recursive: true });

const PICK = { pick: { order: { byTimestamp: "desc" } } };
const ALL = { all: { order: { byTimestamp: "asc" } } };

// The canonical gather: everything pointing at the root, bucketed by target context.
const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};

// A gather that EXCLUDES a context — the Screening v2 evolution drops `note`.
const gatherWithout = (context) => ({
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { not: { hasPointer: { context: { exact: context } } } },
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    },
  },
});

const expandThrough = (role, schema) => ({
  op: "expand",
  role: { exact: role },
  schema,
  in: GATHER,
});

// The specs are authored flat for brevity; the register format is the nested shape every door
// takes — { hyperschema: { name, alg, body }, schema, roots } — so emit that.
const write = (file, { name, alg, body, policy, roots, entity, mutations }) => {
  const spec = {
    hyperschema: { name, alg: alg ?? 1, body },
    schema: policy,
    roots,
    ...(entity ? { entity } : {}),
    ...(mutations ? { mutations } : {}),
  };
  writeFileSync(join(SCHEMAS, file), JSON.stringify(spec, null, 2) + "\n");
  console.log(`  wrote ${file}`);
};

const SCREENINGS = ["screening:s1", "screening:s2", "screening:s3", "screening:s4"];
const FILMS = ["film:the-secret-garden", "film:solaris", "film:local-hero"];
const GATHERINGS = ["gathering:harvest-1", "gathering:harvest-2"];

const PERSON_POLICY = { props: { name: PICK, bio: PICK, follows: ALL }, default: PICK };

// -- commons ------------------------------------------------------------------------------------
write("person.json", {
  name: "Person",
  alg: 1,
  body: GATHER,
  policy: PERSON_POLICY,
  roots: PEOPLE,
});
write("circle.json", {
  name: "Circle",
  alg: 1,
  body: expandThrough("friend", "Person"),
  policy: { props: { name: PICK, follows: ALL }, default: PICK },
  roots: PEOPLE,
});

// -- reel ---------------------------------------------------------------------------------------
write("film.json", {
  name: "Film",
  alg: 1,
  body: GATHER,
  policy: { props: { title: PICK, year: PICK, director: PICK }, default: PICK },
  roots: FILMS,
});
const SCREENING_V1_POLICY = {
  props: { film: PICK, date: PICK, venue: PICK, rating: PICK, note: PICK, with: ALL },
  default: PICK,
};
write("screening-v1.json", {
  name: "Screening",
  alg: 1,
  body: GATHER,
  policy: SCREENING_V1_POLICY,
  roots: SCREENINGS,
});
write("screening-v2.json", {
  name: "Screening",
  alg: 1,
  body: gatherWithout("note"), // evolution: the gather itself drops the note context...
  policy: {
    props: { film: PICK, date: PICK, venue: PICK, rating: PICK, rewatch: PICK, with: ALL },
    default: PICK, // ...and the policy trades `note` for `rewatch`
  },
  roots: SCREENINGS,
});
write("screening-classic.json", {
  name: "ScreeningClassic",
  alg: 1,
  body: GATHER,
  policy: SCREENING_V1_POLICY,
  roots: SCREENINGS,
  entity: "schema:ScreeningClassic", // v1's shape, its own entity: old law, concurrently served
});
write("reel-person.json", {
  name: "Person",
  alg: 1,
  body: GATHER,
  policy: PERSON_POLICY,
  roots: PEOPLE,
});
write("film-night.json", {
  name: "FilmNight",
  alg: 1,
  body: expandThrough("film", "Film"),
  policy: { props: { date: PICK, venue: PICK, film: ALL }, default: PICK },
  roots: SCREENINGS,
});

// -- hive ---------------------------------------------------------------------------------------
write("colony.json", {
  name: "Colony",
  alg: 1,
  body: GATHER,
  policy: { props: { queen: PICK, frames: PICK, yield: PICK, grumbles: ALL }, default: PICK },
  roots: ["colony:1"],
});
write("gathering.json", {
  name: "Gathering",
  alg: 1,
  body: GATHER,
  policy: { props: { date: PICK, honey: PICK, attendee: ALL }, default: PICK },
  roots: GATHERINGS,
});

// -- almanac ------------------------------------------------------------------------------------
// One body, three lenses. Dossier: a person's whole village life. Presence: the bare minimum.
// TrustedDossier: bio resolved by WHO SAID IT — villagers outrank the world.
const DOSSIER_PROPS = {
  name: PICK,
  bio: PICK,
  follows: ALL,
  circle: ALL,
  companioned: ALL,
  attended: ALL,
  // The mill's flour (phase 11): ensurePresence re-registers THIS file to evolve the dossier,
  // so the generator must know the field the evolution promises — regeneration is not regression.
  presence: PICK,
};
write("dossier.json", {
  name: "Dossier",
  alg: 1,
  body: GATHER,
  policy: { props: DOSSIER_PROPS, default: PICK },
  roots: PEOPLE,
});
write("presence.json", {
  name: "Presence",
  alg: 1,
  body: GATHER,
  policy: { props: { name: PICK }, default: PICK },
  roots: PEOPLE,
});
write("trusted-dossier.json", {
  name: "TrustedDossier",
  alg: 1,
  body: GATHER,
  policy: {
    props: {
      ...DOSSIER_PROPS,
      // rhizomatic 0.2.0: "trusted, then latest" — the founding saga's field-note bug, fixed
      // by the substrate change it motivated (rhizomatic#1). The villagers outrank the world,
      // and among a villager's own words the NEWEST wins (no more lexById surprise).
      bio: {
        pick: {
          order: {
            chain: [
              { byAuthorRank: [AUTHORS.wren, AUTHORS.miles, AUTHORS.odile, AUTHORS.petra] },
              { byTimestamp: "desc" },
            ],
          },
        },
      },
    },
    default: PICK,
  },
  roots: PEOPLE,
});
write("almanac-person.json", {
  name: "Person",
  alg: 1,
  body: GATHER,
  policy: PERSON_POLICY,
  roots: PEOPLE,
});

console.log("schemas generated.");
