# The archive trusted commit subjects, and the rail was right to go red

2026-08-05. A stale-store cleanup archived fifteen tickets whose `status` fields still said
open. The verification was commit-subject matching: a commit on main whose subject cites the
ticket id counted as its landing. The capabilities book's rail then went red — `T88 is
ARCHIVED — the gap the book describes has been closed; rewrite it` — and the book was right.

**The heuristic failed because commit subjects are not landings.** T88's matched commit
described the residual it deliberately left open (decide-then-build, Myk's merge). T89's
matched commit was design-stage work; its body opens "DESIGN-STAGE. Deliverable is a working
spec… then STOP for Myk's word." T90's matched commit decided the framing of a new atomicity
promise — the ticket body says "DESIGN-STAGE (a new atomicity promise, so it needs Myk's word
before code)". Three of the fifteen were design-stage or decide-then-build tickets with real
landing-looking commits. All three were restored; the rail went green again.

**The rule that survives this session:** a ticket is archived only when its OWN body's
acceptance criteria are met in the tree — never on commit-subject evidence alone. Design-stage,
decide-then-build, "Myk's merge", and "REMAINING" markers in the body mean OPEN no matter what
a commit says. The capabilities rail is the backstop that makes this recoverable: it goes red
the moment an archived ticket's gap is still cited as open, which is exactly what happened, and
exactly why it exists.

**Second lesson, operational:** `git checkout` carries uncommitted changes across branches, and
`git add -A` then sweeps them into whatever commit you make next — the archive's fifteen shard
moves rode into a T61 fix commit this way, and the T61 lens fixes rode back into the archive
commit. The fix that worked: `git stash push -- <pathspec>` to quarantine the foreign changes
before committing, and `git diff <base> --stat` to verify a commit contains exactly what it
claims. A per-ticket worktree (the house pattern) makes the class impossible; the same session
that learned this moved the next ticket to its own branch and stopped switching with a dirty
tree.

Also landed this session: T61 (the comment sweep — four sites stripped of draft/audit
narration, verified by three independent P5 lenses plus a refuting verifier) and T150 item 1
(the register door now names a malformed Policy's prop path and shapes). Both self-merged on
the ordinary bar.
