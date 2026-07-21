#!/usr/bin/env node
// Re-appliable local patch: `adlc review` cannot spawn `npx` on Windows.
//
// @adlc/cli's `runExternal` (lib/dispatch.mjs) does `spawnSync('npx', [pkg, ...args])` to reach the
// separate `adversarial-review` CLI. On Windows the executable is `npx.cmd`, and Node does NOT do
// PATHEXT resolution for a non-shell spawn — so the call dies `spawnSync npx ENOENT` even though
// `npx` resolves fine in any shell. Net effect: `adlc review` has never worked on Windows, which is
// how this repo ran for two weeks with its independent reviewer silently absent (see CLAUDE.md P5).
//
// The fix needs BOTH halves, and the first one alone is a trap worth recording: naming `npx.cmd`
// turns `ENOENT` into `EINVAL`, because Node ≥18.20.2 / 20.12.2 / 21.7.3 REFUSES to spawn a
// `.bat`/`.cmd` without `shell: true` (the CVE-2024-27980 argument-injection fix). So the patch
// sets `shell` on win32 as well. Scoped to win32 rather than applied everywhere, because `shell`
// changes argument quoting for every caller and there is no reason to alter POSIX behavior.
//
// THIS IS A GLOBAL PACKAGE PATCH, so `npm i -g @adlc/cli` wipes it. That is why this is a script
// rather than a hand-edit: run `node scripts/patch-adlc-npx.mjs` after any adlc upgrade. It is
// idempotent, it verifies before and after, and it refuses rather than guessing if upstream has
// changed the line (which would mean the fix has landed, or moved).
//
// Upstream: github.com/voodootikigod/adlc — remove this script once a released @adlc/cli spawns
// correctly on Windows.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WIN = "process.platform === 'win32'";
const NEEDLE = `spawnFn('npx', [packageName, ...args], { stdio: 'inherit' })`;
const PATCHED =
  `spawnFn(${WIN} ? 'npx.cmd' : 'npx', [packageName, ...args], ` +
  `{ stdio: 'inherit', shell: ${WIN} })`;
// A half-applied patch (filename fixed, shell missing) is the EINVAL state — treat it as unpatched
// so re-running completes the job rather than reporting success over a still-broken CLI.
const HALF = `spawnFn(${WIN} ? 'npx.cmd' : 'npx', [packageName, ...args], { stdio: 'inherit' })`;

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell: true }).trim();
const target = join(globalRoot, "@adlc", "cli", "lib", "dispatch.mjs");

let source;
try {
  source = readFileSync(target, "utf8");
} catch {
  console.error(`adlc-npx-patch: cannot read ${target} — is @adlc/cli installed globally?`);
  process.exit(1);
}

if (source.includes(PATCHED)) {
  console.log("adlc-npx-patch: already applied, nothing to do.");
  process.exit(0);
}

if (source.includes(HALF)) {
  writeFileSync(target, source.replace(HALF, PATCHED), "utf8");
  console.log(`adlc-npx-patch: completed a half-applied patch in ${target}`);
  process.exit(0);
}

if (!source.includes(NEEDLE)) {
  // Refuse rather than guess. Either upstream fixed it (good — delete this script) or the call
  // moved (in which case a blind regex would corrupt someone's global CLI install).
  console.error(
    "adlc-npx-patch: the expected spawn call is not present in dispatch.mjs.\n" +
      "  Upstream may have fixed this (check `adlc review --help`) or restructured it.\n" +
      "  Refusing to patch — inspect the file rather than letting this guess.",
  );
  process.exit(2);
}

writeFileSync(target, source.replace(NEEDLE, PATCHED), "utf8");
console.log(`adlc-npx-patch: applied to ${target}`);
