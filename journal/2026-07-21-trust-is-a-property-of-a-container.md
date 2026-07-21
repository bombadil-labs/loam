# Trust is a property of a container

**2026-07-21** — design conversation; ticket T36, [rhizomatic#27](https://github.com/bombadil-labs/rhizomatic/issues/27)

No code landed. What landed is a re-founding of the trust model, arrived at in conversation, and the
record of how it was reached matters as much as the conclusion.

## How it went

It started as a survey question — Myk asked what other special cases were latent in the container
knob vector, once quarantine and module were named. Enumerating them turned up a candidate I flagged
as risky: *is a tenant a container?* Rather than speculate I read §7 and `trust.ts`, and the answer
was more interesting than either option on the table.

**Trust today is operator-scalar.** One declaration at `loam:trust`, store-wide, operator-authored.
And tenants are not a weaker trust domain — §7's own correction says tenant machinery survives as
"vocabulary for author-communities and read lenses, not as write fences," with entities unowned. So
tenants are not trust principals at all.

Better: §7 had already flagged this neighborhood and deferred it — *"per-tenant admin chains still
mint community-vocabulary grants while constitutional strikes require store standing — revisit with
trust-is-data (step 13)."* Trust-is-data landed. The revisit never happened. The question had been
sitting in the spec with a forward pointer nobody collected.

Myk's move was to collapse it: **trust is a property of a CONTAINER.** A store is the root container,
tenants are containers within it, containers nest. Operator trust is just the root's trust.

## The correction that mattered, and the one that mattered more

I proposed that child trust may only NARROW its parent's — intersection, not override — arguing from
the escalation case (operator rosters `[alice]`, tenant adds `mallory`, tenant just admitted mallory
to the store).

Myk broke it with one example: Bob spins up a container and federates in a remote source. Under pure
intersection, Bob can admit nothing the operator has not already blessed — which pressures the
operator toward blanket `open`. Exactly backwards.

The resolution was that I had one word doing two jobs:

- **ADMISSION** — may these bytes enter this container? **Delegates downward freely.**
- **BINDING** — does this law have force? **Attenuates**, and crosses upward only by promotion.

§8/§12's inert-by-default already separates these; I had collapsed them and applied the right rule to
the wrong axis. And the corrected shape turns out to be something already built: **a child container
is a quarantine relative to its parent** — a place where untrusted law may bind, inside and nowhere
else, promotion the only crossing. §24, one level down. When a new design turns out to be an existing
one at a different depth, that is usually evidence it is right.

## What fell out for free

Two things stopped being judgement calls and became derivations:

- **The trust knob determines the boundary knob.** A container admitting what its parent does not
  trust MUST be a wall, because a child that is merely a *scope* over shared ground would put the
  stranger's bytes in the parent's store, excluded from a default read but present. §24.1's argument
  and the copy-knob framing arrive at the same rule from opposite directions.
- **The operator's real stake is nameable**: not "I vouch for your sources" but **"I can forget, and I
  cap the bill"** — erasure reach (§24.8, built) and the resource envelope (§24.5, T34). That
  re-priced T34 from a hardening nicety to the thing that makes hosting delegated trust safe at all.

## The feasibility check, which is the reusable part

Before writing any of it up I checked whether it is buildable, and the answer split along the same
two axes — which is itself a small confirmation the split is real:

- **Admission is not a lens.** `admitForImpl` resolves a policy and returns a plain JS predicate.
  Composing it down a container tree is ordinary host recursion. No substrate constraint, any depth.
- **Binding is a lens, and lenses are stratified.** `inView` is banned inside `inView.term` at parse
  time (`term-json.js`). So a *live, in-lens* trusted set reaches exactly one link — which is why
  `lawfulStrikersJson` is shaped the way it is, and why §7's residual existed in the first place.
- **The workaround is sound**: resolve the tree in TypeScript and bake the flattened result in as an
  `inSet` rather than an `inView`. Any depth, today. It costs the property rhizomatic#2 was valued
  for — the lens stops being one live source of truth — and the risk is a host that forgets to
  re-derive and silently reads a stale set.

Filed as rhizomatic#27, deliberately as an enhancement rather than a blocker, and with "state that
hosts should flatten, and close the question" offered as a real acceptable outcome rather than a
polite fallback. rhizomatic is frozen; the design builds against the bake path regardless.

## Learnings

**A survey question is cheap and pays oddly well.** "What else is latent in this configuration?" was
one sentence and it surfaced a four-year-old-shaped hole. Enumerating the cells of a design's own
vector is a move worth making routinely once a vector exists.

**When a rule gets broken by a counterexample, check whether the word is overloaded before weakening
the rule.** The fix here was not a weaker intersection rule; it was noticing that "trust" named two
different things and that each wanted a different rule. The instinct to soften the constraint would
have produced a worse design than the instinct to split the term.

**Check feasibility before writing the section, not after.** Reading `admitForImpl` and the
stratification error took a few minutes and changed what the ticket says — it turned "this may need a
rhizomatic change" into "half needs nothing, half has a workaround with a named cost." A section
written before that check would have hedged in the wrong places.
