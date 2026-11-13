import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AUTHORS, PEOPLE, SCHEMAS } from "./harness.mjs";

mkdirSync(SCHEMAS, { recursive: true });

const PICK = { pick: { order: { byTimestamp: "desc" } } };
const ALL = { all: { order: { byTimestamp: "asc" } } };

const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};

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

const expandThrough = (role, schema, reading = schema) => ({
  op: "expand",
  role: { exact: role },
  schema,
  reading,
  in: GATHER,
});

const write = (file, { name, alg, body, policy, roots, entity, writable }) => {
  const spec = {
    hyperschema: { name, alg: alg ?? 1, body },
    schema: { name, alg: alg ?? 1, ...policy },
    roots,
    ...(entity ? { entity } : {}),
    ...(writable ? { writable } : {}),
  };
  writeFileSync(join(SCHEMAS, file), JSON.stringify(spec, null, 2) + "\n");
  console.log(`  wrote ${file}`);
};

const SCREENINGS = ["screening:s1", "screening:s2", "screening:s3", "screening:s4"];
const FILMS = ["film:the-secret-garden", "film:solaris", "film:local-hero"];
const GATHERINGS = ["gathering:harvest-1", "gathering:harvest-2"];

const PERSON_POLICY = { props: { name: PICK, bio: PICK, follows: ALL }, default: PICK };

write("person.json", {
  name: "Person",
  alg: 1,
  body: GATHER,
  policy: PERSON_POLICY,
  roots: PEOPLE,
  writable: ["name", "bio"],
});
write("circle.json", {
  name: "Circle",
  alg: 1,
  body: expandThrough("friend", "Person"),
  policy: { props: { name: PICK, follows: ALL }, default: PICK },
  roots: PEOPLE,
});

write("film.json", {
  name: "Film",
  alg: 1,
  body: GATHER,
  policy: { props: { title: PICK, year: PICK, director: PICK }, default: PICK },
  roots: FILMS,
  writable: ["title", "year", "director"],
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
  writable: ["date", "venue", "rating", "note"],
});
write("screening-v2.json", {
  name: "Screening",
  alg: 1,
  body: gatherWithout("note"),
  policy: {
    props: { film: PICK, date: PICK, venue: PICK, rating: PICK, rewatch: PICK, with: ALL },
    default: PICK,
  },
  roots: SCREENINGS,
  writable: ["date", "venue", "rating", "rewatch"],
});
write("screening-classic.json", {
  name: "ScreeningClassic",
  alg: 1,
  body: GATHER,
  policy: SCREENING_V1_POLICY,
  roots: SCREENINGS,
  writable: ["date", "venue", "rating", "note"],
});
write("reel-person.json", {
  name: "Person",
  alg: 1,
  body: GATHER,
  policy: PERSON_POLICY,
  roots: PEOPLE,
  writable: ["name", "bio"],
});
write("film-night.json", {
  name: "FilmNight",
  alg: 1,
  body: expandThrough("film", "Film"),
  policy: { props: { date: PICK, venue: PICK, film: ALL }, default: PICK },
  roots: SCREENINGS,
});

write("colony.json", {
  name: "Colony",
  alg: 1,
  body: GATHER,
  policy: { props: { queen: PICK, frames: PICK, yield: PICK, grumbles: ALL }, default: PICK },
  roots: ["colony:1"],
  writable: ["queen", "frames", "yield", "grumbles"],
});
write("gathering.json", {
  name: "Gathering",
  alg: 1,
  body: GATHER,
  policy: { props: { date: PICK, honey: PICK, attendee: ALL }, default: PICK },
  roots: GATHERINGS,
  writable: ["date", "honey"],
});

const DOSSIER_PROPS = {
  name: PICK,
  bio: PICK,
  follows: ALL,
  circle: ALL,
  companioned: ALL,
  attended: ALL,
  presence: PICK,
};
write("dossier.json", {
  name: "Dossier",
  alg: 1,
  body: GATHER,
  policy: { props: DOSSIER_PROPS, default: PICK },
  roots: PEOPLE,
  writable: ["name", "bio"],
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
  writable: ["name", "bio"],
});

console.log("schemas generated.");
