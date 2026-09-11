# The second sweep

A fresh judge per ten tickets read every open shard against main at 2867348. Eighty-two open.
The count by verdict: 7 landed, 11 half-landed, 30 live and buildable, 16 blocked on Myk's word,
and 18 more live that wait on a slice above them. Every verdict cites a file, a line, or a commit.

**What the sweep found.** Seven tickets had landed and never heard: T193 and T196 and T275 and T280
under their own names, T279 as #557 with #560, T201 fixed in place, and T213 fixed by T257. Eleven
more are half-landed, and each body now overstates what remains. The eleven: T44, T53, T93, T103,
T105, T152, T188, T190, T202, T244, T263. Three bodies are wrong on their face. T274 is titled
"SPEC 59", and §59 now belongs to local channel incarnations. T91 names a posture and a report
function that no longer exist. T77 points at `spec/29-*`, which is slating and graveyards now.

**Why the shards drifted this far.** Between 2026-09-04 and 2026-09-10 a second model worked this
repo, and the two did not read the same ticket fields. The newer shards carry `state` where the
older carry `status`, and thirty-two carry neither. A landing PR archived the tickets it named and
no other. The 2026-08-25 entry said a periodic sweep is the only honest broom. This entry says the
broom is needed more often when two hands are on the store.

**What the sweep could not do.** Every write to the ticket store is a signed manifest entry, and
the signing key was not in the cloud session. The key Myk pasted from memory did not verify any
entry in the forest, root or segment. So the seven archives and the eleven body rewrites wait for
the key on the box that made the chain. The verdicts are in this entry so that they do not wait
with them.

**The verdicts, in short.** Archive: T193, T196, T201, T213, T275, T279, T280. Rewrite: the eleven
above. Blocked on Myk: T65, T76, T77, T90, T99, T115, T137, T144, T179, T181, T183, T221, T225,
T252, T268, T271. Live and buildable now, cheapest first: T284, T272, T276, T236, T234, T269 half
(a). PR #567 was closed the same day: its cleanup vocabulary was superseded by spec 64.

**One process note.** The judges ran on the session's default model. Upkeep work of this shape
does not need the largest model; name a smaller one on every fan-out.
