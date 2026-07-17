#!/usr/bin/env bash
# The fresh-run ritual (demos/village/README.md, ticket T20): wipe the standing homes and run every
# act from a clean seed, in numeric order, printing one summary line per phase. The witness's own
# script, so the ritual is one command instead of a for-loop retyped per slice.
cd "$(dirname "$0")/../.." || exit 1
rm -rf demos/village/homes
for i in $(seq 0 23); do
  echo "== phase$i: $(timeout 180 node demos/village/phase$i.mjs 2>&1 | tail -1)"
done
for n in bytes pinned guestbook quarantine; do
  echo "== phase-$n: $(timeout 180 node demos/village/phase-$n.mjs 2>&1 | tail -1)"
done
