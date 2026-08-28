## 54. The guided init

`loam init` finishes the job. On a terminal, or under any guided flag, it carries a newcomer from
`npm i -g @bombadil/loam` to a living store in one command: the operator identity, a login user, a
stocked shelf, and the printed next step — the serve command and where to sign in. The measured
gap this section closes: before it, a fresh init left a store with no user to be and *no queryable
surface at all*, and the two commands that fix that were the two a newcomer could not guess.

Three rules give the flow its shape. **The initial user's name is never invented** — it arrives
by `--user` or an interactive prompt, and a guided invocation that can satisfy neither refuses
before writing anything, naming both exits. The password arrives at the prompt (twice, echo off)
or by `--password-file`, never a bare flag. **Skipping is explicit**: `--no-user` and `--no-stock`
each print what the skip costs; `--stock` selects from the shelf, dependencies riding along;
contradictory pairs refuse. **The bare path survives byte-for-byte**: a flagless init in a pipe
is exactly what it always was — two files, no prompts — because hundreds of scripts and rails
call it that way, and a rail now pins the old output literally.

The flow is honest about being several acts with no transaction around them. Every completed step
says so in its own line; every refusal before the home exists leaves the directory untouched and
says "Nothing was done."; a cancelled prompt (Ctrl-D, Ctrl-C) exits 1 as `cancelled`, never 0. A
re-run converges: the first identity is kept, a duplicate user is refused in the user machinery's
own voice while already-bound stock skips, and the ready line — with the sign-in step — prints
only when everything it presupposes actually exists and binds. A guided re-run against a home a
live server holds draws the T103 staleness warning from the stock pass, the same sentence every
other writing verb prints. And a shelf entry that cannot bind does not exist as a quiet outcome:
a contender is always skipped and a rival program always throws, so the landed-but-unbound state
cannot arise — the branch that would have disclaimed it is a loud refusal instead, exiting 1 with
the substrate's own sentence and crowning nothing.

**Provenance.** Ordered and shaped by Myk (the guided-init rules, 2026-08-27); realized by T249
(PR #490). Implementation: the guided branch and its pure trigger in `src/cli/cli.ts`
(`isGuidedInit`, `cmdInitGuided`, `stockSelection`, `installStock`), the echo-on prompt in
`src/cli/prompt.ts`. The rails are `test/cli/guided-init.test.ts`.
