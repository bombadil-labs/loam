// Generate the tutorial's bundled data packets (SPEC §16): `site/packets/circle.json` — a
// whole foreign store (the circle: Alice, Bob, Carol, their names and friendships, signed
// under the circle's OWN operator, its own registrations riding along so the learner can see
// foreign law stay inert) — and `site/packets/adversary.json` — one forged claim against the
// learner's film, really signed by the adversary's key, because "anyone may write" is true
// and the reader's trust policy is the only defense that exists.
//
// DETERMINISTIC: fixed seeds, fixed timestamps. The packets are committed data; re-running
// this script is byte-identical (verified by `--check`, which diffs without writing — CI
// material). Runs against dist/ (build first), like every script here.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authorForSeed, parsePolicy, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { Gateway, MemoryBackend, assembleGenesis, exportOffer, toWire } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "site", "packets");
const checkMode = process.argv.includes("--check");

// The circle's operator and the adversary: fixed identities, tutorial-only, never secret.
const CIRCLE_SEED = "c1".repeat(32);
const CIRCLE_OP = authorForSeed(CIRCLE_SEED);
const ADVERSARY_SEED = "ad".repeat(32);
const ADVERSARY = authorForSeed(ADVERSARY_SEED);

// Fixed clock: every delta's timestamp is BASE + a small offset. Content addresses depend on
// these — change one and the packets change identity, which is the point of the --check gate.
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
  signClaims({ timestamp: BASE + ts, author: CIRCLE_OP, pointers }, CIRCLE_SEED);

async function buildCircle() {
  const gateway = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: CIRCLE_SEED,
      registrations: [
        {
          schema: { name: "Person", alg: 1, body: parseTerm(GATHER) },
          policy: parsePolicy({ props: { name: PICK, follows: ALL }, default: PICK }),
          roots: PEOPLE,
        },
        {
          schema: {
            name: "Friends",
            alg: 1,
            body: parseTerm({
              op: "expand",
              role: { exact: "friend" },
              schema: "Person",
              in: GATHER,
            }),
          },
          policy: parsePolicy({ props: { name: PICK, follows: ALL }, default: PICK }),
          roots: PEOPLE,
        },
      ],
    }),
  );
  await gateway.append([
    say(1, [entity("subject", "person:alice", "name"), value("Alice Song")]),
    say(2, [entity("subject", "person:bob", "name"), value("Bob Ferris")]),
    say(3, [entity("subject", "person:carol", "name"), value("Carol Note")]),
    // Friendship is one claim with two filings: it lands in the subject's `follows` bucket
    // AND carries the `friend` role the Friends lens expands through.
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
  // A real signature on a real delta — the forgery is in the CLAIM, not the crypto. The
  // timestamp is far in the future, so a pick-latest policy falls for it every time.
  const forged = signClaims(
    {
      timestamp: BASE + 500_000_000_000,
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

const files = {};
files["circle.json"] = await buildCircle();
files["adversary.json"] = buildAdversary();

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
    console.log(`gen-packets: wrote site/packets/${name} (${text.length} bytes)`);
  }
}
if (failed) process.exit(1);
