# The posture rename, and the one exemption the freeze will ever learn

**Date:** 2026-07-26. **PRs:** #241 (the mechanism), #238 (the rename). No ticket — both were
Myk's direct calls in chat.

`ContainerPosture` is now `"separate" | "shared"`. The axis is STORAGE — own bytes, or a reading
over ground the host already holds — and "wall" survives only where it names §28's law boundary,
which genuinely is a wall. A §20 migration re-signs surviving declarations and negates the
originals; the door refuses the retired words and names `loam migrate`, while every reader still
resolves both — a strict reader would have made a legacy store's containers silently vanish.

The rename's real cost was twelve frozen rails quoting the retired words, and Myk's ruling on it
is the durable part: *"I'm reluctant to accept bad precedent because we can't know in advance what
will end up in a limited context window in the future."* So the discipline lives in the gate, not
in a PR body. `scripts/rails-guard-ci.mjs` learned exactly one exemption — an authorized
vocabulary rename, declared in `scripts/rail-renames.json` and read FROM THE BASE TREE, so a
branch cannot self-authorize and the flow is two PRs, mechanically enforced. An edit is exempt iff
base + the declared substitution is byte-identical to the branch's file (directly or after the
repo's own prettier — six of the twelve files reflow, because the new words are longer). Exempt
files fold into a synthetic base commit rather than being skipped, so suppression scanning and
every other check still run over them; the exemption prints its authorization, never fires
silently; and the load-bearing rail in `test/scripts/rail-renames.test.ts` is the one that proves
a well-formed declaration written on the branch exempts nothing.

The consumed entries are removed in the same landing — a spent authorization is inert (the
substitution no longer reproduces the base) but an empty file is the honest steady state: red
always means stop, and nothing in this repo's future needs lore about which red was blessed.
