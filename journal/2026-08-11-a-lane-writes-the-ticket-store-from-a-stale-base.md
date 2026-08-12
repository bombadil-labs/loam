# A lane writes the ticket store from a stale base

2026-08-11. A build lane reported that `adlc ticket update T87 --write` had un-archived T97 and
T98 — moving their shards out of `.adlc/ticket-archive/` back into `.adlc/tickets/`, which per T69
un-freezes their rails at the exact moment those rails start protecting landed behavior. It
reverted the move by hand and flagged the tool.

**The tool is innocent. I could not reproduce it.** Against an isolated copy of the real store,
`ticket update` with an explicit `--ticket-store` and again with default resolution from the
working directory both left the counts unchanged: 66 archived, 43 open, before and after.

**What actually happened is a coordination hazard, and it is worth more than the bug would have
been.** The lane's worktree was cut from `main` BEFORE the archive batch (#374) landed. In that
checkout T97 and T98 were still open tickets, because that is what its base said. The ticket store
is a whole-store artifact: a write rewrites it from the writer's view. So the lane's `update` was
not un-archiving anything — it was faithfully persisting a store in which those two tickets had
never been archived, and the lane read the result as damage.

The hazard generalizes past this instance: **any lane that writes the ticket store from a base
older than another lane's landing will resurrect what that landing archived, silently, as a side
effect of an unrelated update.** The rails-guard backstop cannot see it, because the branch's own
shards are internally consistent. It surfaces only as an archive shard reappearing in a diff that
had no business touching it.

**The rule that follows:** a lane rebases onto `origin/main` BEFORE any `adlc ticket update`, not
merely before opening its PR — and a reviewer treats an unexplained `.adlc/` shard in a diff as a
finding, never as noise. This session's lane did the second half correctly: it noticed, it
reverted, and it said so in the PR body. That is why the merge was harmless. The first half is the
cheaper fix.

**And the wider lesson, which is the one worth keeping:** the lane reported a tool defect in good
faith and its report was wrong. Ten minutes against a throwaway copy of the store turned a scary
tooling ticket into a process note. A finding that names a tool is a hypothesis until someone
reproduces it in isolation; minting the ticket first would have left a permanent accusation in the
backlog against a tool that does its job.
