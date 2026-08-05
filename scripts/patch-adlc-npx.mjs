#!/usr/bin/env node
// Re-appliable local patch: `adlc review` cannot spawn `npx` on Windows.
//
// @adlc/cli's `runExternal` (lib/dispatch.mjs) does `spawnSync('npx', [pkg, ...args])` to reach the
// separate `adversarial-review` CLI. On Windows the executable is `npx.cmd`, and Node does NOT do
// PATHEXT resolution for a non-shell spawn — so the call dies `spawnSync npx ENOENT` even though
// `npx` resolves fine in any shell. Net effect: `adlc review` has never worked on Windows, which is
// how this repo ran for two weeks with its independent reviewer silently absent (see CLAUDE.md P5).
//
// THE OBVIOUS FIX IS A TRAP, TWICE OVER, and both halves are worth recording.
//
// Naming `npx.cmd` alone turns `ENOENT` into `EINVAL`: Node ≥18.20.2 REFUSES to spawn a `.bat`/`.cmd`
// without `shell: true` (the CVE-2024-27980 argument-injection fix). The first version of this patch
// therefore set `shell: true` on win32 — and a prosecutor pass called that out as stepping around a
// mitigation rather than satisfying it. With `shell` enabled Node stops escaping argv and hands
// cmd.exe a joined string, so any forwarded argument containing a space (a repo path under
// `My Documents`) is silently word-split, and any `&`, `|`, `^` or backtick is executed. `adlc review`
// forwards diff paths and free-text prompts, so that is live input. A review pointed at the wrong
// target is precisely the silent-wrong-answer this script exists to prevent.
//
// So this patch takes the third road: spawn NODE ITSELF against npm's own `npx-cli.js`. No `.cmd`, no
// shell, argv stays a real array, and the CVE mitigation is satisfied rather than disabled.
//
// THIS IS A GLOBAL PACKAGE PATCH, so `npm i -g @adlc/cli` wipes it. That is why this is a script
// rather than a hand-edit: run `node scripts/patch-adlc-npx.mjs` after any adlc upgrade. It is
// idempotent, it counts call sites rather than testing presence, it READS THE FILE BACK to verify,
// and it refuses rather than guessing if upstream has changed the line (which would mean the fix has
// landed, or moved).
//
// Upstream: github.com/voodootikigod/adlc — remove this script once a released @adlc/cli spawns
// correctly on Windows.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const NEEDLE = `spawnFn('npx', [packageName, ...args], { stdio: 'inherit' })`;
// The two earlier shapes of this patch. Both are treated as UNPATCHED so a re-run replaces them —
// leaving a `shell: true` spawn in place would keep the argument-escaping hole open.
const LEGACY =
  `spawnFn(process.platform === 'win32' ? 'npx.cmd' : 'npx', [packageName, ...args], ` +
  `{ stdio: 'inherit', shell: process.platform === 'win32' })`;
const LEGACY_HALF =
  `spawnFn(process.platform === 'win32' ? 'npx.cmd' : 'npx', [packageName, ...args], ` +
  `{ stdio: 'inherit' })`;

// Asking npm where its global root is has the SAME problem this whole script is about, and the first
// draft of this rewrite walked straight into it: `execFileSync('npm.cmd', …)` without a shell throws
// EINVAL, exactly as the header describes two paragraphs up. Knowing the trap in the abstract did not
// prevent stepping in it — which is the running lesson of this repo, so it is written down here too.
//
// The way out is the same third road: spawn NODE against npm's own `npm-cli.js`, which ships beside
// the running node binary. No `.cmd`, no shell, no CWD-precedence hole.
const nodeAdjacentNpm = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const globalRoot = existsSync(nodeAdjacentNpm)
  ? execFileSync(process.execPath, [nodeAdjacentNpm, "root", "-g"], { encoding: "utf8" }).trim()
  : // POSIX fallback: a bare `npm` is a real executable there, so a shell-free spawn resolves it.
    execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
if (!isAbsolute(globalRoot)) {
  console.error(
    `adlc-npx-patch: 'npm root -g' gave a non-absolute path (${globalRoot}) — refusing.`,
  );
  process.exit(1);
}

const npxCandidates = [
  join(globalRoot, "npm", "bin", "npx-cli.js"),
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"),
];
const npxCli = npxCandidates.find((c) => existsSync(c));
if (npxCli === undefined) {
  console.error(
    [
      "adlc-npx-patch: cannot find npm's npx-cli.js — refusing to patch. Looked in:",
      ...npxCandidates.map((c) => `  ${c}`),
    ].join("\n"),
  );
  process.exit(1);
}
const PATCHED =
  `spawnFn(process.execPath, [${JSON.stringify(npxCli)}, packageName, ...args], ` +
  `{ stdio: 'inherit' })`;

// npm honors `npm_config_prefix` and `.npmrc`, so the global root is environment-influenced. Pin the
// write target inside it rather than trusting whatever came back.
const target = resolve(globalRoot, "@adlc", "cli", "lib", "dispatch.mjs");
if (!target.startsWith(resolve(globalRoot))) {
  console.error(`adlc-npx-patch: refusing to write outside the global root (${target}).`);
  process.exit(1);
}

let source;
try {
  source = readFileSync(target, "utf8");
} catch {
  console.error(`adlc-npx-patch: cannot read ${target} — is @adlc/cli installed globally?`);
  process.exit(1);
}

// COUNT call sites rather than testing presence. A first-occurrence-only replace that then reports
// "already applied" forever is hazard H7 — an operation claiming a completeness it never verified —
// and it would be especially galling in the script whose job is un-silencing the reviewer.
const count = (hay, needle) => hay.split(needle).length - 1;
const stale = count(source, NEEDLE) + count(source, LEGACY) + count(source, LEGACY_HALF);
const alreadyPatched = count(source, PATCHED);

if (stale === 0) {
  if (alreadyPatched > 0) {
    console.log(`adlc-npx-patch: already applied (${alreadyPatched} call site(s)), nothing to do.`);
    process.exit(0);
  }
  // Refuse rather than guess. Either upstream fixed it (good — delete this script) or the call
  // moved (in which case a blind regex would corrupt someone's global CLI install).
  console.error(
    [
      "adlc-npx-patch: the expected spawn call is not present in dispatch.mjs.",
      "  Upstream may have fixed this (check `adlc review --help`) or restructured it.",
      "  Refusing to patch — inspect the file rather than letting this guess.",
    ].join("\n"),
  );
  process.exit(2);
}

let patched = source;
for (const from of [NEEDLE, LEGACY, LEGACY_HALF]) patched = patched.split(from).join(PATCHED);
writeFileSync(target, patched, "utf8");

// Read it back. The header used to claim this script "verifies before and after" while doing no such
// thing — an unverified write is the promise-without-evidence this repo keeps tripping over.
const after = readFileSync(target, "utf8");
const left = count(after, NEEDLE) + count(after, LEGACY) + count(after, LEGACY_HALF);
const now = count(after, PATCHED);
if (left > 0 || now === 0) {
  console.error(
    [
      `adlc-npx-patch: VERIFICATION FAILED — ${left} unpatched call site(s) remain, ${now} patched.`,
      `  ${target} may be in a mixed state; inspect it before running adlc review.`,
    ].join("\n"),
  );
  process.exit(1);
}
console.log(
  `adlc-npx-patch: applied to ${target} — ${stale} site(s) rewritten, ${now} verified after write ` +
    `(spawns node against npx-cli.js; no shell, argv stays an array).`,
);
