#!/usr/bin/env node
// Re-appliable local patch: `adlc init` cannot scaffold an existing repo on Windows.
//
// @adlc/init's `writeFileNoFollow` (lib/scaffold.mjs) opens its target with
// `O_WRONLY | O_TRUNC | O_NOFOLLOW` whenever the file already exists. On Windows that flag set is
// rejected outright — `O_TRUNC` without `O_CREAT` is EINVAL — so every write to a file that is
// already there dies before a byte moves. The exclusive branch (`O_CREAT | O_EXCL`) is fine, which
// is why this fails so selectively: `adlc init` HAPPILY creates `.adlc/config.json` and `.adlc/specs/`
// on a fresh tree, then dies the moment it reaches an existing `.gitignore`.
//
// That partial success is the whole problem. Init is the step that teaches a repo ADLC's conventions,
// and the convention it never got to write is the one that says which parts of `.adlc/` are the
// committed CONTRACT (`config.json`, `tickets.json`, `tickets/`, `specs/`) and which are local
// runtime evidence (`findings.jsonl`, `manifest.jsonl`). Loam hand-wrote an approximation instead and
// committed evidence files ADLC means to keep local — a divergence nobody could see, because the
// tool that would have corrected it exited 1 on a file it had no trouble reading.
//
// THE FIX IS SCOPED TO WIN32 ON PURPOSE. Adding `O_CREAT` unconditionally would also work, but it
// would widen POSIX behavior (ENOENT becomes create) on every platform to fix a bug on one. Guarding
// on `process.platform` keeps POSIX semantics byte-identical and confines the change to the OS that
// is actually broken. `O_NOFOLLOW` is already 0 on Windows, so no symlink protection is traded away
// here — on that platform the defense is `rejectSymlinkComponents`, which this patch does not touch.
//
// THIS IS A GLOBAL PACKAGE PATCH, so `npm i -g @adlc/cli` wipes it — run it after any adlc upgrade
// (`npm run adlc:patch` runs it alongside the npx patch). Idempotent, counts call sites rather than
// testing presence, READS THE FILE BACK to verify, and refuses rather than guessing if upstream has
// restructured the call.
//
// Upstream: github.com/voodootikigod/adlc — remove this script once a released @adlc/cli opens
// existing files correctly on Windows.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const NEEDLE = ": constants.O_WRONLY | constants.O_TRUNC | noFollow;";
const PATCHED =
  ": constants.O_WRONLY | constants.O_TRUNC | noFollow | " +
  "(process.platform === 'win32' ? constants.O_CREAT : 0);";

// Reaching npm to find the global root has the same shell-free-spawn problem the npx patch documents:
// `npm.cmd` without a shell throws EINVAL. Spawn node against npm's own CLI instead.
const nodeAdjacentNpm = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const globalRoot = existsSync(nodeAdjacentNpm)
  ? execFileSync(process.execPath, [nodeAdjacentNpm, "root", "-g"], { encoding: "utf8" }).trim()
  : execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
if (!isAbsolute(globalRoot)) {
  console.error(
    `adlc-init-patch: 'npm root -g' gave a non-absolute path (${globalRoot}) — refusing.`,
  );
  process.exit(1);
}

// npm honors `npm_config_prefix` and `.npmrc`, so pin the write target inside the resolved root
// rather than trusting whatever came back.
const target = resolve(
  globalRoot,
  "@adlc",
  "cli",
  "node_modules",
  "@adlc",
  "init",
  "lib",
  "scaffold.mjs",
);
if (!target.startsWith(resolve(globalRoot))) {
  console.error(`adlc-init-patch: refusing to write outside the global root (${target}).`);
  process.exit(1);
}

let source;
try {
  source = readFileSync(target, "utf8");
} catch {
  console.error(`adlc-init-patch: cannot read ${target} — is @adlc/cli installed globally?`);
  process.exit(1);
}

// Count call sites rather than testing presence — a first-occurrence replace that then reports
// "already applied" forever is a completeness claim nobody verified (H7).
const count = (hay, needle) => hay.split(needle).length - 1;
const stale = count(source, NEEDLE);
const alreadyPatched = count(source, PATCHED);

if (stale === 0) {
  if (alreadyPatched > 0) {
    console.log(
      `adlc-init-patch: already applied (${alreadyPatched} call site(s)), nothing to do.`,
    );
    process.exit(0);
  }
  console.error(
    [
      "adlc-init-patch: the expected open-flags expression is not present in scaffold.mjs.",
      "  Upstream may have fixed this (try `adlc init` on Windows) or restructured it.",
      "  Refusing to patch — inspect the file rather than letting this guess.",
    ].join("\n"),
  );
  process.exit(2);
}

writeFileSync(target, source.split(NEEDLE).join(PATCHED), "utf8");

const after = readFileSync(target, "utf8");
const left = count(after, NEEDLE);
const now = count(after, PATCHED);
if (left > 0 || now === 0) {
  console.error(
    [
      `adlc-init-patch: VERIFICATION FAILED — ${left} unpatched site(s) remain, ${now} patched.`,
      `  ${target} may be in a mixed state; inspect it before running adlc init.`,
    ].join("\n"),
  );
  process.exit(1);
}
console.log(
  `adlc-init-patch: applied to ${target} — ${stale} site(s) rewritten, ${now} verified after write ` +
    `(adds O_CREAT on win32 only; POSIX flags unchanged).`,
);
