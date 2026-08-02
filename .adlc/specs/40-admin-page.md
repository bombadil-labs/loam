# §40 — The admin page: a user's containers, through the browser

**Ticket.** T141 (authored with this spec). **Status.** Working spec. Myk commissioned the feature in
chat (2026-08-02): *"loam serve should serve an admin page scoped to the container associated with
the logging-in user and its children… all the major operations you'd imagine a user would want to be
able to do, through the browser."* He also ruled the role model the same night: actor-role users may
manage their own connections — tenant non-operator users get isolated MCP connections scoped to
their containers. The base branch is `admin-page`; phases merge into it; the whole branch is Myk's
morning P6 into `main`.

**One sentence.** A signed-in user gets `/admin`: a server-rendered, no-script page over exactly
their own container subtree, with forms for every major operation — declare / detach / drop
containers, register schemas, browse members and resolved views, promote deltas, federate in, and
manage MCP connections.

## 40.1 The model

1. **A user's world is a container subtree.** The user's ROOT container is the container named
   exactly `<username>`. Their reach is that container plus every descendant by `parent` edge — the
   same `within()` walk `connectionScope` already uses (§39.1.2). No root container yet: the page
   offers one button, "create your container", and nothing else is possible until it exists.
2. **The session is the authority; the server is the signer.** The page is gated by the §36 session
   (any role — Myk's ruling). Operations that need the OPERATOR's signature (container declarations
   are operator law) are signed by the server with the home's seed, but ONLY after the door proves
   the target name lies inside the session user's subtree. Operations that write data are signed
   with the USER's own seed (`user.<name>.seed`, the phase-8 seam) — the user acts, the operator
   provisions. This is §39.1.3's split, applied to the browser.
3. **Scope is enforced at the door, not drawn on the page.** Every POST re-derives the subtree from
   the live container table and refuses a target outside it. User A's session addressing user B's
   container is a 403 that does not confirm B's container exists.
4. **Same defence posture as consent (§37.4).** Server-rendered HTML, no-script CSP, every value
   escaped, every POST behind the same-origin check + session-bound form token, session read via
   `peek` on GETs (never sliding on refused traffic), no `Location` off-origin, no home paths or
   flag names in any refusal.
5. **Opt-in like the other doors.** `/admin` exists only when `users` is configured (a home with
   `credentials.json`). Absent, the path resolves as it always did — unrouted.

## 40.2 The operations (what "major" means)

| Panel | Operations | Signs as |
|---|---|---|
| Containers | declare child (shared w/ membership Term, or separate), detach (KEEP), drop (DISCARD, confirm form), reattach a detached one | operator (subtree-checked) |
| Schemas | register `{hyperschema, schema, roots, writable}` (the same body as `loam register` / `POST /:mount/register`) | operator (registration is store law) |
| Data | list a container's members (id, author, timestamp, contexts); resolved VIEW through a registered schema | read-only |
| Promotion | promote a delta from a container to the primary ground (T33's promote) | operator (subtree-checked) |
| Federation | pull an offer URL or pasted offer body into a chosen container of the subtree | user seed |
| Connections | list MCP connections bound to subtree containers (client name, actor key, generation, live tokens); revoke one | owner/user seed (§39.3c) |

Deliberately NOT in scope: user management (CLI-only — the standing §36 decision), erasure/slating
(operator surface, §11 — a user "drop" of their own container IS the §39 total-forget, already
railed), renderer publishing, and any operator-wide store view. `/admin` never shows another user's
subtree, even to an operator-role session — an operator who wants the whole store has the CLI; the
page's contract is "YOUR containers", one shape for everyone.

## 40.3 Phasing — each lands green on the base branch

- **A1 — the door and the read surface.** `GET /admin` (dashboard: subtree tree, connections,
  schemas), container detail page (members list), "create your container" for a fresh user. Rails:
  `test/server/admin-door.test.ts`.
- **A2 — container lifecycle.** Declare child / detach / drop / reattach forms + POSTs. Two-sided
  drop rails. Rails: `test/server/admin-containers.test.ts`.
- **A3 — schemas and data.** Register form; resolved-view page. Rails:
  `test/server/admin-schemas.test.ts`.
- **A4 — promotion and federation.** Rails: `test/server/admin-promote.test.ts`.
- **A5 — connections.** List + revoke. Rails: `test/server/admin-connections.test.ts`.

## 40.4 Acceptance criteria

Every criterion names its rail file; each negative carries a positive control.

1. `GET /admin` without a session renders the login form and changes nothing; with a session it
   renders the user's subtree and ONLY theirs. Two users, two subtrees, no overlap; the page for A
   never contains B's container names. `test/server/admin-door.test.ts`.
2. Session reads on GET use `peek` (no slide); every POST requires same-origin + the session's form
   token; a forged token changes nothing. `test/server/admin-door.test.ts`.
3. The CSP forbids script on every admin response; every echoed name (container, client, schema) is
   escaped — a `<script>` container name renders inert. `test/server/admin-door.test.ts`.
4. A fresh user (no root container) sees the create offer; POSTing it declares container
   `<username>` (operator-signed); the dashboard then shows it. `test/server/admin-door.test.ts`.
5. Declaring a child inside the subtree succeeds and the table shows the `parent` edge; declaring a
   name OUTSIDE the subtree (another user's name, an unrelated top-level) refuses 403 without
   confirming existence. Positive control beside each refusal. `test/server/admin-containers.test.ts`.
6. Detach records and keeps; the detached container shows in a "detached" listing and its members
   are out of the gather (the §28 detach contract, driven through the form).
   `test/server/admin-containers.test.ts`.
7. Drop is a CONFIRM form (two steps), and two-sided: the dropped separate container's bytes are
   gone AND a named sibling container and the primary's members survive.
   `test/server/admin-containers.test.ts`.
8. Register accepts the same JSON body as `loam register`, refuses a malformed one naming the defect
   without echoing server paths, and a registered schema resolves a view on the data page.
   `test/server/admin-schemas.test.ts`.
9. The members list shows a container's gather (post negation-closure — a struck member's strike is
   visible, §39.4); the view page resolves through the registered Schema. Both levels, one page
   each. `test/server/admin-schemas.test.ts`.
10. Promote moves a chosen delta into the primary ground exactly as `gw.promote` does, subtree-gated,
    and the promoted delta then resolves in the primary read. `test/server/admin-promote.test.ts`.
11. Federate-in lands a pasted offer's deltas in the chosen subtree container (through its door,
    admission intact — a delta the container's membership refuses does not enter), user-signed.
    `test/server/admin-promote.test.ts`.
12. The connections panel lists exactly the connections bound to subtree containers (from
    `oauth.json` grants × the container table), and revoke drives §39.3c: the connection's next
    write refuses, its past deltas keep their author, a second connection is untouched.
    `test/server/admin-connections.test.ts`.
13. No admin response ever carries a `Location` outside the server's own origin, on any path
    including every refusal. `test/server/admin-door.test.ts`.
14. Nothing in any admin response names the home path, a seed filename, or a flag. Induce a lock
    fault; assert the body. `test/server/admin-door.test.ts`.

## 40.5 What lands where

New file `src/server/admin.ts` (the door, panels, forms — one file, the oauth.ts pattern), wired in
`src/server/http.ts` beside the consent door (built when `users` is configured; `connectors`
optional — without it the connections panel says the store has no connector flow configured). No
change to `accounts.ts`, no change to rhizomatic, no new delta shapes (declarations, grants,
registrations, promotes all reuse landed vocabulary). No §20 migration owed.
