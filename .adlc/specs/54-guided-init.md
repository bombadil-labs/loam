# §54 — the guided init (working spec, T249)

`loam init` finishes the job. Today it mints an operator identity and stops; the store it leaves
has no user to log in as and no surface to query. The guided flow carries a newcomer from
`npm i -g @bombadil/loam` to a living, stocked, loggable store in one command — and the bare
behavior survives byte-for-byte for every script and frozen rail that calls `init` flagless in a
pipe.

## User stories

- A friend runs `loam init` in a terminal. It mints the operator, asks who they are (a username),
  asks for a password twice with echo off, stocks the shelf, and prints the serve command and the
  login URL shape. They run the printed command and log in.
- A provisioning script runs `loam init --user ada --password-file ./secret --stock all --home ./h`
  with no TTY anywhere, and gets the same living store, no prompts.
- A CI fixture calls `run(["init", "--home", home])` in a pipe, exactly as two hundred existing
  tests do, and gets today's bare init — two files, no prompts, no refusal, byte-identical output.
- A friend who wants only the identity runs `loam init --no-user --no-stock` and is told, in the
  output, that `/login` stays dark until `loam user create` and the surface stays empty until
  `loam register`.

## The rules

1. **The initial user's NAME is never invented.** In the guided flow it arrives via `--user
   <name>` or an interactive TTY prompt — nothing else, no default. The password arrives via the
   TTY prompt (twice, echo off, the existing `user create` machinery) or `--password-file <path>`
   — never a bare flag, which would land in shell history.
2. **Skipping is explicit.** `--no-user` skips user creation and says what that costs.
   `--no-stock` skips the shelf. `--stock <name,…|all>` selects; the default in the guided flow
   is `all`. `--user` with `--no-user` refuses as contradictory; so does `--stock` with
   `--no-stock`.
3. **The guided flow triggers on a TTY or on any guided flag** (`--user`, `--password-file`,
   `--no-user`, `--stock`, `--no-stock`). A flagless non-TTY init is today's bare init,
   byte-for-byte. A guided flag with no TTY and no way to satisfy rule 1 (e.g. `--stock all`
   alone in a pipe) refuses, naming `--user` and `--no-user` as the two exits.
4. **Everything runs server-down by construction** — init precedes serve, so grants and
   registrations bind at boot; the T243 staleness trap cannot fire here.
5. **The user is an operator-role user** (the first user is the person who owns the box; the
   home's seed is already the proof of operatorship, per `loam user`'s own doctrine).
6. **The guided flow ends with the next step**: the serve command for this home and the login
   path, printed, so the story continues without a manual.
7. **Idempotence keeps init's promise.** A second guided init on the same home keeps the first
   identity (as today), refuses to overwrite an existing user of the same name (the user-create
   machinery's own refusal), and re-registering stock is the ordinary skip-if-bound install.

## Acceptance criteria

- (a) GUIDED, non-interactive: `init --user ada --password-file <f> --home <h>` on a fresh home
  mints operator + config, creates user `ada` with the operator role, registers the full shelf
  (six shapes, `shallow-person` via deps), and prints the serve command — all with no TTY.
  Verify: `test/cli/guided-init.test.ts`.
- (b) BARE COMPAT, byte-for-byte: flagless `run(["init", "--home", h])` through a piped io
  produces exactly today's two files and today's output lines, no prompts, exit 0 — asserted
  against the literal strings the pre-§54 init printed. Verify: `test/cli/guided-init.test.ts`.
- (c) RULE 1: `--stock all` alone in a pipe (a guided flag, no TTY, no `--user`, no `--no-user`)
  refuses, exit 2, naming both exits; the same command plus `--no-user` succeeds and stocks the
  shelf with no user. Verify: `test/cli/guided-init.test.ts`.
- (d) EXPLICIT SKIPS: `--no-user` prints the /login-stays-dark note and creates no credential
  file; `--no-stock` leaves the surface empty (the virgin-store refusal still answers GraphQL);
  contradictory flag pairs refuse. Verify: `test/cli/guided-init.test.ts`.
- (e) TTY PROMPTS: with an injected `readSecret`/prompt seam (the embedder option `user create`
  already carries, extended to the name prompt), the interactive path asks name once and password
  twice, refuses an empty name, and refuses mismatched passwords — through the same seam the
  terminal uses. Verify: `test/cli/guided-init.test.ts`.
- (f) SELECTION: `--stock person,event` registers exactly those plus their deps
  (`shallow-person`), and nothing else — the surface serves `person`/`event`/`shallowPerson`
  and refuses `note`. Verify: `test/cli/guided-init.test.ts`.
- (g) IDEMPOTENCE: a second guided run on the same home keeps the operator identity, refuses the
  duplicate user by the user-create machinery's own message, and skips already-bound stock —
  exit codes and messages asserted. Verify: `test/cli/guided-init.test.ts`.
- (h) PASSWORD hygiene: `--password-file` content is used, trailing newline tolerated, the file's
  absence refuses with the path named, and no password ever appears in stdout/stderr (asserted
  over the captured io). Verify: `test/cli/guided-init.test.ts`.

## Provenance (working)
Myk's order and rules in chat, 2026-08-27. Ticket T249. The frozen-rail constraint (hundreds of
bare `init` calls in existing tests, many frozen) is what pins rule 3's flagless-non-TTY bare
path.
