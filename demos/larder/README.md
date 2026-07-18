# LARDER — the first real Loam app

A shared grocery list and pantry for a household. That's it. That's the app.

Except: there is **no server**. No signup, no account, no company holding your list. Each
household member runs their own Loam store; the app — its schemas, its claim vocabulary, its UI —
is a **bundle of signed deltas** (`bundle/`, five small JSON files) that a Claude with a loam MCP
connection installs by conversation ([SKILL.md](SKILL.md) is that conversation's manual). "Add
milk" from either phone; the fridge tablet shows the list served **from the store itself**; your
partner's check-off tap is a cryptographically signed write. When you're offline you keep working,
and the lists converge when you next pull — because the list was never a document, it was a
*reading over a union of claims*.

## Run the proof

```sh
npm run build
node demos/larder/larder.mjs   # Ann and Ben: install, share, check off, converge — 7 checks
```

`homes/` is disposable and untracked, like the village's.

## The quiet machinery (what you never have to think about)

- **Checking off your partner's item is outsaying, not unsaying.** `got` is a later claim that
  outweighs an earlier `need`. Nobody edits anybody's data; nobody wrote a permissions system;
  the substrate *is* the permissions.
- **Two lenses read one ground.** The Groceries reading (what's needed) and the Pantry reading
  (what's on hand) are different resolutions of the same item claims — coexisting, evolving
  independently. (§21.7, three days old, already earning a living.)
- **The UI is data too.** The list page and the check-off page are renderers — deltas in the
  store, pinned readings, served anonymously because the operator *declared* them public (§23).
- **The tablet's tap has provenance.** Tokenless check-offs are signed by a provisioned *pen*
  (§23.3) — custody in config, authority in an on-ground grant, revocable by striking it.

## The sequels (and why they need zero integration code)

- **Party** — "do we have enough beer for Saturday's BBQ?" A new bundle whose lens joins the
  event's guest-count claims with the *Pantry reading Larder already keeps*. No API. No webhook.
  A new reading over shared ground.
- **Recipes** — "I want to make Italian next week." A recipe bundle plus Claude (or a §6 derived
  function) turning a meal-plan claim into `need` claims. Larder never has to know.

Apps on Loam compose the way lenses do: by reading each other's claims. Larder was built without
anticipating either sequel — which is the whole point.

---

*Born 2026-07-18 as the celebration app for the §21→§27 arc — and within its first minute of
existing it found a real gap in the platform (a renderer couldn't bind to a non-degenerate lens
name; fixed the same hour). Using what you ship finds what shipping missed.*
