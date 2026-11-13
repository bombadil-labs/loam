import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authorForSeed, parseSchema, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { Gateway, MemoryBackend, assembleGenesis, exportOffer, toWire } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "demos", "tutorial", "packets");
const checkMode = process.argv.includes("--check");

const CIRCLE_SEED = "c1".repeat(32);
const CIRCLE_OP = authorForSeed(CIRCLE_SEED);
const ADVERSARY_SEED = "ad".repeat(32);
const ADVERSARY = authorForSeed(ADVERSARY_SEED);
const DIALECT_SEED = "d1".repeat(32);
const DIALECT = authorForSeed(DIALECT_SEED);

const BASE = 1_752_000_000_000;

const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const PICK = { pick: { order: { byTimestamp: "desc" } } };
const ALL = { all: { order: { byTimestamp: "asc" } } };

const PEOPLE = ["person:alice", "person:bob", "person:carol"];

const entity = (role, id, context) => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const value = (v) => ({ role: "value", target: { kind: "primitive", value: v } });

const say = (ts, pointers) =>
  signClaims(
    { timestamp: BASE + ts, validFrom: BASE + ts, author: CIRCLE_OP, pointers },
    CIRCLE_SEED,
  );

async function buildCircle() {
  const gateway = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: CIRCLE_SEED,
      registrations: [
        {
          hyperschema: { name: "Person", alg: 1, body: parseTerm(GATHER) },
          schema: parseSchema({
            name: "Person",
            props: { name: PICK, follows: ALL },
            default: PICK,
          }),
          roots: PEOPLE,
        },
        {
          hyperschema: {
            name: "Friends",
            alg: 1,
            body: parseTerm({
              op: "expand",
              role: { exact: "friend" },
              schema: "Person",
              reading: "Person",
              in: GATHER,
            }),
          },
          schema: parseSchema({ props: { name: PICK, follows: ALL }, default: PICK }),
          roots: PEOPLE,
        },
      ],
    }),
  );
  await gateway.append([
    say(1, [entity("subject", "person:alice", "name"), value("Alice Song")]),
    say(2, [entity("subject", "person:bob", "name"), value("Bob Ferris")]),
    say(3, [entity("subject", "person:carol", "name"), value("Carol Note")]),
    say(4, [
      entity("subject", "person:alice", "follows"),
      entity("friend", "person:bob", "circle"),
    ]),
    say(5, [
      entity("subject", "person:bob", "follows"),
      entity("friend", "person:alice", "circle"),
    ]),
    say(6, [
      entity("subject", "person:alice", "follows"),
      entity("friend", "person:carol", "circle"),
    ]),
  ]);
  const offer = exportOffer(gateway);
  await gateway.close();
  return offer;
}

function buildAdversary() {
  const forged = signClaims(
    {
      timestamp: BASE + 500_000_000_000,
      validFrom: BASE,
      author: ADVERSARY,
      pointers: [
        entity("subject", "film:arrival", "title"),
        value("ARRIVAL 2: TOTALLY REAL SEQUEL (dir. A. Stranger)"),
      ],
    },
    ADVERSARY_SEED,
  );
  return JSON.stringify({ deltas: [toWire(forged)] });
}

function buildDialect() {
  const logged = signClaims(
    {
      timestamp: BASE + 42,
      validFrom: BASE + 42,
      author: DIALECT,
      pointers: [
        entity("film_watched", "film:arrival", "elsewhere"),
        {
          role: "on",
          target: { kind: "primitive", value: "watched on a rainy Tuesday, logged in Reelboxd" },
        },
      ],
    },
    DIALECT_SEED,
  );
  return JSON.stringify({ deltas: [toWire(logged)] });
}

const files = {};
files["circle.json"] = await buildCircle();
files["adversary.json"] = buildAdversary();
files["dialect.json"] = buildDialect();

let failed = false;
mkdirSync(OUT, { recursive: true });
for (const [name, text] of Object.entries(files)) {
  const path = join(OUT, name);
  if (checkMode) {
    let existing;
    try {
      existing = readFileSync(path, "utf8");
    } catch {
      existing = undefined;
    }
    if (existing !== text) {
      console.error(`gen-packets --check: ${name} does not match its regeneration`);
      failed = true;
    } else {
      console.log(`gen-packets --check: ${name} is byte-identical`);
    }
  } else {
    writeFileSync(path, text);
    console.log(`gen-packets: wrote demos/tutorial/packets/${name} (${text.length} bytes)`);
  }
}
if (failed) process.exit(1);
