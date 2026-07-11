// Phase 17 — THE TAB: a full store in the page (SPEC §15, PR #51). A wanderer passes the
// village with no server, no home directory, no port — just a browser tab. This phase drives
// the SHIPPED store artifact (`dist/browser/index.js`, the `@bombadil/loam/browser` bundle)
// end to end: a governed store boots against a localStorage origin, pulls the commons over
// real HTTP (an aggregator with a URL bar), answers through its OWN law over the imported
// ground, survives the tab closing, and honors erasure down to the origin's keys. The same
// Gateway the village runs on ports — on a different driver, exactly as §8 promised.

import { pathToFileURL } from "node:url";
import { check, join, openStore, opToken, ROOT, signClaims, sleep, summary } from "./harness.mjs";

// The page's localStorage, shimmed: the driver takes any synchronous Storage witness, so the
// phase IS the origin. (In a real tab this is window.localStorage, byte for byte.)
function origin() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()], // phase-side privilege: reach behind the seam to look
  };
}

// The tab: the shipped artifact, imported as a page would import it.
const tab = await import(pathToFileURL(join(ROOT, "..", "dist", "browser", "index.js")).href);

const NOTE_BODY = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const PICK = { pick: { order: { byTimestamp: "desc" } } };

let commons;
let notebook;
let reopened;
try {
  // ---- the tab is born governed: genesis, register, claim, query — all inside the artifact
  const storage = origin();
  const wandererSeed = tab.mintSeed(); // minted where it will live: the page
  const wanderer = tab.authorForSeed(wandererSeed);
  storage.setItem("loam:notebook:seed", wandererSeed); // §15: the seed at its own key
  const genesis = tab.assembleGenesis({
    operatorSeed: wandererSeed,
    registrations: [
      {
        schema: { name: "Note", alg: 1, body: tab.parseTerm(NOTE_BODY) },
        policy: tab.parsePolicy({ props: { text: PICK, about: PICK }, default: PICK }),
        roots: ["note:first"],
      },
    ],
  });
  notebook = await tab.Gateway.boot(new tab.LocalStorageBackend("notebook", storage), genesis);

  const note = signClaims(
    {
      timestamp: Date.now(),
      author: wanderer,
      pointers: [
        {
          role: "subject",
          target: { kind: "entity", entity: { id: "note:first", context: "text" } },
        },
        { role: "value", target: { kind: "primitive", value: "a village! smoke over the trees" } },
      ],
    },
    wandererSeed,
  );
  await notebook.append([note]);
  const firstRead = await notebook.query(`{ note(entity: "note:first") { text } }`);
  const mallory = await notebook.query(
    `mutation { note(entity: "note:first", text: "MINE NOW") { text } }`,
    undefined,
    { actor: "ee".repeat(32) },
  );
  check(
    "17.1",
    "the artifact boots a GOVERNED store in the tab: the wanderer writes, Mallory is refused",
    firstRead.data?.note?.text === "a village! smoke over the trees" &&
      /not permitted/.test((mallory.errors ?? []).join(" ")) &&
      storage.getItem(`loam:notebook:${note.id}`) !== null,
    `note in view and at its own key`,
  );

  // ---- the tab pulls the village over real HTTP: an aggregator with a URL bar
  commons = await openStore("commons");
  await commons.gateway.append([
    signClaims(
      {
        timestamp: Date.now(),
        author: commons.operator,
        pointers: [
          {
            role: "subject",
            target: { kind: "entity", entity: { id: "person:wren", context: "bio" } },
          },
          {
            role: "value",
            target: { kind: "primitive", value: "keeps the commons; waves at wanderers" },
          },
        ],
      },
      commons.seed,
    ),
  ]);
  const pulled = await tab.pullFrom(notebook, commons.base, opToken("commons"));
  const foreign = await notebook.query(`{ person(entity: "person:wren") { bio } }`);
  check(
    "17.2",
    "one pull brings the commons into the tab; the village's law binds NOTHING here",
    pulled.accepted > 0 && /Cannot query field/.test((foreign.errors ?? []).join(" ")),
    `${pulled.accepted} deltas crossed; no Person surface until the wanderer says so`,
  );

  // ---- her own lens over the imported ground: the reader decides everything
  await notebook.publishRegistration(
    { name: "Person", alg: 1, body: tab.parseTerm(NOTE_BODY) },
    tab.parsePolicy({ props: { bio: PICK }, default: PICK }),
    ["person:wren"],
  );
  const hers = await notebook.query(`{ person(entity: "person:wren") { bio } }`);
  check(
    "17.3",
    "she registers her own lens and the village answers through HER law",
    /waves at wanderers/.test(String(hers.data?.person?.bio)),
    String(hers.data?.person?.bio),
  );

  // ---- the tab closes; another opens on the same origin — everything remembered, uncoded
  await notebook.close();
  reopened = await tab.Gateway.open(new tab.LocalStorageBackend("notebook", storage), {
    seed: storage.getItem("loam:notebook:seed"),
  });
  const memory = await reopened.query(
    `{ note(entity: "note:first") { text } person(entity: "person:wren") { bio } }`,
  );
  check(
    "17.4",
    "a second tab on the same origin remembers everything — notes, ground, and BOTH lenses",
    memory.data?.note?.text === "a village! smoke over the trees" &&
      /waves at wanderers/.test(String(memory.data?.person?.bio)),
    "no register() call anywhere: the surface is a function of the store",
  );

  // ---- erasure reaches the page: tombstone → purge → removeItem, and the door holds
  await reopened.erase(note.id, { reason: "the wanderer travels light" });
  let refused = "";
  try {
    await reopened.append([note]);
  } catch (err) {
    refused = String(err.message);
  }
  check(
    "17.5",
    "erasure in the tab clears the origin's key and the door refuses the id's return",
    storage.getItem(`loam:notebook:${note.id}`) === null &&
      /was erased/.test(refused) &&
      storage.getItem("loam:notebook:seed") !== null, // the seed key was never a delta
    "bytes gone; the signed hole remains; the seed untouched",
  );
} finally {
  await reopened?.close().catch(() => {});
  await commons?.close().catch(() => {});
  await sleep(200); // let the port settle before the process exits
}
summary("phase 17 — the tab");
