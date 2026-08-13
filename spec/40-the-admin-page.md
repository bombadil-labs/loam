## 40. The admin page — a user's containers, through the browser

A store's containers were reachable only from the CLI, which meant a user could not see their own
world, and the §39 connection model could not be exercised by a person at all. `/admin` closes that:
a server-rendered page where a signed-in user reads and runs their own container subtree.

### 40.1 A user's world is a container subtree

A user's ROOT container is the one named exactly `<username>`. Their reach is that container plus
every descendant reached by a `parent` edge — and, since §39, by an `inboxOf` edge, so a connection's
inbox travels with the container that spawned it. A user with no root container yet meets one button,
"create your container", and nothing else is possible until it exists.

The page never shows another user's subtree, **even to an operator-role session.** An operator who
wants the whole store has the CLI. The page's contract is *your* containers, one shape for everyone —
which is what makes it safe to hand to any role.

### 40.2 The session authorizes; the server signs; the door enforces

The three-way split of §36 and §39 arrives in the browser intact. The §36 session says *who you are*.
A container declaration is operator law, so the **server** signs it with the home's seed — but only
after the door proves the target name lies inside that session user's subtree. Data writes are signed
with the user's own key (`user.<name>.seed`, the §36 phase-8 seam). The user acts; the operator
provisions.

**Scope is enforced at the door, never drawn on the page.** Every POST re-derives the subtree from the
live container table rather than trusting a rendered form, so a stale page cannot outlive the
authority it was rendered under. Two-step operations — drop, revoke — re-check both the subtree and
the confirm token at the second step, closing the window between a confirmation page and its return.

A session addressing a container outside its subtree receives a 403 whose bytes are **identical** to
the answer for a container that does not exist. Existence is not a thing the page will confirm.

### 40.3 What the page does

| Panel | Operations | Signs as |
|---|---|---|
| Containers | declare a child (shared with a membership Term, or separate), detach, drop behind a confirm, reattach | operator, subtree-checked |
| Schemas | register `{hyperschema, schema, roots, writable}` — the same body `loam register` sends | operator; registration is store law |
| Data | a container's members, and a resolved View through a registered schema | read-only |
| Promotion | promote a delta from a container into the primary ground | operator, subtree-checked |
| Federation | paste an offer body (a peer's `GET /federate` JSON or a store's export) into a container of the subtree — paste-only, the network leg of a pull stays with `loam pull`, and the page never fetches a caller-named URL | the pasted deltas' own signatures; the page adds no authorship |
| Connections | the MCP connections bound to subtree containers, and revoking one | the user's seed |

Deliberately absent: user management (CLI-only, the standing §36 decision), erasure and slating (an
operator surface, §11 — though a user's own container drop *is* the §39 total forget), renderer
publishing, and any store-wide view.

### 40.4 The same defence posture as consent

The page inherits §37.4's posture rather than inventing one: server-rendered HTML with a no-script
CSP, every echoed value escaped, every POST behind the same-origin check and a session-bound form
token, the session read with `peek` on GETs so refused traffic never slides an idle window, no
`Location` that leaves the origin, and no home path or flag name in any refusal — detail goes to
`onFault`, never to the caller.

Like the other doors, `/admin` is opt-in: it exists only where `users` is configured. Absent that, the
path resolves exactly as it did before — unrouted.

**Provenance.** [#324](https://github.com/bombadil-labs/loam/pull/324) (the door and read surface),
[#325](https://github.com/bombadil-labs/loam/pull/325) (container lifecycle),
[#326](https://github.com/bombadil-labs/loam/pull/326) (schemas and data),
[#327](https://github.com/bombadil-labs/loam/pull/327) (promotion and federation),
[#329](https://github.com/bombadil-labs/loam/pull/329) (cross-phase audit fixes), landed together as
[#330](https://github.com/bombadil-labs/loam/pull/330) — `src/server/admin.ts` with its wiring in
`src/server/http.ts`, proved by `test/server/admin-door.test.ts`,
`test/server/admin-containers.test.ts`, `test/server/admin-schemas.test.ts`,
`test/server/admin-promote.test.ts` and `test/server/admin-connections.test.ts`. Working spec:
`.adlc/specs/40-admin-page.md`. Ticket T141.

**A note on this section's own history.** #330 merged without this file, its `SPEC.md` row, or its
capabilities chapter — all three P6 obligations. The capabilities rail could not catch it: it proves
every `spec/` file is claimed by a chapter, so a section that does not exist is invisible to it. The
gap and the rail's blind spot are recorded in the journal.
