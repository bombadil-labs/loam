// The tutorial's arc (SPEC §16), UI-free: eleven lessons as data and functions. The page and
// the headless test drive EXACTLY this module — `perform(ctx)` does what the lesson teaches,
// `check(ctx)` verifies it with a REAL READ of the learner's store (a query or a ground
// predicate), never a quiz answer and never UI state. Progress is the store: re-run every
// check from the ground on every boot and a green mark can never lie.
//
// The module takes the library as a parameter (`buildArc(loam)`): the page passes the shipped
// browser bundle, the test passes src/browser/index.ts — same functions, same commit, no skew.

// ---- the domain: the learner's media store ------------------------------------------------

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

export const FILM = "film:arrival";
export const ALICE = "person:alice";

// Film, as first registered (lesson 3). `tags` is deliberately absent — lesson 6 adds it.
// (`watches` entries resolve to the whole claim record — guest and date together — because
// a multi-pointer claim IS its record; `timesWatched` counts them.)
export const FILM_POLICY_V1 = {
  props: {
    title: PICK,
    rating: PICK,
    watches: ALL,
    timesWatched: { merge: "count" },
  },
  default: PICK,
};

// Lesson 6: evolution is append — the same registration, one more prop.
export const FILM_POLICY_V2 = {
  ...FILM_POLICY_V1,
  props: { ...FILM_POLICY_V1.props, tags: ALL },
};

// Lesson 7: the title's order becomes a trust chain — the learner's own word first, recency
// second. Built per-learner because the rank names THEIR author.
export const filmPolicyTrusted = (author) => ({
  ...FILM_POLICY_V2,
  props: {
    ...FILM_POLICY_V2.props,
    title: { pick: { order: { chain: [{ byAuthorRank: [author] }, { byTimestamp: "desc" }] } } },
  },
});

export const BOOK_POLICY = {
  props: {
    title: PICK,
    pagesRead: { merge: "sum" },
    finished: { absentAs: { const: false, then: PICK } },
  },
  default: PICK,
};

export const PERSON_POLICY = {
  props: { name: PICK, follows: ALL, watchedWith: ALL, note: ALL },
  default: PICK,
};

// ---- small delta grammar --------------------------------------------------------------------

const entity = (role, id, context) => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const prim = (v) => ({ role: "value", target: { kind: "primitive", value: v } });

// ---- boot: the learner's store --------------------------------------------------------------

export const SEED_KEY = "loam:tutorial:seed";

// First visit mints a seed and boots from genesis; every later visit reopens the same store
// from the same origin. The seed lives at its own key (SPEC §15) — it never rides an export
// of deltas by accident.
export async function bootTutorialStore(loam, storage) {
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

// ---- helpers the lessons share ----------------------------------------------------------------

const say = (loam, ctx, pointers) =>
  loam.signClaims({ timestamp: ctx.ts(), author: ctx.author, pointers }, ctx.seed);

const ground = (ctx) => ctx.gateway.offeredDeltas();

const has = (ctx, pred) => ground(ctx).some(pred);

const pointsAt = (id, context) => (d) =>
  d.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === id &&
      p.target.entity.context === context,
  );

async function view(ctx, query) {
  try {
    const res = await ctx.gateway.query(query);
    return res.data ?? {};
  } catch {
    return {}; // no surface yet — every view-based check is simply not-yet-green
  }
}

const registerFilm = (loam, ctx, policy) =>
  ctx.gateway.publishRegistration(
    { name: "Film", alg: 1, body: loam.parseTerm(GATHER) },
    loam.parsePolicy(policy),
    [FILM],
  );

// ---- the arc ---------------------------------------------------------------------------------

export function buildArc(loam) {
  return [
    {
      id: 1,
      title: "You are the operator",
      copy: `This page just made you a database. Not an account on someone's database — a whole
one, running here in this tab, persisted in this browser's localStorage. When it was born, a
cryptographic key was minted for you (look in the Ground pane: the very first record names its
operator — that's you). Nothing was sent anywhere. There is no server. Close the tab and come
back: the store reopens from where it slept, and re-proves everything you've done from its own
records. That key is the only authority this store will ever answer to, and it lives with you.`,
      // Boot already performed this; the check reads the constitution off the ground.
      perform: async () => {},
      check: async (ctx) =>
        ctx.storage.getItem(SEED_KEY) !== null &&
        has(
          ctx,
          (d) => d.claims.author === ctx.author && pointsAt("loam:store", "loam.operator")(d),
        ),
    },

    {
      id: 2,
      title: "A fact needs no permission slip",
      copy: `Say something true: you watched Arrival. Press the button (or, if you speak
JavaScript, open your browser's developer console — this page puts the store itself at
window.store, and everything the buttons do you can do by hand) and watch the Ground pane —
one new record. It has no table, no schema, no shape
anyone approved. It is a CLAIM: a timestamp, your authorship, and pointers — "film:arrival's
title is Arrival" — signed by your key and named by the hash of its own content. Try the
inspector's one-byte edit: change anything and the id shatters. That id IS the fact's identity;
a fact cannot be quietly rewritten, only newly said. Notice the View pane is still empty — the
store holds your fact but no lens has been ground to look at it. That's next.`,
      perform: async (ctx) => {
        await ctx.gateway.append([
          say(loam, ctx, [entity("subject", FILM, "title"), prim("Arrival")]),
        ]);
      },
      // Durable predicate only: the fact is in the ground, said by you. (The "no surface
      // yet" beat is real, but it is the MOMENT between lessons 2 and 3 — the arc test pins
      // it there; a revisit after lesson 3 must not un-green this lesson.)
      check: async (ctx) =>
        has(ctx, (d) => d.claims.author === ctx.author && pointsAt(FILM, "title")(d)),
    },

    {
      id: 3,
      title: "A schema is a lens, not a mold",
      copy: `Now register Film: which properties matter, and how disagreement resolves (for
title: "pick the latest word"). The instant it lands, look at the View pane — your orphaned
fact lit up as { title: "Arrival" }. Nothing migrated. No table was created and no row moved
into it. The schema is itself just more records in your store (check the Ground pane), and the
view is computed by READING: gather everything that points at the film, then resolve each
property by its declared policy. Data first, shape later — and the shape can always change its
mind, because it never owned the data to begin with. Register Book too while you're here;
we'll need it.`,
      perform: async (ctx) => {
        await registerFilm(loam, ctx, FILM_POLICY_V1);
        await ctx.gateway.publishRegistration(
          { name: "Book", alg: 1, body: loam.parseTerm(GATHER) },
          loam.parsePolicy(BOOK_POLICY),
          ["book:solaris"],
        );
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ film(entity: "${FILM}") { title } }`);
        return v.film?.title === "Arrival";
      },
    },

    {
      id: 4,
      title: "One claim, many filings",
      copy: `Log a watch: last night, with Alice. In a table-shaped world that's an insert
here, an update there, a join table somewhere else — three writes that can drift. Here it is
ONE claim with several pointers: it files into the film's watch history, bumps the film's
watch count, and will land on Alice's card the day she has one — atomically, because it is
one record and the "filings" are just the places a reader's lens will find it. Check the View:
timesWatched
became 1, and the watch entry itself carries its whole story — the date and the guest,
together, because the entry IS the claim. Alice, though, is still just an id —
"person:alice" — a name your store has heard but knows nothing about. Remember that; it
becomes interesting in lesson 9.`,
      perform: async (ctx) => {
        await ctx.gateway.append([
          say(loam, ctx, [
            entity("watch", FILM, "watches"),
            entity("watch", FILM, "timesWatched"),
            entity("guest", ALICE, "watchedWith"),
            prim(20260710),
          ]),
        ]);
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ film(entity: "${FILM}") { timesWatched watches } }`);
        const entry = Array.isArray(v.film?.watches)
          ? v.film.watches.find((w) => w?.guest === ALICE && w?.value === 20260710)
          : undefined;
        return v.film?.timesWatched >= 1 && entry !== undefined;
      },
    },

    {
      id: 5,
      title: "Taking it back — and what cannot be set",
      copy: `Rate the film a 9. Now change your mind — not to another number: take it back
entirely. You cannot delete the record (its id is a hash; the past is content-addressed), but
you can NEGATE your own word, and the view resolves your retraction to ABSENCE: the rating key
simply empties. Both records — the rating and the taking-back — sit in the Ground pane,
because a store that forgets what was retracted couldn't prove the retraction happened. Now
the book you registered: log two reading sessions, 120 pages and 90. pagesRead reads 210 —
not the latest entry, their SUM, because that property's policy is a sum. And "finished",
which you never said anything about, reads false rather than missing: its policy answers
absence with a default. Same store, three flavors of "what does silence mean" — a retracted
rating is absent, an unanswered question has a default, and an aggregate? Watch what happens
when you try to SET timesWatched to 100: the count ticks up by exactly one. Your "set" was
just one more claim, dutifully counted. An aggregate is an ANSWER, not a field — there is no
lever behind it to grab, only records to add or take back.`,
      perform: async (ctx) => {
        const rating = say(loam, ctx, [entity("subject", FILM, "rating"), prim(9)]);
        await ctx.gateway.append([rating]);
        await ctx.gateway.append([
          loam.signClaims(
            loam.makeNegationClaims(ctx.author, ctx.ts(), rating.id, "changed my mind"),
            ctx.seed,
          ),
        ]);
        // Two reading sessions: the sum is the answer, and `finished` is never spoken.
        await ctx.gateway.append([
          say(loam, ctx, [entity("subject", "book:solaris", "pagesRead"), prim(120)]),
          say(loam, ctx, [entity("subject", "book:solaris", "pagesRead"), prim(90)]),
        ]);
        // The set-that-isn't: one more claim in the counted bucket, and nothing else.
        await ctx.gateway.query(
          `mutation { film(entity: "${FILM}", timesWatched: 100) { timesWatched } }`,
        );
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ film(entity: "${FILM}") { rating timesWatched } }`);
        if (v.film?.rating != null) return false; // retraction resolves to absence (GraphQL: null)
        // the "set" did not take: the count counts records, it was never a settable number
        if (v.film?.timesWatched === 100 || !(v.film?.timesWatched >= 2)) return false;
        // the taking-back is itself on record, and PRECISELY: a negation by you, of YOUR
        // rating delta — not just any delta-pointing delta
        const rating = ground(ctx).find(
          (d) => d.claims.author === ctx.author && pointsAt(FILM, "rating")(d),
        );
        const retracted =
          rating !== undefined &&
          has(
            ctx,
            (d) =>
              d.claims.author === ctx.author &&
              d.claims.pointers.some(
                (p) => p.target.kind === "delta" && p.target.deltaRef.delta === rating.id,
              ),
          );
        // and the book: aggregates and defaults answer from the same ground
        const b = await view(ctx, `{ book(entity: "book:solaris") { pagesRead finished } }`);
        return retracted && b.book?.pagesRead === 210 && b.book?.finished === false;
      },
    },

    {
      id: 6,
      title: "Evolution is an append",
      copy: `Your store is live — the View pane is a SUBSCRIPTION, not a page you refresh. Now
add a property that didn't exist a minute ago: tags. Registering the schema again with one
more property is just another record landing in the store (evolution is an append, like
everything else), and the running subscription never disconnects — the view simply grows a
key. Tag the film "first-contact". No migration window, no version negotiation, no downtime:
the old facts answer the new question the moment it's asked.`,
      perform: async (ctx) => {
        await registerFilm(loam, ctx, FILM_POLICY_V2);
        await ctx.gateway.append([
          say(loam, ctx, [entity("subject", FILM, "tags"), prim("first-contact")]),
        ]);
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ film(entity: "${FILM}") { title tags } }`);
        return Array.isArray(v.film?.tags) && v.film.tags.includes("first-contact");
      },
    },

    {
      id: 7,
      title: "The adversary, and whose word wins",
      copy: `Time for trouble. We bundled a stranger's claim with this tutorial — press the
button and it arrives like any federated record would: "film:arrival's title is ARRIVAL 2:
TOTALLY REAL SEQUEL", signed with the stranger's own real key and stamped with a timestamp
from the far future. Watch it land in the Ground pane, authored by someone who is not you. Your title flips — because
your policy said "pick the latest word", and the stranger's word is latest. Here is the
important part: NOTHING was hacked. Anyone may write; the signature is honest; your READING
policy was simply naive. So change the reader, not the writer: re-register title to trust YOUR
word first, recency second. The title comes home to "Arrival" — while the forged claim still
sits in the ground, plainly visible, forever refusing to matter. Truth, here, is a policy you
choose and can always revisit.`,
      perform: async (ctx) => {
        await ctx.gateway.federate(ctx.packets.adversary.map((w) => loam.fromWire(w)));
        await registerFilm(loam, ctx, filmPolicyTrusted(ctx.author));
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ film(entity: "${FILM}") { title } }`);
        const forgedStillInGround = has(
          ctx,
          (d) => d.claims.author !== ctx.author && pointsAt(FILM, "title")(d),
        );
        return v.film?.title === "Arrival" && forgedStillInGround;
      },
    },

    {
      id: 8,
      title: "The right to be forgotten, honestly",
      copy: `You once filed a private note about Alice ("cried twice — don't tell her"). She
asks you to forget it. A retraction isn't enough — retraction resolves to absence but the
bytes remain. ERASURE is the loud exception to a store that otherwise never forgets: as the
operator you (and only you) order the record removed, the bytes physically leave this
browser's storage (watch the Ground pane shrink), and a signed TOMBSTONE remains — who asked,
when, which id — never what it said. The tombstone is also a standing order: if the erased
record's exact bytes ever try to come home — from a backup, from a peer who copied them — the
door refuses them by id. The store remembers THAT it forgot, and holds the door.`,
      perform: async (ctx) => {
        const note = say(loam, ctx, [
          entity("about", ALICE, "note"),
          prim("cried twice — don't tell her"),
        ]);
        await ctx.gateway.append([note]);
        await ctx.gateway.erase(note.id, { reason: "Alice asked" });
      },
      check: async (ctx) => {
        const noteGone = !has(
          ctx,
          (d) => pointsAt(ALICE, "note")(d) && d.claims.author === ctx.author,
        );
        const tombstones = loam.readTombstones(ctx.gateway.reactor, ctx.author);
        return noteGone && tombstones.size >= 1;
      },
    },

    {
      id: 9,
      title: "Alice was just an id",
      copy: `All this time your store has been saying "person:alice" the way you'd mention a
stranger by name — confidently, knowing nothing. Somewhere else there is a store that DOES
know her: the circle, kept by its own operator with its own key (we bundled it; it's a
complete store, exported). Pull it. The circle's records — names, friendships — flow into
your ground and Alice lights up: a name, friends, and there on her card, the watch you logged
in lesson 4. Now the fine print, which is the whole point: the circle's SCHEMAS arrived too,
and they do nothing. Foreign law is inert — its registrations reshape nothing here, because
they aren't signed by YOUR operator key. You registered your own Person lens; you decided
what to believe about the data. Data federates; authority never does.`,
      perform: async (ctx) => {
        await ctx.gateway.federate(ctx.packets.circle.map((w) => loam.fromWire(w)));
        await ctx.gateway.publishRegistration(
          { name: "Person", alg: 1, body: loam.parseTerm(GATHER) },
          loam.parsePolicy(PERSON_POLICY),
          [ALICE, "person:bob", "person:carol"],
        );
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ person(entity: "${ALICE}") { name follows watchedWith } }`);
        // "Arrived AND stayed inert" — both halves, or the claim is untested: the circle's
        // Friends registration delta IS in the ground (a foreign author's law arrived)...
        const foreignLawArrived = has(
          ctx,
          (d) =>
            d.claims.author !== ctx.author &&
            d.claims.pointers.some(
              (p) => p.target.kind === "entity" && p.target.entity.id === "schema:Friends",
            ),
        );
        // ...and it binds nothing: the lawful registrations under YOUR operator don't know it.
        const foreignLawInert = !loam
          .readRegistrations(ctx.gateway.reactor, ctx.author)
          .some((r) => r.schema.name === "Friends");
        return (
          v.person?.name === "Alice Song" &&
          Array.isArray(v.person?.watchedWith) &&
          v.person.watchedWith.length >= 1 &&
          foreignLawArrived &&
          foreignLawInert
        );
      },
    },

    {
      id: 10,
      title: "The stranger at the window",
      copy: `Everything so far went through YOUR door, signed or refused by standing. But a
reader with no key at all — a stranger, a search engine, a friend you sent a link — has been
knocking this whole time and getting the same answer: nothing here is public. Declare ONE lens
public — Film — with a single signed record (openness is data too, in the ground like
everything else). The stranger instantly reads your films... and only that. Ask for Person as
the stranger and the window shows nothing: not "forbidden", just a world in which Person does
not exist. The public surface is a smaller world, not a guarded copy of the big one.`,
      perform: async (ctx) => {
        await ctx.gateway.append([
          loam.signClaims(loam.publicClaims(["Film"], ctx.author, ctx.ts()), ctx.seed),
        ]);
      },
      check: async (ctx) => {
        try {
          const open = await ctx.gateway.queryPublic(`{ film(entity: "${FILM}") { title } }`);
          if (open.data?.film?.title !== "Arrival") return false;
          const window = await ctx.gateway.queryPublic(`{ person(entity: "${ALICE}") { name } }`);
          return Array.isArray(window.errors) && window.errors.length > 0; // a smaller world
        } catch {
          return false; // NothingPublic — the window is still dark
        }
      },
    },

    {
      id: 11,
      title: "The same store, now on your machine",
      copy: `The store in this tab is real, but a browser is a small home: it cannot listen for
peers, and "clear site data" is an extinction event. So walk it out. Export writes one file —
your deltas, ids and signatures intact, plus (for this tutorial only) your operator seed;
real data keeps its seed in your own custody, always. Then, in a terminal:

    npm i -g @bombadil/loam
    loam init --seed <the seed from the file>
    loam pull <the file>
    loam serve --http --token anything

Ask the served store the same question this page asks, and compare the _hex — the content
address of the whole answer. It matches, hash for hash. Not a copy of your store, not an
import that resembles it: THE SAME STORE, proven by content address — because your laptop's
genesis, born from the same seed, is byte-for-byte the delta this tab was born from. Nothing
was re-signed. Nothing was lost. It is yours, durable, and ready to federate.`,
      perform: async () => {}, // the export is read-only; buildExport below is the action
      // The finale's green is EARNED OUTSIDE THE TAB: when the page fetches your localhost
      // store and the _hex matches, it records the homecoming as one more signed claim —
      // and this check reads that record from the ground, like every other check. (Appending
      // it by hand in the console is the curriculum entered by a side door; congratulations.)
      check: async (ctx) =>
        has(
          ctx,
          (d) => d.claims.author === ctx.author && pointsAt("tutorial:journey", "homecoming")(d),
        ),
    },
  ];
}

// The finale's file: a frozen federation offer plus the identity that makes it THE SAME
// store on arrival. The seed rides ON PURPOSE — disposable tutorial data (SPEC §16); the
// page says so in the copy above.
export function buildExport(loam, ctx) {
  const offer = JSON.parse(loam.exportOffer(ctx.gateway));
  return JSON.stringify({
    version: 1,
    operator: ctx.author,
    seed: ctx.seed,
    deltas: offer.deltas,
  });
}

// The page calls this after the localhost fetch matches _hex for _hex: the homecoming becomes
// one more signed claim in the learner's store, and lesson 11's check reads it back — because
// progress is the store, all the way to the end.
export async function recordHomecoming(loam, ctx, matchedHex) {
  await ctx.gateway.append([
    say(loam, ctx, [
      entity("milestone", "tutorial:journey", "homecoming"),
      prim(String(matchedHex)),
    ]),
  ]);
}
