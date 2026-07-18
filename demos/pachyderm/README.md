# PACHYDERM — the third real Loam app

A timeline with no company. Your posts live in **your** store, signed. Following someone **is**
pulling their store. And the headline: **the algorithm is a lens you own** — your feed is a
resolution program running in your store, swappable like any Schema, and you can keep several
(the proof ships two: `Feed`, everything in order, and `Latest`, the what-just-happened reading)
over the *same* posts, evolving on your clock, not a product team's.

The trick under the timeline: the feed is a **well-known entity** (`feed:main`) every author
links their posts onto. Entities are unowned, so when you pull the people you follow, their
links and yours merge onto the same feed in your store — **the union is the timeline**. There is
no fan-out service, no home-timeline builder, no ranking pipeline. There is a query you own.

## Run the proof

```sh
npm run build
node demos/pachyderm/pachyderm.mjs   # Alice, Bob, Carol — 7 checks, three sovereign stores
```

`homes/` is disposable and untracked.

## The honest parts (what other protocols theater around)

- **Erasure without pretending.** Alice erases a post: her store forgets it byte-for-byte. Her
  tombstone travels to Bob on his next pull — and *binds nothing there*, because erasure is each
  operator's alone (§11). Bob still remembers; sovereignty cuts both ways. Then Bob **honors**
  her request with his own operator's erasure. No delete-request pretending to be a guarantee —
  the protocol tells you exactly what forgetting means, and the demo asserts all three states.
- **Attribution is computed, not claimed.** A post's byline comes from a §22 resolver reading
  the claim's cryptographic authorship. (Found while building: that resolver applies on direct
  reads but not yet to posts as *expanded children* of the feed — filed as a platform ticket
  with a genuine design question inside it. The demo says so in its own comments; honesty is
  house style.)
- **A boost is a claim citing the original** — provenance rides forever; a reply is an edge. No
  quote-tweet screenshot laundering: the citation is structural.

## Sequels

Image posts (the §23.7 byte-door makes them natural), trust-roster follows (the follow graph
*becoming* the §8 trust data), notification lenses, and DMs — the last named honestly as **not
yet designed** (private messaging needs a capability conversation, not a context string).
