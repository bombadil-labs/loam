# The night the lanes reviewed each other

Seven tickets landed in one night (T210, T203, T208, T204, T205, T207, and T206 in flight at
dawn), built by parallel worktree lanes, each reviewed by independent lenses, each fix reviewed
again. This entry records what the PRs cannot: the cross-lane pattern, and the process
discoveries that cost real time and must not be re-paid.

## The rounds pattern, measured again, at scale

T113 taught it once; tonight measured it three more times. T204's round-1 fix was the worst bug
in its diff — a name-scoped veto over a contender-scoped report, introduced while fixing a real
finding, caught only because round 2 aimed at round 1's fix. T206 ran four rounds; round 3
found the wrong negation predicate inside round 2's fix (`lawfulNegated` where a reader's
question wanted `dataStruck` — the repo's own comment names the split, and the fixture corpus
was 100% operator strikes, so the two derivations coincided: H10's disguise on the sharpest
rails in the file). T205's review found the struck caption reading raw `negationsOf`; fixing it
surfaced two more bugs (`performAtomicWrite`'s explicit key list silently dropping a new field;
revocation-by-client stranding a re-keyed connector). The rule stands and generalizes: a round
that returns findings has not converged, and the next round aims at the fixes. A lane that
refuses to record `p5-complete` until a round comes back clean is doing it right.

## Worktree mechanics that bit every lane

- **Worktrees share the ref store.** Another lane's fetch moves your `origin/main` without you
  fetching. Two mutation gates measured against a base that had silently advanced swept in
  files their lane never touched. Every `--base` must be a pinned SHA. The tell:
  `git diff --stat <base> HEAD` lists files you did not write.
- **The red-proof dance destroys uncommitted work.** `git checkout HEAD -- <file>` to prove a
  rail red discards the fix you have not committed. Back the file up outside the repo first.
  One lane wrote a commit message for a change the checkout had silently discarded — caught,
  corrected in-branch.
- **hollow-test's in-flight record is a refusal, not a lock to clear.** Kill it mid-run and
  the next run refuses; clear only after proving the current bytes are git-clean against HEAD
  (making git authoritative and the record stale). After a rebase it says "matches neither the
  original nor the mutant" — correct behavior, same proof required.
- **A rebase invalidates revision-bound evidence.** Records naming a replaced commit go stale;
  re-measure against the shipping tree and have each new record name what it supersedes.
- **Concurrent lanes flake frozen rails.** Two files (probation-frame, closure-cost) went red
  only under multi-lane load (26–42 load average, 48 vitest workers), clean in isolation, base
  tree equally affected. Ticketed (T221) rather than re-run into silence.

## The lens economics, priced

Verification-free finder rounds plus one verifier per finding held. The night's totals: five
landings' worth of lens rounds produced roughly forty confirmed findings; every serious one
(T204's veto, T205's struck caption, T206's revival predicate, T207's silent custody gap) was
found by a lens aimed at code the author believed finished, and each fix introduced at least
one defect the next round caught. The system caught the mistakes; no model avoided them.

## Operational note

GitHub's ssh endpoint (port 22) went unreachable mid-night; `gh` (HTTPS) kept working. The
origin remote was switched to HTTPS with `gh auth setup-git` credentials. If ssh returns and
Myk prefers it, switch back with `git remote set-url origin git@github.com:bombadil-labs/loam`.
