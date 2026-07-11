// The tutorial's arc (SPEC §19), UI-free: the lessons as data and functions. The page and the
// headless test drive EXACTLY this module — `perform(ctx)` does what the lesson teaches,
// `check(ctx)` verifies it with a REAL READ of the learner's store (a query or a ground
// predicate), never a quiz answer and never UI state. Progress is the store: re-run every
// check from the ground on every boot and a green mark can never lie.
//
// §19's acceptance bars, normative: every check is EARNED (false before its lesson runs),
// DURABLE (monotone in the ground — a later lesson can never un-green an earlier one), and
// SIDE-EFFECT-FREE (safe to re-verify on every boot). The lesson TEACHES by need: you open
// wanting to track your films, and the doctrine beats — data-first, a schema is a lens —
// arrive as earned reveals at the moment only that truth explains what you see.
//
// The module takes the library as a parameter (`buildArc(loam)`): the page passes the shipped
// browser bundle, the test passes src/browser/index.ts — same functions, same commit, no skew.

// ---- the domain: the learner's film log ----------------------------------------------------

const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
// Film-with-screenings (lesson 4): the gather, then EXPAND the `screening` role's targets
// through the Screening lens — so a film's view nests its screenings, each a little view.
const FILM_EXPAND_BODY = {
  op: "expand",
  role: { exact: "screening" },
  schema: "Screening",
  in: GATHER,
};
const PICK = { pick: { order: { byTimestamp: "desc" } } };
const ALL = { all: { order: { byTimestamp: "asc" } } };

export const FILM = "film:arrival";
export const ALICE = "person:alice";
const SCREENING_1 = "screening:1";
const SCREENING_2 = "screening:2";

// Film, first registered (lesson 2). tags is an `all` list; rating and title are `pick` latest.
const FILM_POLICY_V1 = { props: { title: PICK, rating: PICK, tags: ALL }, default: PICK };
// Lesson 4: the body becomes an expand and the policy gains `screenings`.
const FILM_POLICY_V2 = { props: { ...FILM_POLICY_V1.props, screenings: ALL }, default: PICK };
// Lesson 6: `guests` joins — a top-level field, so the evolution is visible and a subscription
// opened against the pre-guests shape can never grow it.
const FILM_POLICY_V3 = { props: { ...FILM_POLICY_V2.props, guests: ALL }, default: PICK };
// Lesson 8: the title's order becomes a trust chain — the learner's word first, recency second.
const filmPolicyTrusted = (author) => ({
  ...FILM_POLICY_V3,
  props: {
    ...FILM_POLICY_V3.props,
    title: { pick: { order: { chain: [{ byAuthorRank: [author] }, { byTimestamp: "desc" }] } } },
  },
});
const SCREENING_POLICY = { props: { date: PICK }, default: PICK };
const BOOK_POLICY = {
  props: {
    title: PICK,
    pagesRead: { merge: "sum" },
    finished: { absentAs: { const: false, then: PICK } },
  },
  default: PICK,
};
const PERSON_POLICY = { props: { name: PICK, friends: ALL, guestAt: ALL }, default: PICK };

// ---- small delta grammar --------------------------------------------------------------------

const entity = (role, id, context) => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const prim = (v) => ({ role: "value", target: { kind: "primitive", value: v } });

// ---- boot: the learner's store --------------------------------------------------------------

export const SEED_KEY = "loam:tutorial:seed";

// First visit mints a seed and boots from genesis; every later visit reopens the same store
// from the same origin. The seed lives at its own key (SPEC §15) — it never rides an export.
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

const say = (loam, ctx, pointers, seed) =>
  loam.signClaims(
    { timestamp: ctx.ts(), author: seed ? loam.authorForSeed(seed) : ctx.author, pointers },
    seed ?? ctx.seed,
  );

const ground = (ctx) => ctx.gateway.offeredDeltas();
const has = (ctx, pred) => ground(ctx).some(pred);

const pointsAt = (id, context) => (d) =>
  d.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === id &&
      p.target.entity.context === context,
  );
// A value claim by an author: a pointer at <id>#<context> plus a primitive value.
const valueAt = (id, context, value) => (d) =>
  d.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === id &&
      p.target.entity.context === context,
  ) && d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === value);

async function view(ctx, query) {
  try {
    const res = await ctx.gateway.query(query);
    return res.errors === undefined ? (res.data ?? {}) : { __errors: res.errors };
  } catch {
    return {}; // no surface yet — every view-based check is simply not-yet-green
  }
}

const registerFilm = (loam, ctx, policy, body = GATHER) =>
  ctx.gateway.publishRegistration(
    { name: "Film", alg: 1, body: loam.parseTerm(body) },
    loam.parsePolicy(policy),
    [FILM],
  );

// ---- the arc ---------------------------------------------------------------------------------

export function buildArc(loam) {
  return [
    // ============================ ACT I — a store of your own ============================
    {
      id: 1,
      title: "You are the operator",
      copy: `This page just made you a database — a whole one, running in this tab, persisted in
this browser and answerable to nobody but you. When it was born it minted you a cryptographic
key; look in the Ground pane, at the record badged "constitution" — that record names your key
as this store's operator, and it is the only authority this store will ever bow to. Nothing was
sent anywhere. There is no server. Everything you do from here lands as a signed record in that
same ground, and the store re-proves it all from those records every time it wakes.`,
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
      title: "Track your films",
      copy: `Say you want to track the films you watch. You tell the store the SHAPE of a film —
a title, a rating, some tags — and how to settle disagreement (for the title: keep the latest
word). That's a schema and a policy, and registering them is the whole setup. The moment it
lands, two things happen on the right: the GraphQL pane comes alive (open it and type "film {"
— it now offers you the fields you just declared), and the Schemas view gains a Film entry.
You never described a film to anybody; you described a LENS, and the store will answer through
it. Register Book too — we'll want it later.`,
      perform: async (ctx) => {
        await registerFilm(loam, ctx, FILM_POLICY_V1);
        await ctx.gateway.publishRegistration(
          { name: "Book", alg: 1, body: loam.parseTerm(GATHER) },
          loam.parsePolicy(BOOK_POLICY),
          ["book:solaris"],
        );
      },
      check: async (ctx) =>
        ctx.gateway.registrationVersions().some((v) => v.schema.name === "Film") &&
        (await view(ctx, `{ film(entity: "${FILM}") { title } }`)).__errors === undefined,
    },

    {
      id: 3,
      title: "Write through the door",
      copy: `Now fill it in: set the title to "Arrival", give it a 9, add a tag. These go through
the GraphQL door — a mutation — and here is the thing worth slowing down for. Watch all three
panes at once. The View updates. The Ground grows a new record, badged "fact". And that record
is a signed CLAIM — the mutation didn't change a cell in a table, it COMPILED to a claim and
signed it with your key. The claim is what's real; the mutation was just a convenient way to
say it. (Expand the new Ground record to see exactly what got signed.)`,
      perform: async (ctx) => {
        await ctx.gateway.query(`mutation { film(entity: "${FILM}", title: "Arrival") { title } }`);
        await ctx.gateway.query(`mutation { film(entity: "${FILM}", rating: 9) { rating } }`);
        await ctx.gateway.query(
          `mutation { film(entity: "${FILM}", tags: "first-contact") { tags } }`,
        );
      },
      // Durable: the door-written facts are in the ground forever (later lessons retract the
      // rating and contest the title, but the ORIGINAL claims never leave the ground).
      check: async (ctx) =>
        has(ctx, (d) => d.claims.author === ctx.author && valueAt(FILM, "title", "Arrival")(d)) &&
        has(ctx, (d) => d.claims.author === ctx.author && valueAt(FILM, "rating", 9)(d)),
    },

    {
      id: 4,
      title: "Screenings are entities too",
      copy: `A film isn't just a title — it has screenings, and a screening is a thing in its own
right: a date, later some guests. So give it its own lens (Screening), and teach Film to gather
its screenings and show each one nested inside the film's view. That "show the nested thing" is
a new move — an EXPAND — and Film's shape changes to use it, live, with no migration. Log last
night's screening. Look at the Film view now: its screenings list holds a little Screening view,
date and all. Two lenses, one film, composing.`,
      perform: async (ctx) => {
        await ctx.gateway.publishRegistration(
          { name: "Screening", alg: 1, body: loam.parseTerm(GATHER) },
          loam.parsePolicy(SCREENING_POLICY),
          [SCREENING_1, SCREENING_2],
        );
        await registerFilm(loam, ctx, FILM_POLICY_V2, FILM_EXPAND_BODY);
        // The screening: it files at the film (so the film gathers it) and names screening:1
        // via the `screening` role (so the expand resolves it), and dates the screening itself.
        await ctx.gateway.append([
          say(loam, ctx, [
            entity("subject", FILM, "screenings"),
            entity("screening", SCREENING_1, "film"),
          ]),
          say(loam, ctx, [entity("subject", SCREENING_1, "date"), prim(20260710)]),
        ]);
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ film(entity: "${FILM}") { screenings } }`);
        return Array.isArray(v.film?.screenings) && v.film.screenings.length >= 1;
      },
    },

    // ============================ ACT II — the ground truth ============================
    {
      id: 5,
      title: "The secret: it was claims all along",
      copy: `Here's what those mutations were hiding. You never needed the door. Write the next
screening BY HAND — a raw signed claim, straight to the ground (the ✍️ pen, not the 🚪 door) —
and make it say something no schema of yours knows how to hear: that Alice was your guest. The
claim lands; it's real; the Ground shows it. But look at the Film view: Alice isn't there. A
lens can only show what it was told to gather, and yours was never told about guests. The fact
is in the world; your lens is just looking the other way. (Try the inspector: change one byte
of any record and its id shatters — the id IS the content, so nothing can be quietly rewritten,
only newly said.)`,
      perform: async (ctx) => {
        await ctx.gateway.append([
          // the screening itself (nested via the film's expand)
          say(loam, ctx, [
            entity("subject", FILM, "screenings"),
            entity("screening", SCREENING_2, "film"),
          ]),
          say(loam, ctx, [entity("subject", SCREENING_2, "date"), prim(20260711)]),
          // and a SEPARATE claim naming Alice a guest of the film: its root pointer files the
          // film under `guests` (so a `guests` lens would gather it) and names Alice as the
          // entry. No lens gathers `guests` yet, so she is real but unseen.
          say(loam, ctx, [entity("subject", FILM, "guests"), entity("guest", ALICE, "at")]),
        ]);
      },
      // Durable: the pen-written guest claim naming Alice is in the ground forever. (That the
      // OLD lens drops her is the between-lessons truth the arc test pins; it stops being true
      // the moment lesson 6 evolves the lens, so it cannot be a durable check here.)
      check: async (ctx) =>
        has(
          ctx,
          (d) =>
            d.claims.author === ctx.author &&
            pointsAt(FILM, "guests")(d) &&
            pointsAt(ALICE, "at")(d),
        ),
    },

    {
      id: 6,
      title: "Evolve the lens, keep every past",
      copy: `So teach the lens to see guests. Add a "guests" field to Film and re-register — an
append, like everything else. Ask again and there's Alice. But notice what did NOT happen: any
view you were already subscribed to kept its old shape. A subscription is a standing question
against the lens as it was when you asked; it can't sprout a field you never selected. Nothing
you were watching broke — you just ask anew to see more. And to prove nothing was overwritten,
re-register the OLD policy under a new name, FilmClassic: now two lenses answer the same ground
side by side, the new one showing Alice, the old one never having heard of her. The past isn't
migrated away. It's still right there, still answerable.`,
      perform: async (ctx) => {
        await registerFilm(loam, ctx, FILM_POLICY_V3, FILM_EXPAND_BODY);
        await ctx.gateway.publishRegistration(
          { name: "FilmClassic", alg: 1, body: loam.parseTerm(FILM_EXPAND_BODY) },
          loam.parsePolicy(FILM_POLICY_V2),
          [FILM],
        );
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ film(entity: "${FILM}") { guests } }`);
        const hasAlice = Array.isArray(v.film?.guests) && v.film.guests.includes(ALICE);
        const classic = ctx.gateway
          .registrationVersions()
          .some((r) => r.schema.name === "FilmClassic");
        return hasAlice && classic;
      },
    },

    {
      id: 7,
      title: "Taking it back, and what silence means",
      copy: `Change your mind about that 9. You can't unsay a record — its id is a hash, the past
is fixed — but you can NEGATE your own word, and the view resolves your retraction to absence:
the rating key just empties. Both records stay in the Ground, because a store that forgot what
was retracted couldn't prove the retraction happened. Now the book. Log two reading sessions,
120 pages and 90: pagesRead reads 210 — their SUM, because that field's policy sums. And
"finished", which you never set, reads false rather than missing, because its policy answers
silence with a default. Three flavors of silence — a retracted value is absent, an unasked
question has a default, and an aggregate is an ANSWER, not a settable field: try to set
timesRead and watch the number ignore you, because there's nothing behind it to grab, only
records to add or take back.`,
      perform: async (ctx) => {
        // Retract the rating written in lesson 3 by negating THAT record (a negation names an
        // id; a fresh identical rating would be a different id). It may already be retracted on
        // a re-run — negation is idempotent by content address, so this is safe to repeat.
        const first = ground(ctx).find(
          (d) => d.claims.author === ctx.author && valueAt(FILM, "rating", 9)(d),
        );
        if (first !== undefined) {
          await ctx.gateway.append([
            loam.signClaims(
              loam.makeNegationClaims(ctx.author, ctx.ts(), first.id, "changed my mind"),
              ctx.seed,
            ),
          ]);
        }
        await ctx.gateway.append([
          say(loam, ctx, [entity("subject", "book:solaris", "pagesRead"), prim(120)]),
          say(loam, ctx, [entity("subject", "book:solaris", "pagesRead"), prim(90)]),
        ]);
      },
      check: async (ctx) => {
        // the retraction is on record: a negation by the learner of a rating fact
        const retracted = has(
          ctx,
          (d) =>
            d.claims.author === ctx.author &&
            d.claims.pointers.some((p) => p.target.kind === "delta"),
        );
        const b = await view(ctx, `{ book(entity: "book:solaris") { pagesRead finished } }`);
        return retracted && b.book?.pagesRead === 210 && b.book?.finished === false;
      },
    },

    // ============================ ACT III — other people ============================
    {
      id: 8,
      title: "The adversary, and whose word wins",
      copy: `A stranger's claim just arrived — we bundled one so you can meet it. Press the
button and watch it land in the Ground, authored by someone who is NOT you: "the title of
Arrival is ARRIVAL 2: TOTALLY REAL SEQUEL", signed with the stranger's own real key, stamped
far in the future. Let it in and your title flips — because your policy said "keep the latest
word", and the stranger's word is latest. Nothing was hacked; anyone may write, and your READER
was simply naive. So change the reader, not the writer: re-register the title to trust YOUR word
first, recency second. Home it comes. And if you'd rather SEE the disagreement than settle it,
a second lens with a "conflicts" policy shows both claims at once — the forgery preserved,
visible, and powerless. Truth here is a policy you choose, and can always revisit.`,
      perform: async (ctx) => {
        await ctx.gateway.federate(ctx.packets.adversary.map((w) => loam.fromWire(w)));
        await registerFilm(loam, ctx, filmPolicyTrusted(ctx.author), FILM_EXPAND_BODY);
        await ctx.gateway.publishRegistration(
          { name: "FilmDispute", alg: 1, body: loam.parseTerm(GATHER) },
          loam.parsePolicy({
            props: { title: { conflicts: { order: { byTimestamp: "desc" } } } },
            default: PICK,
          }),
          [FILM],
        );
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ film(entity: "${FILM}") { title } }`);
        const dispute = await view(ctx, `{ filmDispute(entity: "${FILM}") { title } }`);
        const forgedInGround = has(
          ctx,
          (d) => d.claims.author !== ctx.author && pointsAt(FILM, "title")(d),
        );
        const disputed =
          Array.isArray(dispute.filmDispute?.title) && dispute.filmDispute.title.length >= 2;
        return v.film?.title === "Arrival" && forgedInGround && disputed;
      },
    },

    {
      id: 9,
      title: "The right to be forgotten, honestly",
      copy: `You once jotted a private note about Alice, straight to the ground. She asks you to
forget it. A retraction won't do — that resolves to absence but the bytes remain. ERASURE is
the loud exception to a store that otherwise never forgets: as the operator, you (and only you)
order the record removed, the bytes physically leave this browser's storage — watch the Ground
shrink — and a signed TOMBSTONE stays behind: who asked, when, which id, never what it said. The
tombstone is also a standing order: if those exact bytes ever try to come home, from a backup or
a peer who copied them, the door refuses them by id. The store remembers THAT it forgot, and
holds the door.`,
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
          (d) => d.claims.author === ctx.author && pointsAt(ALICE, "note")(d),
        );
        const tombstones = loam.readTombstones(ctx.gateway.reactor, ctx.author);
        return noteGone && tombstones.size >= 1;
      },
    },

    // ============================ ACT IV — the wider world ============================
    {
      id: 10,
      title: "Alice was just an id",
      copy: `All this time your store has said "person:alice" the way you'd name a stranger —
confidently, knowing nothing. Somewhere there's a store that DOES know her: the circle, kept by
its own operator with its own key. We bundled its whole export. Pull it. Names and friendships
flow into your ground and Alice lights up — a name, some friends, and there on her card, the
screening you logged with her. Now the fine print, which is the entire point: the circle's own
SCHEMAS arrived too, and they do nothing here. Foreign law is inert — its registrations reshape
nothing, because they aren't signed by YOUR key. You register your own Person lens; you decide
what to believe. Data federates; authority never does.`,
      perform: async (ctx) => {
        await ctx.gateway.federate(ctx.packets.circle.map((w) => loam.fromWire(w)));
        await ctx.gateway.publishRegistration(
          { name: "Person", alg: 1, body: loam.parseTerm(GATHER) },
          loam.parsePolicy(PERSON_POLICY),
          [ALICE, "person:bob", "person:carol"],
        );
      },
      check: async (ctx) => {
        const v = await view(ctx, `{ person(entity: "${ALICE}") { name } }`);
        const foreignArrived = has(
          ctx,
          (d) =>
            d.claims.author !== ctx.author &&
            d.claims.pointers.some(
              (p) => p.target.kind === "entity" && p.target.entity.id === "schema:Friends",
            ),
        );
        const foreignInert = !loam
          .readRegistrations(ctx.gateway.reactor, ctx.author)
          .some((r) => r.schema.name === "Friends");
        return v.person?.name === "Alice Song" && foreignArrived && foreignInert;
      },
    },

    // ============================ ACT V — the door out ============================
    {
      id: 11,
      title: "The stranger at the window",
      copy: `Everything so far went through YOUR door, signed or refused by standing. But a reader
with no key at all — a stranger, a search engine, a friend you sent a link — has been knocking
this whole time and getting the same answer: nothing here is public. Declare ONE lens public —
Film — with a single signed record (openness is data too). The stranger instantly reads your
films, and only that. Toggle "ask as the stranger" in the GraphQL pane: the hints shrink to the
smaller world you declared. Ask for Person as the stranger and the window shows nothing — not
"forbidden", just a world in which Person does not exist. The public surface is a smaller world,
not a guarded copy of the big one.`,
      perform: async (ctx) => {
        await ctx.gateway.append([
          loam.signClaims(loam.publicClaims(["Film"], ctx.author, ctx.ts()), ctx.seed),
        ]);
      },
      check: async (ctx) => {
        try {
          const open = await ctx.gateway.queryPublic(`{ film(entity: "${FILM}") { title } }`);
          if (open.data?.film?.title !== "Arrival") return false;
          const shut = await ctx.gateway.queryPublic(`{ person(entity: "${ALICE}") { name } }`);
          return Array.isArray(shut.errors) && shut.errors.length > 0;
        } catch {
          return false;
        }
      },
    },

    {
      id: 12,
      title: "The same store, now on your machine",
      copy: `This store is real, but a browser is a small home: it can't listen for peers, and
"clear site data" is an extinction event. So walk it out. Export writes one file — your records,
ids and signatures intact, plus (for this tutorial only) your operator seed; real data keeps its
seed in your own custody, always. Then, in a terminal:

    npm i -g @bombadil/loam
    loam init --seed <the seed from the file>
    loam pull <the file>
    loam serve --http --token anything

Ask the served store the same question this page asks and compare the _hex — the content address
of the whole answer. It matches, hash for hash. Not a copy that resembles your store: THE SAME
STORE, proven by content address, because your laptop's genesis, born from the same seed, is
byte-for-byte the record this tab was born from. Nothing re-signed, nothing lost. It is yours,
durable, and ready to federate.`,
      perform: async () => {},
      check: async (ctx) =>
        has(
          ctx,
          (d) => d.claims.author === ctx.author && pointsAt("tutorial:journey", "homecoming")(d),
        ),
    },
  ];
}

// The finale's file: a frozen federation offer plus the identity that makes it THE SAME store on
// arrival. The seed rides ON PURPOSE — disposable tutorial data (SPEC §16); the copy says so.
export function buildExport(loam, ctx) {
  const offer = JSON.parse(loam.exportOffer(ctx.gateway));
  return JSON.stringify({ version: 1, operator: ctx.author, seed: ctx.seed, deltas: offer.deltas });
}

// The page calls this after the localhost fetch matches _hex for _hex: the homecoming becomes
// one more signed claim, and lesson 12's check reads it back — progress is the store, all the
// way to the end.
export async function recordHomecoming(loam, ctx, matchedHex) {
  await ctx.gateway.append([
    say(loam, ctx, [
      entity("milestone", "tutorial:journey", "homecoming"),
      prim(String(matchedHex)),
    ]),
  ]);
}
