// The tutorial's ARC (§48), UI-free: the lessons as data. The page and the headless CI suite
// drive exactly this module, so a lesson whose `run` stops doing its work fails in CI by name.
//
// THIS IS THE STUB ARC (T226). It is three lessons long and it is not the curriculum: it exists
// so every mechanic the player owns can be exercised end to end before the real fifteen land
// (T227). It carries, deliberately, one of each thing the machine must be able to play — a
// look-step and earning steps, a registration, a door write, a quiz, terms planted on entry and
// a term planted from inside a step, and an erasure whose sweep destroys a checkpoint. Its copy
// is minimal on purpose: the prose is T227's craft, and writing it twice would only invite the
// two versions to disagree.
//
// A LESSON'S SHAPE, which is the contract T227 fills:
//   { id, role, title, copy, terms: [{term, meaning}], quiz?, steps: [...], check(ctx) }
// and a STEP's:
//   { id, label, have, want, how, run(ctx), observe: { page: {selector, contains?}, store(ctx) } }
//
// `have` / `want` / `how` are the three sentences every step shows: what we have, what we want,
// how we get there. `observe` is what makes a step CHECKABLE: the page predicate and the store
// predicate must BOTH hold after `run`, so a step that quietly stops working is refused rather
// than banked. Prose is never compared to the DOM it produced.
//
// ROLES are the browser suite's targeting contract. `test/browser/tutorial.test.ts` freezes at
// its landing and finds the mechanics it exercises by role, never by lesson number or title:
//   "opening"         — the first lesson; boot has already happened
//   "reveal"          — plants a glossary term from inside a step (the where-does-this-live payoff)
//   "erasure-finale"  — erases a record the arc landed earlier, which sweeps the checkpoints
// T227's arc MUST keep these three roles pointing at lessons that do those things.

import { STORE_PREFIX, SEED_KEY, plantTerm } from "./player.mjs";

// ---- the domain: one film diary ------------------------------------------------------------

export const DIARY = "diary:mine";
export const VIEWING = "viewing:arrival";
export const RAE = "person:rae";

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
// A viewing is a date, a film and a rating; when two viewings disagree about a film, the latest
// word wins — and the notes COLLECT rather than replace, because both were true when written.
const VIEWING_POLICY = { props: { film: PICK, rating: PICK, note: ALL }, default: PICK };

// ---- the delta grammar the arc writes in ----------------------------------------------------

const entity = (role, id, context) => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const prim = (value) => ({ role: "value", target: { kind: "primitive", value } });

const say = (loam, ctx, pointers) =>
  loam.signClaims({ timestamp: ctx.ts(), author: ctx.author, pointers }, ctx.seed);

const ground = (ctx) => ctx.gateway.offeredDeltas();
const pointsAt = (id, context) => (d) =>
  d.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === id &&
      p.target.entity.context === context,
  );
const mineAt = (ctx, id, context) =>
  ground(ctx).some((d) => d.claims.author === ctx.author && pointsAt(id, context)(d));

async function view(ctx, query) {
  try {
    const res = await ctx.gateway.query(query);
    return res.errors === undefined ? (res.data ?? {}) : {};
  } catch {
    return {}; // no surface yet — a view-shaped observable is simply not-yet-true
  }
}

// ---- boot: the student's store ---------------------------------------------------------------

// The LocalStorageBackend owns every `loam:tutorial:<id>` key and reads what it finds there as a
// delta. A key under that prefix whose suffix is not a delta id was written by someone else, so
// it is purged before the backend reads: the driver quarantines such rows rather than bricking,
// and healing them here keeps the pane honest about what the store holds. This is also why the
// checkpoints live under their OWN prefix (`loam:tutorial-ckpt:`) — they would be swept away here.
function healStrayKeys(storage) {
  const strays = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k === null || !k.startsWith(STORE_PREFIX) || k === SEED_KEY) continue;
    if (!/^[0-9a-f]+$/.test(k.slice(STORE_PREFIX.length))) strays.push(k);
  }
  for (const k of strays) storage.removeItem(k);
}

// First visit mints a seed and boots from genesis; every later visit reopens the same store from
// the same origin. The seed lives at its own key — it never rides an export of deltas.
export async function bootTutorialStore(loam, storage) {
  healStrayKeys(storage);
  let seed = storage.getItem(SEED_KEY);
  const backend = new loam.LocalStorageBackend("tutorial", storage);
  let gateway;
  if (seed === null) {
    seed = loam.mintSeed();
    storage.setItem(SEED_KEY, seed);
    gateway = await loam.Gateway.boot(backend, loam.assembleGenesis({ operatorSeed: seed }));
  } else {
    gateway = await loam.Gateway.open(backend, { seed });
  }
  return { gateway, seed, author: loam.authorForSeed(seed) };
}

// The file a student walks out with: the exact bytes `/federate` would serve, plus the identity
// that makes it THE SAME store on arrival. The seed rides on purpose — disposable tutorial data.
export function buildExport(loam, ctx) {
  const offer = JSON.parse(loam.exportOffer(ctx.gateway));
  return JSON.stringify({ version: 1, operator: ctx.author, seed: ctx.seed, deltas: offer.deltas });
}

// ---- the arc ---------------------------------------------------------------------------------

export function buildArc(loam) {
  return [
    {
      id: 1,
      role: "opening",
      title: "The keys are yours",
      copy: `This page just made you a database. It runs in this tab, it keeps records, and it
answers to one key — yours.`,
      terms: [
        { term: "store", meaning: "the whole thing this page just made: a keeper of records." },
        { term: "record", meaning: "one thing you said, signed, that the store will never edit." },
        { term: "key", meaning: "the secret that proves a record is yours. It never leaves here." },
      ],
      steps: [
        {
          id: "1.1",
          label: "Look at the record it was born with",
          have: "A store with one record in it already.",
          want: "To see the record that names your key as the one this store obeys.",
          how: "Open the Ground pane and read the first row — it is badged constitution.",
          // A LOOK step: boot performed the work, and the observable is already true. The arc
          // needs these; the red-probe deliberately skips them (there is nothing to neutralize).
          run: async () => {},
          observe: {
            page: { selector: "#ground-rows", contains: "constitution" },
            store: async (ctx) => mineAt(ctx, "loam:store", "loam.operator"),
          },
        },
        {
          id: "1.2",
          label: "Name your diary",
          have: "A store that holds records but has not been told what it is for.",
          want: "One record of your own in the ground, signed by you.",
          how: "Press the button. Watch the Ground pane grow a row that says diary:mine.",
          run: async (ctx) => {
            await ctx.gateway.append([
              say(loam, ctx, [entity("subject", DIARY, "name"), prim("A film diary of my own")]),
            ]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: DIARY },
            store: async (ctx) => mineAt(ctx, DIARY, "name"),
          },
        },
      ],
      check: async (ctx) =>
        mineAt(ctx, "loam:store", "loam.operator") && mineAt(ctx, DIARY, "name"),
    },

    {
      id: 2,
      role: "reveal",
      title: "Say what a viewing is, then look behind the glossary",
      copy: `A store keeps records, not vibes. Say what a viewing IS — a film, a rating, the
notes you make — and the store will answer questions through that description.`,
      terms: [
        {
          term: "lens",
          meaning: "a description of what you want back, and how to settle disagreement.",
        },
        { term: "claim", meaning: "a record that says one thing, signed by whoever said it." },
      ],
      quiz: {
        id: "act-i",
        questions: [
          {
            ask: "You ask the diary for Arrival's rating. Where does the answer come from?",
            choices: [
              "A row somebody updated in place",
              "Your signed claims, gathered at the moment you ask",
              "A copy kept on a server",
            ],
            answer: 1,
            teaches: "2.2",
          },
          {
            ask: "You wrote the note down. What did the store do to the records already in it?",
            choices: [
              "Nothing — it added one more",
              "Updated the viewing",
              "Replaced the older one",
            ],
            answer: 0,
            teaches: "2.3",
          },
        ],
      },
      steps: [
        {
          id: "2.1",
          label: "Say what a viewing is",
          have: "A store that will hold anything and answer nothing.",
          want: "A description the store can answer through.",
          how: "Register the Viewing lens. The Views pane gains a Viewing entry.",
          run: async (ctx) => {
            await ctx.gateway.publishRegistration(
              { name: "Viewing", alg: 1, body: loam.parseTerm(GATHER) },
              loam.parseSchema(VIEWING_POLICY),
              [VIEWING],
              undefined,
              undefined,
              undefined,
              Object.keys(VIEWING_POLICY.props),
            );
          },
          observe: {
            page: { selector: "#view-cards", contains: "Viewing" },
            store: async (ctx) =>
              ctx.gateway.registrationVersions().some((v) => v.hyperschema.name === "Viewing"),
          },
        },
        {
          id: "2.2",
          label: "Log last night: Arrival, a 9",
          have: "A description with nothing behind it.",
          want: "Last night's viewing in the diary, in your own hand.",
          how: "Press the button. The write becomes a signed claim, and the view reassembles.",
          run: async (ctx) => {
            await ctx.gateway.query(
              `mutation { viewing(entity: "${VIEWING}", film: "Arrival", rating: 9) { rating } }`,
            );
          },
          observe: {
            page: { selector: "#view-cards", contains: "Arrival" },
            // OBJECT LEVEL: what a reader resolves through the lens, not merely what is in the
            // ground. The two can disagree, and that disagreement is usually the bug.
            store: async (ctx) =>
              (await view(ctx, `{ viewing(entity: "${VIEWING}") { rating } }`))?.viewing?.rating ===
              9,
          },
        },
        {
          id: "2.3",
          label: "Write down what Rae told you in confidence",
          have: "A diary about films.",
          want: "A note about the evening — including a line that was never yours to keep.",
          how: "Press the button. Remember this record; the last lesson comes back for it.",
          run: async (ctx) => {
            await ctx.gateway.append([
              say(loam, ctx, [
                entity("about", RAE, "note"),
                prim("rae read me their friend's message out loud, and i wrote it down"),
              ]),
            ]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: RAE },
            store: async (ctx) => mineAt(ctx, RAE, "note"),
          },
        },
        {
          id: "2.4",
          label: "Ask the glossary where it lives",
          have: "A glossary you have been reading as if the page owned it.",
          want: "The real name of a record — and the proof the glossary is made of them.",
          how: "Press the button, then use any entry's 'where does this live?' control.",
          run: async (ctx) => {
            await plantTerm(
              loam,
              ctx,
              2,
              "delta",
              "the real name for a record here: one signed statement, named by its own content.",
            );
          },
          observe: {
            page: { selector: "#glossary-entries", contains: "delta" },
            store: async (ctx) => mineAt(ctx, "tutorial:term:delta", "tutorial.glossary"),
          },
        },
      ],
      check: async (ctx) =>
        ctx.gateway.registrationVersions().some((v) => v.hyperschema.name === "Viewing") &&
        (await view(ctx, `{ viewing(entity: "${VIEWING}") { rating } }`))?.viewing?.rating === 9 &&
        mineAt(ctx, RAE, "note") &&
        mineAt(ctx, "tutorial:term:delta", "tutorial.glossary"),
    },

    {
      id: 3,
      role: "erasure-finale",
      title: "What never should have landed",
      copy: `Those words were a third person's, and they are in your store. Striking a record
leaves the bytes at rest. Erasing removes them — and it reaches your checkpoints too, because a
checkpoint is a copy, and a copy holds the bytes.`,
      terms: [
        { term: "erase", meaning: "the operator's order to remove a record's bytes, for good." },
        {
          term: "receipt",
          meaning:
            "what stays after an erasure: that something went, by whom, when, why. Never what.",
        },
      ],
      steps: [
        {
          id: "3.1",
          label: "Erase it, and say why",
          have: "A record in your ground that was never yours to keep.",
          want: "Those bytes gone — from the store AND from every checkpoint that copied them.",
          how: "Press the button. Watch the revert rail get shorter, and read what it says.",
          run: async (ctx) => {
            const note = ground(ctx).find(
              (d) => d.claims.author === ctx.author && pointsAt(RAE, "note")(d),
            );
            if (note !== undefined) {
              await ctx.gateway.erase(note.id, { reason: "it was not mine to keep" });
            }
          },
          observe: {
            page: { selector: "#sweep-notice", contains: "checkpoint" },
            store: async (ctx) =>
              !mineAt(ctx, RAE, "note") &&
              loam.readTombstones(ctx.gateway.reactor, ctx.author).size >= 1,
          },
        },
      ],
      check: async (ctx) =>
        !mineAt(ctx, RAE, "note") &&
        loam.readTombstones(ctx.gateway.reactor, ctx.author).size >= 1 &&
        // the diary is whole around the hole: the bystander claims are still here
        mineAt(ctx, DIARY, "name") &&
        (await view(ctx, `{ viewing(entity: "${VIEWING}") { rating } }`))?.viewing?.rating === 9,
    },
  ];
}
