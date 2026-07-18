---
name: pachyderm
description: Set up and drive PACHYDERM — a federated timeline living in the user's own Loam store, where following is pulling and the feed algorithm is a lens they own. Use when the user wants to post, follow someone, read their timeline, boost, reply, or set their profile.
---

# Pachyderm — a timeline with no company

Same delivery as Larder and Planner: the app is a delta-bundle; installing is landing it;
using it is speaking its templates through the user's loam MCP connection.

## Install ("set me up on pachyderm")

1. Register, in order: `bundle/post.json` (note its attribution resolver), `bundle/profile.json`,
   `bundle/feed.json`, `bundle/latest.json` — the last two are **two lenses over one gather**;
   the user's timeline algorithm is theirs to extend with more.
2. Publish `renderer-timeline.json` and `renderer-profile.json`; declare `Feed` and `Profile`
   public. The timeline lives at `<store URL>/app/timeline/feed:main`.
3. Set the profile: `mutation { handle(person: "person:<name>", name: "<name>") { delta } }` and
   `bioIs(person, text)`.

## Daily verbs

Posting is a link plus the words (mint slugs like `post:<short-random>`):

```graphql
mutation { linkFeed(entity: "feed:main", field: "post", target: "post:x7f2") { post } }
mutation { say(post: "post:x7f2", text: "…") { delta } }
mutation { stamp(post: "post:x7f2", at: <Date.now()>) { delta } }
```

- **reply** → post as above, then `mutation { replyTo(post: "post:<new>", parent: "post:<theirs>") { delta } }`
- **boost** → `mutation { boost(post: "post:<fresh-slug>", original: "post:<theirs>") { delta } }`
  — a boost is a claim citing the original; provenance is structural.
- **read the timeline** → `{ feed(entity: "feed:main") { post } }`, newest by `at` first.
- **what just happened** → `{ latest(entity: "feed:main") { post } }` — the other lens.

## Following ("follow @sam")

Following **is federation**: pull their store (URL + a token they issued), and their posts merge
onto the user's own `feed:main` — the union is the timeline. Re-pull to refresh. Unfollowing is
simply not pulling; what was already pulled remains (their store, their claims — see erasure).

## Erasure, honestly

If the user erases their own post, their store forgets it byte-for-byte and the tombstone travels
on others' next pulls — but it binds nothing in a follower's store: erasure is each operator's
alone. If someone asks the user to forget a post they pulled, honor it with the user's OWN
erasure (their store, their call). Never present federated deletion as guaranteed; this protocol
does not pretend.
