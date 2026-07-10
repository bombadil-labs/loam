---
name: grow-a-store
description: Grow a new Loam store into the running village — a schema, some starting facts, and it joins the confluence in one command. Use when asked to "build a store for X", "add an app to the village", or to demonstrate growing a store mid-meeting.
---

# Grow a store

This skill belongs to the village demonstration; the full recipe lives in `_testing/README.md`,
section **"Growing a new store"** — read it and follow it. In short:

1. Write a schema file for whatever was named, copying the shape of the worked example
   `_testing/schemas/sighting.json`: an UpperCamel singular `name`, the canonical gather `body`
   (verbatim), a `policy` whose `props` name the fields (`pick` = latest value, `all` = a list),
   and the `roots` to hold live.
2. Optionally write a starting-facts file — triples like
   `[{ "at": "sighting:1", "context": "species", "value": "heron" }]`.
3. Run `node _testing/grow.mjs <name> --port <p> --schema <file> [--claims <file>]`.

If the village is running (`node _testing/village.mjs`, dashboard at http://127.0.0.1:4400),
watch the event log for `🌱 a new store joins the confluence` — the almanac pulls the newcomer
on its next beat. That first-contact line is the demo beat; nothing else needs a restart.
