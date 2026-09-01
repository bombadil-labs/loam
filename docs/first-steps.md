# First Steps

You just connected Claude to a database that is yours. Not an account on someone's server — a
store on your machine, holding signed facts, that an AI can read and write through the connector
you just added. This page is the answer to the honest first question: *okay, but what do I do
with it?*

## What this actually is

Three properties make Loam different from a notes app, and everything below grows from them:

- **Every fact remembers who said it and when.** A write is a signed delta — yours, Claude's, a
  friend's store, a script's — and the signature travels with the fact forever. When two sources
  disagree, the store holds both and the *reading* decides; nothing is silently overwritten.
- **The store only ever learns.** Updating a field supersedes the old value; it never destroys
  it. Retracting a claim is itself a claim. Your data has a history because history is the
  storage format, not a backup of it.
- **Shapes are grown, not imposed.** There is no fixed set of tables. When you need a new kind
  of thing, the agent registers a schema for it mid-conversation and the store's surface grows a
  new type on the spot — no migration, no restart.

## Ways to use it

Each of these works today, in a conversation, with nothing but the connector. Paste the prompt
and go.

**A memory that outlives the chat.** Chats end; the store does not. Anything worth keeping
becomes a note with tags, and any later conversation can pick the thread back up.

> "Save a note in my Loam store: I decided to use tailscale funnel instead of a reverse proxy,
> because there is nothing to configure and TLS is included. Tag it `infra` and `decisions`."

Weeks later, in a fresh chat: *"check my Loam notes tagged `decisions` — what did I decide about
hosting?"* The answer comes back with when you said it.

**Your people, as a graph.** The stock shelf ships `person` and `org`, and references between
them are typed edges — not strings that happen to contain a name.

> "In my Loam store, create person:ada with name Ada, and person:me follows her. Add org:garden
> with me and Ada as members."

Then ask *"who do I follow?"* or *"who is in the garden org, by name?"* — the graph answers,
shallow-read so an org lists its people without dragging in their whole worlds.

**A log of anything.** Books read, films watched, birds seen, wines tried. This is where the
grown-not-imposed part gets fun: there is no "media log" feature, and you do not need one.

> "Register a schema in my Loam store for a reading log: a `readinglog:entry` has a title, an
> author, a rating, and a body for my thoughts. Then log the book I just described to you."

The agent reads the store's own registration manual (`loam_docs`), defines the shape, and starts
writing entries — as itself, with its signature on every one. Your log, its clerk.

**An interviewer that files as it goes.** Flip the direction: instead of you dictating records,
have Claude ask.

> "Interview me about the people at the dinner party I just mentioned, and file each one as a
> person in my Loam store with a bio line and who they know."

**Two humans, two stores.** Loam stores federate: yours and a friend's can each subscribe to a
slice of the other, and the deltas keep their signatures as they travel — you always know which
claims are yours and which arrived. Both sides need a served, reachable store (the quick-start's
funnel movement); then the `loam_federate_*` tools open and manage the channel from chat. Start a
shared log — two readers, two writers, one growing record, and neither of you can overwrite the
other.

**Scripts and bots as citizens, not gods.** When something non-interactive should write — a cron
job, a home automation hook, another agent — do not hand it your operator token. On the store's
machine:

```bash
loam client mint watcher --register-prefix "watch:"
```

One command mints it a key of its own and prints a bearer once. Everything it writes names its
own author, so you can always read *the watcher said this* apart from *I said this* — and one
`loam client revoke watcher` retires it without touching anything it wrote.

## Two things worth knowing early

**An empty answer is not always an empty store.** Reads are masked for callers the store does not
recognize, and a masked read looks exactly like no data. If a view comes back suspiciously empty,
ask Claude to call `loam_whoami` — it answers who the store thinks the caller is and what
standing they hold. It is the difference between "there is nothing here" and "you are not signed
in," and those deserve different reactions.

**The store has a face.** Sign in at `/admin` in a browser (your store's URL, the user from
init) for the operator's view: every container, its census, its schemas, its channels. Reading
what the AI has been filing is half the fun.

## Going deeper

- `loam_docs()` — the store lists everything it can teach; `loam_docs(topic: "register-grammar")`
  is the full schema-definition manual the agent reads before growing a shape.
- The [interactive tutorial](https://bombadil-labs.github.io/loam/tutorial.html) — a real store
  in your browser, sixteen lessons, no install.
- [The quick-start](quick-start.md) — the four movements that got you here, for the next machine
  or the next friend.
