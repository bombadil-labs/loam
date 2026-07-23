# Moving Loam development into WSL

A one-time runbook. Delete it once the move has settled and the journal carries the record.

## Why

- **`gate-fuzzing` cannot run on Windows.** It executes adversary-generated diffs and requires an OS
  sandbox — `bwrap` on Linux, `sandbox-exec` on macOS. Windows has neither, and
  `--unsafe-no-sandbox` is documented as VM-only. This is the one ADLC gate we simply cannot use.
- **Two local patches stop being necessary.** `scripts/patch-adlc-npx.mjs` and
  `scripts/patch-adlc-init.mjs` both fix Windows-only defects (`O_TRUNC` without `O_CREAT`; a bare
  `npx` spawn Node won't resolve without PATHEXT). On Linux neither bug exists.
- **The environment matches CI**, which has always been the ground the green bar is judged on.

## What you give up

WSL sessions in the desktop app do not load **plugins**. That is the whole ADLC plugin surface: the
`adlc` discovery skill, `/adlc:*` commands, the PreToolUse rail hook, the MCP tools, and the seven
`adlc:prosecutor-*` agents. The `adlc` **CLI** is unaffected — every `adlc <tool>` command works.

Two consequences worth naming before you start:

1. **CLAUDE.md carries a fallback phase index** for exactly this reason. It is deliberately thin;
   the skill is authoritative whenever it loads.
2. **P5's independent reviewer gets BETTER, not worse.** The prosecutor panel is the plugin's and
   goes dark — but `adversarial-review` is a CLI, so it survives, and it is the stronger
   instrument: `--providers gpt,gemini,claude` merges independent reviews with cross-provider
   corroboration, which is the cross-model independence ADLC gates P5 on. No API keys needed to
   start; it drives the local `claude` CLI on your subscription and, when the reviewer is the same
   model, runs it in a fresh isolated context and says so.

   **This is a reason to move, not a cost of moving.** It cannot run on Windows at all: the
   assembled prompt (~18 KB) exceeds the ~16 KB argv limit and the local agent rejects it on stdin,
   and the `claude` CLI refuses to start without a POSIX shell. Both vanish on Linux.

The in-session rail hook is also gone, which makes `scripts/rails-guard-ci.mjs` the only rail
enforcement left. It already runs on every PR and does not depend on the plugin.

## Prerequisites

Already satisfied on this machine, listed so a future reader can check:

| | |
|---|---|
| WSL 2 (WSL 1 is not supported) | ✅ Ubuntu 22.04.5 LTS |
| `git` inside the distribution | ✅ 2.34.1 |
| `bwrap` for gate-fuzzing | ✅ `/usr/bin/bwrap` |
| node build deps | ✅ `curl` `gpg` `dirmngr` `gawk` `build-essential` |

## 1. Node, via asdf

asdf v0.14.0 is installed and sourced correctly from both `~/.bashrc` and `~/.bash_profile`. Node
was missing for a duller reason than a loading failure: **only the `elixir` and `erlang` plugins
were ever added, neither has a version installed, and `~/.asdf/shims` is empty.** There was nothing
for asdf to provide. Nothing is broken; node was simply never installed.

Loam needs **Node 24** (`engines: >=24`, and CI pins 24).

```bash
asdf plugin add nodejs
asdf install nodejs latest:24
asdf global nodejs "$(asdf latest nodejs 24)"

# a new shell, or re-source, so the shim lands on PATH
exec bash -l
node -v   # expect v24.x
npm -v
```

`asdf global` writes `~/.tool-versions`, which is what was missing. Note the verb: **v0.14 uses
`asdf global`**; v0.16+ renamed it to `asdf set`. Check `asdf --version` before trusting a tutorial.

If `asdf install` fails on signature verification, the plugin's keyring is the usual cause:

```bash
bash ~/.asdf/plugins/nodejs/bin/import-release-team-keyring
```

## 2. Clone into the Linux filesystem

Clone into the distribution's own filesystem — **not** `/mnt/c`. Files under `/mnt/c` cross the 9p
bridge on every read, which is slow and breaks file watching.

```bash
cd ~
git clone https://github.com/bombadil-labs/loam.git
cd loam
npm ci
npm run check          # expect the full green bar
```

## 3. ADLC

```bash
npm i -g @adlc/cli
adlc --version
adlc init              # idempotent; owns .gitignore's .adlc block
adlc ticket store status   # expect backend "directory", 27 tickets
```

**Do not run `npm run adlc:patch`.** Both patches target Windows-only bugs. The init patch is
win32-guarded and would no-op; the npx patch would rewrite a call that already works. They stay in
the tree for as long as anyone builds on Windows.

Then confirm a gate you expect to **fail** actually fails — a toolchain you have only seen pass has
proven nothing:

```bash
adlc run p1            # expect exit 2, "missing evidence: spec-lint, premortem"
node scripts/rails-guard-ci.mjs origin/main
```

## 4. Start the session

In the desktop app: **new session in the Code tab → environment picker → the WSL section → Ubuntu →
folder picker → `/home/mykola/loam` → trust the folder.** The first session in a distribution takes
longer while Claude installs itself inside it.

Trust is granted per distribution *and* folder — trusting a path on Windows does not carry over to
the same path in WSL.

Opening a `\\wsl.localhost\...` folder from the ordinary folder picker also works; it reopens inside
the distribution. What does **not** work is pointing a *Windows* session at a WSL path: the files
are Linux but every process is still Windows. Measured, with cwd inside the distribution:

```
platform:    win32
uname:       MINGW64_NT-10.0-22621
bwrap here?: ABSENT        # though /usr/bin/bwrap exists in that same Ubuntu
```

## 5. Afterwards

- Retire the Windows worktree rather than syncing both; two clones of a repo whose gates bind to a
  revision is a way to prosecute one tree and merge another.
- `gate-fuzzing` becomes available. It still needs a suite at `.adlc/gate-suite.json` and provider
  keys, and it is designed to run nightly rather than per-commit.
- Fold what actually happened into `journal/` and delete this file.
