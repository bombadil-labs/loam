// The tutorial's ARC (§48), UI-free: the lessons as data. The page and the headless CI suite
// drive exactly this module, so a lesson whose `run` stops doing its work fails in CI by name.
//
// THIS IS "A STORE OF YOUR OWN" — fifteen lessons in five acts, the arc the workshop settled.
// The student is `you`; the other voice is Rae, whose film opinions are wrong. The spine is the
// VIEWING — a date, a film, a rating — because a rewatch is a second true thing rather than a
// contradiction, and that is the whole shape of this database in one domestic fact.
//
// A LESSON'S SHAPE:
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
//   "opening"         — the arc's FIRST lesson; boot has already happened
//   "reveal"          — plants a glossary term from inside a STEP, not from the lesson's `terms`
//                       (those are planted on entry); the payoff needs the student to act
//   "erasure-finale"  — erases a record that landed AFTER at least one checkpoint boundary, so
//                       one blob is holding those bytes when the sweep runs and an EARLIER blob
//                       is not. Rae writes the condemned note in lesson 13; lesson 14 erases it,
//                       so twelve boundaries predate it and one holds it.
//
// THE SATISFIABILITY RULE, which governs every `observe.page` and is mechanically checked
// (`test/site/arc.test.ts`, "every step's page observable roots at an element the SHELL
// declares"): a step's selector must root at an element declared in `index.html` whose content
// renders FROM THE STORE. Two halves:
//
//   (a) STATE, NOT EVENT. `seePage` must hold in every store state where the step's store
//       predicate holds — including after a bare reload, and when `run` finds its work already
//       done. An observable true only in the instant after its own run is a TRAP on any
//       irreversible step: the act cannot be repeated, so the step can never be completed.
//   (b) NO ui.* DEPENDENCE. No selector may name an element that exists only while some page
//       field is set. The tell is a selector absent from `index.html`.
//
// THREE MORE RULES THE FROZEN SUITE PINS:
//   - The finale must be FULLY PASSABLE with every checkpoint blob deleted. So no finale step
//     may observe the revert rail SHRINKING — there may be nothing to shrink. The sweep notice
//     is the witness, and it speaks for every forgetting, destroyed or not.
//   - ONE PRESS PER FINALE STEP. A two-stage act belongs to two steps.
//   - Two copy pins are frozen: a finished quiz card's button says "done", and a sweep that
//     found nothing says "there was nothing to destroy".
//
// AND ONE CLOCK. Every claim this arc writes is hand-signed at `ctx.ts()`. The mutation door is
// registered and the console invites the student through it, but no lesson writes that way:
// `gateway.nextTimestamp()` and `ctx.ts()` are two monotonic counters, and interleaving them
// would leave "whose word is latest" decided by a millisecond race — which is a coin flip on
// every latest-wins read in Act III, and a flake in every rail that asserts one.

import {
  CKPT_PREFIX,
  STORE_PREFIX,
  SEED_KEY,
  plantTerm,
  readGlossary,
  readProgress,
  sweepCheckpoints,
} from "./player.mjs";

// ---- the domain: one film diary ---------------------------------------------------------------

export const DIARY = "diary:mine";
export const VIEWING = "viewing:arrival";
export const TENET = "viewing:tenet";
export const MOVIE_NIGHT = "viewing:paddington-2";
export const CHASE = "viewing:fast-and-furious";
export const RAE = "person:rae";

// Stage keys. Rae is a character, so Rae's key lives here in the open — in a real store you
// would never hold anyone else's, and the arc says so out loud when it hands Rae the first one.
// Two of them, because lesson 13 gives Rae a fresh one and the old one has to stay refused.
const RAE_FIRST_SEED = "a7".repeat(32);
const RAE_SECOND_SEED = "b3".repeat(32);
// The person who sends you a file claiming to be Rae. Nobody you know.
const STRANGER_SEED = "5c".repeat(32);

// The words the arc writes, kept here so a rail can ask about the exact bytes.
const DIARY_TITLE = "A film diary of my own";
const FIRST_NOTE = "made me cry on a Tuesday";
const REGRET = "understood it completely";
const SECOND_THOUGHT = "the 9 was the night, not the film";
const RAE_VERDICT = "it's slow";
const FORGED_LINE = "actually i loved it — rae";
const MOVIE_NIGHT_NOTE = "we watched it three times and nobody apologised";
const PRIVATE_LINE =
  "jamie texted me tonight: \"i can't do this on my own any more. please don't tell anyone.\"";
// The shortest fragment of it that could only have come from those bytes — what a rail asks for
// when it wants to know whether the words survived somewhere they should not.
const PRIVATE_FRAGMENT = "jamie texted me";
const LAST_LINE =
  "four films, two of us, one thing forgotten on purpose — and every line of the rest still mine";
const STRANGER_NOTE = "a perfect film, no notes";
const ERASURE_REASON = "a third person's words, never mine to keep";

// The store's own vocabulary for a forgetting, restated here so a lesson can ask about a receipt
// without importing the gateway's internals into a page module.
const ERASURE_ENTITY = "loam:erasure";
const ERASURE_CONTEXT = "loam.erasure";

// ---- the reading programs ---------------------------------------------------------------------

// Everything pointing at the root, bucketed by the context each pointer named. Struck records
// drop. This is the plain description: it hears every hand that ever wrote here.
const OPEN_GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};

// The same program, narrowed to the hands this reading agrees to hear. This is where "whose
// word counts" actually lives — in the reading, not in the store, and never in a platform.
//
// TWO NARROWINGS, NOT ONE, and the second is the one that is easy to forget. The `select`
// decides whose CLAIMS this reading admits. The `mask` decides whose TAKING-BACK it honours, and
// it runs FIRST, over the whole ground — so a plain "drop" mask would let any stranger who can
// get a record in here strike the student's own rating and watch it vanish from their private
// shelf. A shelf that names whose word it hears and then obeys a stranger's retraction is not
// narrowed at all; it just looks it. Both halves take the same set of hands.
const heardFrom = (authors) => ({
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: {
      and: [
        { hasPointer: { targetEntity: { var: "root" } } },
        { match: { field: "author", cmp: "inSet", const: [...authors] } },
      ],
    },
    in: {
      op: "mask",
      policy: { trust: { match: { field: "author", cmp: "inSet", const: [...authors] } } },
      in: "input",
    },
  },
});

const PICK = { pick: { order: { byTimestamp: "desc" } } };
const ALL = { all: { order: { byTimestamp: "asc" } } };
// Your hand first, then whoever else spoke last. `byAuthorRank` puts you at the front of the
// queue; the timestamp settles everyone behind you.
const MINE_FIRST = (me) => ({
  pick: { order: { chain: [{ byAuthorRank: [me] }, { byTimestamp: "desc" }] } },
});

const VIEWING_PROPS = { date: ALL, film: PICK, rating: PICK, note: ALL };
const GUEST_PROPS = { ...VIEWING_PROPS, guests: ALL };

// ---- the delta grammar the arc writes in -------------------------------------------------------

const entity = (role, id, context) => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const prim = (value) => ({ role: "value", target: { kind: "primitive", value } });

const say = (loam, ctx, pointers) =>
  loam.signClaims({ timestamp: ctx.ts(), author: ctx.author, pointers }, ctx.seed);

/** The same claim, in someone else's hand — signed by their key, refused if it is not theirs. */
const sayAs = (loam, ctx, seed, pointers) =>
  loam.signClaims({ timestamp: ctx.ts(), author: loam.authorForSeed(seed), pointers }, seed);

/** One line of a viewing: the entity, the field, the words. */
const field = (loam, ctx, id, name, value) =>
  say(loam, ctx, [entity("subject", id, name), prim(value)]);
const fieldAs = (loam, ctx, seed, id, name, value) =>
  sayAs(loam, ctx, seed, [entity("subject", id, name), prim(value)]);

const ground = (ctx) => ctx.gateway.offeredDeltas();

const pointsAt = (id, context) => (d) =>
  d.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === id &&
      p.target.entity.context === context,
  );

const holds = (d, value) =>
  d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === value);

const mineAt = (ctx, id, context) =>
  ground(ctx).some((d) => d.claims.author === ctx.author && pointsAt(id, context)(d));

/** Every record in the ground that files at (id, context) and carries this exact value. */
const rowsSaying = (ctx, id, context, value) =>
  ground(ctx).filter((d) => pointsAt(id, context)(d) && holds(d, value));

/** Does any record anywhere in the ground carry these words? */
const anywhere = (ctx, value) => ground(ctx).some((d) => holds(d, value));

/**
 * The words as a STORED ROW spells them. Rows are `JSON.stringify` of the wire delta, so a
 * needle taken from the source will not be found in the haystack the moment it contains a quote
 * or a backslash — silently, which is the worst way for a byte-level guard to be wrong. Escaping
 * the needle the same way the row was escaped is the whole fix.
 */
const asStored = (words) => JSON.stringify(words).slice(1, -1);

/** The id a stored row's own bytes claim to be — "" if it will not say. */
function claimedIdOf(row) {
  try {
    const parsed = JSON.parse(row);
    return typeof parsed?.id === "string" ? parsed.id : "";
  } catch {
    return "";
  }
}

/**
 * Do these words appear in any ROW this browser has written under the store's prefix — not in a
 * reading of the ground, in the stored text itself? A reading is what a reader is SERVED; this is
 * what the machine still HOLDS, and the erasure's promise is about the second one.
 *
 * It scopes to this origin's own prefix, which is the whole of what a page can ask about. Step
 * 13.4 asserts it finds the words while they are there, so a false answer here is evidence
 * rather than a needle that never matched.
 */
function wordsInStorage(ctx, words) {
  const needle = asStored(words);
  for (let i = 0; i < ctx.storage.length; i++) {
    const key = ctx.storage.key(i);
    if (key === null || !key.startsWith(STORE_PREFIX) || key === SEED_KEY) continue;
    if ((ctx.storage.getItem(key) ?? "").includes(needle)) return true;
  }
  return false;
}

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

async function view(ctx, query) {
  try {
    const res = await ctx.gateway.query(query);
    return res.errors === undefined ? (res.data ?? {}) : {};
  } catch {
    return {}; // no surface yet — a shape-shaped observable is simply not-yet-true
  }
}

/** One reading's answer for one entity, or `{}` when this store cannot answer yet. */
const read = async (ctx, lens, id, extra = "") => {
  const fields = `${extra} date film rating note`;
  const answer = await view(ctx, `{ ${lens}(entity: "${id}") { ${fields} } }`);
  return answer[lens] ?? {};
};

const readAsOf = async (ctx, lens, id, at, extra = "") => {
  const answer = await view(
    ctx,
    `{ ${lens}(entity: "${id}", asOf: ${at}) { ${extra} date film rating note } }`,
  );
  return answer[lens] ?? {};
};

const lensExists = (ctx, name) =>
  ctx.gateway.registrationVersions().some((v) => v.hyperschema.name === name);

const versionsOf = (ctx, name) =>
  ctx.gateway.registrationVersions().filter((v) => v.hyperschema.name === name);

/** Hand the student a file. Guarded: the headless suite has no document, and needs none. */
function offerDownload(name, text) {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  if (typeof URL.createObjectURL !== "function") return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---- boot: the student's store ------------------------------------------------------------------

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

/**
 * Open the exported file the way another machine would: a fresh store under the same key, then
 * every record poured in through the ordinary door. Nothing is copied by hand and nothing is
 * trusted because it came from here — the law rides in the file and binds on arrival.
 *
 * The caller closes it. It is a real store, and lesson 15 asks it real questions.
 */
async function openTheCopy(loam, ctx, text) {
  const copy = await loam.Gateway.boot(
    new loam.MemoryBackend(),
    loam.assembleGenesis({ operatorSeed: ctx.seed }),
  );
  await copy.federate(loam.parseOffer(text));
  // POUR IN, THEN READ THE LAW — the same two motions as `loam pull` followed by opening the
  // store on the other machine. Federation lands records; it does not go looking for law among
  // them, so the surface is built by the read that follows. That the description travels with
  // the diary is exactly what lesson 15 is proving, and it is why this line is here.
  copy.replayRegistrations();
  return copy;
}

// ---- the glossary, in the order the arc earns it ------------------------------------------------

/**
 * THE TERMS MANIFEST — twenty-one words, in the order a student meets them. Nothing here is
 * decoration: `test/site/arc.test.ts` reads this list, checks it against the arc script's own
 * ordered twenty-one, and then scans every sentence of lesson copy for a word used before the
 * lesson that introduces it. A term with no entry here cannot be introduced at all.
 *
 * `lesson` is where the word is planted. `step` marks the one word a STEP plants rather than the
 * lesson's arrival — the reveal's payoff, which has to be earned. `forms` are the shapes the scan
 * hunts for; they are written out rather than stemmed, because "viewing" is this arc's whole
 * subject and is not an inflection of "view".
 */
export const TERMS = [
  {
    term: "store",
    lesson: 1,
    forms: ["store", "stores"],
    meaning: "the whole thing this page just made for you: a keeper of records.",
  },
  {
    term: "record",
    lesson: 1,
    forms: ["record", "records"],
    meaning: "one thing somebody said, signed, that nothing here will ever edit.",
  },
  {
    term: "key",
    lesson: 1,
    forms: ["key", "keys"],
    meaning: "the secret that proves a record is yours. It never leaves this tab.",
  },
  {
    term: "operator",
    lesson: 1,
    forms: ["operator", "operators"],
    meaning:
      "the one key a store answers to. It decides who else may write here, and what may be " +
      "removed. Here that is you.",
  },
  {
    term: "lens",
    lesson: 2,
    forms: ["lens", "lenses"],
    meaning: "a description of what you want back, and how to settle a disagreement.",
  },
  {
    term: "shape",
    lesson: 2,
    forms: ["shape", "shapes", "shaped"],
    meaning: "the fields a thing has — for a viewing: a date, a film, a rating, and notes.",
  },
  {
    term: "claim",
    lesson: 3,
    forms: ["claim", "claims", "claimed"],
    meaning: "a record that says one thing, and says who said it.",
  },
  {
    term: "signature",
    lesson: 3,
    forms: ["signature", "signatures"],
    meaning: "the mark only your key can make. Anyone can check it; nobody can fake it.",
  },
  {
    term: "ground",
    lesson: 4,
    forms: ["ground"],
    meaning: "every record the store holds, side by side. Everything else is a reading of it.",
  },
  {
    term: "view",
    lesson: 4,
    forms: ["view", "views"],
    meaning: "the answer a lens gives right now, worked out from the ground when you ask.",
  },
  {
    term: "strike",
    lesson: 5,
    forms: ["strike", "strikes", "struck", "striking"],
    meaning: "a record that says 'I take that back'. It hides the old one; it removes nothing.",
  },
  {
    term: "moment",
    lesson: 6,
    forms: ["moment", "moments"],
    meaning: "a time you can pin a question to: what did this store say on that day?",
  },
  {
    term: "author",
    lesson: 7,
    forms: ["author", "authors", "authored", "authorship"],
    meaning: "whose hand wrote a record. It rides in the record and never changes.",
  },
  {
    term: "policy",
    lesson: 8,
    forms: ["policy", "policies"],
    meaning: "a lens's rule for settling a field when the records disagree.",
  },
  {
    term: "version",
    lesson: 10,
    forms: ["version", "versions"],
    meaning: "one dated edition of a lens. Old editions keep working; nothing is migrated.",
  },
  {
    term: "delta",
    lesson: 11,
    step: "11.1",
    forms: ["delta", "deltas"],
    meaning: "the real name of a record here: one signed statement, named by its own content.",
  },
  {
    term: "trust",
    lesson: 12,
    forms: ["trust", "trusts", "trusted", "trusting"],
    meaning: "whose word a reading agrees to hear. The reader chooses; the store never does.",
  },
  {
    term: "grant",
    lesson: 13,
    forms: ["grant", "grants", "granted"],
    meaning: "your written permission for another key to write here.",
  },
  {
    term: "revoke",
    lesson: 13,
    forms: ["revoke", "revokes", "revoked", "revoking", "revocation"],
    meaning: "taking that permission back. It stops the next write; it unsays nothing.",
  },
  {
    term: "erase",
    lesson: 14,
    forms: ["erase", "erases", "erased", "erasing", "erasure"],
    meaning:
      "the operator's order to remove a record's words themselves, everywhere, for good — " +
      "including from every copy this browser kept.",
  },
  {
    term: "receipt",
    lesson: 14,
    forms: ["receipt", "receipts"],
    meaning: "what stays after an erasure: that something went, by whom, when, why. Never what.",
  },
];

const termsEntering = (lesson) =>
  TERMS.filter((t) => t.lesson === lesson && t.step === undefined).map((t) => ({
    term: t.term,
    meaning: t.meaning,
  }));

const meaningOf = (term) => TERMS.find((t) => t.term === term).meaning;

// ---- the arc -------------------------------------------------------------------------------------

export function buildArc(loam) {
  const RAE_FIRST = loam.authorForSeed(RAE_FIRST_SEED);
  const RAE_SECOND = loam.authorForSeed(RAE_SECOND_SEED);
  const STRANGER = loam.authorForSeed(STRANGER_SEED);

  const grantWriting = (ctx, to) =>
    ctx.gateway.append([
      loam.signClaims(
        loam.grantClaims(loam.STORE_ENTITY, to, "write", ctx.author, ctx.ts()),
        ctx.seed,
      ),
    ]);

  const canWrite = (ctx, who) =>
    loam.holdsGrant(ctx.gateway.reactor, loam.STORE_ENTITY, who, "write", ctx.author);

  /** The record filed at (id, context) carrying these words — or undefined if it is not here. */
  const rowSaying = (ctx, id, context, value) => rowsSaying(ctx, id, context, value)[0];

  /**
   * The moment lesson 6 reads the diary as of: when the last of lesson 3's lines landed, which
   * is the last instant at which everything in the diary was still your first word about it.
   * Taken from the STRUCK Tenet note's own timestamp — it is still in the ground, which is
   * exactly why that evening is readable at all.
   */
  const firstEvening = (ctx) => rowSaying(ctx, TENET, "note", REGRET)?.claims.timestamp;

  return [
    // ============================ ACT I — a place of your own ============================
    {
      id: 1,
      role: "opening",
      title: "The keys are yours",
      copy: `This page just made you a database — a store, which is the word this tutorial will
use from here. It runs in this tab, on your machine, and it answers to exactly one key: the one
it made for you a second ago. Nobody signed up for anything. Nothing was sent anywhere. What you
write here is yours to keep, and the last thing you do in this lesson is take the key that
proves it.`,
      terms: termsEntering(1),
      steps: [
        {
          id: "1.1",
          label: "Look at the record it was born with",
          have: "A store with exactly one record in it, made before you got here.",
          want: "To read the record that names your key as the one this store obeys.",
          how: "Press the button, then open the Ground pane and read the top row.",
          // A LOOK step: boot did the work, and the observable is already true. The arc needs
          // these; the red probe skips them, because there is nothing to neutralise.
          run: async () => {},
          observe: {
            page: { selector: "#ground-rows", contains: "loam.operator" },
            store: async (ctx) => mineAt(ctx, "loam:store", "loam.operator"),
          },
        },
        {
          id: "1.2",
          label: "Say what the store is for",
          have: "A store that will hold anything and has been told nothing.",
          want: "One record of your own, sitting next to the one it was born with.",
          how: "Press the button. Watch a second row appear in the Ground pane.",
          run: async (ctx) => {
            await ctx.gateway.append([
              say(loam, ctx, [entity("subject", DIARY, "name"), prim(DIARY_TITLE)]),
            ]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: DIARY_TITLE },
            store: async (ctx) => mineAt(ctx, DIARY, "name"),
          },
        },
        {
          id: "1.3",
          label: "Check that the new record is really yours",
          have: "Two records, and only your word that the second one is yours.",
          want: "To see the name your key makes, and find it on the record you just wrote.",
          how: "Press the button. The name at the top of the page is the one your key makes.",
          run: async () => {},
          observe: {
            page: { selector: "#author-chip", contains: "ed25519:" },
            store: async (ctx) => {
              // `every` over an empty set is true, so the row has to be FOUND before its author
              // is asked about — otherwise "no such record" reads as "the record is yours".
              const written = rowsSaying(ctx, DIARY, "name", DIARY_TITLE);
              return (
                loam.authorForSeed(ctx.seed) === ctx.author &&
                written.length === 1 &&
                written[0].claims.author === ctx.author
              );
            },
          },
        },
        {
          id: "1.4",
          label: "Download your key — and keep it somewhere safe",
          have: "A key that exists in this tab and nowhere else on earth.",
          want: "A copy of it, in your hands, before anything else happens.",
          how: "Press the button. A small file lands. Lose it and this store is gone for good.",
          run: async (ctx) => {
            offerDownload("my-key.json", JSON.stringify({ seed: ctx.seed, operator: ctx.author }));
          },
          observe: {
            // The closing sentence of this lesson, as a question the store can answer: the
            // secret is in the file and in this browser, and in NO record. Look at the ground
            // all day; your diary is in there and your key is not.
            page: { selector: "#ground-rows", contains: DIARY },
            store: async (ctx) => !anywhere(ctx, ctx.seed) && mineAt(ctx, DIARY, "name"),
          },
        },
      ],
      check: async (ctx) =>
        mineAt(ctx, "loam:store", "loam.operator") &&
        mineAt(ctx, DIARY, "name") &&
        !anywhere(ctx, ctx.seed),
    },

    {
      id: 2,
      role: "describe",
      title: "Say what a viewing is",
      copy: `You watched Arrival last night and you want it written down. A store keeps records,
not vibes, so before you write anything you say what the thing IS. A viewing has a date, a film,
a rating and as many notes as you feel like — that is its shape. And one house rule: when two
viewings of the same film disagree about the rating, your latest word wins. Shape plus rule is a
lens, and it lives in the store like everything else in here.`,
      terms: termsEntering(2),
      steps: [
        {
          id: "2.1",
          label: "Describe what a viewing is",
          have: "A store that will hold anything and answer nothing.",
          want: "A description the store can answer questions through.",
          how: "Press the button. A Viewing entry appears in the View pane.",
          run: async (ctx) => {
            await ctx.gateway.publishRegistration(
              { name: "Viewing", alg: 1, body: loam.parseTerm(OPEN_GATHER) },
              loam.parseSchema({ props: VIEWING_PROPS, default: PICK }),
              [VIEWING],
              undefined,
              undefined,
              undefined,
              Object.keys(VIEWING_PROPS),
            );
          },
          observe: {
            page: { selector: "#view-cards", contains: "Viewing" },
            store: async (ctx) => lensExists(ctx, "Viewing"),
          },
        },
      ],
      check: async (ctx) => lensExists(ctx, "Viewing"),
    },

    {
      id: 3,
      role: "first-write",
      title: "Last night: Arrival, a 9",
      copy: `Now write it down. Each line you add becomes a claim: a record that says one thing
and says who said it. Nothing is edited, ever. Your key leaves a signature on each one, which
anyone can check and nobody can fake. When you ask the diary a question, the answer is worked out
from the claims at the time you ask — which is why nothing here has to be kept up to date.`,
      terms: termsEntering(3),
      quiz: {
        id: "act-i",
        questions: [
          {
            ask: "You ask the diary what Arrival is rated. Where does that answer come from?",
            choices: [
              "A row somebody updated in place",
              "Your signed records, gathered together at the time you ask",
              "A copy kept on somebody else's computer",
            ],
            answer: 1,
            teaches: "3.1",
          },
          {
            ask: "You added the note. What did that do to the records already in the store?",
            choices: [
              "Nothing at all — it added one more",
              "It updated the viewing",
              "It replaced the older record",
            ],
            answer: 0,
            teaches: "3.2",
          },
          {
            ask: "Somebody copies your diary onto their machine. Can they write in it as you?",
            choices: [
              "Yes, it is only a file",
              "No — the mark on each record needs your key, which never left your tab",
              "Only with your permission, which they would have to ask you for",
            ],
            answer: 1,
            teaches: "3.1",
          },
        ],
      },
      steps: [
        {
          id: "3.1",
          label: "Log last night: Arrival, a 9",
          have: "A description with nothing behind it.",
          want: "Last night in the diary, in your own hand.",
          how: "Press the button. Three lines land, and the View pane answers.",
          run: async (ctx) => {
            await ctx.gateway.append([
              field(loam, ctx, VIEWING, "date", "14 May"),
              field(loam, ctx, VIEWING, "film", "Arrival"),
              field(loam, ctx, VIEWING, "rating", 9),
            ]);
          },
          observe: {
            page: { selector: "#view-cards", contains: "Arrival" },
            // OBJECT LEVEL: what a reader gets back through the lens, not merely what is in the
            // ground. The two can disagree, and that disagreement is usually the bug.
            store: async (ctx) => (await read(ctx, "viewing", VIEWING)).rating === 9,
          },
        },
        {
          id: "3.2",
          label: `Add the note: "${FIRST_NOTE}"`,
          have: "A rating, which is not the same as a memory.",
          want: "The line you would actually want to read in five years.",
          how: "Press the button. Nothing is edited; one more record lands beside the rest.",
          run: async (ctx) => {
            await ctx.gateway.append([field(loam, ctx, VIEWING, "note", FIRST_NOTE)]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: FIRST_NOTE },
            store: async (ctx) =>
              list((await read(ctx, "viewing", VIEWING)).note).includes(FIRST_NOTE) &&
              rowsSaying(ctx, VIEWING, "note", FIRST_NOTE).length === 1,
          },
        },
        {
          id: "3.3",
          label: "Catch up: Tenet, back on the 2nd, a 6",
          have: "One night written down, and a diary you are behind on.",
          want: "The other film you owe it, note and all, exactly as you felt at the time.",
          how: "Press the button. Four lines land. Read the note back and wince.",
          run: async (ctx) => {
            await ctx.gateway.append([
              field(loam, ctx, TENET, "date", "2 May"),
              field(loam, ctx, TENET, "film", "Tenet"),
              field(loam, ctx, TENET, "rating", 6),
              field(loam, ctx, TENET, "note", REGRET),
            ]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: REGRET },
            store: async (ctx) => list((await read(ctx, "viewing", TENET)).note).includes(REGRET),
          },
        },
      ],
      check: async (ctx) => {
        const now = await read(ctx, "viewing", VIEWING);
        const other = await read(ctx, "viewing", TENET);
        return (
          now.rating === 9 &&
          list(now.note).includes(FIRST_NOTE) &&
          list(other.note).includes(REGRET)
        );
      },
    },

    // ============================ ACT II — changing your mind ============================
    {
      id: 4,
      role: "rewatch",
      title: "The rewatch",
      copy: `Two weeks later you put Arrival on again, on a laptop, half-asleep, and it is a 7.
Same film, same you, different Tuesday. Everything this store holds sits together in one place,
called the ground, and every answer you read is a view of it — worked out on the spot, using the
house rule you wrote in lesson two. So the 7 does not overwrite the 9, or archive it, or hide it.
It is simply the latest thing you said.

Which means you never have to decide which night was the real one. Both were. That is not a
compromise this thing is making; it is the only honest way to keep a diary, and almost nothing
else lets you.`,
      terms: termsEntering(4),
      steps: [
        {
          id: "4.1",
          label: "Log the rewatch: 28 May, a 7",
          have: "One night in the diary, and a rating you no longer stand behind.",
          want: "Both nights in the diary, and the question answered with your latest word.",
          how: "Press the button. Two dates appear on the entry; the rating moves to 7.",
          run: async (ctx) => {
            await ctx.gateway.append([
              field(loam, ctx, VIEWING, "date", "28 May"),
              field(loam, ctx, VIEWING, "rating", 7),
            ]);
          },
          observe: {
            page: { selector: "#view-cards", contains: "28 May" },
            store: async (ctx) => {
              const now = await read(ctx, "viewing", VIEWING);
              return (
                now.rating === 7 &&
                list(now.date).includes("14 May") &&
                // DELTA LEVEL, the other half: the 9 is still lying there, untouched.
                rowsSaying(ctx, VIEWING, "rating", 9).length === 1
              );
            },
          },
        },
        {
          id: "4.2",
          label: "Look at everything you have ever said about this film",
          have: "One answer, worked out on the spot from several claims.",
          want: "To see the ground itself — the argument you have been having with yourself.",
          how: "Press the button, then read the Ground pane from the top down.",
          run: async () => {},
          observe: {
            page: { selector: "#ground-rows", contains: "viewing:arrival #rating" },
            store: async (ctx) =>
              rowsSaying(ctx, VIEWING, "rating", 9).length === 1 &&
              rowsSaying(ctx, VIEWING, "rating", 7).length === 1 &&
              (await read(ctx, "viewing", VIEWING)).rating === 7,
          },
        },
      ],
      check: async (ctx) => {
        const now = await read(ctx, "viewing", VIEWING);
        return (
          now.rating === 7 &&
          list(now.date).length === 2 &&
          rowsSaying(ctx, VIEWING, "rating", 9).length === 1
        );
      },
    },

    {
      id: 5,
      role: "unsay",
      title: "Unsaying",
      copy: `Some things you write down are wrong in a way a later rating cannot fix. Your Tenet
entry carries a note claiming you understood it completely. You did not. Nobody does. Taking it
back does not reach into the past and tidy it. You write one more claim — a strike, which says
"I take that back" and names what it takes back — and from then on no view repeats the line. The
claim it struck stays exactly where it was, in the ground, dimmed. Your diary gets to show that
you outgrew something, which is more than most of them can do.

Look down the side while you are here. Every lesson you finish leaves a checkpoint: a whole copy
of this store, frozen exactly where you left it, with a button offering to put you back there.
That is your
undo, and you have been collecting one per lesson since the first screen. Remember it. The last
act is going to send you a bill for it.`,
      terms: termsEntering(5),
      steps: [
        {
          id: "5.1",
          label: "Take the note back",
          have: "A line in your diary that was never true.",
          want: "It gone from every reading, and still on the record that you once said it.",
          how: "Press the button. The note leaves the entry; a strike appears naming what it undoes.",
          run: async (ctx) => {
            const note = rowSaying(ctx, TENET, "note", REGRET);
            if (note === undefined) return;
            await ctx.gateway.append([
              loam.signClaims(
                loam.makeNegationClaims(ctx.author, ctx.ts(), note.id, "nobody understood it"),
                ctx.seed,
              ),
            ]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: "negates" },
            store: async (ctx) => {
              const note = rowSaying(ctx, TENET, "note", REGRET);
              const now = await read(ctx, "viewing", TENET);
              return (
                // OBJECT LEVEL: no reader repeats it any more — and the SAME answer still says
                // 6, because `!includes` is satisfied by a lens that answers nothing at all.
                now.rating === 6 &&
                !list(now.note).includes(REGRET) &&
                // ...and DELTA LEVEL: the record it struck is still lying in the ground, and the
                // strike itself names it. Removal and retraction are different acts.
                note !== undefined &&
                ctx.gateway.reactor.negationsOf(note.id).length >= 1
              );
            },
          },
        },
      ],
      check: async (ctx) => {
        const now = await read(ctx, "viewing", TENET);
        return (
          now.rating === 6 &&
          !list(now.note).includes(REGRET) &&
          rowsSaying(ctx, TENET, "note", REGRET).length === 1
        );
      },
    },

    {
      id: 6,
      role: "as-of",
      title: "The diary as of the night you wrote it",
      copy: `Here is a question worth asking a diary: not what you think of Arrival now, and not
what you REMEMBER thinking — what did you actually say at the time? It is the same question with
a moment pinned to it: as of the evening you wrote it all down. The 9 comes back. So does the
Tenet note you struck, because that evening you still believed it. Nothing is restored, because
nothing was ever lost; the ground is all still there, and the moment only decides how much of it
to read.`,
      terms: termsEntering(6),
      quiz: {
        id: "act-ii",
        questions: [
          {
            ask: "Reading as of that evening brings back the note you took back. Why?",
            choices: [
              "The strike was undone",
              "Because on that evening you had not taken it back yet, and the strike is dated too",
              "The store keeps a second copy of everything",
            ],
            answer: 1,
            teaches: "6.2",
          },
          {
            ask: "Why does the diary still hold the 9 as well as the 7?",
            choices: [
              "Both nights happened, and both are true about their own night",
              "The 9 is a backup of the 7",
              "It has not finished tidying up",
            ],
            answer: 0,
            teaches: "6.2",
          },
          {
            ask: "You take the moment off and ask again. What got restored?",
            choices: [
              "The present view, from the archive",
              "Nothing — nothing had gone anywhere",
              "Your original rating",
            ],
            answer: 1,
            teaches: "6.3",
          },
        ],
      },
      steps: [
        {
          id: "6.1",
          label: "Write down what you think now",
          have: "Two ratings and one line you wrote in the dark.",
          want: "Today's honest sentence, so today can be told apart from that evening.",
          how: "Press the button. One more line lands on the Arrival entry.",
          run: async (ctx) => {
            await ctx.gateway.append([field(loam, ctx, VIEWING, "note", SECOND_THOUGHT)]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: SECOND_THOUGHT },
            store: async (ctx) =>
              list((await read(ctx, "viewing", VIEWING)).note).includes(SECOND_THOUGHT),
          },
        },
        {
          id: "6.2",
          label: "Ask the diary what it said the evening you filled it in",
          have: "A diary that answers with everything you have ever said.",
          want: "The answer it would have given before you changed your mind about any of it.",
          how: "Press the button. The same question runs, with that moment pinned to it.",
          run: async (ctx) => {
            const at = firstEvening(ctx);
            if (at === undefined) return;
            await view(ctx, `{ viewing(entity: "${VIEWING}", asOf: ${at}) { rating } }`);
          },
          observe: {
            // The struck claim is STILL IN THE GROUND. That is not a detail; it is the only
            // reason that evening can be read at all.
            page: { selector: "#ground-rows", contains: REGRET },
            store: async (ctx) => {
              const at = firstEvening(ctx);
              if (at === undefined) return false;
              const then = await readAsOf(ctx, "viewing", VIEWING, at);
              const tenetThen = await readAsOf(ctx, "viewing", TENET, at);
              const now = await read(ctx, "viewing", VIEWING);
              return (
                // that evening: the 9 stands and the Tenet note is live...
                then.rating === 9 &&
                !list(then.note).includes(SECOND_THOUGHT) &&
                list(tenetThen.note).includes(REGRET) &&
                // ...and it is a READING of the past, not a move into it: now is still now.
                now.rating === 7
              );
            },
          },
        },
        {
          id: "6.3",
          label: "Take the moment off and ask again",
          have: "An answer from the past, sitting beside an answer from now.",
          want: "To watch the present come back on its own, with nothing rebuilt.",
          how: "Press the button. The same question, with no moment pinned to it.",
          run: async () => {},
          observe: {
            page: { selector: "#view-cards", contains: '"rating": 7' },
            store: async (ctx) => {
              const now = await read(ctx, "viewing", VIEWING);
              const tenetNow = await read(ctx, "viewing", TENET);
              return (
                now.rating === 7 &&
                list(now.note).includes(SECOND_THOUGHT) &&
                // the positive twin: this answer is a real one, and it still says 6
                tenetNow.rating === 6 &&
                !list(tenetNow.note).includes(REGRET)
              );
            },
          },
        },
      ],
      check: async (ctx) => {
        const at = firstEvening(ctx);
        if (at === undefined) return false;
        const then = await readAsOf(ctx, "viewing", VIEWING, at);
        const now = await read(ctx, "viewing", VIEWING);
        return then.rating === 9 && now.rating === 7 && list(now.note).includes(SECOND_THOUGHT);
      },
    },

    // ============================ ACT III — other voices ============================
    {
      id: 7,
      role: "second-hand",
      title: "Rae gets a pen",
      copy: `Rae shares your couch and disagrees with you about everything on it. Rae thinks
Arrival is a 4, and says so at length. So give Rae a pen: a key of their own, plus your written
permission to use it here. Every claim Rae makes carries Rae as its author, forever, and no
setting anywhere can make it say otherwise. (Rae's key is printed inside this tutorial because
Rae is a character. You would never hold anybody else's.)`,
      terms: termsEntering(7),
      steps: [
        {
          id: "7.1",
          label: "Give Rae a pen",
          have: "A store where one key writes and the same key decides who else ever will.",
          want: "A second key that may write here, on your say-so and nobody else's.",
          how: "Press the button. A permission lands in the Ground pane, signed by you.",
          run: async (ctx) => {
            await grantWriting(ctx, RAE_FIRST);
          },
          observe: {
            page: { selector: "#ground-rows", contains: "loam.grants" },
            store: async (ctx) => canWrite(ctx, RAE_FIRST) && !canWrite(ctx, STRANGER),
          },
        },
        {
          id: "7.2",
          label: "Let Rae log their verdict: Arrival, a 4",
          have: "A key with permission and nothing written yet.",
          want: "Rae's opinion in the diary, unmistakably in Rae's hand.",
          how: "Press the button. New rows land naming a different author from you.",
          run: async (ctx) => {
            await ctx.gateway.append([
              fieldAs(loam, ctx, RAE_FIRST_SEED, VIEWING, "date", "9 June"),
              fieldAs(loam, ctx, RAE_FIRST_SEED, VIEWING, "rating", 4),
              fieldAs(loam, ctx, RAE_FIRST_SEED, VIEWING, "note", RAE_VERDICT),
            ]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: RAE_FIRST.slice(0, 18) },
            store: async (ctx) =>
              rowsSaying(ctx, VIEWING, "rating", 4).some((d) => d.claims.author === RAE_FIRST) &&
              (await read(ctx, "viewing", VIEWING)).rating === 4,
          },
        },
        {
          id: "7.3",
          label: "Try softening Rae's verdict in Rae's own name",
          have: "A 4 sitting in your diary, and a very human urge to improve it slightly.",
          want: "To find out what stops you, since nothing on this page is asking permission.",
          how: "Press the button. The store says no. Look in the Ground pane: the line is not there.",
          run: async (ctx) => {
            try {
              // Your seed, Rae's name on the front. The mark will not check out, and the door
              // will not take it — which is the only reason "Rae said this" means anything.
              await ctx.gateway.append([
                loam.signClaims(
                  {
                    timestamp: ctx.ts(),
                    author: RAE_FIRST,
                    pointers: [entity("subject", VIEWING, "note"), prim(FORGED_LINE)],
                  },
                  ctx.seed,
                ),
              ]);
            } catch {
              /* the refusal is the lesson; the observable below is what proves it */
            }
          },
          observe: {
            page: { selector: "#ground-rows", contains: RAE_FIRST.slice(0, 18) },
            store: async (ctx) =>
              // Nothing landed...
              !anywhere(ctx, FORGED_LINE) &&
              // ...and the real Rae's real line is untouched, which is the other half: a door
              // that refused everything would pass the first test and fail the diary.
              list((await read(ctx, "viewing", VIEWING)).note).includes(RAE_VERDICT),
          },
        },
      ],
      check: async (ctx) =>
        canWrite(ctx, RAE_FIRST) &&
        !anywhere(ctx, FORGED_LINE) &&
        (await read(ctx, "viewing", VIEWING)).rating === 4,
    },

    {
      id: 8,
      role: "policies",
      title: "Whose word wins?",
      copy: `So what is Arrival rated in this house? The store refuses to have an opinion. It
holds a 9, a 7 and a 4, all true about the night they were written, and the answer you get
depends entirely on the rule you asked with. That rule is a policy, it lives in the lens, and you
can keep as many lenses as you have moods.`,
      terms: termsEntering(8),
      steps: [
        {
          id: "8.1",
          label: "Ask the house",
          have: "Three ratings for one film, from two hands.",
          want: "The answer your first description gives: the latest word, whoever said it.",
          how: "Press the button and read the Viewing card. Rae spoke last, so Rae answers.",
          run: async () => {},
          observe: {
            page: { selector: "#view-cards", contains: '"rating": 4' },
            store: async (ctx) => (await read(ctx, "viewing", VIEWING)).rating === 4,
          },
        },
        {
          id: "8.2",
          label: "Describe a reading that hears you first",
          have: "One description, which lets whoever wrote last decide.",
          want: "A second description, for your own future self: your word, then everyone else's.",
          how: "Press the button. A My Diary card appears, answering 7.",
          run: async (ctx) => {
            await ctx.gateway.publishRegistration(
              { name: "MyDiary", alg: 1, body: loam.parseTerm(heardFrom([ctx.author])) },
              loam.parseSchema({
                props: { ...VIEWING_PROPS, rating: MINE_FIRST(ctx.author) },
                default: PICK,
              }),
              [VIEWING],
            );
          },
          observe: {
            page: { selector: "#view-cards", contains: "MyDiary" },
            store: async (ctx) => (await read(ctx, "myDiary", VIEWING)).rating === 7,
          },
        },
        {
          id: "8.3",
          label: "Check that nothing was copied to make that happen",
          have: "Two answers to one question, both of them true.",
          want: "Proof that there is still exactly one of each record underneath.",
          how: "Press the button. Count this film's rating rows in the Ground pane: still three.",
          run: async () => {},
          observe: {
            page: { selector: "#view-cards", contains: "MyDiary" },
            store: async (ctx) =>
              (await read(ctx, "viewing", VIEWING)).rating === 4 &&
              (await read(ctx, "myDiary", VIEWING)).rating === 7 &&
              ground(ctx).filter(pointsAt(VIEWING, "rating")).length === 3,
          },
        },
      ],
      check: async (ctx) =>
        (await read(ctx, "myDiary", VIEWING)).rating === 7 &&
        (await read(ctx, "viewing", VIEWING)).rating === 4,
    },

    {
      id: 9,
      role: "shelves",
      title: "My shelf, our shelf",
      copy: `Rae has seen My Diary and has opinions about being second in the queue. Fine: keep
both worlds, permanently. My Diary is for your future self, and it puts your word first. The
house shelf is for the fridge door, and it keeps every rating from every hand you have given a
pen to — yours and Rae's — in the order they were written, nobody quietly deleted to make the
page tidier. Two shelves, one set of records underneath, and not a single thing copied between
them.`,
      terms: termsEntering(9),
      steps: [
        {
          id: "9.1",
          label: "Put the house shelf on the wall",
          have: "A shelf for you, and an argument with nowhere to live.",
          want: "A shelf that keeps every rating instead of choosing between them.",
          how: "Press the button. A House Diary card appears with all three ratings on it.",
          run: async (ctx) => {
            await ctx.gateway.publishRegistration(
              {
                name: "HouseDiary",
                alg: 1,
                body: loam.parseTerm(heardFrom([ctx.author, RAE_FIRST])),
              },
              loam.parseSchema({ props: { ...VIEWING_PROPS, rating: ALL }, default: ALL }),
              [VIEWING, TENET],
            );
          },
          observe: {
            page: { selector: "#view-cards", contains: "HouseDiary" },
            store: async (ctx) => {
              const house = await read(ctx, "houseDiary", VIEWING);
              return (
                list(house.rating).join(",") === "9,7,4" &&
                (await read(ctx, "myDiary", VIEWING)).rating === 7 &&
                (await read(ctx, "viewing", VIEWING)).rating === 4 &&
                // one set of records underneath all three answers
                ground(ctx).filter(pointsAt(VIEWING, "rating")).length === 3
              );
            },
          },
        },
      ],
      check: async (ctx) => list((await read(ctx, "houseDiary", VIEWING)).rating).length === 3,
    },

    {
      id: 10,
      role: "evolution",
      title: "Movie night",
      copy: `Something changed and the diary has not noticed. You and Rae watch things together
now — properly, on purpose, with the good snacks — and every entry in here still reads as though
you were alone on the sofa. A viewing has a date, a film, a rating and notes. There is nowhere to
put the person beside you.

So change what a viewing is: a second version, with room for guests. Here is the whole bill for
that. Nothing already written is touched. No entry is converted or moved. The first version keeps
answering, including about entries written under the second — and May's Arrival needs nothing
done to it to live in the new world. You will check both of those yourself, in a minute, because
this is the promise
most worth checking rather than believing.`,
      terms: termsEntering(10),
      steps: [
        {
          id: "10.1",
          label: "Add guests to what a viewing is",
          have: "A description of a viewing with nowhere to put the person beside you.",
          want: "A second version with room for guests, and the first one left undisturbed.",
          how: "Press the button, then open the panel asking 'is that really what happened?' — guests is in the shape now.",
          run: async (ctx) => {
            await ctx.gateway.publishRegistration(
              { name: "Viewing", alg: 1, body: loam.parseTerm(OPEN_GATHER) },
              loam.parseSchema({ props: GUEST_PROPS, default: PICK }),
              [VIEWING, MOVIE_NIGHT],
              undefined,
              undefined,
              undefined,
              Object.keys(GUEST_PROPS),
            );
          },
          observe: {
            page: { selector: "#drawer-sdl", contains: "guests" },
            store: async (ctx) => {
              const editions = versionsOf(ctx, "Viewing");
              return (
                editions.length === 2 &&
                !editions[0].schema.props.has("guests") &&
                editions[1].schema.props.has("guests")
              );
            },
          },
        },
        {
          id: "10.2",
          label: "Log movie night: Paddington 2, a 10, Rae beside you",
          have: "The 2nd of July, Paddington 2, and Rae texting their friend Jamie through it.",
          want: "Tonight in the diary the way tonight actually was: not yours, but both of yours.",
          how: "Press the button. A Paddington 2 card appears with Rae named on the guest line.",
          run: async (ctx) => {
            await ctx.gateway.append([
              field(loam, ctx, MOVIE_NIGHT, "date", "2 July"),
              field(loam, ctx, MOVIE_NIGHT, "film", "Paddington 2"),
              field(loam, ctx, MOVIE_NIGHT, "rating", 10),
              say(loam, ctx, [
                entity("subject", MOVIE_NIGHT, "guests"),
                entity("guest", RAE, "person"),
              ]),
            ]);
          },
          observe: {
            page: { selector: "#view-cards", contains: "Paddington 2" },
            store: async (ctx) =>
              list((await read(ctx, "viewing", MOVIE_NIGHT, "guests")).guests).includes(RAE),
          },
        },
        {
          id: "10.3",
          label: "Read tonight's entry through the OLD version",
          have: "A first version still sitting in your store, because nothing here is ever deleted.",
          want: "To know whether it still answers, or whether you just broke it.",
          how: "Press the button. It answers Paddington 2, a 10, exactly as it always did.",
          run: async () => {},
          observe: {
            page: { selector: "#view-cards", contains: "person:rae" },
            store: async (ctx) => {
              const first = versionsOf(ctx, "Viewing")[0];
              if (first === undefined) return false;
              const asItWas = ctx.gateway.resolvePinned(first, MOVIE_NIGHT).view;
              return (
                // The first version has no rule for guests — it was written before the word...
                !first.schema.props.has("guests") &&
                // ...and it reads the entry anyway, film and rating intact. What it is NOT
                // asserted to do is hide the guest: a reading with no rule for a field falls
                // back to its default one, so the value is still in there. The promise being
                // kept is "the old reading still works", never "the old reading is blind".
                asItWas.film === "Paddington 2" &&
                asItWas.rating === 10
              );
            },
          },
        },
        {
          id: "10.4",
          label: "Read May's entry through the NEW version",
          have: "An entry from May, written before guests existed as an idea in this diary.",
          want: "To know what the new version demands of it before it will answer.",
          how: "Press the button. Arrival answers exactly as it always did; its guest line is empty.",
          run: async () => {},
          observe: {
            page: { selector: "#view-cards", contains: "Arrival" },
            store: async (ctx) => {
              const may = await read(ctx, "viewing", VIEWING, "guests");
              return may.film === "Arrival" && list(may.guests).length === 0;
            },
          },
        },
      ],
      check: async (ctx) =>
        versionsOf(ctx, "Viewing").length === 2 &&
        list((await read(ctx, "viewing", MOVIE_NIGHT, "guests")).guests).includes(RAE),
    },

    {
      id: 11,
      role: "reveal",
      title: "It was records all along",
      copy: `Time to look behind the furniture. The glossary you have been consulting since lesson
one is not part of this page. Every definition in it is a claim in YOUR store, signed by your key,
planted the moment you first needed the word. So is your progress. So are your quiz answers. This
tutorial has no memory of its own — it has been reading yours the whole time.

And one piece of housekeeping, now that you have made a hundred or so of them. Record, claim and
delta are three words for the same object. "Record" is what it is: one signed statement that
never changes. "Claim" is what it does: somebody saying something, and standing behind it.
"Delta" is the name it goes by outside this tutorial. Same object, three angles, and that short
string of letters on every row in the Ground pane is its name — worked out from the words
themselves, which is why nothing in here ever had to be given a number.`,
      terms: termsEntering(11),
      quiz: {
        id: "act-iii",
        questions: [
          {
            ask: "Where does the glossary you have been reading actually live?",
            choices: [
              "In this page's code",
              "In your own store, as claims you made while you learned",
              "On somebody else's computer, filed under your name",
            ],
            answer: 1,
            teaches: "11.1",
          },
          {
            ask: "The tick beside each finished lesson — where is it kept?",
            choices: [
              "In this browser, beside the store",
              "In the store, as an ordinary claim signed by you",
              "In this page's memory, until you close the tab",
            ],
            answer: 1,
            teaches: "11.2",
          },
          {
            ask: "You wipe everything in this browser EXCEPT your own claims, then reload. What does the page forget?",
            choices: [
              "Which lesson you were on",
              "Your quiz answers",
              "Nothing — it works all of that out from your claims",
            ],
            answer: 2,
            teaches: "11.2",
          },
        ],
      },
      steps: [
        {
          id: "11.1",
          label: "Ask the glossary where it lives",
          have: "A glossary you have been reading as if this page owned it.",
          want: "The real name of a record here — and proof of what the glossary is made of.",
          how: "Press the button, then use any entry's 'where does this live?' link.",
          run: async (ctx) => {
            await plantTerm(loam, ctx, 11, "delta", meaningOf("delta"));
          },
          observe: {
            page: { selector: "#glossary-entries", contains: "delta" },
            store: async (ctx) => mineAt(ctx, "tutorial:term:delta", "tutorial.glossary"),
          },
        },
        {
          id: "11.2",
          label: "Ask your own progress like any other question",
          have: "A progress list down the side, which looked like part of the page.",
          want: "To find every tick of it in your own store, signed by you.",
          how: "Press the button, then read the progress list: every tick on it is a record you signed.",
          run: async () => {},
          observe: {
            page: { selector: "#progress-rail", contains: "✓ 1." },
            store: async (ctx) => {
              const entries = readGlossary(ctx);
              const progress = readProgress(ctx);
              return (
                entries.length >= 16 &&
                // AT THE BYTES, which is the reveal's actual claim. `readGlossary` is derived
                // from `offeredDeltas()`, so checking its entries against `offeredDeltas()`
                // compares the code with itself and can never fail. The rows are a different
                // level: every word in that pane is a record this browser wrote down.
                entries.every((e) => ctx.storage.getItem(STORE_PREFIX + e.deltaId) !== null) &&
                // EXACT, and both numbers are the same fact. The twenty-five steps of lessons
                // 1-10 plus 11.1 make 26; this step's own banking makes 27, and the predicate is
                // asked on both sides of it. Steps bank in order, one at a time, and the rail
                // refuses a lesson the student has not reached, so no other count is reachable —
                // which is why this is not a floor. A floor lets a step quietly stop banking and
                // still read as a full journey.
                (progress.steps.size === 26 || progress.steps.size === 27) &&
                progress.entered.length >= 11
              );
            },
          },
        },
      ],
      check: async (ctx) =>
        mineAt(ctx, "tutorial:term:delta", "tutorial.glossary") &&
        readGlossary(ctx).every((e) => ctx.storage.getItem(STORE_PREFIX + e.deltaId) !== null),
    },

    // ============================ ACT IV — who gets in ============================
    {
      id: 12,
      role: "stranger",
      title: "A file claims to be Rae",
      copy: `Someone emails you a file: "Rae's viewings", and it says Tenet is a ten out of ten.
Rae has never said that in their life. Open it anyway. Your store does not burn mail — the claims
land, wearing a key nobody in this house has ever seen. Then look at your two shelves, and then
at the plain description you wrote in lesson two. The shelves name whose word they hear; the
plain one hears anybody. Trust was never something the store decided for you. It has been sitting
in each reading the whole time, waiting for you to notice.`,
      terms: termsEntering(12),
      steps: [
        {
          id: "12.1",
          label: "Open the file",
          have: "A file from a stranger, and no way to know what is in it until you look.",
          want: "It in the store where you can see it, and out of every answer that matters.",
          how: "Press the button. A new row appears wearing a name you do not recognise.",
          run: async (ctx) => {
            // A real file, in the shape any Loam store serves: signed records and nothing else.
            const file = JSON.stringify({
              deltas: [
                fieldAs(loam, ctx, STRANGER_SEED, TENET, "rating", 10),
                fieldAs(loam, ctx, STRANGER_SEED, TENET, "note", STRANGER_NOTE),
              ].map((d) => loam.toWire(d)),
            });
            await ctx.gateway.federate(loam.parseOffer(file));
          },
          observe: {
            page: { selector: "#ground-rows", contains: STRANGER.slice(0, 18) },
            store: async (ctx) => {
              const landed = rowsSaying(ctx, TENET, "rating", 10);
              const house = await read(ctx, "houseDiary", TENET);
              const mine = await read(ctx, "myDiary", TENET);
              const plain = await read(ctx, "viewing", TENET);
              return (
                // It LANDED, under the stranger's own key — the store does not burn mail...
                landed.length === 1 &&
                landed[0].claims.author === STRANGER &&
                // ...and neither shelf hears it. The NOTE is what proves that, not the rating:
                // both shelves put your own hand first anyway, so a shelf that had quietly
                // stopped narrowing would still answer 6 and this would notice nothing. The
                // note field keeps everything it hears, so a leak has nowhere to hide.
                house.rating.includes(6) &&
                !list(house.rating).includes(10) &&
                !list(house.note).includes(STRANGER_NOTE) &&
                mine.rating === 6 &&
                !list(mine.note).includes(STRANGER_NOTE) &&
                // ...while the plain description from lesson two hears everyone, and believed
                // it — note and all.
                plain.rating === 10 &&
                list(plain.note).includes(STRANGER_NOTE)
              );
            },
          },
        },
        {
          id: "12.2",
          label: "Tell the house shelf to trust everyone, on purpose",
          have: "A shelf that hears two named hands, and a stranger it has never heard of.",
          want: "To see what inviting everybody in actually looks like.",
          how: "Press the button. The Tenet house card gains the stranger's ten, under their own key.",
          run: async (ctx) => {
            await ctx.gateway.publishRegistration(
              { name: "HouseDiary", alg: 1, body: loam.parseTerm(OPEN_GATHER) },
              loam.parseSchema({ props: { ...VIEWING_PROPS, rating: ALL }, default: ALL }),
              [VIEWING, TENET],
            );
          },
          observe: {
            page: { selector: "#view-cards", contains: STRANGER_NOTE },
            store: async (ctx) => {
              const house = await read(ctx, "houseDiary", TENET);
              const forged = rowsSaying(ctx, TENET, "rating", 10)[0];
              return (
                list(house.rating).includes(10) &&
                list(house.note).includes(STRANGER_NOTE) &&
                // ...and it did not lose your own word to make room for theirs
                list(house.rating).includes(6) &&
                // and it wears the key that really wrote it — never Rae's name
                forged !== undefined &&
                forged.claims.author === STRANGER &&
                forged.claims.author !== RAE_FIRST &&
                // your own shelf is untouched by the invitation
                (await read(ctx, "myDiary", VIEWING)).rating === 7
              );
            },
          },
        },
      ],
      check: async (ctx) =>
        rowsSaying(ctx, TENET, "rating", 10).some((d) => d.claims.author === STRANGER) &&
        list((await read(ctx, "houseDiary", TENET)).rating).includes(10),
    },

    {
      id: 13,
      role: "revocation",
      title: "The cousin incident",
      copy: `Rae's cousin found Rae's pen and logged fourteen nights of the same car film.
Revoke the grant — the store's front door will refuse that key from now on. What it will not do
is pretend the fourteen were never written, because a history you can quietly rewrite is not a
history. Then do the part that matters most and is easiest to get wrong: hand Rae a fresh key on
the spot and grant that one. Nothing about Rae has changed, and keys are cheap anyway. What you actually govern is who may write, and you are about to
change it twice in a minute without losing a single line of anything.`,
      terms: termsEntering(13),
      quiz: {
        id: "act-iv",
        questions: [
          {
            ask: "After you took the pen back, who wrote the cousin's fourteen viewings?",
            choices: [
              "Nobody — they were removed",
              "The old key, still, and the store still says so",
              "Rae, under the new key",
            ],
            answer: 1,
            teaches: "13.2",
          },
          {
            ask: "Why give Rae a fresh key instead of cleaning up the old one?",
            choices: [
              "A key is cheap; what you govern is who may write, not who someone is",
              "The old key is corrupted",
              "It makes the cousin's records disappear",
            ],
            answer: 0,
            teaches: "13.3",
          },
          {
            ask: "What did taking the pen back change about records already written?",
            choices: ["Nothing", "Their author", "Their dates"],
            answer: 0,
            teaches: "13.2",
          },
        ],
      },
      steps: [
        {
          id: "13.1",
          label: "Fourteen nights of the same car film",
          have: "A pen you gave to Rae, and a cousin who found it.",
          want: "The damage on the page, where you can see exactly what happened.",
          how: "Press the button. Fifteen rows land — fourteen dates and the film's name — all in Rae's first hand.",
          run: async (ctx) => {
            const batch = [];
            for (let n = 1; n <= 14; n++) {
              batch.push(fieldAs(loam, ctx, RAE_FIRST_SEED, CHASE, "date", `binge night ${n}`));
            }
            batch.push(fieldAs(loam, ctx, RAE_FIRST_SEED, CHASE, "film", "Fast & Furious"));
            await ctx.gateway.append(batch);
          },
          observe: {
            page: { selector: "#ground-rows", contains: "viewing:fast-and-furious" },
            store: async (ctx) =>
              ground(ctx).filter((d) => d.claims.author === RAE_FIRST && pointsAt(CHASE, "date")(d))
                .length === 14,
          },
        },
        {
          id: "13.2",
          label: "Revoke the grant",
          have: "A key that may still write here, in hands you did not choose.",
          want: "That key refused from now on — and the fourteen still on the record.",
          how: "Press the button. The grant goes dim. The fourteen stay exactly where they are.",
          run: async (ctx) => {
            const permission = ground(ctx).find(
              (d) =>
                d.claims.author === ctx.author &&
                pointsAt(loam.STORE_ENTITY, "loam.grants")(d) &&
                holds(d, RAE_FIRST),
            );
            if (permission === undefined) return;
            await ctx.gateway.append([
              loam.signClaims(loam.revocationClaims(permission.id, ctx.author, ctx.ts()), ctx.seed),
            ]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: "viewing:fast-and-furious" },
            store: async (ctx) => {
              const binge = await read(ctx, "viewing", CHASE);
              return (
                // the key is refused from here on...
                !canWrite(ctx, RAE_FIRST) &&
                // ...and every line it ever wrote is still here, still saying who wrote it, at
                // the delta...
                ground(ctx).filter(
                  (d) => d.claims.author === RAE_FIRST && pointsAt(CHASE, "date")(d),
                ).length === 14 &&
                rowsSaying(ctx, VIEWING, "rating", 4).some((d) => d.claims.author === RAE_FIRST) &&
                // ...AND at the reading, which is the half that would go quiet first if losing
                // standing ever un-said what a key had already written. The copy and the quiz
                // both promise this; the delta level alone cannot keep the promise.
                binge.film === "Fast & Furious" &&
                list(binge.date).length === 14 &&
                (await read(ctx, "viewing", VIEWING)).rating === 4
              );
            },
          },
        },
        {
          id: "13.3",
          label: "Grant Rae a fresh pen",
          have: "A friend with no way to write, over something a cousin did.",
          want: "Rae writing again, under a key the cousin has never touched.",
          how: "Press the button. A second grant lands, naming a different key.",
          run: async (ctx) => {
            await grantWriting(ctx, RAE_SECOND);
          },
          observe: {
            page: { selector: "#ground-rows", contains: RAE_SECOND.slice(0, 18) },
            store: async (ctx) => canWrite(ctx, RAE_SECOND) && !canWrite(ctx, RAE_FIRST),
          },
        },
        {
          id: "13.4",
          label: "Rae writes again — and writes down something that was never theirs",
          have: "Rae, back at the diary with a fresh pen, still thinking about movie night.",
          want: "Their two lines about that evening. One of them is about Jamie.",
          how: "Press the button, then read both new lines on Paddington 2. Read the first one twice.",
          run: async (ctx) => {
            // Two lines, in this order on purpose: the second one's timestamp is what lesson 14
            // pins its as-of read to, so the past it reads is a past that CONTAINED the first.
            await ctx.gateway.append([
              fieldAs(loam, ctx, RAE_SECOND_SEED, MOVIE_NIGHT, "note", PRIVATE_LINE),
              fieldAs(loam, ctx, RAE_SECOND_SEED, MOVIE_NIGHT, "note", MOVIE_NIGHT_NOTE),
            ]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: MOVIE_NIGHT_NOTE },
            store: async (ctx) => {
              const night = list((await read(ctx, "viewing", MOVIE_NIGHT)).note);
              return (
                night.includes(PRIVATE_LINE) &&
                night.includes(MOVIE_NIGHT_NOTE) &&
                // AND THE SCANNER CAN SEE THEM IN THE ROWS. Lesson 14 proves those words are in
                // no row afterwards; that proof is worth nothing unless the same scanner, with
                // the same needle, finds them HERE — where they certainly are. A needle escaped
                // the wrong way reads "clean" on an empty store and on a full one alike, so this
                // is the assertion that makes the later absence mean something.
                wordsInStorage(ctx, PRIVATE_LINE)
              );
            },
          },
        },
      ],
      check: async (ctx) =>
        canWrite(ctx, RAE_SECOND) &&
        !canWrite(ctx, RAE_FIRST) &&
        anywhere(ctx, PRIVATE_LINE) &&
        anywhere(ctx, MOVIE_NIGHT_NOTE),
    },

    // ============================ ACT V — leaving, and forgetting ============================
    {
      id: 14,
      role: "erasure-finale",
      title: "What never should have landed",
      copy: `Read that first line again. Jamie sent it to Rae at eleven at night, to Rae only,
and now it is in your film diary. A strike is not enough this time. A struck claim stays exactly
where it was — that is the whole point of a strike — and these particular words should not be
anywhere in your store at all. So erase it: the one order only the operator can give. The words
themselves go, everywhere this browser wrote them down, and a receipt stays behind saying that
something went.

Everywhere includes the checkpoints down the side. A checkpoint is a copy, and a copy has the
words in it, so some of your undo is about to be destroyed in front of you — named, one line
each, with the reason. That is the bill. A right to be forgotten that spares your undo button is
not a right to be forgotten, and Jamie is owed the real one.`,
      terms: termsEntering(14),
      quiz: {
        id: "act-v",
        questions: [
          {
            ask: "What does the receipt remember, and what can it never remember?",
            choices: [
              "Everything, including the words — that is the point of a receipt",
              "That something went, by whom, when and why — never what it said",
              "Only the date",
            ],
            answer: 1,
            teaches: "14.2",
          },
          {
            ask: "Why did some of your checkpoints have to go?",
            choices: [
              "They were old",
              "Each one is a copy, and a copy of the record holds the words",
              "To save space",
            ],
            answer: 1,
            teaches: "14.3",
          },
          {
            ask: "Striking and erasing — what is the difference?",
            choices: [
              "None; erasing is just a stronger word",
              "A strike hides a record and keeps it; erasing removes the words, and only the operator may",
              "A strike needs a receipt too",
            ],
            answer: 1,
            teaches: "14.1",
          },
        ],
      },
      steps: [
        {
          id: "14.1",
          label: "Erase it, and say why",
          have: "A third person's private words, in a store you are responsible for.",
          want: "Those words gone — from the store and from every copy of it you kept.",
          how: "Press the button. Read what the page says it reached, and what it left alone.",
          run: async (ctx) => {
            const line = ground(ctx).find((d) => holds(d, PRIVATE_LINE));
            if (line === undefined) return;
            await ctx.gateway.erase(line.id, { reason: ERASURE_REASON });
          },
          observe: {
            // The HOLDER, which index.html declares — never the notice rendered inside it. An
            // observable rooted at a conjured element is satisfiable only while something
            // conjures it, and this act cannot be repeated.
            page: { selector: "#sweep-holder", contains: "checkpoint" },
            store: async (ctx) => {
              const night = list((await read(ctx, "viewing", MOVIE_NIGHT)).note);
              return (
                // gone from what any reader is served...
                !anywhere(ctx, PRIVATE_LINE) &&
                // ...AND from the rows this browser wrote, asked at the level the rows are
                // spelled at. Step 13.4 proved this same scanner finds these same words when
                // they are there, so the false here is a fact rather than a needle that never
                // matched anything.
                !wordsInStorage(ctx, PRIVATE_LINE) &&
                loam.readTombstones(ctx.gateway.reactor, ctx.author).size >= 1 &&
                // ...and the diary is whole around the hole: the line beside it survived, and so
                // did everything else. A door that removed too much would pass the first test.
                night.includes(MOVIE_NIGHT_NOTE) &&
                (await read(ctx, "viewing", VIEWING)).rating === 4
              );
            },
          },
        },
        {
          id: "14.2",
          label: "Read what stayed behind",
          have: "A hole where a record was, and no account of how it got there.",
          want: "The receipt: who removed something, when, and why — and nothing more.",
          how: "Press the button, then find the row in the Ground pane marked as an erasure.",
          run: async () => {},
          observe: {
            page: { selector: "#ground-rows", contains: "loam.erasure" },
            store: async (ctx) => {
              const receipts = ground(ctx).filter(pointsAt(ERASURE_ENTITY, ERASURE_CONTEXT));
              return (
                receipts.length >= 1 &&
                // EVERY one says WHY — `some` would let a reasonless receipt ride along beside
                // a good one and still call the ledger honest.
                receipts.every((d) => holds(d, ERASURE_REASON)) &&
                // ...and it cannot say WHAT, because it never kept the words. At the bytes.
                receipts.every((d) => !JSON.stringify(d).includes(PRIVATE_FRAGMENT)) &&
                receipts.every((d) => d.claims.author === ctx.author)
              );
            },
          },
        },
        {
          id: "14.3",
          label: "Watch it reach your checkpoints",
          have: "Copies of your store down the side, some taken while those words were in it.",
          want: "Every copy that held them destroyed, and every copy that did not, kept.",
          how: "Press the button. The page names what went, what stayed, and why.",
          run: async (ctx) => {
            sweepCheckpoints(ctx.storage, [
              ...loam.readTombstones(ctx.gateway.reactor, ctx.author),
            ]);
          },
          observe: {
            page: { selector: "#sweep-holder", contains: "checkpoint" },
            // ONE-SIDED ON PURPOSE, and this is the one place that is right. The frozen browser
            // suite requires this lesson to be passable with every checkpoint blob deleted, so
            // "a bystander survived" cannot be a condition of finishing — a student whose quota
            // refused every checkpoint would be stranded on the last lesson forever. The other
            // side, that the sweep spares what it must, is asserted in `test/site/arc.test.ts`,
            // which owns the fixture and can guarantee a bystander exists to be spared.
            //
            // A blob is condemned for HOLDING the record, never for MENTIONING it: the receipt
            // names the id it forgot, and every checkpoint taken after the erasure carries that
            // receipt. Asking "does this blob mention the id" would destroy those too — which is
            // over-purging, in the one direction whose mistakes cannot be undone.
            //
            // AND IT WALKS THE KEYS, not a list of lesson numbers derived from them. The sweep
            // reads every key under the prefix verbatim, for the reason `player.mjs` states: a
            // suffix that does not round-trip through `Number` would be skipped, leaving a blob
            // with the record in it while the report said none had. A verdict that re-derived
            // the numbers would be blind to exactly the blob the sweep exists to catch.
            store: async (ctx) => {
              const dead = loam.readTombstones(ctx.gateway.reactor, ctx.author);
              if (dead.size === 0) return false;
              const words = asStored(PRIVATE_LINE);
              for (let i = 0; i < ctx.storage.length; i++) {
                const key = ctx.storage.key(i);
                if (key === null || !key.startsWith(CKPT_PREFIX)) continue;
                const raw = ctx.storage.getItem(key);
                let blob = null;
                try {
                  blob = raw === null ? null : JSON.parse(raw);
                } catch {
                  blob = null;
                }
                // A blob that will not read cannot be shown to be clean, and the sweep destroys
                // exactly those. One still lying here means the sweep did not run.
                if (blob === null || typeof blob.rows !== "object" || blob.rows === null) {
                  return false;
                }
                for (const [rowKey, row] of Object.entries(blob.rows)) {
                  // The two questions the sweep itself asks: the key that FILES the row, and the
                  // id the row's own bytes CLAIM — the second catches a misfiled row.
                  if (dead.has(rowKey.slice(STORE_PREFIX.length))) return false;
                  if (typeof row !== "string") continue;
                  if (dead.has(claimedIdOf(row))) return false;
                  // ...and the words themselves, escaped the way a stored row escapes them. The
                  // raw sentence is never found in a row: the row is JSON, and the quotes in it
                  // are backslashed. A needle taken from the source is a guard that never fires.
                  if (row.includes(words)) return false;
                }
              }
              return true;
            },
          },
        },
        {
          id: "14.4",
          label: "Read the past, minus what you lawfully forgot",
          have: "A store that can show you any evening you like.",
          want: "That evening honestly: what it held, and an admission of what it no longer can.",
          how: "Press the button. The other line from that night is there; the erased one is not.",
          run: async () => {},
          observe: {
            page: { selector: "#view-cards", contains: "Paddington 2" },
            store: async (ctx) => {
              const marker = rowSaying(ctx, MOVIE_NIGHT, "note", MOVIE_NIGHT_NOTE);
              if (marker === undefined) return false;
              const at = marker.claims.timestamp;
              const answer = await view(
                ctx,
                `{ viewing(entity: "${MOVIE_NIGHT}", asOf: ${at}) { note _forgotten } }`,
              );
              const then = answer.viewing ?? {};
              return (
                // that evening still reads...
                list(then.note).includes(MOVIE_NIGHT_NOTE) &&
                // ...without what has since been forgotten, no matter how far back you point...
                !list(then.note).includes(PRIVATE_LINE) &&
                // ...and it SAYS there is a hole rather than pretending to be complete.
                list(then._forgotten).length >= 1
              );
            },
          },
        },
      ],
      check: async (ctx) =>
        !anywhere(ctx, PRIVATE_LINE) &&
        loam.readTombstones(ctx.gateway.reactor, ctx.author).size >= 1 &&
        list((await read(ctx, "viewing", MOVIE_NIGHT)).note).includes(MOVIE_NIGHT_NOTE) &&
        (await read(ctx, "viewing", VIEWING)).rating === 4,
    },

    {
      id: 15,
      role: "homecoming",
      title: "The homecoming",
      copy: `Take it home. What comes out of this tab is not a summary of your diary and it is not
a picture of it. It IS the diary: the same records, the same key, the same rules about who may
write and what was removed — so opening it on another machine gives you the same answers,
character for character. Including the answer about Jamie, which is that there is no answer, and
a receipt saying so.

Rae has been watching all of this and wants one of their own. That is another journey. Yours ends
the way it started, with the key in your hand and one more thing to write down.`,
      terms: termsEntering(15),
      steps: [
        {
          id: "15.1",
          label: "Carry it out, and open it somewhere else",
          have: "A store that lives in one browser tab, which is a frightening place to live.",
          want: "The same store somewhere else, proven the same rather than promised the same.",
          how: "Press the button. A file lands, and the page opens a second store from it and compares.",
          run: async (ctx) => {
            offerDownload("my-store.json", buildExport(loam, ctx));
          },
          observe: {
            page: { selector: "#view-cards", contains: "Arrival" },
            store: async (ctx) => {
              const copy = await openTheCopy(loam, ctx, buildExport(loam, ctx));
              try {
                // TWO ENTITIES, and the second is the one that matters. Arrival is a plain
                // pile of ratings; Tenet carries a strike of your own AND a stranger's
                // federated claim, so it is the entity where a seeding edge that dropped a
                // retraction would show up — as a copy serving a taken-back note as live.
                for (const entity of [VIEWING, TENET]) {
                  const here = await ctx.gateway.query(
                    `{ viewing(entity: "${entity}") { _hex rating } }`,
                  );
                  const there = await copy.query(
                    `{ viewing(entity: "${entity}") { _hex rating } }`,
                  );
                  const mine = here.data?.viewing;
                  const theirs = there.data?.viewing;
                  if (typeof mine?._hex !== "string" || mine._hex.length === 0) return false;
                  // the same answer, character for character — the law travelled with the records
                  if (mine._hex !== theirs?._hex) return false;
                }
                return true;
              } finally {
                await copy.close();
              }
            },
          },
        },
        {
          id: "15.2",
          label: "Ask the copy for what you forgot",
          have: "A second store, holding everything this one holds.",
          want: "Proof that everything does not include the words you removed.",
          how: "Press the button. The copy is asked for that night, and for the receipt.",
          run: async () => {},
          observe: {
            page: { selector: "#ground-rows", contains: "loam.erasure" },
            store: async (ctx) => {
              const text = buildExport(loam, ctx);
              // AT THE BYTES OF THE FILE, before anything opens it: the words are not in there.
              if (text.includes(PRIVATE_FRAGMENT)) return false;
              const copy = await openTheCopy(loam, ctx, text);
              try {
                const night = await copy.query(
                  `{ viewing(entity: "${MOVIE_NIGHT}") { note film } }`,
                );
                const notes = list(night.data?.viewing?.note);
                const receipts = copy
                  .offeredDeltas()
                  .filter(pointsAt(ERASURE_ENTITY, ERASURE_CONTEXT));
                return (
                  // the forgetting travelled...
                  !notes.includes(PRIVATE_LINE) &&
                  receipts.length >= 1 &&
                  // ...and so did the diary around it
                  notes.includes(MOVIE_NIGHT_NOTE) &&
                  night.data?.viewing?.film === "Paddington 2"
                );
              } finally {
                await copy.close();
              }
            },
          },
        },
        {
          id: "15.3",
          label: `Write the last line: "${LAST_LINE}"`,
          have: "Your whole diary, proven whole, in your hands and on your machine.",
          want: "One more line in it, because that is what a diary is for.",
          how: "Press the button. It lands the same way the very first one did, and you are done.",
          run: async (ctx) => {
            await ctx.gateway.append([field(loam, ctx, DIARY, "note", LAST_LINE)]);
          },
          observe: {
            page: { selector: "#ground-rows", contains: LAST_LINE },
            store: async (ctx) => anywhere(ctx, LAST_LINE),
          },
        },
      ],
      check: async (ctx) => anywhere(ctx, LAST_LINE) && !anywhere(ctx, PRIVATE_LINE),
    },
  ];
}
