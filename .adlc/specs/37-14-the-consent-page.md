# §37 phase 14 — The consent page (working spec, T135)

**Ticket.** T135. **Status.** Working spec, transcription of the phasing plan (Myk approved
2026-07-27). Every criterion is verbatim from the plan; this spec only names each one's verification.
**Landing PR is Myk's merge** (it decides — plan §9c), but the design is the approved plan, so this
is transcription, not invention.

**One sentence.** `GET /oauth/authorize` renders a consent page behind a phase-5 session, and its
approval POST mints a single authorization code bound to the client and its exact redirect URI —
minting no seed and no token (those are phase 15).

## What it delivers

- `GET /oauth/authorize` — the consent page. Behind a phase-5 session; without one it renders the
  login form and mints nothing.
- The approval `POST` — carries phase-6's same-origin + form-token defence; on success mints one
  authorization code and redirects to the registered `redirect_uri` with `code` and `state`.
- The code: a short-lived, single-use secret bound to `client_id` AND `redirect_uri`, with a
  monotonic expiry. Redemption is phase 15.

## What it must not do

- It must not mint an actor seed or an access token. (Enumerated: the mint path's only output is a
  `code` record; assert no seed field and no token digest is written — criterion in the rail.)

## Acceptance criteria

Every criterion is proved in `test/server/oauth-consent.test.ts` unless a backtick command is named.

1. **The page requires a phase-5 session.** `GET /oauth/authorize` without the session cookie renders
   the login form (200, the login HTML) and mints nothing. Verified in `test/server/oauth-consent.test.ts`:
   assert the response body is the login page AND the oauth file's code list is unchanged (empty).
2. **`redirect_uri` must EXACTLY match one registered for that client.** A different path, an added
   query, and another port are each refused. Verified in `test/server/oauth-consent.test.ts`: three
   negative cases (path, query, port), each refused, each with a POSITIVE control that the exact
   registered uri is accepted — a rail of only negatives passes on an unrelated answer (plan §2).
3. **No response carries a `Location` outside the allowlist, on EVERY refusal path.** Verified in
   `test/server/oauth-consent.test.ts`: for each refusal (no session, bad redirect_uri, cross-site
   POST), assert the response has no `Location` header pointing off the registered origins. The
   open-redirect fence is asserted on the refusal paths, not only the happy path.
4. **The page escapes `client_name`, displays the REGISTERED uri (never caller text), and carries a
   no-script CSP.** Verified in `test/server/oauth-consent.test.ts`: register a client whose
   `client_name` contains `<script>`; assert the rendered page HTML-escapes it, shows the registered
   `redirect_uri` string, and the response `Content-Security-Policy` forbids script (reuse §36's CSP
   constant).
5. **The approval POST carries phase-6's same-origin check and form token.** A cross-site-shaped
   approval (missing/failed form token, or a foreign `Origin`) mints nothing. Verified in
   `test/server/oauth-consent.test.ts`: a POST without a valid form token is refused and the code
   list stays empty; a POST with a valid same-origin form token mints one code (positive control).
6. **A minted code binds to `client_id` AND `redirect_uri`; its expiry is monotonic.** Verified in
   `test/server/oauth-consent.test.ts`: assert the stored code record carries both fields; assert
   that a wall-clock STEP BACKWARDS (a stepping clock injected into the door) does not extend the
   code's deadline — expiry is computed from a monotonic deadline recorded at mint, not re-read from
   the clock (the §36 phase-8 `expiresAt` lesson, applied here).
7. **The consent copy states the powers a grant really carries.** A granted author is a lawful
   striker, so it can retract claims the operator wrote — the page SAYS this. Verified in
   `test/server/oauth-consent.test.ts`: assert the rendered consent HTML contains the plain-language
   warning that the connector can retract operator-written claims. Narrowing that power is T118, not
   this phase.

## Rails

Declared at P3 when the tests exist and are RED. The rail file is `test/server/oauth-consent.test.ts`
— this phase owns it and shares it with no other phase (plan §1 rule i). This phase adds no
precondition to a door an earlier phase railed (rule ii): it adds a NEW door (`/oauth/authorize`),
leaving `/oauth/register` and the session doors untouched.

## Landing

First phase of §37's second group to touch it after 13? No — §37 already exists (`spec/37-connectors.md`,
§37.1–37.3). This phase EDITS it, adding a §37.4 (the consent page) with a Provenance footer, and adds
one `{says, spec, proof}` claim to §37's chapter in `demos/capabilities/chapters.mjs` or
`test/site/capabilities.test.ts` stays red. Archive T135 on landing.
