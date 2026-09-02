# First Steps

Everything in your store is a signed statement that never changes. Everything else — what is
true, whose word counts, what shape the data has, even what "delete" means — is a **reading** of
that pile, and readings are yours to hold and to change. That one decision is why two stores can
meet with no referee, and why the ground never forgets who signed what.

You just connected Claude to one of these. This page is the answer to the honest first question:
*okay, but what is actually different here, and what do I do with it?*

## First, one command: give Claude room to grow shapes

Out of the box, a connected Claude can read and write the stock shapes — `person`, `org`,
`event`, `note`, `post` — and nothing else. Defining a *new* shape is constitutional: it needs a
grant, and consent gives a connection only a place to live — one container under your name, where
its writes land and its reads resolve. So, once, on the store's machine:

```bash
loam grant list
loam grant <client_id> --verb=register --prefix=mine:
```

The first names your connectors and their ids; the second lets that one define shapes whose
names start with `mine:` — its own namespace, and nothing else. Then restart `loam serve`: a
running server honors a grant only after a restart. From here on, every shape Claude defines is
called `mine:something`, and it answers at the field `mine_something`.

## Three things to feel, alone

**One pile, two readings.** Ask Claude to keep a reading log — a title, an author, a rating, your
thoughts. Rate a book, then change your mind and rate it again. Now, in the same conversation,
while Claude still has the shape in front of it:

> "Register a second reading of the log, named `mine:logFirst`, that keeps the *first* rating I
> ever gave instead of the latest — and show me that book through both."

`mine_log` and `mine_logFirst` disagree, and both are right by their own declared law, from the
same facts, with nothing copied. This is the whole idea in one move: the store holds every claim;
a reading decides what they add up to. Two apps can read one store differently on purpose.

**Ask about last Tuesday.** Every fact and every retraction carries its time, and nothing is
edited, so the past is a filter over the present. Reading one entry, Claude can pass `asOf` — a
millisecond timestamp — and ask for the `_asOf` and `_forgotten` fields beside it:

> "Show me that book's entry as it stood yesterday at noon."

The answer is the entry as it was; a change you made later does not yet apply. If the store has
lawfully erased anything in that window, `_forgotten` says so, and when — never what.

**Who said that?** Claude holds its own signing key. When it files a note, the ground records
that *Claude's connection* said it, not you, and the signature travels with the fact forever. And
it lands in the connection's own **inbox** inside the container you chose at consent — never in
your primary ground, and never anywhere you did not name. Disconnect it and every line stays,
still signed as its. Today you read those signatures on the admin page and in the store's own
ledger (`loam grant list`); teaching the read surface to answer "who said this" from chat is
queued work.

## Two stores, one ground

This is where the shape of the thing shows. A friend runs a store of their own. She hands you the
token she serves with — federating wants the peer's own token today — and on your machine:

```bash
loam federate open --from https://<her-machine>.<tailnet>.ts.net/default \
  --into friends --prefix alice --token <her-serve-token>
```

Then restart `loam serve`; a serving store polls its channels every minute from the next boot.
Three things happen, and each is yours:

- Her facts land in a sealed **pool** inside your `friends` container. Not your primary ground —
  her bytes stay her bytes, and every one still proves who signed it.
- Her **types arrive too.** If Alice defined a `Note`, `alice_Note` is now a field on your own
  API and MCP surface, serving her notes exactly as she defined them. She adds one an hour later
  and it is there, still signed by her.
- **The name is yours.** You called the channel `alice`; she never chose it. If you both used the
  stock `note` shape, yours keeps its name and hers serves beside it under the prefix you
  assigned. A peer can never take a name your store already answers.

And it stays reversible until the one act that is not. The channel is `channel:friends:alice`:
`--receiving false` freezes it and keeps everything that arrived; `--bless false` stops new law
binding while what is bound keeps serving; `loam federate drop` purges her pool byte-for-byte —
and every other friend's channel is untouched.

Whose word wins when two of you contradict each other? Yours to declare, per reading, and there
are two knobs because there are two questions. The gather's **mask** decides whose *retractions*
bind, so a stranger's strike cannot blank a friend's claim under a governed reading; the
policy's **`byAuthorRank`** decides whose *claim* wins when two disagree. Trust is the reader's
lens, not the store's verdict — and Claude can register such a reading for you, inside its
namespace, once it has read the register grammar.

*From chat:* the `loam_federate_*` tools do all of this, but they want federate standing, and a
claude.ai connector holds `write` only. Today the command line is the way; a Claude Code or
Desktop client, or a script, can hold a key of its own (`loam client mint <name> --federate
friends`, then restart `loam serve`). Handing the connector itself federate standing is queued.

## Ways to use it

**A memory that outlives the chat.** Chats end; the store does not.

> "Save a note: I chose tailscale funnel over a reverse proxy because there is nothing to
> configure and TLS is included. Tag it `infra` and `decisions`."

Weeks later, in a fresh chat: *"what did I decide about hosting?"* — and the answer comes back
with when you said it.

**Your people, as a graph.** The stock shelf ships `person` and `org`, and references between
them are typed edges, never strings that happen to contain a name.

> "Create person:ada with name Ada. I follow her. Add org:garden with the two of us as members."

Then *"who is in the garden, by name?"* — shallow-read, so an org lists its people without
dragging in their whole worlds.

**A log of anything.** Books, films, birds, wines. There is no "media log" feature and you do not
need one: with its `mine:` namespace, Claude reads the store's own registration manual, defines
the shape, and files entries as itself. Your log, its clerk. Open a channel to a friend and their
entries arrive under the prefix you assign, each still signed by them.

**An interviewer that files as it goes.** Flip the direction: *"interview me about the dinner
party and file each person with a bio line and who they know."*

**Scripts and bots as citizens, not gods.** A cron job, a home-automation hook, a second agent —
each gets a key of its own with one command on the store's machine:

```bash
loam client mint watcher --register-prefix "watch:"
```

The bearer prints once. Everything the watcher writes names the watcher, and one
`loam client revoke watcher` retires it without touching a word it wrote.

## Two things worth knowing early

**An empty answer is not always an empty store.** Reads are masked for callers the store does
not recognize, and a masked read looks exactly like no data. If a view comes back suspiciously
empty, ask Claude to call `loam_whoami` first — it answers who the store thinks the caller is and
what standing they hold. "Nothing here" and "not signed in" deserve different reactions.

**The store has a face — for your part of it.** Sign in at `/admin` in a browser and the page
shows the containers under your own name: what arrived since you last looked and from whom, the
channels receiving into them, the connections bound there, the schemas. What Claude files lands
in its inbox inside the container you chose, so the page counts it under your name — and one row
revokes that one connection, leaving every word it wrote in place. The whole store, wherever it
is, is the command line's (`loam store`, `loam federate list`, `loam grant list`).

**A connection reads what it can see.** Claude reads the container it is bound to — your claims
there, its own, and the pools composed into it — and nothing outside. Ask about something you
filed elsewhere and the honest answer is empty; consent again into that container, or into a
wider one, and the same connection sees it. `loam_whoami` names the binding.

## Going deeper

- `loam_docs()` — the store lists everything it can teach; `loam_docs(topic: "register-grammar")`
  is the full schema-definition manual Claude reads before growing a shape or a second reading.
- The [interactive tutorial](https://bombadil-labs.github.io/loam/tutorial.html) — a real store
  in your browser, fifteen lessons, no install, ending with the store walking out of the tab.
- [The quick-start](quick-start.md) — the four movements that got you here, for the next machine
  or the next friend.
