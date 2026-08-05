# §36-06 repair — a real browser can open the doors (T143)

## The problem

The store's own pages set `referrer-policy: no-referrer`. Under that policy Chrome serializes the
Origin of a same-origin form POST as the literal string `null` (Fetch: only a `no-referrer` policy
nulls the serialized request origin). `fromThisPage` refuses `Origin: null` outright — a decision
this repair does NOT reopen — so every session-gated POST refuses a real browser: login, logout,
the consent approval, every admin form. Every rail was green, because every rail hand-builds its
headers and no rail drives a browser. Myk hit it in the first minute of hand-driving the form.

## The decision (Myk, 2026-08-05, in chat)

**Fix (a): the pages change, the check does not.** The three HTML helpers — the only `text/html`
emitters that host forms (`session.ts` `html`, `oauth.ts` consent `htmlOut`, `admin.ts` `htmlOut`)
— stop sending `no-referrer`. Option (b), treating `Origin: null` as absent, was declined: it
widens a refusal on the authentication surface.

The replacement policy is per page, chosen by what the page's URL contains:

- **Login and admin pages: `referrer-policy: same-origin`.** No referrer ever leaves the origin;
  a same-origin form POST carries a real Origin.
- **The consent door's pages: `referrer-policy: origin`.** The consent URL carries `client_id`,
  `state`, and `code_challenge` in its query. Under `same-origin` that full URL would ride the
  Referer on same-origin navigations; under `origin` no navigation in any direction ever carries
  more than the bare origin — and the one party that can receive it cross-origin (the registered
  `redirect_uri` host) already knows this store's origin, because it registered here and built the
  authorize URL itself. `origin` un-nulls the POST exactly as `same-origin` does. This is the one
  refinement to the choice as named in chat; the PR states it for Myk's judgement.
- **Non-documents keep `no-referrer`:** the JSON helpers (login refusals, register, token) and the
  authorize 302 host no form and initiate no same-origin POST, and the 302 must keep the strictest
  policy toward a foreign `redirect_uri`.

## User stories (Myk approved all three; each story IS a rail)

1. **Login and logout.** Alice opens `/login` in real Chrome, types her name and password, and
   submits the form. She sees the signed-in answer naming her role. She then submits the logout
   form and is signed out. → `test/browser/door-smoke.test.ts`
2. **Consent.** A connector sends Alice to `/oauth/authorize` in real Chrome. She reads the consent
   page and clicks approve. Chrome lands on the registered `redirect_uri` carrying a code. →
   `test/browser/door-smoke.test.ts`
3. **Admin.** Signed-in Alice submits one admin form in real Chrome and sees the change take
   effect on the page she is redirected back to. → `test/browser/door-smoke.test.ts`

## Acceptance criteria

1. The login page, the login/logout answers, and every admin page send
   `referrer-policy: same-origin`; the consent page and its refusals send
   `referrer-policy: origin`. Verified in `test/server/referrer-policy.test.ts` (asserts the
   header on a live response from each named page).
2. The JSON doors (login refusal, register, token) and the authorize 302 still send
   `referrer-policy: no-referrer`. Verified in `test/server/referrer-policy.test.ts` (positive
   control: the policy did not flip everywhere).
3. A coverage floor ties the promise to the SET of pages, not a hand list: no `no-referrer` sits
   in the same header block as `text/html` anywhere under `src/`, and every `no-referrer` in
   `src/server` is one of the named non-document sites (a pinned count — a new page copied from an
   old header block goes red). Verified in `test/server/referrer-policy.test.ts` (source scan).
4. Real Chrome, driven over CDP, completes story 1: load `/login`, fill, submit, assert the
   signed-in body and the session cookie; then submit logout and assert signed out. Verified in
   `test/browser/door-smoke.test.ts`.
5. Real Chrome completes story 2: consent approve lands on the registered `redirect_uri` with a
   `code` in the query — and the request that ARRIVES at the `redirect_uri` listener carries no
   Referer with a path or query (absent, or the bare origin, never the authorize URL). Verified in
   `test/browser/door-smoke.test.ts`.
6. Real Chrome completes story 3: one admin POST succeeds and its effect is visible in the
   following GET. Verified in `test/browser/door-smoke.test.ts`.
7. The browser rail FAILS when Chrome is absent — it does not skip. The failure message names
   `LOAM_CHROME` as the override. Verified in `test/browser/door-smoke.test.ts` (the resolver
   throws; `npx vitest run test/browser` on a box with Chrome proves the resolve path). CI is
   provisioned already: the GitHub `ubuntu-latest` and `windows-latest` images both ship Chrome.
8. Two-sided: a genuinely cross-site POST still refuses. The frozen rail
   `test/server/login-csrf.test.ts` (T127) continues to pass byte-identical — including its
   `origin: "null"` refusal cases, which stay CORRECT under fix (a): the store's own pages no
   longer manufacture a null origin, and a null origin remains attacker-selectable. Verified by
   `npm test` (the frozen file runs unchanged) and by `node scripts/rails-guard-ci.mjs` (no frozen
   rail was edited).
9. No check relaxes: `git diff main -- src/server/session.ts` touches only response headers, never
   `fromThisPage`. Verified by `git diff main -- src/server/session.ts` in the PR review.

## Named gaps (each says which rail would close it, per the P3 rule)

- **Rendered artifact pages and the front-door greeting send no referrer-policy at all.** The
  browser default (`strict-origin-when-cross-origin`) does not null an Origin, so no door refuses
  them today. Criterion 3's scan keeps `no-referrer` from ever reaching them; declaring their
  policy on purpose is follow-up work (artifact-page forms POST via fetch and would deserve their
  own story rail).
- **A browser that sends neither `Origin` nor `Sec-Fetch-Site` on a same-origin POST is refused**
  (old Safari shapes). That is §36-06's landed decision, unchanged here; the door-smoke header
  names it. Widening acceptance would be a new decision for Myk, not part of a repair.
- **Nothing rails origin-agreement behind a TLS terminator** (`--public-url` scheme/port vs the
  Origin a real browser sends through the funnel). This repair's browser rail runs loopback, where
  agreement holds by construction. A funnel-fixture story rail, or a boot-time fault when a refused
  POST's Origin differs from `ownOrigins` only in scheme/port, is a follow-up ticket.

## What this repair must not do

- It must not touch `fromThisPage`, `ownOrigins`, the check order, or any refusal shape.
- It must not edit `test/server/login-csrf.test.ts` or any other frozen rail.
- It must not change the policy on the authorize 302 or any JSON response.

**Provenance (working spec).** T143; Myk chose fix (a) and the three stories in chat, 2026-08-05.
The consent-page `origin` refinement and criteria 3, 5 (Referer at the listener) and the named
gaps were earned by the independent premortem of the same date.
