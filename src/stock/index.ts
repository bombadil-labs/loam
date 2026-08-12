// THE STOCK SHELF — a handful of ordinary shapes, shipped, so day one is a command rather than an
// exercise in writing a rhizomatic gather Term by hand. A newcomer wants to store a note; without
// this they must first understand `group`/`select`/`mask`, pointer contexts, and Policy folds
// before a single fact lands.
//
// EACH ENTRY IS A `loam register` FILE, verbatim. Not a parsed object, not a privileged shortcut:
// the exact JSON a reader could have typed into `plant.json`, which `--stock` hands to the same
// `parseRegistrationInput` and the same `publishRegistration` a file takes. That is the whole
// design — a stock schema is a CONVENIENCE, never a second door. If one of these were malformed,
// the ordinary validator would say so in the ordinary voice.
//
// They are deliberately plain. Every one is `entityGatherJson()` — everything pointing at the
// root, bucketed by context — because that is the shape an ordinary entity wants, and a reader who
// outgrows it has README's "Schemas are data" waiting. No expands, no claim templates: the
// interesting choices belong to the reader who has a reason for them.
//
// A STOCK SHAPE IS UNGOVERNED IN BOTH DIRECTIONS, and both are worth naming rather than leaving to
// be discovered. Neither is a defect; together they are why the shelf is a starting point rather
// than a deployment.
//
//   • STRIKES. The negation posture is `drop`: every negation present binds, whoever signed it, so
//     a peer's strike can retract a field from a stock view.
//   • CLAIMS. `entityGatherJson()` is called with NO `authoredBy`, so the outer select admits every
//     author's claims too — not only their strikes. Every prop here is `pick byTimestamp desc`, so
//     a peer who signs `Note.title` at your entity with a later timestamp wins your view and keeps
//     winning it.
//
// A trust mask answers only the first half. The second wants `authoredBy` in the BODY (the select
// admits your operator alone) or `byAuthorRank` in the SCHEMA (a stranger cannot outrank you).
// Neither is computed here for a reason the whole feature rests on: a stock schema must be the
// registration a person could have typed, and every hand-authored registration in this tree —
// demos, fixtures, README — is this shape. Computing a different body behind `--stock` would make
// it a privileged path, which is the one thing it must not be. A federating store writes its own
// body; the CLI's help and README say so in the same words.
//
// `roots` is EMPTY on every entry, and that is correct rather than lazy. Roots are the entities a
// gateway holds live, and a shipped library cannot know yours; an entity outside the roots is
// materialized lazily on first read (§21.7), so a stock registration serves `note:groceries`
// without having been told about it. The ceiling is real and belongs here, because empty roots
// makes lazy materialization the DEFAULT posture of every store that starts from this shelf: one
// gateway holds at most MAX_LAZY_MATS = 1024 unregistered entities live (lifecycle.ts), and the
// 1025th read throws rather than growing the reactor without bound. A store meant to serve more
// names its roots — which is a deployment decision, made by re-registering your own file.

import { entityGatherJson } from "../gateway/gather.js";

/** One shelf entry: the `--stock` name, the line `--help` prints, and the registration itself. */
export interface StockSchema {
  /** The name `--stock` takes. Lowercase, one word — it is typed at a shell. */
  readonly name: string;
  /** One line, for the help text and the refusal that lists the shelf. */
  readonly summary: string;
  /**
   * The registration, in the at-rest JSON dialect — the same bytes a `loam register <file>` would
   * read. Typed as the substrate sees it (`unknown` fields, validated at the door) rather than as a
   * parsed `RegistrationInput`, so the stock path cannot skip the validation a file gets.
   */
  readonly registration: Readonly<Record<string, unknown>>;
}

const LATEST = () => ({ pick: { order: { byTimestamp: "desc" } } }); // one value: the last said
const EVERY = () => ({ all: { order: { byTimestamp: "asc" } } }); // a list, everything, in order

// FUNCTIONS rather than two shared constants, so no two props on a shelf entry are the SAME object.
// A shared literal would survive `structuredClone` as an alias — one clone, one object, reachable
// from every latest-valued prop and from `default` at once — and a future consumer that normalized
// a policy in place would rewrite all of them together. Cheap to allocate, one less thing to know.

// FROZEN THROUGH, not merely `readonly`. `readonly` is a compile-time promise the CLI's own
// `unknown`-typed registration path erases the moment it hands an entry to a validator; the freeze
// survives into the runtime, so no consumer — this repo's or an embedder's — can edit the shelf
// under a later caller's feet. It is why `--stock` clones before registering.
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

/** A plain-entity registration over `props`, with `writable` the fields a surface may claim. */
function plain(
  name: string,
  props: Readonly<Record<string, unknown>>,
  writable: readonly string[],
): Readonly<Record<string, unknown>> {
  return deepFreeze({
    hyperschema: { name, alg: 1, body: entityGatherJson() },
    schema: { name, alg: 1, props: { ...props }, default: LATEST() },
    roots: [] as string[],
    writable: [...writable],
  });
}

/**
 * The shelf, in the order `--help` prints it. Alphabetical by name: a list a reader scans wants an
 * order they can predict, and no entry is more important than another.
 */
export const STOCK_SCHEMAS: readonly StockSchema[] = deepFreeze<readonly StockSchema[]>([
  {
    name: "event",
    summary: "something happening — a title, when and where, and who is coming",
    registration: plain(
      "Event",
      {
        title: LATEST(),
        startsAt: LATEST(),
        endsAt: LATEST(),
        location: LATEST(),
        notes: LATEST(),
        attending: EVERY(),
      },
      ["title", "startsAt", "endsAt", "location", "notes", "attending"],
    ),
  },
  {
    name: "note",
    summary: "a captured thought — a title, a body, and tags",
    registration: plain("Note", { title: LATEST(), body: LATEST(), tags: EVERY() }, [
      "title",
      "body",
      "tags",
    ]),
  },
  {
    name: "person",
    summary: "somebody — a name, a bio, a way to reach them, and who they follow",
    registration: plain(
      "Person",
      { name: LATEST(), bio: LATEST(), email: LATEST(), follows: EVERY() },
      ["name", "bio", "email", "follows"],
    ),
  },
  {
    // NO `author` FIELD, deliberately. Every delta already carries a verified signer, and a claimed
    // `author` string resolved latest-wins would read as provenance while being an ordinary,
    // overwritable value — the one field on this shelf a newcomer would trust for the wrong reason.
    // A store that wants a display byline can add one knowingly; the shipped default does not offer
    // an identity claim the resolution cannot keep.
    name: "post",
    summary: "something published — a title, a body, when it went out, and tags",
    registration: plain(
      "Post",
      { title: LATEST(), body: LATEST(), publishedAt: LATEST(), tags: EVERY() },
      ["title", "body", "publishedAt", "tags"],
    ),
  },
]);

/** Every stock name, in shelf order — what the help text and a refusal both name. */
export const stockNames = (): readonly string[] => STOCK_SCHEMAS.map((s) => s.name);

/** The entry by name, or `undefined`. Exact match: a stock name is typed, not guessed at. */
export const stockSchema = (name: string): StockSchema | undefined =>
  STOCK_SCHEMAS.find((s) => s.name === name);
