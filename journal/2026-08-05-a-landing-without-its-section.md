# A landing without its section, and the rail that could not see it

§40 (the admin page, T141) merged as #330 carrying none of its three P6 obligations: no
`spec/40-*.md`, no `SPEC.md` index row, no capabilities chapter, and the ticket left unarchived at
phase `p3`. I merged it. I had checked the green bar, both audits, and CI on both platforms — and not
the landing obligations, because I was treating "is the code right" as the whole question.

**The rail cannot catch this shape, and that is the durable lesson.**
`test/site/capabilities.test.ts` proves every file in `spec/` is claimed by exactly one chapter. It
reasons from the section files that EXIST. A landed feature with no section file is invisible to it —
there is nothing for the rail to find unclaimed. So the book stayed green while the spec silently
stopped describing the system.

The same hole covers the index row and the archive: nothing computes "features on main" and diffs it
against "sections in `spec/`". The obligations are enforced by a human remembering them, which is the
enforcement CLAUDE.md spent this repo's whole history trying to remove.

Two candidate closes, neither built yet: a rail that reads the ticket store and fails when an
ARCHIVED ticket names a `spec/` file that does not exist (cheap, catches the archive path); or one
that fails when a merged ticket's `scope` names `src/` files whose feature has no section (harder to
define, catches more). The first is small enough to be worth doing.

What I did instead, this time: wrote the section from the working spec, added its row and its three
chapter claims, archived the ticket. The section carries a note about its own late arrival, because a
reader deserves to know a Provenance footer was written after the fact rather than with the change.
