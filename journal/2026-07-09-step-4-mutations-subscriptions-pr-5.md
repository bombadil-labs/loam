## 2026-07-09 — Step 4: Mutations + subscriptions (PR #5)

The gateway learned to write and to watch. `mutate`: one field per schema, one argument per
policy prop; each provided argument becomes a signed property-claim delta through the same
validated write-through path, and the response is the re-resolved view. A seedless gateway
refuses to write. `subscribe`: an initial snapshot, then one patch per relevant change
(`_fromHex → _hex`, `_changed`, fields re-resolved), on a lazily-created cached materialization
per (schema, entity). 76/76 green.

Learnings worth keeping:

- **A suspended async generator cannot be left.** `return()` on a generator parked on a pending
  promise waits for that promise — a subscription built on one hangs whoever tries to leave.
  The `Channel` implements the AsyncGenerator protocol directly, so `return()` always lands.
  The same rule forced the graphql-subscribe wrapper to be a pass-through object, not a
  generator.
- **Backpressure is coalescence, not growth.** A slow reader holds at most one pending patch;
  the merge keeps the hex chain honest (`pending.fromHex → incoming.hex`) and unions the
  changed-sets. Three writes against a parked reader arrive as one truthful patch.
- **Sinks fire inside the writer's ingest.** A subscriber whose re-resolution throws must fail
  its own stream and detach — never abort the fan-out or make the mutation look failed when the
  delta already landed.
- **The review caught three quiet lies**: a patch whose view didn't move (HView changed, View
  identical — now silence); `close()` stranding parked readers (now every channel ends first);
  and `${name}@${entity}` lazy-mat names colliding with legitimate schema names (lazy names now
  live in a NUL alphabet schemas are refused entry to; `__proto__` props are refused for the
  plain-object-setter trap).
