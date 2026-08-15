## 44. The front door

The first thing anyone does with a served store's URL is open it in a browser, and until this
landed the answer was a JSON refusal — correct, and mute. The bare root is the one path with no
world behind it, so it is the one path that can afford a human answer: `GET /` serves a greeting —
one self-contained HTML page that says what Loam is, points at the doors, and tells the reader,
honestly, why it will not say more.

### 44.1 The greeting is a constant, and the constancy is the security property

The page is a **compile-time constant** — one string in `src/server/http.ts`, served verbatim to
every caller, answered *before* any identity or mount resolution runs, because there is nothing on
this path for resolution to decide. It is blind to the mount table, the token presented (valid,
invalid, or absent — a bad token does not downgrade the answer, because there is no anonymous
variant to downgrade to), every public declaration, and whether the operator has configured human
accounts at all. This is not modesty; it is the same money the uniform refusals (§17) pay
everywhere else. A front page that varied on any of those axes would be an enumeration oracle — a
mount's existence readable from a 404-vs-401 difference, a store's having-people readable from
whether the page mentions logging in — and the accounts axis is railed to *byte identity*: a store
with credentials on disk and a store with none serve the same bytes under the same headers, and the
rail first proves the two stores genuinely differ at `/login` so the parity means something.

The constancy also settles the headers. The body being identical for every caller means a shared
cache can hold it and cannot leak by holding it — so the greeting is the one door that DECLARES
itself cacheable, `Cache-Control: public, max-age=300`; the JSON doors set no cache header at all,
which leaves them to a cache's heuristics rather than to a promise. It carries the session pages'
own CSP constant, all six directives (`default-src 'none'`, `script-src 'none'`,
`style-src 'unsafe-inline'` — the page's one inline style block — `form-action 'self'`,
`frame-ancestors 'none'`, `base-uri 'none'`) — the page has no script and no form today, and the header
is what keeps that true of whatever it grows into — and `Referrer-Policy: same-origin`, the house
policy for documents this store serves (§36's T143 lesson: `no-referrer` on HTML makes Chrome send
`Origin: null` on any form such a page ever grows, and a weaker policy leaks the store's URL to
wherever a future link points).

### 44.2 What the words may say

Every path the page names **exists on every store**. It names the door *shapes* —
`/<mount>/graphql` to ask, `/<mount>/subscribe` to listen, `/<mount>/rest` and `/<mount>/mcp` for
the same worlds in other tongues — and one fixed path, `/login`, as the human door. Naming fixed
paths is safe precisely because they are fixed: `/login` sits at the same address on every store,
and where no accounts are configured it refuses exactly as any unresolved name does, so the
sentence stays true, and constant, either way. What the page never names is a mount — and it says
so, on the page: *which worlds live here is between you and your token*. It also states the
refusal discipline in the reader's terms: a door that refuses you is not saying nothing is there,
only that it will not say.

And the prose promises only what the store honours. The first draft overpromised twice and the
corrections are load-bearing: history is a **default, never a guarantee** — the page says the past
stays legible *by default* and names the erasure (§11) as the one act that takes bytes back, on
purpose, because a store whose front door says "the ground remembers" is lying the moment an
operator exercises §11; and federation is **admission, not osmosis** — two stores merge what each
has *agreed to admit* from the other (§8), never simply whatever they meet. The rail holds this at
the truth level in both directions: the qualifiers must be present, and the old unqualified
spellings must stay gone — a reworded overpromise extends the banned list rather than deleting it.

### 44.3 The edges

The greeting lives at exactly `GET /`. A POST to `/`, a mount's bare root, and an absent mount all
answer precisely as they did before the greeting existed — the ordinary door discipline, untouched.
The one companion is `GET /favicon.ico` → `204`: every browser asks for the icon before anything
else, and 204 is the quiet true answer — nothing is here, and nothing is wrong.

**Provenance.** Landed in [#273](https://github.com/bombadil-labs/loam/pull/273) (the constant
greeting, the favicon 204, and the frozen shape rails — byte-identity across mounts and tokens in
`test/server/front-door.test.ts`, with a declared store compared against a bare one) and
[#361](https://github.com/bombadil-labs/loam/pull/361) (T104: the words — what Loam is, the
`/login` link, `Referrer-Policy: same-origin` — with the truth-level and accounts-parity rails in
`test/server/front-door-greeting.test.ts`). Implementation: the `GREETING` constant and `greeted`
in `src/server/http.ts`.
